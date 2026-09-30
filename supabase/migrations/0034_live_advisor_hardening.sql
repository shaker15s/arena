-- 0034_live_advisor_hardening.sql
-- Hardens remaining public functions (search_path = public, pg_temp), removes
-- unused legacy _v2 and manual-script overloads left in the live DB, revokes
-- unnecessary anon EXECUTE on internal/authenticated functions, and revokes
-- direct PostgREST API exposure on materialized views.

BEGIN;

-- 1) Drop unused legacy manual-script functions & overloads if present in live DB
DROP FUNCTION IF EXISTS public.student_check_in_v2(TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION);
DROP FUNCTION IF EXISTS public.student_check_in_v2(TEXT, UUID);
DROP FUNCTION IF EXISTS public.award_kudos_v2(UUID, UUID, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.award_kudos_v2(UUID, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.issue_certificates_v2(UUID);
DROP FUNCTION IF EXISTS public.check_in_session(UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION);
DROP FUNCTION IF EXISTS public.get_user_gamification(UUID);
DROP FUNCTION IF EXISTS public.create_course_by_staff(TEXT, TEXT, TEXT, INTEGER, UUID);
DROP FUNCTION IF EXISTS public.create_course_by_staff(UUID, TEXT, TEXT, TEXT, TEXT[], INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.update_course_details(UUID, TEXT, TEXT, TEXT, TEXT[], INTEGER);
DROP FUNCTION IF EXISTS public.cancel_session(UUID, TEXT);

-- 2) Ensure every function in public schema has immutable search_path = public, pg_temp
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proconfig IS NULL OR NOT ('search_path=public, pg_temp' = ANY(p.proconfig)))
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', r.sig);
  END LOOP;
END $$;

-- 3) Revoke anon/PUBLIC EXECUTE on all public functions except intentional public verification RPCs
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname NOT IN ('verify_certificate', 'public_badge_assertion', 'verify_badge_assertion')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
  END LOOP;
END $$;

-- 4) Revoke direct API SELECT on materialized views (queried via SECURITY DEFINER RPCs)
REVOKE ALL ON TABLE public.mv_batch_stats FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.mv_admin_overview FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.mv_leaderboard_week FROM PUBLIC, anon, authenticated;

COMMIT;
