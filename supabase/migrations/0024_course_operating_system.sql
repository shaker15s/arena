-- MASAR 3.2 — 0024: Course Operating System Foundation

BEGIN;

-- 1) Course owner column
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 2) Course Roles table
CREATE TABLE IF NOT EXISTS public.course_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'organizer', 'coordinator', 'instructor_delegate')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (course_id, user_id, role)
);
CREATE INDEX IF NOT EXISTS idx_course_roles_course ON public.course_roles(course_id);
CREATE INDEX IF NOT EXISTS idx_course_roles_user ON public.course_roles(user_id);

ALTER TABLE public.course_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS course_roles_select_policy ON public.course_roles;
CREATE POLICY course_roles_select_policy ON public.course_roles FOR SELECT TO authenticated USING (true);

-- 3) Domain Events table (Central semantic ledger)
CREATE TABLE IF NOT EXISTS public.domain_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  semantic_key TEXT UNIQUE NOT NULL,
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_domain_events_entity ON public.domain_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_domain_events_actor ON public.domain_events(actor_id);
CREATE INDEX IF NOT EXISTS idx_domain_events_type ON public.domain_events(event_type);

ALTER TABLE public.domain_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS domain_events_select_policy ON public.domain_events;
CREATE POLICY domain_events_select_policy ON public.domain_events FOR SELECT TO authenticated USING (public.is_manager() OR actor_id = public.my_profile_id());

-- 4) Update status constraints for Course, Batch, Session
ALTER TABLE public.courses DROP CONSTRAINT IF EXISTS courses_status_check;
ALTER TABLE public.courses ADD CONSTRAINT courses_status_check CHECK (status IN ('draft', 'pending_approval', 'published', 'running', 'completed', 'archived', 'cancelled'));

ALTER TABLE public.batches DROP CONSTRAINT IF EXISTS batches_status_check;
ALTER TABLE public.batches ADD CONSTRAINT batches_status_check CHECK (status IN ('scheduled', 'active', 'completed', 'archived', 'cancelled'));

ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_status_check;
ALTER TABLE public.sessions ADD CONSTRAINT sessions_status_check CHECK (status IN ('scheduled', 'live', 'closed', 'cancelled'));

