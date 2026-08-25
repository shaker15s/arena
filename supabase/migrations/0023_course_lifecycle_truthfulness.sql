-- MASAR 3.2 — 0023: Course Lifecycle, Truthfulness & Access Rectifications

BEGIN;

-- 1) Helper: is_staff (admin, supervisor, volunteer)
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.my_role() IN ('admin', 'supervisor', 'volunteer');
$$;
REVOKE ALL ON FUNCTION public.is_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated;

-- 2) can_manage_course: creator, manager, or assigned non-archived batch instructor
CREATE OR REPLACE FUNCTION public.can_manage_course(p_course_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID := public.my_profile_id();
BEGIN
  IF v_actor IS NULL THEN RETURN FALSE; END IF;
  IF public.is_manager() THEN RETURN TRUE; END IF;
  RETURN EXISTS(
    SELECT 1 FROM public.batches
    WHERE course_id = p_course_id AND instructor_id = v_actor AND status <> 'archived'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.can_manage_course(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_course(UUID) TO authenticated;

-- 3) create_course: committee is OPTIONAL (nullable), staff can create
CREATE OR REPLACE FUNCTION public.create_course(
  p_title TEXT,
  p_code TEXT,
  p_desc TEXT,
  p_sessions_count INTEGER,
  p_committee_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_id UUID; v_actor UUID := public.my_profile_id();
BEGIN
  IF NOT public.is_staff() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_committee_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.committees WHERE id = p_committee_id) THEN
    RAISE EXCEPTION 'invalid_committee';
  END IF;
  IF p_sessions_count < 1 OR p_sessions_count > 60 THEN RAISE EXCEPTION 'invalid_session_count'; END IF;
  
  INSERT INTO public.courses(title, code, description, sessions_count, committee_id, status)
  VALUES(btrim(p_title), upper(btrim(p_code)), btrim(p_desc), p_sessions_count, p_committee_id, 'published')
  RETURNING id INTO v_id;
  
  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES(v_actor, 'create_course', v_id::text, jsonb_build_object('code', p_code, 'sessions', p_sessions_count));
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_course(TEXT, TEXT, TEXT, INTEGER, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_course(TEXT, TEXT, TEXT, INTEGER, UUID) TO authenticated;

-- 4) update_course_details: allow creator/instructor/manager, committee optional
CREATE OR REPLACE FUNCTION public.update_course_details(
  p_course_id UUID,
  p_title TEXT,
  p_code TEXT,
  p_desc TEXT,
  p_sessions_count INTEGER,
  p_committee_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID := public.my_profile_id();
BEGIN
  IF NOT (public.is_manager() OR public.can_manage_course(p_course_id)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_committee_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.committees WHERE id = p_committee_id) THEN
    RAISE EXCEPTION 'invalid_committee';
  END IF;
  IF p_sessions_count < 1 OR p_sessions_count > 60 THEN RAISE EXCEPTION 'invalid_session_count'; END IF;

  UPDATE public.courses
  SET title = btrim(p_title),
      code = upper(btrim(p_code)),
      description = btrim(p_desc),
      sessions_count = p_sessions_count,
      committee_id = p_committee_id,
      updated_at = now()
  WHERE id = p_course_id;

  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES(v_actor, 'update_course', p_course_id::text, jsonb_build_object('title', p_title, 'sessions', p_sessions_count));
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.update_course_details(UUID, TEXT, TEXT, TEXT, INTEGER, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_course_details(UUID, TEXT, TEXT, TEXT, INTEGER, UUID) TO authenticated;

-- 5) create_batch_with_sessions: volunteer can create for self, enforce course exclusivity
CREATE OR REPLACE FUNCTION public.create_batch_with_sessions(
  p_course_id UUID,
  p_branch_id UUID,
  p_instructor_id UUID,
  p_code TEXT,
  p_capacity INTEGER,
  p_room TEXT,
  p_schedule JSONB,
  p_first_session_at TIMESTAMPTZ,
  p_custom_sessions_count INTEGER DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch_id UUID;
  v_actor UUID := public.my_profile_id();
  v_role TEXT := public.my_role();
  v_count INTEGER;
  v_c_title TEXT;
  v_starts TIMESTAMPTZ;
  v_time TIME;
  v_days TEXT[];
  v_target_dow INTEGER[];
  v_map JSONB := '{"sun":0,"mon":1,"tue":2,"wed":3,"thu":4,"fri":5,"sat":6}'::jsonb;
  v_d TEXT;
  v_dur INTEGER := 120;
  v_conflict RECORD;
  v_other_instructor UUID;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  
  -- Volunteers can only assign themselves as instructor
  IF v_role = 'volunteer' THEN
    IF p_instructor_id <> v_actor THEN RAISE EXCEPTION 'volunteer_can_only_assign_self'; END IF;
  ELSIF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Enforce exclusivity: course cannot be taken by another instructor if active batch exists
  SELECT instructor_id INTO v_other_instructor
  FROM public.batches
  WHERE course_id = p_course_id AND status <> 'archived' AND instructor_id <> p_instructor_id
  LIMIT 1;
  IF v_other_instructor IS NOT NULL THEN
    RAISE EXCEPTION 'course_taken_by_another_instructor';
  END IF;

  SELECT title, sessions_count INTO v_c_title, v_count FROM public.courses WHERE id = p_course_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_course'; END IF;
  
  IF p_custom_sessions_count IS NOT NULL AND p_custom_sessions_count BETWEEN 1 AND 60 THEN
    v_count := p_custom_sessions_count;
  END IF;

  v_days := ARRAY(SELECT jsonb_array_elements_text(p_schedule->'days'));
  IF array_length(v_days, 1) IS NULL OR array_length(v_days, 1) = 0 THEN
    RAISE EXCEPTION 'invalid_schedule_days';
  END IF;
  v_time := (p_schedule->>'time')::time;
  v_dur := COALESCE((p_schedule->>'durationMin')::int, 120);

  FOREACH v_d IN ARRAY v_days LOOP
    IF NOT v_map ? v_d THEN RAISE EXCEPTION 'invalid_day_code: %', v_d; END IF;
    v_target_dow := array_append(v_target_dow, (v_map->>v_d)::int);
  END LOOP;

  INSERT INTO public.batches(course_id, branch_id, instructor_id, code, capacity, room, schedule, status)
  VALUES(p_course_id, p_branch_id, p_instructor_id, upper(btrim(p_code)), p_capacity, btrim(p_room), p_schedule, 'active')
  RETURNING id INTO v_batch_id;

  v_starts := (p_first_session_at AT TIME ZONE 'UTC')::date + v_time;
  IF v_starts < now() - interval '1 day' THEN
    v_starts := v_starts + interval '7 days';
  END IF;

  FOR i IN 1..v_count LOOP
    WHILE NOT (extract(DOW FROM v_starts)::int = ANY(v_target_dow)) LOOP
      v_starts := v_starts + interval '1 day';
    END LOOP;

    INSERT INTO public.sessions(batch_id, seq, title, starts_at, duration_min, status)
    VALUES(v_batch_id, i, 'المحاضرة ' || i || ' — ' || v_c_title, v_starts, v_dur, 'scheduled');

    v_starts := v_starts + interval '1 day';
  END LOOP;

  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES(v_actor, 'create_batch', v_batch_id::text, jsonb_build_object('course_id', p_course_id, 'sessions', v_count));

  RETURN v_batch_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_batch_with_sessions(UUID, UUID, UUID, TEXT, INTEGER, TEXT, JSONB, TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_batch_with_sessions(UUID, UUID, UUID, TEXT, INTEGER, TEXT, JSONB, TIMESTAMPTZ, INTEGER) TO authenticated;

-- 6) admin_update_user_access: 5 args with branch assignment and clearance
CREATE OR REPLACE FUNCTION public.admin_update_user_access(
  p_profile_id UUID,
  p_role TEXT,
  p_status TEXT,
  p_branch_id UUID DEFAULT NULL,
  p_clear_branch BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID := public.my_profile_id();
BEGIN
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_role NOT IN ('student', 'volunteer', 'supervisor', 'admin') THEN RAISE EXCEPTION 'invalid_role'; END IF;
  IF p_status NOT IN ('active', 'disabled') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  IF p_branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id) THEN
    RAISE EXCEPTION 'invalid_branch';
  END IF;

  IF p_clear_branch THEN
    UPDATE public.profiles SET role = p_role, status = p_status, branch_id = NULL, updated_at = now() WHERE id = p_profile_id;
  ELSIF p_branch_id IS NOT NULL THEN
    UPDATE public.profiles SET role = p_role, status = p_status, branch_id = p_branch_id, updated_at = now() WHERE id = p_profile_id;
  ELSE
    UPDATE public.profiles SET role = p_role, status = p_status, updated_at = now() WHERE id = p_profile_id;
  END IF;

  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES(v_actor, 'update_user_access', p_profile_id::text, jsonb_build_object('role', p_role, 'status', p_status, 'branch', p_branch_id));
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_user_access(UUID, TEXT, TEXT, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user_access(UUID, TEXT, TEXT, UUID, BOOLEAN) TO authenticated;

-- 7) join_batch: prevent enrolling into multiple batches of the same course
CREATE OR REPLACE FUNCTION public.join_batch(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_user UUID := public.my_profile_id(); v_batch public.batches%ROWTYPE;
        v_course_id UUID; v_active_count INTEGER; v_status TEXT;
BEGIN
  IF v_user IS NULL OR COALESCE(public.my_role(), '') <> 'student' THEN
    RAISE EXCEPTION 'authentication_required';
  END IF;

  SELECT * INTO v_batch FROM public.batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND OR v_batch.status = 'archived' THEN RAISE EXCEPTION 'invalid_batch'; END IF;

  -- Check if already enrolled in another batch of the same course
  SELECT course_id INTO v_course_id FROM public.batches WHERE id = p_batch_id;
  IF EXISTS (
    SELECT 1 FROM public.enrollments e
    JOIN public.batches b ON b.id = e.batch_id
    WHERE e.user_id = v_user AND b.course_id = v_course_id AND e.batch_id <> p_batch_id AND e.status = 'active'
  ) THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'already_in_course');
  END IF;

  SELECT status INTO v_status FROM public.enrollments WHERE user_id = v_user AND batch_id = p_batch_id;
  IF v_status IS NOT NULL THEN
    RETURN jsonb_build_object('ok', TRUE, 'status', v_status, 'already', TRUE);
  END IF;

  SELECT count(*) INTO v_active_count FROM public.enrollments WHERE batch_id = p_batch_id AND status = 'active';
  IF v_active_count < v_batch.capacity THEN
    v_status := 'active';
  ELSE
    v_status := 'waitlist';
  END IF;

  INSERT INTO public.enrollments(user_id, batch_id, status)
  VALUES(v_user, p_batch_id, v_status);

  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES(v_user, 'join_batch', p_batch_id::text, jsonb_build_object('status', v_status));

  RETURN jsonb_build_object('ok', TRUE, 'status', v_status, 'already', FALSE);
END;
$$;

-- 8) Course Status Management (Archive / Publish)
CREATE OR REPLACE FUNCTION public.set_course_status(p_course_id UUID, p_status TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID := public.my_profile_id();
BEGIN
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_status NOT IN ('draft', 'published', 'archived') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  
  UPDATE public.courses SET status = p_status, updated_at = now() WHERE id = p_course_id;
  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES(v_actor, 'set_course_status', p_course_id::text, jsonb_build_object('status', p_status));
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.set_course_status(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_course_status(UUID, TEXT) TO authenticated;

-- 9) Batch Archiving
CREATE OR REPLACE FUNCTION public.archive_batch(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID := public.my_profile_id();
BEGIN
  IF NOT (public.is_manager() OR public.can_manage_batch(p_batch_id)) THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.batches SET status = 'archived', updated_at = now() WHERE id = p_batch_id;
  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES(v_actor, 'archive_batch', p_batch_id::text, jsonb_build_object('batch_id', p_batch_id));
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.archive_batch(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_batch(UUID) TO authenticated;

-- 10) notify_session_absentees: exclude pending/accepted excuses
CREATE OR REPLACE FUNCTION public.notify_session_absentees(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID := public.my_profile_id(); v_sess public.sessions%ROWTYPE;
        v_count INTEGER := 0; r RECORD;
BEGIN
  SELECT * INTO v_sess FROM public.sessions WHERE id = p_session_id;
  IF NOT FOUND OR NOT public.can_manage_batch(v_sess.batch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;

  FOR r IN
    SELECT a.user_id FROM public.attendance a
    WHERE a.session_id = p_session_id AND a.status = 'absent'
      AND NOT EXISTS (
        SELECT 1 FROM public.excuses ex
        WHERE ex.session_id = p_session_id AND ex.user_id = a.user_id AND ex.status IN ('pending', 'approved')
      )
  LOOP
    INSERT INTO public.notifications(user_id, title, body, type)
    VALUES(r.user_id, 'تنبيه غياب', 'تم تسجيل غيابك في ' || v_sess.title || '. يمكنك تقديم عذر رسمي خلال 48 ساعة.', 'excuse');
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', TRUE, 'notified', v_count);
END;
$$;
REVOKE ALL ON FUNCTION public.notify_session_absentees(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_session_absentees(UUID) TO authenticated;

COMMIT;
