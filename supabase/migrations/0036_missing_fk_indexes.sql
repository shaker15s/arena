-- ═══════════════════════════════════════════════════════════════════════════
-- 0036_missing_fk_indexes.sql — Foreign Key Indexes & Retention Hardening
-- Task 7 (T7) from EXECUTION_PLAN_2026-10-01
-- NOTE: LIVE-OPS APPLICATION TO LIVE DATABASE REQUIRES EXPLICIT SHAKER SIGN-OFF
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Missing Foreign Key Indexes
CREATE INDEX IF NOT EXISTS idx_audit_actor_action ON public.audit_log(actor_id, action);
CREATE INDEX IF NOT EXISTS idx_excuses_user ON public.excuses(user_id);
CREATE INDEX IF NOT EXISTS idx_certs_batch ON public.certificates(batch_id);
CREATE INDEX IF NOT EXISTS idx_course_roles_composite ON public.course_roles(course_id, user_id);
CREATE INDEX IF NOT EXISTS idx_private_notes ON public.private_notes(instructor_id, user_id);
CREATE INDEX IF NOT EXISTS idx_att_disputes_session_status ON public.attendance_disputes(session_id, status);
CREATE INDEX IF NOT EXISTS idx_report_subs_user ON public.report_subscriptions(user_id);

-- 2) Batched retention pruning to avoid long table locks
CREATE OR REPLACE FUNCTION public.prune_retention_tables()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_notif INTEGER := 0;
  v_audit INTEGER := 0;
  v_points INTEGER := 0;
  v_att INTEGER := 0;
BEGIN
  -- Batched pruning to prevent long exclusive table locks (LIMIT 5000)
  WITH doomed AS (
    SELECT id FROM public.notifications
     WHERE created_at < now() - INTERVAL '180 days' AND read = TRUE
     LIMIT 5000
  )
  DELETE FROM public.notifications WHERE id IN (SELECT id FROM doomed);
  GET DIAGNOSTICS v_notif = ROW_COUNT;

  WITH doomed AS (
    SELECT id FROM public.audit_log
     WHERE created_at < now() - INTERVAL '730 days'
     LIMIT 5000
  )
  DELETE FROM public.audit_log WHERE id IN (SELECT id FROM doomed);
  GET DIAGNOSTICS v_audit = ROW_COUNT;

  WITH doomed AS (
    SELECT id FROM public.point_events
     WHERE created_at < now() - INTERVAL '730 days'
     LIMIT 5000
  )
  DELETE FROM public.point_events WHERE id IN (SELECT id FROM doomed);
  GET DIAGNOSTICS v_points = ROW_COUNT;

  WITH doomed AS (
    SELECT session_id, user_id FROM public.attendance
     WHERE checked_in_at < now() - INTERVAL '1095 days'
     LIMIT 5000
  )
  DELETE FROM public.attendance
   WHERE (session_id, user_id) IN (SELECT session_id, user_id FROM doomed);
  GET DIAGNOSTICS v_att = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'pruned_notifications', v_notif,
    'pruned_audit_log', v_audit,
    'pruned_point_events', v_points,
    'pruned_attendance', v_att,
    'executed_at', now()
  );
END;
$$;
REVOKE ALL ON FUNCTION public.prune_retention_tables() FROM PUBLIC, anon, authenticated;

-- 3) Retention job scheduling (guarded for environments with pg_cron)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('masar-retention-prune');
    EXCEPTION WHEN OTHERS THEN
      -- job might not exist yet
    END;
    PERFORM cron.schedule('masar-retention-prune', '15 4 * * *', 'SELECT public.prune_retention_tables()');
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- ignore in environments where pg_cron extension schema is not queryable
END $$;
