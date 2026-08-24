-- MASAR 3.2 — 0008: real account deletion (release blocker).
-- Users need an App-Store-compliant deletion path that removes their auth identity
-- and all dependent data. profiles.user_id references auth.users ON DELETE CASCADE,
-- and every table referencing profiles(id) cascades on delete, so removing the
-- auth.users row is the single source of truth for full erasure.
--
-- NOTE ON RUNTIME PRIVILEGES: this function is SECURITY DEFINER and must be owned
-- by a role with DELETE + TRUNCATE on auth.users (Supabase migration context =
-- postgres/supabase_admin). If deployed to a restricted project where the migration
-- role cannot touch auth schema, grant the function owner DELETE on auth.users, or
-- route deletion through an Edge Function calling admin.deleteUser().

BEGIN;

CREATE OR REPLACE FUNCTION public.delete_my_account(p_confirm TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_auth UUID := auth.uid();
  v_profile UUID := public.my_profile_id();
  v_role TEXT := public.my_role();
BEGIN
  IF v_auth IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  -- The client must type a confirmation phrase so an accidental tap cannot erase the account.
  IF btrim(COALESCE(p_confirm, '')) <> 'DELETE' THEN RAISE EXCEPTION 'confirmation_required'; END IF;

  -- Protect the last active admin from self-erasure (mirrors admin_update_user_access).
  IF v_role = 'admin' THEN
    IF (SELECT count(*) FROM public.profiles WHERE role = 'admin' AND status = 'active') <= 1 THEN
      RAISE EXCEPTION 'last_admin';
    END IF;
  END IF;

  -- Audit before destruction (actor_id is SET NULL, so the row survives erasure).
  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES (v_profile, 'account_deleted', v_profile::text, '{}'::jsonb);

  -- Deleting the auth.users row cascades to profiles and every dependent row
  -- (enrollments, attendance, point_events, streak_weeks, gamification, user_badges,
  -- league_weeks, certificates, excuses, course_ratings, private_notes, notifications,
  -- support_requests where sender). Instructor/supervisor SET NULL links are preserved.
  DELETE FROM auth.users WHERE id = v_auth;

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_my_account(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account(text) TO authenticated;

COMMIT;
