-- MASAR 3.2 — 0010: first-class session report + notify absent students.
-- The live-session close returns present/late/absent/excused/total but there is no
-- per-session report detail and no way to notify absentees in one shot. This adds an
-- atomic server-side summary RPC and a notify-absentees RPC (both idempotent), so the
-- client can render a real session report and offer a single-tap "notify absent" action.

BEGIN;

-- Authoritative per-session report: requires the caller to manage the session's batch,
-- so students cannot read arbitrary rosters/summaries through this endpoint.
CREATE OR REPLACE FUNCTION public.get_session_report(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v public.sessions%ROWTYPE;
  v_present INTEGER; v_late INTEGER; v_absent INTEGER; v_excused INTEGER; v_total INTEGER;
  v_students INTEGER;
BEGIN
  SELECT * INTO v FROM public.sessions WHERE id = p_session_id;
  IF NOT FOUND OR NOT public.can_manage_batch(v.batch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v.status <> 'closed' THEN RAISE EXCEPTION 'session_not_closed'; END IF;

  SELECT count(*) FILTER(WHERE status='present'), count(*) FILTER(WHERE status='late'),
         count(*) FILTER(WHERE status='absent'), count(*) FILTER(WHERE status='excused'), count(*)
  INTO v_present, v_late, v_absent, v_excused, v_total
  FROM public.attendance WHERE session_id = p_session_id;

  SELECT count(*) INTO v_students FROM public.enrollments
  WHERE batch_id = v.batch_id AND status = 'active';

  RETURN jsonb_build_object(
    'session_id', v.id,
    'title', v.title,
    'starts_at', v.starts_at,
    'expected', v_students,
    'present', COALESCE(v_present,0),
    'late', COALESCE(v_late,0),
    'absent', COALESCE(v_absent,0),
    'excused', COALESCE(v_excused,0),
    'total', COALESCE(v_total,0),
    'report', v.report
  );
END;
$$;

-- Notify every student who was absent (or has no record) for a closed session.
-- Idempotent via dedupe_key; returns the number notified.
CREATE OR REPLACE FUNCTION public.notify_session_absentees(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v public.sessions%ROWTYPE;
  v_count INTEGER;
BEGIN
  SELECT * INTO v FROM public.sessions WHERE id = p_session_id;
  IF NOT FOUND OR NOT public.can_manage_batch(v.batch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v.status <> 'closed' THEN RAISE EXCEPTION 'session_not_closed'; END IF;

  WITH absentees AS (
    SELECT e.user_id FROM public.enrollments e
    WHERE e.batch_id = v.batch_id AND e.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM public.attendance a
        WHERE a.session_id = p_session_id AND a.user_id = e.user_id AND a.status <> 'absent'
      )
  ), inserted AS (
    INSERT INTO public.notifications(user_id, title, body, type, dedupe_key)
    SELECT user_id, 'غبت عن الجلسة', COALESCE(v.title, 'جلسة تدريبية') || ' — سجّل غيابك أو قدّم عذرًا.', 'session',
      'absent-notify:' || p_session_id || ':' || user_id
    FROM absentees
    ON CONFLICT(dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_count FROM inserted;

  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES (public.my_profile_id(), 'notify_absentees', p_session_id::text, jsonb_build_object('notified', COALESCE(v_count,0)));
  RETURN jsonb_build_object('ok', TRUE, 'notified', COALESCE(v_count,0));
END;
$$;

DO $$ DECLARE f REGPROCEDURE;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.get_session_report(uuid)'::regprocedure,
    'public.notify_session_absentees(uuid)'::regprocedure
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

COMMIT;