-- 5) Enhanced can_manage_course function
CREATE OR REPLACE FUNCTION public.can_manage_course(p_course_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID := public.my_profile_id();
BEGIN
  IF v_actor IS NULL THEN RETURN FALSE; END IF;
  IF public.is_manager() THEN RETURN TRUE; END IF;
  
  IF EXISTS(SELECT 1 FROM public.courses WHERE id = p_course_id AND owner_id = v_actor) THEN
    RETURN TRUE;
  END IF;
  
  IF EXISTS(SELECT 1 FROM public.course_roles WHERE course_id = p_course_id AND user_id = v_actor AND role IN ('owner', 'organizer', 'coordinator')) THEN
    RETURN TRUE;
  END IF;

  RETURN EXISTS(
    SELECT 1 FROM public.batches
    WHERE course_id = p_course_id AND instructor_id = v_actor AND status <> 'archived'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.can_manage_course(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_course(UUID) TO authenticated;

-- 6) RPC: assign_course_role
CREATE OR REPLACE FUNCTION public.assign_course_role(
  p_course_id UUID,
  p_user_id UUID,
  p_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID := public.my_profile_id();
BEGIN
  IF NOT (public.is_manager() OR public.can_manage_course(p_course_id)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_role NOT IN ('owner', 'organizer', 'coordinator', 'instructor_delegate') THEN
    RAISE EXCEPTION 'invalid_role';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;

  INSERT INTO public.course_roles(course_id, user_id, role)
  VALUES(p_course_id, p_user_id, p_role)
  ON CONFLICT(course_id, user_id, role) DO NOTHING;

  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES(v_actor, 'assign_course_role', p_course_id::text, jsonb_build_object('user_id', p_user_id, 'role', p_role));

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.assign_course_role(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_course_role(UUID, UUID, TEXT) TO authenticated;

-- 7) RPC: revoke_course_role
CREATE OR REPLACE FUNCTION public.revoke_course_role(
  p_course_id UUID,
  p_user_id UUID,
  p_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID := public.my_profile_id();
BEGIN
  IF NOT (public.is_manager() OR public.can_manage_course(p_course_id)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  DELETE FROM public.course_roles
  WHERE course_id = p_course_id AND user_id = p_user_id AND role = p_role;

  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES(v_actor, 'revoke_course_role', p_course_id::text, jsonb_build_object('user_id', p_user_id, 'role', p_role));

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_course_role(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_course_role(UUID, UUID, TEXT) TO authenticated;

-- 8) RPC: cancel_training_session
CREATE OR REPLACE FUNCTION public.cancel_training_session(
  p_session_id UUID,
  p_reason TEXT DEFAULT 'إلغاء المحاضرة من قبل الإدارة'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID := public.my_profile_id(); v_sess public.sessions%ROWTYPE; r RECORD;
BEGIN
  SELECT * INTO v_sess FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_batch(v_sess.batch_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF v_sess.status = 'closed' THEN
    RAISE EXCEPTION 'cannot_cancel_closed_session';
  END IF;

  UPDATE public.sessions
  SET status = 'cancelled', qr_seed = NULL, report = jsonb_build_object('cancellation_reason', p_reason, 'cancelled_by', v_actor, 'cancelled_at', extract(epoch from now())*1000)
  WHERE id = p_session_id;

  FOR r IN SELECT user_id FROM public.enrollments WHERE batch_id = v_sess.batch_id AND status = 'active' LOOP
    INSERT INTO public.notifications(user_id, title, body, type)
    VALUES(r.user_id, 'إلغاء محاضرة ⚠️', 'تم إلغاء ' || v_sess.title || '. السبب: ' || p_reason, 'session');
  END LOOP;

  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES(v_actor, 'cancel_session', p_session_id::text, jsonb_build_object('batch_id', v_sess.batch_id, 'reason', p_reason));

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_training_session(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_training_session(UUID, TEXT) TO authenticated;

-- 9) RPC: reschedule_training_session
CREATE OR REPLACE FUNCTION public.reschedule_training_session(
  p_session_id UUID,
  p_starts_at TIMESTAMPTZ,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID := public.my_profile_id(); v_sess public.sessions%ROWTYPE; r RECORD;
BEGIN
  SELECT * INTO v_sess FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_batch(v_sess.batch_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF v_sess.status = 'closed' THEN
    RAISE EXCEPTION 'cannot_reschedule_closed_session';
  END IF;

  UPDATE public.sessions
  SET starts_at = p_starts_at
  WHERE id = p_session_id;

  FOR r IN SELECT user_id FROM public.enrollments WHERE batch_id = v_sess.batch_id AND status = 'active' LOOP
    INSERT INTO public.notifications(user_id, title, body, type)
    VALUES(r.user_id, 'تعديل موعد محاضرة 🗓️', 'تم تعديل موعد ' || v_sess.title || ' ليصبح: ' || to_char(p_starts_at, 'YYYY-MM-DD HH24:MI'), 'session');
  END LOOP;

  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES(v_actor, 'reschedule_session', p_session_id::text, jsonb_build_object('batch_id', v_sess.batch_id, 'new_time', p_starts_at, 'reason', p_reason));

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.reschedule_training_session(UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_training_session(UUID, TIMESTAMPTZ, TEXT) TO authenticated;

-- 10) RPC: cancel_batch
CREATE OR REPLACE FUNCTION public.cancel_batch(
  p_batch_id UUID,
  p_reason TEXT DEFAULT 'إلغاء الدفعة التدريبية'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID := public.my_profile_id(); r RECORD;
BEGIN
  IF NOT (public.is_manager() OR public.can_manage_batch(p_batch_id)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.batches SET status = 'cancelled', updated_at = now() WHERE id = p_batch_id;
  UPDATE public.sessions SET status = 'cancelled' WHERE batch_id = p_batch_id AND status <> 'closed';

  FOR r IN SELECT user_id FROM public.enrollments WHERE batch_id = p_batch_id AND status IN ('active', 'waitlist') LOOP
    INSERT INTO public.notifications(user_id, title, body, type)
    VALUES(r.user_id, 'إلغاء الدفعة التدريبية ⚠️', 'تم إلغاء الدفعة التدريبية. السبب: ' || p_reason, 'session');
  END LOOP;

  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES(v_actor, 'cancel_batch', p_batch_id::text, jsonb_build_object('reason', p_reason));

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_batch(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_batch(UUID, TEXT) TO authenticated;

-- 11) RPC: get_detailed_course_analytics
CREATE OR REPLACE FUNCTION public.get_detailed_course_analytics(p_course_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_total_batches INTEGER;
  v_active_batches INTEGER;
  v_completed_batches INTEGER;
  v_total_enrollments INTEGER;
  v_active_students INTEGER;
  v_certified_students INTEGER;
  v_avg_rating NUMERIC;
  v_rating_count INTEGER;
  v_avg_attendance_pct NUMERIC;
  v_funnel JSONB;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE status = 'active'),
         count(*) FILTER (WHERE status = 'completed')
  INTO v_total_batches, v_active_batches, v_completed_batches
  FROM public.batches WHERE course_id = p_course_id;

  SELECT count(*), count(*) FILTER (WHERE e.status = 'active')
  INTO v_total_enrollments, v_active_students
  FROM public.enrollments e
  JOIN public.batches b ON b.id = e.batch_id
  WHERE b.course_id = p_course_id;

  SELECT count(*) INTO v_certified_students
  FROM public.certificates c
  JOIN public.batches b ON b.id = c.batch_id
  WHERE b.course_id = p_course_id AND c.status = 'active';

  SELECT COALESCE(round(avg(stars)::numeric, 1), 0), count(*)
  INTO v_avg_rating, v_rating_count
  FROM public.course_ratings WHERE course_id = p_course_id;

  SELECT COALESCE(round(
    (count(a.id) FILTER (WHERE a.status <> 'absent') * 100.0) / NULLIF(count(a.id), 0), 1
  ), 0)
  INTO v_avg_attendance_pct
  FROM public.attendance a
  JOIN public.sessions s ON s.id = a.session_id
  JOIN public.batches b ON b.id = s.batch_id
  WHERE b.course_id = p_course_id AND s.status = 'closed';

  v_funnel := jsonb_build_object(
    'totalEnrollments', v_total_enrollments,
    'activeStudents', v_active_students,
    'certifiedStudents', v_certified_students,
    'ratedCount', v_rating_count,
    'avgRating', v_avg_rating,
    'avgAttendancePct', v_avg_attendance_pct
  );

  RETURN jsonb_build_object(
    'ok', TRUE,
    'totalBatches', v_total_batches,
    'activeBatches', v_active_batches,
    'completedBatches', v_completed_batches,
    'funnel', v_funnel
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_detailed_course_analytics(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_detailed_course_analytics(UUID) TO authenticated;

COMMIT;
