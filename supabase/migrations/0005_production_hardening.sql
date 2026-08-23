-- MASAR 3.2 — production hardening and real workflows
-- Apply after 001_complete_schema.sql and 0004_real_auth_and_policies.sql.
-- This migration deliberately moves security-sensitive business logic into atomic RPCs.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Requests/messages: students can request a course from a volunteer or request
-- a role review from admins. Every request has an explicit lifecycle.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.support_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('course_request', 'role_request', 'support')),
  subject TEXT NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 3 AND 120),
  body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 10 AND 2000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'resolved', 'rejected')),
  response TEXT CHECK (response IS NULL OR char_length(response) <= 2000),
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS support_requests_sender_idx ON public.support_requests(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS support_requests_recipient_idx ON public.support_requests(recipient_id, status, created_at DESC);
ALTER TABLE public.support_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_uidx
  ON public.notifications(dedupe_key) WHERE dedupe_key IS NOT NULL;

-- Useful uniqueness/integrity constraints missing from the baseline.
CREATE UNIQUE INDEX IF NOT EXISTS sessions_batch_seq_uidx ON public.sessions(batch_id, seq);
CREATE UNIQUE INDEX IF NOT EXISTS instructor_ratings_once_uidx
  ON public.instructor_ratings(user_id, instructor_id, batch_id) NULLS NOT DISTINCT;
CREATE UNIQUE INDEX IF NOT EXISTS organization_ratings_once_uidx
  ON public.organization_ratings(user_id, branch_id);
CREATE UNIQUE INDEX IF NOT EXISTS excuses_user_session_uidx
  ON public.excuses(user_id, session_id);
CREATE UNIQUE INDEX IF NOT EXISTS certificates_user_batch_uidx
  ON public.certificates(user_id, batch_id);
CREATE UNIQUE INDEX IF NOT EXISTS committees_branch_name_uidx
  ON public.committees(branch_id,lower(name));
ALTER TABLE public.batches DROP CONSTRAINT IF EXISTS batches_capacity_check;
ALTER TABLE public.batches ADD CONSTRAINT batches_capacity_check CHECK (capacity BETWEEN 1 AND 500);
ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_duration_check;
ALTER TABLE public.sessions ADD CONSTRAINT sessions_duration_check CHECK (duration_min BETWEEN 15 AND 600);

-- ---------------------------------------------------------------------------
-- Identity and authorization helpers. These never trust ids supplied by clients.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_profile_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1 $$;

CREATE OR REPLACE FUNCTION public.my_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT role FROM public.profiles WHERE user_id = auth.uid() AND status = 'active' LIMIT 1 $$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT COALESCE(public.my_role() IN ('volunteer', 'supervisor', 'admin'), FALSE) $$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT COALESCE(public.my_role() = 'admin', FALSE) $$;

CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT COALESCE(public.my_role() IN ('supervisor', 'admin'), FALSE) $$;

CREATE OR REPLACE FUNCTION public.can_manage_batch(p_batch_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    public.is_manager() OR EXISTS (
      SELECT 1 FROM public.batches b
      WHERE b.id = p_batch_id AND b.instructor_id = public.my_profile_id()
    ), FALSE
  )
$$;

-- Safe profile directory. Students receive staff display data but never other
-- users' phone/email. Volunteers receive contact data only for their students.
CREATE OR REPLACE FUNCTION public.list_visible_profiles(p_offset INTEGER DEFAULT 0, p_limit INTEGER DEFAULT 500)
RETURNS TABLE (
  id UUID, user_id UUID, email TEXT, phone TEXT, full_name TEXT, role TEXT,
  avatar_url TEXT, avatar_color TEXT, branch_id UUID, status TEXT, gender TEXT,
  joined_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH me AS (
    SELECT p.id,p.role,p.status FROM public.profiles p WHERE p.user_id=auth.uid()
  ), visible AS (
    SELECT p.*,
      CASE
        WHEN p.id=(SELECT id FROM me) THEN TRUE
        WHEN (SELECT status FROM me)='active' AND (SELECT role FROM me) IN ('admin','supervisor') THEN TRUE
        WHEN (SELECT status FROM me)='active' AND (SELECT role FROM me)='volunteer' AND (
          EXISTS (
            SELECT 1 FROM public.batches b JOIN public.enrollments e ON e.batch_id=b.id
            WHERE b.instructor_id=(SELECT id FROM me) AND e.user_id=p.id
          ) OR EXISTS (
            SELECT 1 FROM public.support_requests sr
            WHERE sr.recipient_id=(SELECT id FROM me) AND sr.sender_id=p.id
          )
        ) THEN TRUE
        -- Active users receive community display fields only. Disabled users
        -- receive only their own row so the client can render the hard block.
        WHEN (SELECT status FROM me)='active' AND p.status='active' THEN TRUE
        ELSE FALSE
      END AS can_see,
      CASE
        WHEN p.id=(SELECT id FROM me) THEN TRUE
        WHEN (SELECT status FROM me)='active' AND (SELECT role FROM me) IN ('admin','supervisor') THEN TRUE
        WHEN (SELECT status FROM me)='active' AND (SELECT role FROM me)='volunteer' AND EXISTS (
          SELECT 1 FROM public.batches b JOIN public.enrollments e ON e.batch_id=b.id
          WHERE b.instructor_id=(SELECT id FROM me) AND e.user_id=p.id
        ) THEN TRUE
        ELSE FALSE
      END AS can_see_contact
    FROM public.profiles p
  )
  SELECT v.id,
    CASE WHEN v.can_see_contact THEN v.user_id ELSE NULL END,
    CASE WHEN v.can_see_contact THEN v.email ELSE NULL END,
    CASE WHEN v.can_see_contact THEN v.phone ELSE NULL END,
    v.full_name, v.role, v.avatar_url, v.avatar_color, v.branch_id, v.status,
    v.gender, v.joined_at
  FROM visible v
  WHERE v.can_see
  ORDER BY v.id
  LIMIT LEAST(GREATEST(p_limit,1),500) OFFSET GREATEST(p_offset,0)
$$;

CREATE OR REPLACE FUNCTION public.get_batch_stats(p_offset INTEGER DEFAULT 0, p_limit INTEGER DEFAULT 500)
RETURNS TABLE(batch_id UUID, enrolled_count BIGINT, waitlist_count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT b.id,
    count(e.user_id) FILTER (WHERE e.status = 'active'),
    count(e.user_id) FILTER (WHERE e.status = 'waitlist')
  FROM public.batches b
  LEFT JOIN public.enrollments e ON e.batch_id = b.id
  WHERE public.my_role() IS NOT NULL
  GROUP BY b.id
  ORDER BY b.id
  LIMIT LEAST(GREATEST(p_limit,1),500) OFFSET GREATEST(p_offset,0)
$$;

-- ---------------------------------------------------------------------------
-- Deterministic badge evaluation. Only active badge definitions are awardable;
-- every award is unique and notification-deduplicated.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.evaluate_user_badges(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_count INTEGER;
BEGIN
  WITH candidates(code) AS (
    SELECT 'first_step' WHERE EXISTS(
      SELECT 1 FROM public.attendance WHERE user_id=p_user_id AND status<>'absent')
    UNION ALL SELECT 'consistent' WHERE EXISTS(
      SELECT 1 FROM public.batches b WHERE (
        SELECT count(*)=4 AND bool_and(x.status<>'absent') FROM (
          SELECT a.status FROM public.sessions s JOIN public.attendance a ON a.session_id=s.id AND a.user_id=p_user_id
          WHERE s.batch_id=b.id AND s.status='closed' ORDER BY s.starts_at DESC LIMIT 4
        ) x
      ))
    UNION ALL SELECT 'early_bird' WHERE (
      SELECT count(*) FROM public.attendance a JOIN public.sessions s ON s.id=a.session_id
      WHERE a.user_id=p_user_id AND a.status='present' AND a.checked_in_at<s.starts_at)>=10
    UNION ALL SELECT 'super_streak' WHERE COALESCE((
      SELECT current_streak_weeks FROM public.gamification WHERE user_id=p_user_id),0)>=8
    UNION ALL SELECT 'perfection' WHERE EXISTS(
      SELECT 1 FROM public.enrollments e JOIN public.sessions s ON s.batch_id=e.batch_id AND s.status='closed'
      LEFT JOIN public.attendance a ON a.session_id=s.id AND a.user_id=e.user_id
      WHERE e.user_id=p_user_id
      GROUP BY date_trunc('month',s.starts_at AT TIME ZONE 'Africa/Cairo')
      HAVING count(DISTINCT s.id)>=4
        AND count(DISTINCT s.id) FILTER(WHERE a.status IS NOT NULL AND a.status<>'absent')=count(DISTINCT s.id)
    )
    UNION ALL SELECT 'cert_hunter' WHERE (SELECT count(*) FROM public.certificates WHERE user_id=p_user_id)>=1
    UNION ALL SELECT 'pro_expert' WHERE (SELECT count(*) FROM public.certificates WHERE user_id=p_user_id)>=3
    UNION ALL SELECT 'honest_reviewer' WHERE (SELECT count(*) FROM public.course_ratings WHERE user_id=p_user_id)>=3
  ), inserted AS (
    INSERT INTO public.user_badges(user_id,badge_code)
    SELECT p_user_id,c.code FROM candidates c JOIN public.badges b ON b.code=c.code AND b.active
    ON CONFLICT(user_id,badge_code) DO NOTHING RETURNING badge_code
  ), notified AS (
    INSERT INTO public.notifications(user_id,title,body,type,dedupe_key)
    SELECT p_user_id,'شارة جديدة 🎉',b.name_ar,'badge','badge:'||p_user_id||':'||i.badge_code
    FROM inserted i JOIN public.badges b ON b.code=i.badge_code
    ON CONFLICT(dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING 1
  ) SELECT count(*) INTO v_count FROM inserted;
  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- Profile completion and admin account management.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_my_profile(
  p_full_name TEXT, p_phone TEXT, p_avatar_url TEXT DEFAULT NULL,
  p_branch_id UUID DEFAULT NULL, p_gender TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF char_length(btrim(COALESCE(p_full_name,''))) NOT BETWEEN 3 AND 120 THEN RAISE EXCEPTION 'invalid_name'; END IF;
  IF COALESCE(p_phone,'') !~ '^01[0-9]{9}$' THEN RAISE EXCEPTION 'invalid_phone'; END IF;
  IF char_length(COALESCE(p_avatar_url,''))>2000 THEN RAISE EXCEPTION 'invalid_avatar'; END IF;
  IF (p_branch_id IS NULL AND public.my_role()<>'admin') OR (p_branch_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.branches WHERE id=p_branch_id AND status='active'
  )) THEN RAISE EXCEPTION 'invalid_branch'; END IF;
  IF p_gender IS NOT NULL AND p_gender NOT IN ('m','f') THEN RAISE EXCEPTION 'invalid_gender'; END IF;

  UPDATE public.profiles
  SET full_name = btrim(p_full_name), phone = p_phone, avatar_url = p_avatar_url,
      branch_id = p_branch_id, gender = p_gender, updated_at = now()
  WHERE user_id = auth.uid()
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'profile_not_found'; END IF;
  RETURN jsonb_build_object('ok', TRUE, 'profile_id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_my_profile(p_full_name TEXT, p_phone TEXT, p_avatar_url TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID:=public.my_profile_id();
BEGIN
  IF public.my_role() IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF char_length(btrim(COALESCE(p_full_name,''))) NOT BETWEEN 3 AND 120 THEN RAISE EXCEPTION 'invalid_name'; END IF;
  IF COALESCE(p_phone,'') !~ '^01[0-9]{9}$' THEN RAISE EXCEPTION 'invalid_phone'; END IF;
  IF char_length(COALESCE(p_avatar_url,''))>2000 THEN RAISE EXCEPTION 'invalid_avatar'; END IF;
  UPDATE public.profiles SET full_name=btrim(p_full_name),phone=p_phone,
    avatar_url=NULLIF(btrim(p_avatar_url),''),updated_at=now() WHERE id=v_actor;
  INSERT INTO public.audit_log(actor_id,action,target,payload)
  VALUES(v_actor,'profile_updated',v_actor::text,jsonb_build_object('avatar_changed',p_avatar_url IS NOT NULL));
  RETURN jsonb_build_object('ok',TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_user_access(
  p_profile_id UUID, p_role TEXT DEFAULT NULL, p_status TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID := public.my_profile_id(); v_old public.profiles%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_role IS NOT NULL AND p_role NOT IN ('student','volunteer','supervisor','admin') THEN RAISE EXCEPTION 'invalid_role'; END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('active','disabled') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  SELECT * INTO v_old FROM public.profiles WHERE id = p_profile_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;
  IF p_profile_id = v_actor AND p_status = 'disabled' THEN RAISE EXCEPTION 'cannot_disable_self'; END IF;
  IF v_old.role = 'admin' AND p_role IS DISTINCT FROM 'admin'
     AND (SELECT count(*) FROM public.profiles WHERE role = 'admin' AND status = 'active') <= 1
  THEN RAISE EXCEPTION 'last_admin'; END IF;

  UPDATE public.profiles
  SET role = COALESCE(p_role, role), status = COALESCE(p_status, status), updated_at = now()
  WHERE id = p_profile_id;
  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES (v_actor, 'user_access_changed', p_profile_id::text,
    jsonb_build_object('old_role', v_old.role, 'role', COALESCE(p_role, v_old.role),
                       'old_status', v_old.status, 'status', COALESCE(p_status, v_old.status)));
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

-- ---------------------------------------------------------------------------
-- Atomic enrollment with locking; capacity cannot be overbooked by races.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_batch(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_user UUID := public.my_profile_id(); v_batch public.batches%ROWTYPE;
        v_active INTEGER; v_status TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF public.my_role() <> 'student' THEN RAISE EXCEPTION 'students_only'; END IF;
  SELECT * INTO v_batch FROM public.batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND OR v_batch.status NOT IN ('scheduled','active') THEN RAISE EXCEPTION 'batch_unavailable'; END IF;

  SELECT status INTO v_status FROM public.enrollments WHERE user_id = v_user AND batch_id = p_batch_id;
  IF v_status IS NOT NULL THEN RETURN jsonb_build_object('ok', TRUE, 'status', v_status, 'already', TRUE); END IF;
  SELECT count(*) INTO v_active FROM public.enrollments WHERE batch_id = p_batch_id AND status = 'active';
  v_status := CASE WHEN v_active < v_batch.capacity THEN 'active' ELSE 'waitlist' END;
  INSERT INTO public.enrollments(user_id, batch_id, status) VALUES (v_user, p_batch_id, v_status);
  RETURN jsonb_build_object('ok', TRUE, 'status', v_status, 'already', FALSE);
END;
$$;

-- ---------------------------------------------------------------------------
-- Server-signed rotating QR. qr_seed is never returned through table SELECT.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._qr_signature(p_seed TEXT, p_session UUID, p_slot BIGINT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $$ SELECT substr(encode(digest(p_seed || ':' || p_session::text || ':' || p_slot::text, 'sha256'), 'hex'), 1, 20) $$;

CREATE OR REPLACE FUNCTION public._backup_code(p_seed TEXT, p_session UUID)
RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $$
  SELECT lpad((
    (get_byte(digest(p_seed || ':backup:' || p_session::text, 'sha256'), 0)::bigint * 16777216
    + get_byte(digest(p_seed || ':backup:' || p_session::text, 'sha256'), 1)::bigint * 65536
    + get_byte(digest(p_seed || ':backup:' || p_session::text, 'sha256'), 2)::bigint * 256
    + get_byte(digest(p_seed || ':backup:' || p_session::text, 'sha256'), 3)::bigint) % 1000000
  )::text, 6, '0')
$$;

CREATE OR REPLACE FUNCTION public.join_batch_by_code(p_join_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_batch UUID; v_result JSONB;
BEGIN
  IF char_length(btrim(COALESCE(p_join_code,''))) NOT BETWEEN 6 AND 40 THEN RAISE EXCEPTION 'invalid_join_code'; END IF;
  SELECT id INTO v_batch FROM public.batches
  WHERE upper(join_code)=upper(btrim(p_join_code)) AND status IN ('scheduled','active');
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_join_code'; END IF;
  v_result:=public.join_batch(v_batch);
  RETURN v_result||jsonb_build_object('batch_id',v_batch);
END;
$$;

CREATE OR REPLACE FUNCTION public.start_training_session(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_session public.sessions%ROWTYPE; v_actor UUID := public.my_profile_id();
BEGIN
  IF NOT public.can_manage_batch(p_batch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO v_session FROM public.sessions WHERE batch_id = p_batch_id AND status = 'live' LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('ok', TRUE, 'session_id', v_session.id, 'already', TRUE); END IF;

  SELECT * INTO v_session FROM public.sessions
  WHERE batch_id = p_batch_id AND status = 'scheduled'
  ORDER BY starts_at, seq LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_scheduled_session'; END IF;
  UPDATE public.sessions
  SET status = 'live', started_at = now(), qr_seed = encode(gen_random_bytes(32), 'hex')
  WHERE id = v_session.id;
  UPDATE public.batches SET status = 'active', updated_at = now()
  WHERE id = p_batch_id AND status = 'scheduled';
  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES(v_actor, 'start_session', v_session.id::text, jsonb_build_object('batch_id', p_batch_id));
  RETURN jsonb_build_object('ok', TRUE, 'session_id', v_session.id, 'already', FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_session_qr_payload(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v public.sessions%ROWTYPE; v_slot BIGINT; v_sig TEXT; v_expires TIMESTAMPTZ;
BEGIN
  SELECT * INTO v FROM public.sessions WHERE id = p_session_id AND status = 'live';
  IF NOT FOUND OR NOT public.can_manage_batch(v.batch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v.qr_seed IS NULL OR v.started_at IS NULL THEN RAISE EXCEPTION 'qr_not_ready'; END IF;
  v_slot := GREATEST(0, floor(extract(epoch FROM (clock_timestamp() - v.started_at)) / 25)::bigint);
  v_sig := public._qr_signature(v.qr_seed, v.id, v_slot);
  v_expires := v.started_at + make_interval(secs => ((v_slot + 1) * 25)::double precision);
  RETURN jsonb_build_object(
    'token', 'MSRQ:' || v.id::text || ':' || v_slot::text || ':' || v_sig,
    'backup_code', public._backup_code(v.qr_seed, v.id),
    'expires_at', extract(epoch FROM v_expires) * 1000
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.check_in_with_token(p_payload TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_user UUID := public.my_profile_id(); v public.sessions%ROWTYPE;
        v_parts TEXT[]; v_slot BIGINT; v_current BIGINT; v_method TEXT := 'qr';
        v_elapsed NUMERIC; v_late INTEGER; v_points INTEGER; v_status TEXT;
        v_existing TEXT;
BEGIN
  IF v_user IS NULL OR public.my_role() <> 'student' THEN RAISE EXCEPTION 'authentication_required'; END IF;
  p_payload := btrim(p_payload);
  IF p_payload ~ '^MSRQ:[0-9a-fA-F-]{36}:[0-9]+:[0-9a-f]{20}$' THEN
    v_parts := string_to_array(p_payload, ':');
    SELECT * INTO v FROM public.sessions WHERE id = v_parts[2]::uuid FOR UPDATE;
    IF NOT FOUND OR v.status <> 'live' OR v.qr_seed IS NULL THEN RETURN jsonb_build_object('kind','no_session'); END IF;
    v_slot := v_parts[3]::bigint;
    v_current := GREATEST(0, floor(extract(epoch FROM (clock_timestamp() - v.started_at)) / 25)::bigint);
    IF v_slot NOT IN (v_current, v_current - 1)
       OR public._qr_signature(v.qr_seed, v.id, v_slot) <> v_parts[4]
    THEN RETURN jsonb_build_object('kind','expired'); END IF;
  ELSIF p_payload ~ '^[0-9]{6}$' THEN
    v_method := 'code';
    SELECT s.* INTO v FROM public.sessions s
    JOIN public.enrollments e ON e.batch_id = s.batch_id AND e.user_id = v_user AND e.status = 'active'
    WHERE s.status = 'live' AND s.qr_seed IS NOT NULL
      AND public._backup_code(s.qr_seed, s.id) = p_payload
    LIMIT 1 FOR UPDATE OF s;
    IF NOT FOUND THEN RETURN jsonb_build_object('kind','no_session'); END IF;
  ELSE
    RETURN jsonb_build_object('kind','invalid');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.enrollments e WHERE e.batch_id = v.batch_id AND e.user_id = v_user AND e.status = 'active')
  THEN RETURN jsonb_build_object('kind','not_enrolled'); END IF;
  SELECT status INTO v_existing FROM public.attendance WHERE session_id = v.id AND user_id = v_user;
  IF v_existing IS NOT NULL AND v_existing <> 'absent' THEN RETURN jsonb_build_object('kind','already'); END IF;

  v_elapsed := extract(epoch FROM (clock_timestamp() - COALESCE(v.started_at, v.starts_at))) / 60;
  IF v_elapsed > 30 THEN RETURN jsonb_build_object('kind','too_late'); END IF;
  SELECT COALESCE((value->>'value')::int, 15) INTO v_late FROM public.gamification_rules WHERE key = 'attendance.late_window_min';
  v_late := COALESCE(v_late, 15);
  v_status := CASE WHEN v_elapsed <= v_late THEN 'present' ELSE 'late' END;
  SELECT COALESCE((value->>'value')::int, CASE WHEN v_status='present' THEN 10 ELSE 7 END)
  INTO v_points FROM public.gamification_rules WHERE key = 'points.' || v_status;
  v_points := COALESCE(v_points, CASE WHEN v_status='present' THEN 10 ELSE 7 END);

  INSERT INTO public.attendance(session_id, user_id, status, checked_in_at, method)
  VALUES(v.id, v_user, v_status, now(), v_method)
  ON CONFLICT(session_id,user_id) DO UPDATE SET status=EXCLUDED.status, checked_in_at=EXCLUDED.checked_in_at, method=EXCLUDED.method;
  INSERT INTO public.point_events(user_id, points, reason_code, ref_type, ref_id, idempotency_key)
  VALUES(v_user, v_points, 'attendance.' || v_status, 'session', v.id, 'attendance:' || v.id || ':' || v_user)
  ON CONFLICT(idempotency_key) DO NOTHING;
  PERFORM public.evaluate_user_badges(v_user);
  RETURN jsonb_build_object('kind','ok','status',v_status,'points',v_points,'session_id',v.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.manual_mark_attendance(
  p_session_id UUID, p_user_id UUID, p_status TEXT, p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v public.sessions%ROWTYPE; v_points INTEGER; v_actor UUID := public.my_profile_id(); v_existing TEXT;
BEGIN
  SELECT * INTO v FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_batch(v.batch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v.status <> 'live' THEN RAISE EXCEPTION 'session_not_live'; END IF;
  IF p_status NOT IN ('present','late') OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 500
  THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.enrollments WHERE batch_id=v.batch_id AND user_id=p_user_id AND status='active')
  THEN RAISE EXCEPTION 'not_enrolled'; END IF;
  SELECT status INTO v_existing FROM public.attendance WHERE session_id=p_session_id AND user_id=p_user_id;
  IF v_existing IS NOT NULL AND v_existing<>'absent' THEN
    RETURN jsonb_build_object('ok',TRUE,'already',TRUE,'status',v_existing);
  END IF;
  SELECT COALESCE((value->>'value')::int, CASE WHEN p_status='present' THEN 10 ELSE 7 END)
  INTO v_points FROM public.gamification_rules WHERE key='points.'||p_status;
  v_points := COALESCE(v_points, CASE WHEN p_status='present' THEN 10 ELSE 7 END);
  INSERT INTO public.attendance(session_id,user_id,status,checked_in_at,method,note)
  VALUES(p_session_id,p_user_id,p_status,now(),'manual',btrim(p_reason))
  ON CONFLICT(session_id,user_id) DO UPDATE SET status=EXCLUDED.status,checked_in_at=EXCLUDED.checked_in_at,method='manual',note=EXCLUDED.note;
  INSERT INTO public.point_events(user_id,points,reason_code,ref_type,ref_id,awarded_by,idempotency_key)
  VALUES(p_user_id,v_points,'attendance.'||p_status,'session',p_session_id,v_actor,'attendance:'||p_session_id||':'||p_user_id)
  ON CONFLICT(idempotency_key) DO NOTHING;
  INSERT INTO public.audit_log(actor_id,action,target,payload)
  VALUES(v_actor,'manual_mark',p_user_id::text,jsonb_build_object('session_id',p_session_id,'status',p_status,'reason',btrim(p_reason)));
  PERFORM public.evaluate_user_badges(p_user_id);
  RETURN jsonb_build_object('ok',TRUE,'already',FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.close_training_session(p_session_id UUID, p_report JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v public.sessions%ROWTYPE; v_actor UUID := public.my_profile_id();
        v_remaining INTEGER; v_total INTEGER; v_present INTEGER; v_late INTEGER; v_absent INTEGER; v_excused INTEGER;
BEGIN
  SELECT * INTO v FROM public.sessions WHERE id=p_session_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_batch(v.batch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v.status <> 'live' THEN RAISE EXCEPTION 'session_not_live'; END IF;
  IF jsonb_typeof(COALESCE(p_report,'{}'::jsonb))<>'object'
     OR char_length(COALESCE(p_report->>'done',''))>4000
     OR char_length(COALESCE(p_report->>'planned',''))>4000
     OR char_length(COALESCE(p_report->>'challenges',''))>4000
  THEN RAISE EXCEPTION 'invalid_report'; END IF;
  p_report:=jsonb_build_object(
    'done',COALESCE(p_report->>'done',''),'planned',COALESCE(p_report->>'planned',''),
    'challenges',COALESCE(p_report->>'challenges',''),
    'submittedAt',floor(extract(epoch FROM now())*1000)
  );
  INSERT INTO public.attendance(session_id,user_id,status)
  SELECT v.id,e.user_id,'absent' FROM public.enrollments e
  WHERE e.batch_id=v.batch_id AND e.status='active'
  ON CONFLICT(session_id,user_id) DO NOTHING;
  UPDATE public.sessions SET status='closed',closed_at=now(),qr_seed=NULL,report=p_report WHERE id=v.id;
  SELECT count(*) FILTER(WHERE status='present'), count(*) FILTER(WHERE status='late'),
         count(*) FILTER(WHERE status='absent'), count(*) FILTER(WHERE status='excused'), count(*)
  INTO v_present,v_late,v_absent,v_excused,v_total FROM public.attendance WHERE session_id=v.id;
  SELECT count(*) INTO v_remaining FROM public.sessions WHERE batch_id=v.batch_id AND status<>'closed';
  IF v_remaining=0 THEN
    UPDATE public.batches b SET status='completed',updated_at=now()
    WHERE b.id=v.batch_id
      AND EXISTS(SELECT 1 FROM public.enrollments e WHERE e.batch_id=b.id AND e.status='active')
      AND (SELECT count(*) FROM public.sessions s WHERE s.batch_id=b.id)=(
        SELECT c.sessions_count FROM public.courses c WHERE c.id=b.course_id
      );
  END IF;
  INSERT INTO public.audit_log(actor_id,action,target,payload)
  VALUES(v_actor,'close_session',v.id::text,jsonb_build_object('batch_id',v.batch_id,'total',v_total));
  RETURN jsonb_build_object('ok',TRUE,'present',v_present,'late',v_late,'absent',v_absent,'excused',v_excused,'total',v_total);
END;
$$;

-- ---------------------------------------------------------------------------
-- Organization/catalog creation. Multi-row batch publication is validated and
-- committed atomically, including every generated session.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_branch(p_name TEXT, p_governorate TEXT, p_address TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID:=public.my_profile_id(); v_id UUID;
BEGIN
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF char_length(btrim(COALESCE(p_name,''))) NOT BETWEEN 2 AND 120
     OR char_length(btrim(COALESCE(p_governorate,''))) NOT BETWEEN 2 AND 120
     OR char_length(COALESCE(p_address,''))>500 THEN RAISE EXCEPTION 'invalid_branch'; END IF;
  INSERT INTO public.branches(name,governorate,address)
  VALUES(btrim(p_name),btrim(p_governorate),NULLIF(btrim(p_address),'')) RETURNING id INTO v_id;
  INSERT INTO public.audit_log(actor_id,action,target,payload)
  VALUES(v_actor,'create_branch',v_id::text,jsonb_build_object('name',btrim(p_name)));
  RETURN jsonb_build_object('ok',TRUE,'id',v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_committee(p_branch_id UUID, p_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID:=public.my_profile_id(); v_id UUID;
BEGIN
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF char_length(btrim(COALESCE(p_name,''))) NOT BETWEEN 2 AND 120
     OR NOT EXISTS(SELECT 1 FROM public.branches WHERE id=p_branch_id AND status='active')
  THEN RAISE EXCEPTION 'invalid_committee'; END IF;
  INSERT INTO public.committees(branch_id,name) VALUES(p_branch_id,btrim(p_name)) RETURNING id INTO v_id;
  INSERT INTO public.audit_log(actor_id,action,target,payload)
  VALUES(v_actor,'create_committee',v_id::text,jsonb_build_object('branch_id',p_branch_id,'name',btrim(p_name)));
  RETURN jsonb_build_object('ok',TRUE,'id',v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_course(
  p_committee_id UUID, p_title TEXT, p_field TEXT, p_description TEXT,
  p_topics TEXT[], p_sessions_count INTEGER, p_color TEXT DEFAULT '#4F46E5'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID:=public.my_profile_id(); v_id UUID;
BEGIN
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.committees WHERE id=p_committee_id)
     OR char_length(btrim(COALESCE(p_title,''))) NOT BETWEEN 3 AND 160
     OR char_length(btrim(COALESCE(p_field,''))) NOT BETWEEN 2 AND 100
     OR char_length(COALESCE(p_description,''))>4000
     OR p_sessions_count NOT BETWEEN 1 AND 100
     OR p_color !~ '^#[0-9A-Fa-f]{6}$'
  THEN RAISE EXCEPTION 'invalid_course'; END IF;
  INSERT INTO public.courses(committee_id,title,field,description,topics,sessions_count,status,color)
  VALUES(p_committee_id,btrim(p_title),btrim(p_field),NULLIF(btrim(p_description),''),COALESCE(p_topics,'{}'),p_sessions_count,'published',upper(p_color))
  RETURNING id INTO v_id;
  INSERT INTO public.audit_log(actor_id,action,target,payload)
  VALUES(v_actor,'create_course',v_id::text,jsonb_build_object('title',btrim(p_title),'sessions_count',p_sessions_count));
  RETURN jsonb_build_object('ok',TRUE,'id',v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_batch_with_sessions(
  p_course_id UUID, p_branch_id UUID, p_instructor_id UUID, p_capacity INTEGER,
  p_schedule JSONB, p_start_date DATE, p_room TEXT, p_sessions JSONB
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID:=public.my_profile_id(); v_batch UUID; v_join TEXT;
  v_expected INTEGER; v_count INTEGER;
BEGIN
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT sessions_count INTO v_expected FROM public.courses WHERE id=p_course_id AND status='published';
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.branches WHERE id=p_branch_id AND status='active')
     OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_instructor_id AND status='active' AND role IN ('volunteer','supervisor','admin'))
     OR p_capacity NOT BETWEEN 1 AND 500 OR p_start_date IS NULL
     OR char_length(btrim(COALESCE(p_room,''))) NOT BETWEEN 1 AND 120
     OR jsonb_typeof(p_schedule)<>'object' OR jsonb_typeof(p_sessions)<>'array'
  THEN RAISE EXCEPTION 'invalid_batch'; END IF;
  v_count:=jsonb_array_length(p_sessions);
  IF v_count<>v_expected THEN RAISE EXCEPTION 'invalid_session_count'; END IF;

  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_sessions) WITH ORDINALITY x(item,ord)
    WHERE (item->>'seq')::INTEGER<>ord
      OR char_length(btrim(COALESCE(item->>'title',''))) NOT BETWEEN 1 AND 200
      OR (item->>'duration_min')::INTEGER NOT BETWEEN 15 AND 600
      OR (item->>'starts_at')::TIMESTAMPTZ < now()-interval '1 day'
  ) THEN RAISE EXCEPTION 'invalid_sessions'; END IF;

  IF EXISTS(
    SELECT 1
    FROM jsonb_array_elements(p_sessions) WITH ORDINALITY a(item,ord)
    JOIN jsonb_array_elements(p_sessions) WITH ORDINALITY b(item,ord) ON a.ord<b.ord
    WHERE tstzrange(
      (a.item->>'starts_at')::TIMESTAMPTZ,
      (a.item->>'starts_at')::TIMESTAMPTZ+make_interval(mins=>(a.item->>'duration_min')::INTEGER),'[)'
    ) && tstzrange(
      (b.item->>'starts_at')::TIMESTAMPTZ,
      (b.item->>'starts_at')::TIMESTAMPTZ+make_interval(mins=>(b.item->>'duration_min')::INTEGER),'[)'
    )
  ) THEN RAISE EXCEPTION 'sessions_overlap'; END IF;

  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_sessions) n(item)
    JOIN public.sessions s ON tstzrange(
      (n.item->>'starts_at')::TIMESTAMPTZ,
      (n.item->>'starts_at')::TIMESTAMPTZ+make_interval(mins=>(n.item->>'duration_min')::INTEGER),'[)'
    ) && tstzrange(s.starts_at,s.starts_at+make_interval(mins=>s.duration_min),'[)')
    JOIN public.batches b ON b.id=s.batch_id
    WHERE b.instructor_id=p_instructor_id AND s.status<>'closed'
  ) THEN RAISE EXCEPTION 'instructor_schedule_conflict'; END IF;

  v_join:='MSR-'||upper(substr(encode(gen_random_bytes(8),'hex'),1,12));
  INSERT INTO public.batches(course_id,branch_id,instructor_id,capacity,schedule,start_date,room,status,join_code)
  VALUES(p_course_id,p_branch_id,p_instructor_id,p_capacity,p_schedule,p_start_date,btrim(p_room),'scheduled',v_join)
  RETURNING id INTO v_batch;
  INSERT INTO public.sessions(batch_id,seq,title,starts_at,duration_min,status)
  SELECT v_batch,(item->>'seq')::INTEGER,btrim(item->>'title'),(item->>'starts_at')::TIMESTAMPTZ,
         (item->>'duration_min')::INTEGER,'scheduled'
  FROM jsonb_array_elements(p_sessions) x(item);
  INSERT INTO public.audit_log(actor_id,action,target,payload)
  VALUES(v_actor,'create_batch',v_batch::text,jsonb_build_object('course_id',p_course_id,'branch_id',p_branch_id,'sessions',v_count));
  RETURN jsonb_build_object('ok',TRUE,'batch_id',v_batch,'join_code',v_join);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_gamification_rule(p_key TEXT, p_value NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID:=public.my_profile_id(); v_min NUMERIC; v_max NUMERIC; v_old JSONB;
BEGIN
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT x.min_value,x.max_value INTO v_min,v_max FROM (VALUES
    ('points.present',5::numeric,20::numeric),('points.late',0,20),('attendance.late_window_min',5,30),
    ('certificate.min_attendance_pct',50,100),('kudos.monthly_quota_per_instructor',0,1000),
    ('streak.freeze_max_hold',0,5),('streak.min_sessions_week',1,7),('league.promotion_pct',5,40),
    ('league.relegation_pct',0,40),('points.month_bonus',0,200),('points.course_complete',0,500),
    ('points.rating',0,20)
  ) AS x(key,min_value,max_value) WHERE x.key=p_key;
  IF NOT FOUND OR p_value<v_min OR p_value>v_max OR p_value<>trunc(p_value) THEN RAISE EXCEPTION 'rule_out_of_bounds'; END IF;
  SELECT value INTO v_old FROM public.gamification_rules WHERE key=p_key;
  INSERT INTO public.gamification_rules(key,value,scope,updated_by,updated_at)
  VALUES(p_key,jsonb_build_object('value',p_value),jsonb_build_object('type','global'),v_actor,now())
  ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=v_actor,updated_at=now();
  INSERT INTO public.audit_log(actor_id,action,target,payload)
  VALUES(v_actor,'admin_update_rule',p_key,jsonb_build_object('from',v_old,'to',p_value));
  RETURN jsonb_build_object('ok',TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_badge_active(p_code TEXT, p_active BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID:=public.my_profile_id(); v_changed INTEGER;
BEGIN
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.badges SET active=p_active WHERE code=p_code AND active IS DISTINCT FROM p_active;
  GET DIAGNOSTICS v_changed=ROW_COUNT;
  IF NOT EXISTS(SELECT 1 FROM public.badges WHERE code=p_code) THEN RAISE EXCEPTION 'badge_not_found'; END IF;
  IF v_changed>0 THEN
    INSERT INTO public.audit_log(actor_id,action,target,payload)
    VALUES(v_actor,'set_badge_active',p_code,jsonb_build_object('active',p_active));
  END IF;
  RETURN jsonb_build_object('ok',TRUE,'changed',v_changed>0);
END;
$$;

CREATE OR REPLACE FUNCTION public.bootstrap_organization(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch UUID; v_committee UUID; v_course UUID; v_batch JSONB;
  v_name TEXT; v_result JSONB; v_topics TEXT[]; v_committees TEXT[];
BEGIN
  IF NOT public.is_manager() OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT array_agg(value) INTO v_committees
  FROM jsonb_array_elements_text(p_payload->'committee_names') x(value);
  IF COALESCE(array_length(v_committees,1),0)<1 THEN RAISE EXCEPTION 'committee_required'; END IF;
  v_result:=public.create_branch(p_payload->>'branch_name',p_payload->>'governorate',p_payload->>'address');
  v_branch:=(v_result->>'id')::UUID;
  UPDATE public.profiles SET branch_id=v_branch,updated_at=now()
  WHERE id=public.my_profile_id() AND branch_id IS NULL;
  FOREACH v_name IN ARRAY v_committees LOOP
    v_result:=public.create_committee(v_branch,v_name);
    IF v_committee IS NULL THEN v_committee:=(v_result->>'id')::UUID; END IF;
  END LOOP;
  SELECT array_agg(value) INTO v_topics FROM jsonb_array_elements_text(p_payload->'topics') x(value);
  v_result:=public.create_course(
    v_committee,p_payload->>'course_title',p_payload->>'course_field',p_payload->>'course_description',
    v_topics,(p_payload->>'sessions_count')::INTEGER,COALESCE(p_payload->>'color','#4F46E5')
  );
  v_course:=(v_result->>'id')::UUID;
  v_batch:=public.create_batch_with_sessions(
    v_course,v_branch,(p_payload->>'instructor_id')::UUID,(p_payload->>'capacity')::INTEGER,
    p_payload->'schedule',(p_payload->>'start_date')::DATE,p_payload->>'room',p_payload->'sessions'
  );
  RETURN jsonb_build_object('ok',TRUE,'branch_id',v_branch,'committee_id',v_committee,'course_id',v_course,
    'batch_id',v_batch->>'batch_id','join_code',v_batch->>'join_code');
END;
$$;

-- Excuses, ratings, kudos and certificates are also atomic. No points or
-- attendance ledger is ever assembled through a sequence of client writes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_excuse(p_session_id UUID, p_reason TEXT, p_attachment_url TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_user UUID:=public.my_profile_id(); v_session public.sessions%ROWTYPE; v_id UUID; v_instructor UUID;
BEGIN
  IF v_user IS NULL OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 5 AND 2000
     OR char_length(COALESCE(p_attachment_url,''))>2000
  THEN RAISE EXCEPTION 'invalid_input'; END IF;
  SELECT * INTO v_session FROM public.sessions WHERE id=p_session_id;
  IF NOT FOUND OR NOT EXISTS(
    SELECT 1 FROM public.enrollments WHERE batch_id=v_session.batch_id AND user_id=v_user AND status='active'
  ) THEN RAISE EXCEPTION 'not_enrolled'; END IF;
  IF EXISTS(SELECT 1 FROM public.excuses WHERE session_id=p_session_id AND user_id=v_user AND status<>'rejected')
  THEN RAISE EXCEPTION 'excuse_exists'; END IF;
  IF v_session.status<>'closed' OR NOT EXISTS(
    SELECT 1 FROM public.attendance WHERE session_id=p_session_id AND user_id=v_user AND status='absent'
  ) THEN RAISE EXCEPTION 'not_absent'; END IF;
  INSERT INTO public.excuses(user_id,session_id,reason,attachment_url)
  VALUES(v_user,p_session_id,btrim(p_reason),NULLIF(btrim(p_attachment_url),''))
  ON CONFLICT(user_id,session_id) DO UPDATE
    SET reason=EXCLUDED.reason,attachment_url=EXCLUDED.attachment_url,status='pending',note=NULL,reviewed_by=NULL,created_at=now()
    WHERE public.excuses.status='rejected'
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'excuse_exists'; END IF;
  SELECT instructor_id INTO v_instructor FROM public.batches WHERE id=v_session.batch_id;
  IF v_instructor IS NOT NULL THEN
    INSERT INTO public.notifications(user_id,title,body,type)
    VALUES(v_instructor,'عذر جديد بانتظار المراجعة',btrim(p_reason),'excuse');
  END IF;
  RETURN jsonb_build_object('ok',TRUE,'id',v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.review_excuse(p_excuse_id UUID, p_decision TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID:=public.my_profile_id(); v_excuse public.excuses%ROWTYPE; v_batch UUID;
BEGIN
  SELECT * INTO v_excuse FROM public.excuses WHERE id=p_excuse_id FOR UPDATE;
  IF NOT FOUND OR v_excuse.status<>'pending' OR p_decision NOT IN ('accepted','rejected') THEN RAISE EXCEPTION 'invalid_excuse'; END IF;
  IF p_decision='rejected' AND NULLIF(btrim(p_note),'') IS NULL THEN RAISE EXCEPTION 'rejection_note_required'; END IF;
  IF p_note IS NOT NULL AND char_length(p_note)>1000 THEN RAISE EXCEPTION 'note_too_long'; END IF;
  SELECT batch_id INTO v_batch FROM public.sessions WHERE id=v_excuse.session_id;
  IF NOT public.can_manage_batch(v_batch) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_decision='accepted' AND NOT EXISTS(
    SELECT 1 FROM public.attendance WHERE session_id=v_excuse.session_id AND user_id=v_excuse.user_id AND status='absent'
  ) THEN RAISE EXCEPTION 'attendance_not_absent'; END IF;
  UPDATE public.excuses SET status=p_decision,note=NULLIF(btrim(p_note),''),reviewed_by=v_actor WHERE id=p_excuse_id;
  IF p_decision='accepted' THEN
    INSERT INTO public.attendance(session_id,user_id,status,note)
    VALUES(v_excuse.session_id,v_excuse.user_id,'excused','عذر مقبول')
    ON CONFLICT(session_id,user_id) DO UPDATE SET status='excused',note='عذر مقبول';
  END IF;
  INSERT INTO public.notifications(user_id,title,body,type)
  VALUES(v_excuse.user_id,CASE WHEN p_decision='accepted' THEN 'تم قبول عذرك' ELSE 'تم رفض عذرك' END,
         COALESCE(NULLIF(btrim(p_note),''),CASE WHEN p_decision='accepted' THEN 'تم حفظ الغياب كعذر.' ELSE 'راجع المدرب للتفاصيل.' END),'excuse');
  INSERT INTO public.audit_log(actor_id,action,target,payload)
  VALUES(v_actor,'review_excuse',p_excuse_id::text,jsonb_build_object('decision',p_decision,'note',p_note));
  RETURN jsonb_build_object('ok',TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_course_rating(p_course_id UUID, p_stars INTEGER, p_comment TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_user UUID:=public.my_profile_id(); v_points INTEGER;
BEGIN
  IF v_user IS NULL OR p_stars NOT BETWEEN 1 AND 5 OR char_length(COALESCE(p_comment,''))>2000
  THEN RAISE EXCEPTION 'invalid_rating'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.enrollments e JOIN public.batches b ON b.id=e.batch_id
    JOIN public.courses c ON c.id=b.course_id
    WHERE e.user_id=v_user AND e.status='active' AND b.course_id=p_course_id AND b.status='completed'
      AND (SELECT count(*) FROM public.sessions s WHERE s.batch_id=b.id)=c.sessions_count
      AND NOT EXISTS(SELECT 1 FROM public.sessions s WHERE s.batch_id=b.id AND s.status<>'closed')
  ) THEN RAISE EXCEPTION 'course_not_completed'; END IF;
  INSERT INTO public.course_ratings(user_id,course_id,stars,comment)
  VALUES(v_user,p_course_id,p_stars,NULLIF(btrim(p_comment),''))
  ON CONFLICT(user_id,course_id) DO UPDATE SET stars=EXCLUDED.stars,comment=EXCLUDED.comment;
  SELECT COALESCE((value->>'value')::int,5) INTO v_points FROM public.gamification_rules WHERE key='points.rating';
  INSERT INTO public.point_events(user_id,points,reason_code,ref_type,ref_id,idempotency_key)
  VALUES(v_user,COALESCE(v_points,5),'rating','course',p_course_id,'rating:'||p_course_id||':'||v_user)
  ON CONFLICT(idempotency_key) DO NOTHING;
  PERFORM public.evaluate_user_badges(v_user);
  RETURN jsonb_build_object('ok',TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.award_kudos(
  p_student_id UUID, p_batch_id UUID, p_points INTEGER, p_reason TEXT, p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID:=public.my_profile_id(); v_month TEXT:=to_char(now(),'YYYY-MM'); v_quota INTEGER; v_spent INTEGER;
BEGIN
  IF p_idempotency_key IS NULL OR NOT public.can_manage_batch(p_batch_id) OR p_points NOT BETWEEN 1 AND 25
     OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 500
  THEN RAISE EXCEPTION 'invalid_kudos'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.enrollments WHERE batch_id=p_batch_id AND user_id=p_student_id AND status='active')
  THEN RAISE EXCEPTION 'not_enrolled'; END IF;
  SELECT COALESCE((value->>'value')::int,200) INTO v_quota FROM public.gamification_rules WHERE key='kudos.monthly_quota_per_instructor';
  INSERT INTO public.kudos_quotas(instructor_id,month,spent) VALUES(v_actor,v_month,0)
  ON CONFLICT(instructor_id,month) DO NOTHING;
  SELECT spent INTO v_spent FROM public.kudos_quotas WHERE instructor_id=v_actor AND month=v_month FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.point_events WHERE idempotency_key='kudos:'||p_idempotency_key) THEN
    IF NOT EXISTS(
      SELECT 1 FROM public.point_events WHERE idempotency_key='kudos:'||p_idempotency_key
        AND awarded_by=v_actor AND user_id=p_student_id AND ref_id=p_batch_id AND points=p_points
    ) THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
    RETURN jsonb_build_object('ok',TRUE,'left',COALESCE(v_quota,200)-v_spent,'already',TRUE);
  END IF;
  IF v_spent+p_points>COALESCE(v_quota,200) THEN RAISE EXCEPTION 'kudos_quota_exceeded'; END IF;
  INSERT INTO public.point_events(user_id,points,reason_code,ref_type,ref_id,awarded_by,idempotency_key)
  VALUES(p_student_id,p_points,'kudos','batch',p_batch_id,v_actor,'kudos:'||p_idempotency_key)
  ON CONFLICT(idempotency_key) DO NOTHING;
  IF NOT FOUND THEN
    IF NOT EXISTS(
      SELECT 1 FROM public.point_events WHERE idempotency_key='kudos:'||p_idempotency_key
        AND awarded_by=v_actor AND user_id=p_student_id AND ref_id=p_batch_id AND points=p_points
    ) THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
    RETURN jsonb_build_object('ok',TRUE,'left',COALESCE(v_quota,200)-v_spent,'already',TRUE);
  END IF;
  UPDATE public.kudos_quotas SET spent=spent+p_points WHERE instructor_id=v_actor AND month=v_month;
  INSERT INTO public.notifications(user_id,title,body,type)
  VALUES(p_student_id,'تقدير جديد +'||p_points,btrim(p_reason),'system');
  INSERT INTO public.audit_log(actor_id,action,target,payload)
  VALUES(v_actor,'award_kudos',p_student_id::text,jsonb_build_object('batch_id',p_batch_id,'points',p_points,'reason',btrim(p_reason)));
  RETURN jsonb_build_object('ok',TRUE,'left',COALESCE(v_quota,200)-v_spent-p_points);
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_batch_certificates(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID:=public.my_profile_id(); v_pct INTEGER; v_points INTEGER; v_issued INTEGER:=0; r RECORD; v_serial TEXT;
BEGIN
  IF NOT public.can_manage_batch(p_batch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.batches b JOIN public.courses c ON c.id=b.course_id
    WHERE b.id=p_batch_id AND b.status='completed'
      AND EXISTS(SELECT 1 FROM public.enrollments e WHERE e.batch_id=b.id AND e.status='active')
      AND (SELECT count(*) FROM public.sessions s WHERE s.batch_id=b.id)=c.sessions_count
      AND NOT EXISTS(SELECT 1 FROM public.sessions s WHERE s.batch_id=b.id AND s.status<>'closed')
  ) THEN RAISE EXCEPTION 'batch_not_completed'; END IF;
  SELECT COALESCE((value->>'value')::int,75) INTO v_pct FROM public.gamification_rules WHERE key='certificate.min_attendance_pct';
  SELECT COALESCE((value->>'value')::int,100) INTO v_points FROM public.gamification_rules WHERE key='points.course_complete';
  FOR r IN
    SELECT e.user_id,
      count(s.id) AS total,
      count(a.session_id) FILTER(WHERE a.status<>'absent') AS honored
    FROM public.enrollments e
    JOIN public.sessions s ON s.batch_id=e.batch_id AND s.status='closed'
    LEFT JOIN public.attendance a ON a.session_id=s.id AND a.user_id=e.user_id
    WHERE e.batch_id=p_batch_id AND e.status='active'
    GROUP BY e.user_id
  LOOP
    IF r.total>0 AND (r.honored*100.0/r.total)>=COALESCE(v_pct,75)
       AND NOT EXISTS(SELECT 1 FROM public.certificates WHERE user_id=r.user_id AND batch_id=p_batch_id)
    THEN
      v_serial:='MSR-'||to_char(now(),'YYYY')||'-'||upper(substr(encode(gen_random_bytes(8),'hex'),1,12));
      INSERT INTO public.certificates(user_id,batch_id,serial) VALUES(r.user_id,p_batch_id,v_serial)
      ON CONFLICT(user_id,batch_id) DO NOTHING;
      IF NOT FOUND THEN CONTINUE; END IF;
      INSERT INTO public.point_events(user_id,points,reason_code,ref_type,ref_id,idempotency_key)
      VALUES(r.user_id,COALESCE(v_points,100),'course.complete','batch',p_batch_id,'course.complete:'||p_batch_id||':'||r.user_id)
      ON CONFLICT(idempotency_key) DO NOTHING;
      INSERT INTO public.notifications(user_id,title,body,type) VALUES(r.user_id,'شهادتك جاهزة','يمكنك تنزيلها ومشاركتها الآن.','cert');
      PERFORM public.evaluate_user_badges(r.user_id);
      v_issued:=v_issued+1;
    END IF;
  END LOOP;
  INSERT INTO public.audit_log(actor_id,action,target,payload)
  VALUES(v_actor,'issue_certificates',p_batch_id::text,jsonb_build_object('issued',v_issued));
  RETURN jsonb_build_object('ok',TRUE,'issued',v_issued);
END;
$$;

-- Public certificate verification returns a deliberately minimal projection;
-- callers never receive profile, enrollment or batch identifiers.
CREATE OR REPLACE FUNCTION public.verify_certificate(p_serial TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_result JSONB;
BEGIN
  IF char_length(btrim(COALESCE(p_serial,''))) NOT BETWEEN 8 AND 80 THEN RETURN NULL; END IF;
  SELECT jsonb_build_object(
    'serial',c.serial,
    'issued_at',c.issued_at,
    'student_name',p.full_name,
    'course_title',co.title,
    'branch_name',br.name
  ) INTO v_result
  FROM public.certificates c
  JOIN public.profiles p ON p.id=c.user_id
  JOIN public.batches b ON b.id=c.batch_id
  JOIN public.courses co ON co.id=b.course_id
  JOIN public.branches br ON br.id=b.branch_id
  WHERE upper(c.serial)=upper(btrim(p_serial));
  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- Requests and broadcasts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_support_request(
  p_kind TEXT, p_subject TEXT, p_body TEXT, p_recipient_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_sender UUID:=public.my_profile_id(); v_id UUID;
BEGIN
  IF v_sender IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_kind NOT IN ('course_request','role_request','support') THEN RAISE EXCEPTION 'invalid_kind'; END IF;
  IF p_kind IN ('course_request','role_request') AND public.my_role()<>'student' THEN RAISE EXCEPTION 'students_only'; END IF;
  IF char_length(btrim(p_subject)) NOT BETWEEN 3 AND 120 OR char_length(btrim(p_body)) NOT BETWEEN 10 AND 2000
  THEN RAISE EXCEPTION 'invalid_message'; END IF;
  IF p_kind='course_request' AND (p_recipient_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.profiles WHERE id=p_recipient_id AND role='volunteer' AND status='active'))
  THEN RAISE EXCEPTION 'invalid_recipient'; END IF;
  IF p_kind='role_request' THEN p_recipient_id:=NULL; END IF;
  INSERT INTO public.support_requests(sender_id,recipient_id,kind,subject,body)
  VALUES(v_sender,p_recipient_id,p_kind,btrim(p_subject),btrim(p_body)) RETURNING id INTO v_id;
  INSERT INTO public.notifications(user_id,title,body,type)
  SELECT p.id,
    CASE WHEN p_kind='role_request' THEN 'طلب ترقية جديد' ELSE 'طلب جديد' END,
    btrim(p_subject),'system'
  FROM public.profiles p
  WHERE (p_kind='role_request' AND p.role='admin' AND p.status='active') OR p.id=p_recipient_id;
  RETURN jsonb_build_object('ok',TRUE,'id',v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.review_support_request(p_request_id UUID, p_status TEXT, p_response TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID:=public.my_profile_id(); v_req public.support_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_req FROM public.support_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF v_req.status IN ('resolved','rejected') THEN RAISE EXCEPTION 'request_already_closed'; END IF;
  IF p_status NOT IN ('in_review','resolved','rejected') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  IF char_length(COALESCE(p_response,''))>2000 THEN RAISE EXCEPTION 'response_too_long'; END IF;
  IF v_req.kind='role_request' AND NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT (public.is_manager() OR (public.my_role()='volunteer' AND v_req.recipient_id=v_actor)) THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.support_requests SET status=p_status,response=NULLIF(btrim(p_response),''),reviewed_by=v_actor,
    updated_at=now(),resolved_at=CASE WHEN p_status IN ('resolved','rejected') THEN now() ELSE NULL END WHERE id=p_request_id;
  INSERT INTO public.notifications(user_id,title,body,type)
  VALUES(v_req.sender_id,'تم تحديث طلبك',COALESCE(NULLIF(btrim(p_response),''),'تم تغيير حالة الطلب إلى '||p_status),'system');
  RETURN jsonb_build_object('ok',TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.broadcast_notifications(
  p_scope TEXT, p_scope_id UUID, p_title TEXT, p_body TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID:=public.my_profile_id(); v_count INTEGER;
BEGIN
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_scope NOT IN ('all','branch','batch')
     OR char_length(btrim(COALESCE(p_title,''))) NOT BETWEEN 2 AND 160
     OR char_length(btrim(COALESCE(p_body,''))) NOT BETWEEN 4 AND 4000
  THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF p_scope='branch' AND NOT EXISTS(SELECT 1 FROM public.branches WHERE id=p_scope_id) THEN RAISE EXCEPTION 'invalid_scope'; END IF;
  IF p_scope='batch' AND NOT EXISTS(SELECT 1 FROM public.batches WHERE id=p_scope_id) THEN RAISE EXCEPTION 'invalid_scope'; END IF;
  WITH targets AS (
    SELECT DISTINCT p.id FROM public.profiles p
    WHERE p.status='active' AND p.id<>v_actor AND (
      p_scope='all'
      OR (p_scope='branch' AND p.branch_id=p_scope_id)
      OR (p_scope='batch' AND EXISTS(SELECT 1 FROM public.enrollments e WHERE e.batch_id=p_scope_id AND e.user_id=p.id))
    )
  ), inserted AS (
    INSERT INTO public.notifications(user_id,title,body,type)
    SELECT id,btrim(p_title),btrim(p_body),'broadcast' FROM targets RETURNING 1
  ) SELECT count(*) INTO v_count FROM inserted;
  INSERT INTO public.audit_log(actor_id,action,target,payload)
  VALUES(v_actor,'broadcast',p_scope,jsonb_build_object('scope_id',p_scope_id,'title',btrim(p_title),'reached',v_count));
  RETURN jsonb_build_object('ok',TRUE,'reached',v_count);
END;
$$;

-- ---------------------------------------------------------------------------
-- Replace permissive RLS. Public data is readable; personal/operational data
-- follows ownership or assigned-batch rules. Sensitive writes use RPC only.
-- ---------------------------------------------------------------------------
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT schemaname,tablename,policyname FROM pg_policies WHERE schemaname='public'
           AND tablename IN ('profiles','branches','committees','courses','batches','sessions','enrollments','attendance',
             'point_events','streak_weeks','gamification','badges','user_badges','league_weeks','certificates','excuses',
             'course_ratings','instructor_ratings','organization_ratings','gamification_rules','audit_log','kudos_quotas',
             'notifications','private_notes','support_requests')
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',r.policyname,r.tablename); END LOOP;
END $$;

CREATE POLICY profiles_self_or_manager ON public.profiles FOR SELECT USING (
  id=public.my_profile_id() OR public.is_manager() OR
  (public.my_role()='volunteer' AND EXISTS(
    SELECT 1 FROM public.batches b JOIN public.enrollments e ON e.batch_id=b.id
    WHERE b.instructor_id=public.my_profile_id() AND e.user_id=profiles.id))
);
-- Profile writes are RPC-only; self-service fields and access-control fields
-- have separate validation and audit paths.
CREATE POLICY branches_read ON public.branches FOR SELECT USING(public.my_role() IS NOT NULL);
CREATE POLICY committees_read ON public.committees FOR SELECT USING(public.my_role() IS NOT NULL);
CREATE POLICY courses_read ON public.courses FOR SELECT USING(public.my_role() IS NOT NULL);
CREATE POLICY batches_read ON public.batches FOR SELECT USING(public.my_role() IS NOT NULL);
-- Organization, course, batch and session writes are RPC-only for validation,
-- auditability and atomic session generation.
CREATE POLICY sessions_visible ON public.sessions FOR SELECT USING(
  public.my_role() IS NOT NULL AND (public.is_manager() OR public.can_manage_batch(batch_id) OR EXISTS(
    SELECT 1 FROM public.enrollments e WHERE e.batch_id=sessions.batch_id AND e.user_id=public.my_profile_id())
));
CREATE POLICY enrollments_visible ON public.enrollments FOR SELECT USING(
  public.my_role() IS NOT NULL AND (user_id=public.my_profile_id() OR public.is_manager() OR public.can_manage_batch(batch_id))
);
CREATE POLICY attendance_visible ON public.attendance FOR SELECT USING(
  public.my_role() IS NOT NULL AND (user_id=public.my_profile_id() OR public.is_manager() OR EXISTS(
    SELECT 1 FROM public.sessions s WHERE s.id=attendance.session_id AND public.can_manage_batch(s.batch_id)))
);
CREATE POLICY points_visible ON public.point_events FOR SELECT USING(public.my_role() IS NOT NULL);
CREATE POLICY streak_visible ON public.streak_weeks FOR SELECT USING(public.my_role() IS NOT NULL AND (user_id=public.my_profile_id() OR public.is_manager()));
CREATE POLICY gamification_visible ON public.gamification FOR SELECT USING(public.my_role() IS NOT NULL AND (user_id=public.my_profile_id() OR public.is_manager()));
CREATE POLICY badges_read ON public.badges FOR SELECT USING(public.my_role() IS NOT NULL);
CREATE POLICY user_badges_visible ON public.user_badges FOR SELECT USING(public.my_role() IS NOT NULL AND (user_id=public.my_profile_id() OR public.is_manager()));
CREATE POLICY league_read ON public.league_weeks FOR SELECT USING(public.my_role() IS NOT NULL);
CREATE POLICY certificates_visible ON public.certificates FOR SELECT USING(public.my_role() IS NOT NULL AND (user_id=public.my_profile_id() OR public.is_manager()));
CREATE POLICY excuses_visible ON public.excuses FOR SELECT USING(
  public.my_role() IS NOT NULL AND (user_id=public.my_profile_id() OR public.is_manager() OR EXISTS(
    SELECT 1 FROM public.sessions s WHERE s.id=excuses.session_id AND public.can_manage_batch(s.batch_id)))
);
-- Excuse and rating writes are RPC-only so eligibility, review and point awards
-- cannot be bypassed with direct PostgREST mutations.
CREATE POLICY course_ratings_read ON public.course_ratings FOR SELECT USING(public.my_role() IS NOT NULL);
CREATE POLICY instructor_ratings_self_read ON public.instructor_ratings FOR SELECT USING(public.my_role() IS NOT NULL AND (user_id=public.my_profile_id() OR public.is_manager()));
CREATE POLICY org_ratings_self_read ON public.organization_ratings FOR SELECT USING(public.my_role() IS NOT NULL AND (user_id=public.my_profile_id() OR public.is_manager()));
CREATE POLICY rules_read ON public.gamification_rules FOR SELECT USING(public.my_role() IS NOT NULL);
CREATE POLICY audit_admin_read ON public.audit_log FOR SELECT USING(public.is_admin());
CREATE POLICY kudos_visible ON public.kudos_quotas FOR SELECT USING(public.my_role() IS NOT NULL AND (instructor_id=public.my_profile_id() OR public.is_manager()));
CREATE POLICY notes_owner ON public.private_notes FOR ALL USING(public.my_role() IS NOT NULL AND instructor_id=public.my_profile_id()) WITH CHECK(public.my_role() IS NOT NULL AND instructor_id=public.my_profile_id());
CREATE POLICY notifications_own_read ON public.notifications FOR SELECT USING(public.my_role() IS NOT NULL AND user_id=public.my_profile_id());
CREATE POLICY notifications_own_update ON public.notifications FOR UPDATE USING(public.my_role() IS NOT NULL AND user_id=public.my_profile_id()) WITH CHECK(public.my_role() IS NOT NULL AND user_id=public.my_profile_id());
CREATE POLICY requests_visible ON public.support_requests FOR SELECT USING(
  public.my_role() IS NOT NULL AND (
    sender_id=public.my_profile_id() OR recipient_id=public.my_profile_id() OR public.is_admin()
    OR (public.my_role()='supervisor' AND kind<>'role_request')
  )
);

-- Profiles are never directly mutable through PostgREST.
REVOKE UPDATE ON public.profiles FROM authenticated;
-- qr_seed must never be downloadable, even for an enrolled student.
REVOKE SELECT ON public.sessions FROM anon, authenticated;
GRANT SELECT(id,batch_id,seq,title,starts_at,duration_min,status,started_at,closed_at,report,created_at)
  ON public.sessions TO authenticated;

-- Remove the old insecure function that accepted arbitrary user ids.
REVOKE ALL ON FUNCTION public.check_in_session(UUID,UUID,TEXT) FROM PUBLIC, anon, authenticated;

-- Internal helpers are not API endpoints.
REVOKE ALL ON FUNCTION public.evaluate_user_badges(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._qr_signature(TEXT,UUID,BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._backup_code(TEXT,UUID) FROM PUBLIC, anon, authenticated;

-- Explicit RPC grants (Supabase often grants functions to PUBLIC by default).
DO $$ DECLARE f REGPROCEDURE;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.list_visible_profiles(integer,integer)'::regprocedure,
    'public.get_batch_stats(integer,integer)'::regprocedure,
    'public.complete_my_profile(text,text,text,uuid,text)'::regprocedure,
    'public.update_my_profile(text,text,text)'::regprocedure,
    'public.admin_update_user_access(uuid,text,text)'::regprocedure,
    'public.join_batch(uuid)'::regprocedure,
    'public.join_batch_by_code(text)'::regprocedure,
    'public.start_training_session(uuid)'::regprocedure,
    'public.get_session_qr_payload(uuid)'::regprocedure,
    'public.check_in_with_token(text)'::regprocedure,
    'public.manual_mark_attendance(uuid,uuid,text,text)'::regprocedure,
    'public.close_training_session(uuid,jsonb)'::regprocedure,
    'public.create_branch(text,text,text)'::regprocedure,
    'public.create_committee(uuid,text)'::regprocedure,
    'public.create_course(uuid,text,text,text,text[],integer,text)'::regprocedure,
    'public.create_batch_with_sessions(uuid,uuid,uuid,integer,jsonb,date,text,jsonb)'::regprocedure,
    'public.update_gamification_rule(text,numeric)'::regprocedure,
    'public.set_badge_active(text,boolean)'::regprocedure,
    'public.bootstrap_organization(jsonb)'::regprocedure,
    'public.submit_excuse(uuid,text,text)'::regprocedure,
    'public.review_excuse(uuid,text,text)'::regprocedure,
    'public.submit_course_rating(uuid,integer,text)'::regprocedure,
    'public.award_kudos(uuid,uuid,integer,text,uuid)'::regprocedure,
    'public.issue_batch_certificates(uuid)'::regprocedure,
    'public.submit_support_request(text,text,text,uuid)'::regprocedure,
    'public.review_support_request(uuid,text,text)'::regprocedure,
    'public.broadcast_notifications(text,uuid,text,text)'::regprocedure
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.verify_certificate(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_certificate(TEXT) TO anon, authenticated;

-- Realtime request inboxes.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.support_requests;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
