-- MASAR 3.2 — 0025: server-side rate limiting for sensitive RPCs (P0).
--
-- Why: the client-side limiter in `src/data/actions.ts` is advisory only — any
-- caller can hit PostgREST directly and bypass it. The QR/backup-code path was
-- already throttled (0014), but the remaining abusable surfaces were not:
--   * join_batch_by_code  → join-code enumeration (guessing other batches' codes)
--   * submit_excuse       → spam floods the instructor's inbox/notifications
--   * register_push_token → unbounded rows per user
--   * award_kudos         → quota exists but no burst protection / audit noise
--
-- Design: one generic sliding-window counter table keyed by (user, bucket) with
-- a SECURITY DEFINER helper. No policies on the table: it is only ever touched
-- from inside SECURITY DEFINER functions (same pattern as `checkin_attempts`).

BEGIN;

CREATE TABLE IF NOT EXISTS public.rpc_rate_events (
  id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  bucket   TEXT NOT NULL,
  hit_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rpc_rate_events_lookup_idx
  ON public.rpc_rate_events(user_id, bucket, hit_at DESC);

ALTER TABLE public.rpc_rate_events ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: RPC-only access.

-- Records one hit and returns TRUE when the caller is over the limit.
-- Sliding window; old rows are pruned opportunistically by prune_rate_events().
CREATE OR REPLACE FUNCTION public._rate_limit_exceeded(
  p_bucket TEXT,
  p_max INTEGER,
  p_window INTERVAL
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_user UUID := public.my_profile_id(); v_hits INTEGER;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT count(*) INTO v_hits FROM public.rpc_rate_events
   WHERE user_id = v_user AND bucket = p_bucket AND hit_at > now() - p_window;
  IF v_hits >= p_max THEN
    -- Log only the transition into the limited state (first refusal per window)
    -- to avoid flooding audit_log during an attack.
    IF v_hits = p_max THEN
      INSERT INTO public.audit_log(actor_id, action, target, payload)
      VALUES (v_user, 'rpc_rate_limited', p_bucket,
              jsonb_build_object('hits', v_hits, 'max', p_max, 'window', p_window::text));
    END IF;
    INSERT INTO public.rpc_rate_events(user_id, bucket) VALUES (v_user, p_bucket);
    RETURN TRUE;
  END IF;
  INSERT INTO public.rpc_rate_events(user_id, bucket) VALUES (v_user, p_bucket);
  RETURN FALSE;
END;
$$;
REVOKE ALL ON FUNCTION public._rate_limit_exceeded(TEXT, INTEGER, INTERVAL) FROM PUBLIC, anon, authenticated;

-- Housekeeping — call from the same cron that runs prune_checkin_attempts().
CREATE OR REPLACE FUNCTION public.prune_rate_events()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.rpc_rate_events WHERE hit_at < now() - interval '1 day';
END;
$$;
REVOKE ALL ON FUNCTION public.prune_rate_events() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1) join_batch_by_code — 10 attempts / 10 minutes. Also stops the timing/enum
--    oracle: an unknown code and a closed batch now fail identically.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_batch_by_code(p_join_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_batch UUID; v_result JSONB;
BEGIN
  IF char_length(btrim(COALESCE(p_join_code,''))) NOT BETWEEN 6 AND 40 THEN RAISE EXCEPTION 'invalid_join_code'; END IF;
  IF public._rate_limit_exceeded('join_batch_by_code', 10, interval '10 minutes') THEN
    RAISE EXCEPTION 'rate_limited';
  END IF;
  SELECT id INTO v_batch FROM public.batches
  WHERE upper(join_code)=upper(btrim(p_join_code)) AND status IN ('scheduled','active');
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_join_code'; END IF;
  v_result:=public.join_batch(v_batch);
  RETURN v_result||jsonb_build_object('batch_id',v_batch);
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) submit_excuse — 6 submissions / hour (upserts on rejected excuses count).
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
  IF public._rate_limit_exceeded('submit_excuse', 6, interval '1 hour') THEN
    RAISE EXCEPTION 'rate_limited';
  END IF;
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

-- ---------------------------------------------------------------------------
-- 3) register_push_token — 20 registrations / hour, and a hard cap of 10 live
--    tokens per user (oldest evicted) so the table can't grow unbounded.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_push_token(p_token TEXT, p_platform TEXT DEFAULT 'unknown')
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_user UUID := public.my_profile_id();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF char_length(btrim(COALESCE(p_token,''))) NOT BETWEEN 8 AND 512 THEN RAISE EXCEPTION 'invalid_token'; END IF;
  IF public._rate_limit_exceeded('register_push_token', 20, interval '1 hour') THEN
    RAISE EXCEPTION 'rate_limited';
  END IF;
  IF p_platform NOT IN ('android','ios','web','unknown') THEN p_platform := 'unknown'; END IF;
  INSERT INTO public.push_tokens(user_id, token, platform, updated_at)
  VALUES (v_user, btrim(p_token), p_platform, now())
  ON CONFLICT (user_id, token) DO UPDATE SET platform = EXCLUDED.platform, updated_at = now();
  DELETE FROM public.push_tokens pt
   WHERE pt.user_id = v_user
     AND pt.token NOT IN (
       SELECT token FROM public.push_tokens
        WHERE user_id = v_user ORDER BY updated_at DESC LIMIT 10
     );
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.register_push_token(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_push_token(TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) award_kudos — burst guard: 30 awards / 10 minutes per instructor.
--    (The monthly quota still applies; this only stops scripted bursts.)
-- ---------------------------------------------------------------------------
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
  IF public._rate_limit_exceeded('award_kudos', 30, interval '10 minutes') THEN
    RAISE EXCEPTION 'rate_limited';
  END IF;
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

COMMIT;
