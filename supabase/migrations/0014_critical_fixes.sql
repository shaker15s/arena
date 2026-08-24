-- MASAR 3.2 — 0014: critical fixes from the production critique (2026-08-24).
--
--  1) mark_notifications_read RPC — the client used a direct upsert on
--     `notifications`, which 0005's RLS (SELECT+UPDATE only, no INSERT) rejects.
--     PostgREST upsert = INSERT ... ON CONFLICT and therefore always failed.
--  2) Broken CHECK constraints: `x IN ('a','b',NULL)` evaluates to NULL for any
--     non-listed value, and a NULL CHECK passes. These constraints never
--     rejected anything. Rewritten as `IS NULL OR IN (...)`.
--  3) Backup-code brute force: check_in_with_token accepted unlimited 6-digit
--     guesses (10^6 space). Adds a per-user sliding-window rate limit with
--     audit logging of lockouts.
--  4) command_queue had no RLS enabled (defense-in-depth: access is RPC-only,
--     but every other table is belt-and-braces).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Notifications: server-side "mark all read" (idempotent, self-scoped).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_notifications_read()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_user UUID := public.my_profile_id(); v_count INTEGER;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  UPDATE public.notifications SET read = TRUE
  WHERE user_id = v_user AND read = FALSE;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('ok', TRUE, 'updated', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_notifications_read() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Repair CHECK constraints neutralized by the IN(...,NULL) pitfall.
--    Existing invalid data (if any) is normalized to NULL first so the
--    constraints can be applied.
-- ---------------------------------------------------------------------------
UPDATE public.profiles SET gender = NULL
  WHERE gender IS NOT NULL AND gender NOT IN ('m','f');
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_gender_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_gender_check
  CHECK (gender IS NULL OR gender IN ('m','f'));

UPDATE public.attendance SET method = NULL
  WHERE method IS NOT NULL AND method NOT IN ('qr','code','manual');
ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_method_check;
ALTER TABLE public.attendance ADD CONSTRAINT attendance_method_check
  CHECK (method IS NULL OR method IN ('qr','code','manual'));

UPDATE public.point_events SET ref_type = NULL
  WHERE ref_type IS NOT NULL AND ref_type NOT IN ('session','course','batch','admin');
ALTER TABLE public.point_events DROP CONSTRAINT IF EXISTS point_events_ref_type_check;
ALTER TABLE public.point_events ADD CONSTRAINT point_events_ref_type_check
  CHECK (ref_type IS NULL OR ref_type IN ('session','course','batch','admin'));

UPDATE public.league_weeks SET outcome = NULL
  WHERE outcome IS NOT NULL AND outcome NOT IN ('promoted','stayed','relegated');
ALTER TABLE public.league_weeks DROP CONSTRAINT IF EXISTS league_weeks_outcome_check;
ALTER TABLE public.league_weeks ADD CONSTRAINT league_weeks_outcome_check
  CHECK (outcome IS NULL OR outcome IN ('promoted','stayed','relegated'));

-- ---------------------------------------------------------------------------
-- 3) Backup-code rate limiting.
--    Sliding window: max 8 failed 6-digit attempts per 10 minutes per user.
--    QR-token scans are not throttled (tokens are unforgeable 20-hex sha256).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.checkin_attempts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS checkin_attempts_user_time_idx
  ON public.checkin_attempts(user_id, attempted_at DESC);
ALTER TABLE public.checkin_attempts ENABLE ROW LEVEL SECURITY;
-- No policies: table is written/read exclusively inside SECURITY DEFINER RPCs.

CREATE OR REPLACE FUNCTION public.check_in_with_token(p_payload TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_user UUID := public.my_profile_id(); v public.sessions%ROWTYPE;
        v_parts TEXT[]; v_slot BIGINT; v_current BIGINT; v_method TEXT := 'qr';
        v_elapsed NUMERIC; v_late INTEGER; v_points INTEGER; v_status TEXT;
        v_existing TEXT; v_recent_fails INTEGER;
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
    -- Rate limit: 8 failed guesses per 10 minutes locks 6-digit entry.
    SELECT count(*) INTO v_recent_fails FROM public.checkin_attempts
    WHERE user_id = v_user AND attempted_at > now() - interval '10 minutes';
    IF v_recent_fails >= 8 THEN
      INSERT INTO public.audit_log(actor_id, action, target, payload)
      VALUES (v_user, 'checkin_rate_limited', v_user::text,
              jsonb_build_object('recent_fails', v_recent_fails));
      RETURN jsonb_build_object('kind','rate_limited');
    END IF;
    SELECT s.* INTO v FROM public.sessions s
    JOIN public.enrollments e ON e.batch_id = s.batch_id AND e.user_id = v_user AND e.status = 'active'
    WHERE s.status = 'live' AND s.qr_seed IS NOT NULL
      AND public._backup_code(s.qr_seed, s.id) = p_payload
    LIMIT 1 FOR UPDATE OF s;
    IF NOT FOUND THEN
      INSERT INTO public.checkin_attempts(user_id) VALUES (v_user);
      RETURN jsonb_build_object('kind','no_session');
    END IF;
    -- Successful match clears the failure window.
    DELETE FROM public.checkin_attempts WHERE user_id = v_user;
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

-- Grants survive CREATE OR REPLACE, but be explicit anyway.
REVOKE ALL ON FUNCTION public.check_in_with_token(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_in_with_token(TEXT) TO authenticated;

-- Hourly janitor: drop stale attempt rows (>1 day) so the table stays tiny.
CREATE OR REPLACE FUNCTION public.prune_checkin_attempts()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_count INTEGER;
BEGIN
  DELETE FROM public.checkin_attempts WHERE attempted_at < now() - interval '1 day';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.prune_checkin_attempts() FROM PUBLIC, anon, authenticated;
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'masar-prune-checkin-attempts'
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
DO $$ BEGIN
  PERFORM cron.schedule('masar-prune-checkin-attempts','20 * * * *','SELECT public.prune_checkin_attempts()');
EXCEPTION WHEN undefined_function OR undefined_table THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 4) command_queue: enable RLS (RPC-only access; no policies on purpose).
-- ---------------------------------------------------------------------------
ALTER TABLE public.command_queue ENABLE ROW LEVEL SECURITY;

COMMIT;
