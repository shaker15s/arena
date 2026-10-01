-- 0035_role_update_null_safe.sql
-- Null-safe admin_update_user_access: COALESCE partial updates, preserve guards and audit log.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_update_user_access(
  p_profile_id UUID,
  p_role TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_branch_id UUID DEFAULT NULL,
  p_clear_branch BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := public.my_profile_id();
  v_old public.profiles%ROWTYPE;
  v_role TEXT;
  v_status TEXT;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT * INTO v_old FROM public.profiles WHERE id = p_profile_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;

  v_role := COALESCE(p_role, v_old.role);
  v_status := COALESCE(p_status, v_old.status);

  IF v_role NOT IN ('student', 'volunteer', 'supervisor', 'admin') THEN RAISE EXCEPTION 'invalid_role'; END IF;
  IF v_status NOT IN ('active', 'disabled') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  IF p_branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id) THEN
    RAISE EXCEPTION 'invalid_branch';
  END IF;

  IF p_profile_id = v_actor AND v_status = 'disabled' THEN
    RAISE EXCEPTION 'cannot_disable_self';
  END IF;

  IF v_old.role = 'admin' AND (v_role <> 'admin' OR v_status = 'disabled')
     AND (SELECT count(*) FROM public.profiles WHERE role = 'admin' AND status = 'active') <= 1
  THEN
    RAISE EXCEPTION 'last_admin';
  END IF;

  IF p_clear_branch THEN
    UPDATE public.profiles SET role = v_role, status = v_status, branch_id = NULL, updated_at = now() WHERE id = p_profile_id;
  ELSIF p_branch_id IS NOT NULL THEN
    UPDATE public.profiles SET role = v_role, status = v_status, branch_id = p_branch_id, updated_at = now() WHERE id = p_profile_id;
  ELSE
    UPDATE public.profiles SET role = v_role, status = v_status, updated_at = now() WHERE id = p_profile_id;
  END IF;

  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES (
    v_actor,
    'update_user_access',
    p_profile_id::text,
    jsonb_build_object(
      'old_role', v_old.role,
      'role', v_role,
      'old_status', v_old.status,
      'status', v_status,
      'branch', CASE WHEN p_clear_branch THEN NULL ELSE COALESCE(p_branch_id, v_old.branch_id) END,
      'clear_branch', p_clear_branch
    )
  );

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_user_access(UUID, TEXT, TEXT, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user_access(UUID, TEXT, TEXT, UUID, BOOLEAN) TO authenticated;

COMMIT;
