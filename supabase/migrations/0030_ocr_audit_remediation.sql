-- 0030_ocr_audit_remediation.sql
-- MASAR 3.3 — Comprehensive remediation of Open Code Review findings:
-- 1. Drop stale 1-arg overload of check_in_with_token(TEXT) to close geofence bypass.
-- 2. Restore COALESCE null coercion in is_staff() to prevent disabled/missing profiles from bypassing staff gates.
-- 3. Harden admin_update_user_access: restrict to is_admin(), prevent self-disable, protect last active admin.
-- 4. Secure get_batch_roster: add existence & authorization checks, mute join_code for non-managers.
-- 5. Recreate analytics facts with (security_invoker = true) to enforce caller RLS.

BEGIN;

-- 1) Drop geofence-less check_in_with_token overload left over from migration 0014
DROP FUNCTION IF EXISTS public.check_in_with_token(TEXT);

-- 2) Restore COALESCE null coercion in is_staff()
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(public.my_role() IN ('admin', 'supervisor', 'volunteer'), FALSE);
$$;
REVOKE ALL ON FUNCTION public.is_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated;

-- 3) Harden admin_update_user_access against privilege escalation
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
DECLARE
  v_actor UUID := public.my_profile_id();
  v_old public.profiles%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_role NOT IN ('student', 'volunteer', 'supervisor', 'admin') THEN RAISE EXCEPTION 'invalid_role'; END IF;
  IF p_status NOT IN ('active', 'disabled') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  IF p_branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id) THEN
    RAISE EXCEPTION 'invalid_branch';
  END IF;

  SELECT * INTO v_old FROM public.profiles WHERE id = p_profile_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;

  IF p_profile_id = v_actor AND p_status = 'disabled' THEN
    RAISE EXCEPTION 'cannot_disable_self';
  END IF;

  IF v_old.role = 'admin' AND (p_role <> 'admin' OR p_status = 'disabled')
     AND (SELECT count(*) FROM public.profiles WHERE role = 'admin' AND status = 'active') <= 1
  THEN
    RAISE EXCEPTION 'last_admin';
  END IF;

  IF p_clear_branch THEN
    UPDATE public.profiles SET role = p_role, status = p_status, branch_id = NULL, updated_at = now() WHERE id = p_profile_id;
  ELSIF p_branch_id IS NOT NULL THEN
    UPDATE public.profiles SET role = p_role, status = p_status, branch_id = p_branch_id, updated_at = now() WHERE id = p_profile_id;
  ELSE
    UPDATE public.profiles SET role = p_role, status = p_status, updated_at = now() WHERE id = p_profile_id;
  END IF;

  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES (
    v_actor,
    'update_user_access',
    p_profile_id::text,
    jsonb_build_object(
      'old_role', v_old.role,
      'role', p_role,
      'old_status', v_old.status,
      'status', p_status,
      'branch', p_branch_id,
      'clear_branch', p_clear_branch
    )
  );

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_user_access(UUID, TEXT, TEXT, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user_access(UUID, TEXT, TEXT, UUID, BOOLEAN) TO authenticated;

-- 4) Secure get_batch_roster and mute join_code for unauthorized callers
CREATE OR REPLACE FUNCTION public.get_batch_roster(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := public.my_profile_id();
  v_can_manage BOOLEAN;
  v_json JSONB;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.batches WHERE id = p_batch_id) THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  v_can_manage := public.can_manage_batch(p_batch_id);
  IF NOT v_can_manage AND NOT EXISTS(SELECT 1 FROM public.enrollments WHERE batch_id = p_batch_id AND user_id = v_actor) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT jsonb_build_object(
    'batch', (
      SELECT jsonb_build_object(
        'id', b.id,
        'course_id', b.course_id,
        'branch_id', b.branch_id,
        'instructor_id', b.instructor_id,
        'capacity', b.capacity,
        'schedule', b.schedule,
        'start_date', b.start_date,
        'room', b.room,
        'status', b.status,
        'created_at', b.created_at,
        'join_code', CASE WHEN v_can_manage THEN b.join_code ELSE NULL END
      )
      FROM public.batches b
      WHERE b.id = p_batch_id
    ),
    'students', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'full_name', p.full_name,
        'avatar_url', p.avatar_url,
        'avatar_color', p.avatar_color,
        'email', CASE WHEN v_can_manage THEN p.email ELSE NULL END,
        'phone', CASE WHEN v_can_manage THEN p.phone ELSE NULL END,
        'status', e.status,
        'joined_at', e.joined_at,
        'attended', (SELECT count(*) FROM public.attendance a WHERE a.user_id = p.id AND a.status <> 'absent'),
        'absent', (SELECT count(*) FROM public.attendance a WHERE a.user_id = p.id AND a.status = 'absent')
      ))
      FROM public.enrollments e
      JOIN public.profiles p ON p.id = e.user_id
      WHERE e.batch_id = p_batch_id
    ), '[]'::jsonb)
  ) INTO v_json;

  RETURN v_json;
END;
$$;
REVOKE ALL ON FUNCTION public.get_batch_roster(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_batch_roster(UUID) TO authenticated;

-- 5) Analytics facts with security_invoker = true
CREATE OR REPLACE VIEW public.attendance_fact
WITH (security_invoker = true) AS
SELECT
  a.session_id, a.user_id, a.status, a.checked_in_at,
  s.batch_id, s.starts_at, s.seq AS session_seq,
  b.branch_id, b.course_id, b.instructor_id
FROM public.attendance a
JOIN public.sessions s ON s.id = a.session_id
JOIN public.batches b ON b.id = s.batch_id;

CREATE OR REPLACE VIEW public.enrollment_fact
WITH (security_invoker = true) AS
SELECT
  e.user_id, e.batch_id, e.status AS enrollment_status, e.joined_at,
  b.branch_id, b.course_id, b.instructor_id, b.status AS batch_status
FROM public.enrollments e
JOIN public.batches b ON b.id = e.batch_id;

CREATE OR REPLACE VIEW public.session_fact
WITH (security_invoker = true) AS
SELECT
  s.id AS session_id, s.batch_id, s.seq, s.starts_at, s.duration_min, s.status,
  b.branch_id, b.course_id, b.instructor_id, b.capacity
FROM public.sessions s
JOIN public.batches b ON b.id = s.batch_id;

CREATE OR REPLACE VIEW public.course_fact
WITH (security_invoker = true) AS
SELECT
  c.id AS course_id, c.title, c.field, c.status AS course_status, c.sessions_count,
  b.id AS batch_id, b.branch_id, b.status AS batch_status,
  count(DISTINCT CASE WHEN e.status = 'active' THEN e.user_id END) AS enrolled
FROM public.courses c
LEFT JOIN public.batches b ON b.course_id = c.id
LEFT JOIN public.enrollments e ON e.batch_id = b.id
GROUP BY c.id, c.title, c.field, c.status, c.sessions_count, b.id, b.branch_id, b.status;

COMMIT;
