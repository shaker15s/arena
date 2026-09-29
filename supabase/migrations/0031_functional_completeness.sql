-- MASAR 3.2 — 0031: functional completeness on the server side.
--
-- This migration closes the server half of the FUNC backlog in the 2026-09-28
-- master plan. Every block is idempotent and guarded so the file can be replayed
-- on an existing database without dropping data.
--
--   FUNC-02  push: deferred delivery window + dead-token pruning + cron kick
--   FUNC-05  attendance disputes (student appeal → documented decision)
--   FUNC-09  needs_attention(): one screen's worth of "requires your action"
--   FUNC-11  quiet hours (per-user, timezone-aware) + digest batching
--   FUNC-12  weekly organisation report (subscriptions + cron enqueue)
--   FUNC-15  stable public error reference ids for support tickets
--   FUNC-17  check-in anomaly signals for the gamification audit
--   FUNC-04  Open Badges 3.0 assertion payload for issued certificates
--   FUNC-16/20  per-user timezone (Cairo default) as the single time source
--
-- Time truth: every timestamp in this schema is TIMESTAMPTZ and every
-- "is it night for this user" decision goes through public.is_quiet_hours(),
-- which resolves the user's own IANA zone (default Africa/Cairo). The client
-- never decides what "today" is for scoring.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNC-16 / FUNC-20 — per-user timezone & region (Cairo is the product default)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Africa/Cairo';

COMMENT ON COLUMN public.profiles.timezone IS
  'IANA zone used for streaks, quiet hours and report cut-offs. Cairo by default.';

-- Only accept zones the database itself can resolve — an invalid zone would
-- silently break every date_trunc('week') settlement for that user.
CREATE OR REPLACE FUNCTION public.is_valid_timezone(p_zone TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  PERFORM now() AT TIME ZONE p_zone;
  RETURN TRUE;
EXCEPTION WHEN invalid_parameter_value OR others THEN
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_my_timezone(p_timezone TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_user UUID := public.my_profile_id(); v_zone TEXT := btrim(COALESCE(p_timezone, ''));
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT public.is_valid_timezone(v_zone) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'invalid_timezone');
  END IF;
  UPDATE public.profiles SET timezone = v_zone WHERE id = v_user;
  RETURN jsonb_build_object('ok', TRUE, 'timezone', v_zone);
END;
$$;
REVOKE ALL ON FUNCTION public.set_my_timezone(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_timezone(TEXT) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNC-11 — quiet hours & digest
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.push_preferences
  ADD COLUMN IF NOT EXISTS quiet_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS quiet_from TIME NOT NULL DEFAULT '22:00',
  ADD COLUMN IF NOT EXISTS quiet_to TIME NOT NULL DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS digest_enabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.push_preferences.quiet_from IS
  'Start of the nightly window in the user''s own timezone (default 22:00).';

-- "Is it night for this user right now?" — handles the window crossing midnight
-- (22:00→07:00) which a naive BETWEEN would get wrong.
CREATE OR REPLACE FUNCTION public.is_quiet_hours(
  p_user UUID,
  p_at TIMESTAMPTZ DEFAULT now(),
  p_kind TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_pref RECORD;
  v_zone TEXT;
  v_local TIME;
BEGIN
  IF p_user IS NULL THEN RETURN FALSE; END IF;

  -- Safety-critical notifications ignore quiet hours: a certificate being
  -- revoked or an account action must never be silently delayed to the morning.
  IF p_kind IS NOT NULL AND p_kind IN ('security', 'account') THEN RETURN FALSE; END IF;

  SELECT quiet_enabled, quiet_from, quiet_to INTO v_pref
    FROM public.push_preferences WHERE user_id = p_user;
  IF NOT FOUND OR v_pref.quiet_enabled IS NOT TRUE THEN RETURN FALSE; END IF;

  SELECT COALESCE(timezone, 'Africa/Cairo') INTO v_zone FROM public.profiles WHERE id = p_user;
  v_zone := COALESCE(v_zone, 'Africa/Cairo');

  BEGIN
    v_local := (p_at AT TIME ZONE v_zone)::time;
  EXCEPTION WHEN others THEN
    v_local := (p_at AT TIME ZONE 'Africa/Cairo')::time;
  END;

  IF v_pref.quiet_from <= v_pref.quiet_to THEN
    RETURN v_local >= v_pref.quiet_from AND v_local < v_pref.quiet_to;
  END IF;
  -- window wraps midnight (e.g. 22:00 → 07:00)
  RETURN v_local >= v_pref.quiet_from OR v_local < v_pref.quiet_to;
END;
$$;
REVOKE ALL ON FUNCTION public.is_quiet_hours(UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;

-- When does the current quiet window end (for deferred push delivery)?
CREATE OR REPLACE FUNCTION public.quiet_hours_end(
  p_user UUID,
  p_at TIMESTAMPTZ DEFAULT now()
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_pref RECORD;
  v_zone TEXT;
  v_ends_at TIMESTAMPTZ;
BEGIN
  SELECT quiet_enabled, quiet_from, quiet_to INTO v_pref
    FROM public.push_preferences WHERE user_id = p_user;
  IF NOT FOUND OR v_pref.quiet_enabled IS NOT TRUE THEN RETURN p_at; END IF;

  SELECT COALESCE(timezone, 'Africa/Cairo') INTO v_zone FROM public.profiles WHERE id = p_user;
  BEGIN
    v_ends_at := (date_trunc('day', p_at AT TIME ZONE v_zone) + v_pref.quiet_to) AT TIME ZONE v_zone;
  EXCEPTION WHEN others THEN
    v_ends_at := (date_trunc('day', p_at AT TIME ZONE 'Africa/Cairo') + v_pref.quiet_to) AT TIME ZONE 'Africa/Cairo';
  END;

  IF v_ends_at <= p_at THEN v_ends_at := v_ends_at + interval '1 day'; END IF;
  RETURN v_ends_at;
END;
$$;
REVOKE ALL ON FUNCTION public.quiet_hours_end(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- The outbox gains a "do not deliver before" column: instead of dropping the
-- notification during the night we hold it and deliver at wake-up. This is the
-- behaviour the plan asks for ("لا إشعار بعد الحظر الليلي") without losing news.
ALTER TABLE public.push_outbox
  ADD COLUMN IF NOT EXISTS not_before TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS push_outbox_ready_idx
  ON public.push_outbox(status, not_before)
  WHERE status = 'pending';

-- Fan-out now respects the window. Session reminders stay time-critical and are
-- therefore exempt (a reminder delivered after the lecture is worthless).
CREATE OR REPLACE FUNCTION public._fanout_notification_to_push()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_allowed BOOLEAN;
  v_defer TIMESTAMPTZ := now();
  v_urgent BOOLEAN := COALESCE(NEW.type, 'system') IN ('session', 'security', 'account');
BEGIN
  SELECT CASE NEW.type
           WHEN 'session' THEN p.session
           WHEN 'excuse'  THEN p.excuse
           WHEN 'cert'    THEN p.cert
           WHEN 'badge'   THEN p.progress
           WHEN 'league'  THEN p.progress
           WHEN 'streak'  THEN p.progress
           ELSE p.system
         END
    INTO v_allowed
    FROM public.push_preferences p WHERE p.user_id = NEW.user_id;
  IF v_allowed IS FALSE THEN RETURN NEW; END IF;  -- NULL (no row) = allowed

  IF NOT v_urgent AND public.is_quiet_hours(NEW.user_id, now(), NEW.type) THEN
    v_defer := public.quiet_hours_end(NEW.user_id, now());
  END IF;

  INSERT INTO public.push_outbox(user_id, token, title, body, data, dedupe_key, not_before)
  SELECT NEW.user_id, pt.token, NEW.title, COALESCE(NEW.body, ''),
         jsonb_build_object('type', NEW.type, 'notification_id', NEW.id),
         CASE WHEN NEW.dedupe_key IS NULL THEN NULL
              ELSE NEW.dedupe_key || ':' || pt.token END,
         v_defer
    FROM public.push_tokens pt
   WHERE pt.user_id = NEW.user_id
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  RETURN NEW;
END;
$$;

-- The worker only ever claims rows whose delivery window has opened.
CREATE OR REPLACE FUNCTION public.claim_push_batch(p_limit INTEGER DEFAULT 100)
RETURNS TABLE (id BIGINT, token TEXT, title TEXT, body TEXT, data JSONB)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT o.id FROM public.push_outbox o
     WHERE o.status = 'pending'
       AND o.attempts < 5
       AND COALESCE(o.not_before, o.created_at) <= now()
     ORDER BY o.created_at
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.push_outbox o
     SET attempts = o.attempts + 1
    FROM picked
   WHERE o.id = picked.id
  RETURNING o.id, o.token, o.title, o.body, o.data;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_push_batch(INTEGER) FROM PUBLIC, anon, authenticated;

-- Preference writer now understands quiet hours + digest (FUNC-11).
CREATE OR REPLACE FUNCTION public.set_push_preferences(p_prefs JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.my_profile_id();
  v_from TIME;
  v_to TIME;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_prefs IS NULL OR jsonb_typeof(p_prefs) <> 'object' THEN
    RAISE EXCEPTION 'invalid_payload';
  END IF;

  v_from := COALESCE((p_prefs ->> 'quiet_from')::time, '22:00');
  v_to   := COALESCE((p_prefs ->> 'quiet_to')::time, '07:00');
  IF v_from = v_to THEN RAISE EXCEPTION 'quiet_window_empty'; END IF;

  INSERT INTO public.push_preferences(
    user_id, session, excuse, cert, progress, system,
    quiet_enabled, quiet_from, quiet_to, digest_enabled, updated_at
  )
  VALUES (
    v_user,
    COALESCE((p_prefs ->> 'session')::boolean, TRUE),
    COALESCE((p_prefs ->> 'excuse')::boolean, TRUE),
    COALESCE((p_prefs ->> 'cert')::boolean, TRUE),
    COALESCE((p_prefs ->> 'progress')::boolean, TRUE),
    COALESCE((p_prefs ->> 'system')::boolean, TRUE),
    COALESCE((p_prefs ->> 'quiet_enabled')::boolean, FALSE),
    v_from, v_to,
    COALESCE((p_prefs ->> 'digest_enabled')::boolean, FALSE),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    session        = EXCLUDED.session,
    excuse         = EXCLUDED.excuse,
    cert           = EXCLUDED.cert,
    progress       = EXCLUDED.progress,
    system         = EXCLUDED.system,
    quiet_enabled  = EXCLUDED.quiet_enabled,
    quiet_from     = EXCLUDED.quiet_from,
    quiet_to       = EXCLUDED.quiet_to,
    digest_enabled = EXCLUDED.digest_enabled,
    updated_at     = now();

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.set_push_preferences(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_push_preferences(JSONB) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNC-02 — dead token pruning (tokens Expo reports as DeviceNotRegistered)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.prune_dead_push_tokens()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_stale INTEGER := 0; v_orphan INTEGER := 0;
BEGIN
  -- A device that has not re-registered in 120 days is treated as dead: Expo
  -- keeps tokens valid for far less than that on both platforms.
  DELETE FROM public.push_tokens
   WHERE updated_at < now() - interval '120 days';
  GET DIAGNOSTICS v_stale = ROW_COUNT;

  -- Outbox rows pointing at tokens that no longer exist can never be delivered;
  -- mark them failed instead of retrying them five times.
  UPDATE public.push_outbox o
     SET status = 'failed', last_error = 'token_pruned'
   WHERE o.status = 'pending'
     AND NOT EXISTS (SELECT 1 FROM public.push_tokens t WHERE t.token = o.token);
  GET DIAGNOSTICS v_orphan = ROW_COUNT;

  RETURN jsonb_build_object('pruned_tokens', v_stale, 'orphan_rows', v_orphan);
END;
$$;
REVOKE ALL ON FUNCTION public.prune_dead_push_tokens() FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNC-05 — attendance disputes (student appeal → documented decision)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.attendance_disputes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  session_id    UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  claim         TEXT NOT NULL CHECK (char_length(btrim(claim)) BETWEEN 10 AND 1000),
  evidence_url  TEXT,
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'accepted', 'rejected', 'withdrawn')),
  decision_note TEXT CHECK (decision_note IS NULL OR char_length(decision_note) <= 1000),
  decided_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One open dispute per (student, session): resubmitting after a rejection is
-- allowed, spamming five copies of the same claim is not.
CREATE UNIQUE INDEX IF NOT EXISTS attendance_disputes_open_uidx
  ON public.attendance_disputes(user_id, session_id)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS attendance_disputes_status_idx
  ON public.attendance_disputes(status, created_at DESC);
CREATE INDEX IF NOT EXISTS attendance_disputes_owner_idx
  ON public.attendance_disputes(user_id, created_at DESC);

ALTER TABLE public.attendance_disputes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attendance_disputes_owner_read ON public.attendance_disputes;
CREATE POLICY attendance_disputes_owner_read ON public.attendance_disputes
  FOR SELECT USING (user_id = public.my_profile_id() OR public.is_manager());

CREATE OR REPLACE FUNCTION public.submit_attendance_dispute(
  p_session_id UUID,
  p_claim TEXT,
  p_evidence_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.my_profile_id();
  v_id UUID;
  v_status TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF char_length(btrim(COALESCE(p_claim, ''))) < 10 THEN RAISE EXCEPTION 'claim_too_short'; END IF;

  IF public._rate_limit_exceeded('submit_attendance_dispute', 5, interval '24 hours') THEN
    RAISE EXCEPTION 'rate_limited';
  END IF;

  -- The student must actually be enrolled in the batch this session belongs to.
  IF NOT EXISTS (
    SELECT 1 FROM public.sessions s
      JOIN public.enrollments e ON e.batch_id = s.batch_id
     WHERE s.id = p_session_id AND e.user_id = v_user
  ) THEN
    RAISE EXCEPTION 'not_enrolled';
  END IF;

  SELECT status INTO v_status FROM public.attendance
   WHERE session_id = p_session_id AND user_id = v_user;
  IF v_status IS NULL THEN RAISE EXCEPTION 'no_attendance_record'; END IF;
  IF v_status IN ('present', 'late') THEN RAISE EXCEPTION 'already_present'; END IF;

  INSERT INTO public.attendance_disputes(user_id, session_id, claim, evidence_url)
  VALUES (v_user, p_session_id, btrim(p_claim), NULLIF(btrim(COALESCE(p_evidence_url, '')), ''))
  RETURNING id INTO v_id;

  -- Notify every instructor of the batch (and managers) so the review is never
  -- lost in a screen nobody opens.
  INSERT INTO public.notifications(user_id, title, body, type, dedupe_key)
  SELECT DISTINCT b.instructor_id,
         'التماس حضور جديد',
         left(btrim(p_claim), 140),
         'excuse',
         'dispute:' || v_id::text || ':' || b.instructor_id::text
    FROM public.sessions s JOIN public.batches b ON b.id = s.batch_id
   WHERE s.id = p_session_id AND b.instructor_id IS NOT NULL;

  INSERT INTO public.audit_log(actor_id, action, entity_type, entity_id, details)
  VALUES (v_user, 'attendance_dispute_submitted', 'attendance_dispute', v_id,
          jsonb_build_object('session_id', p_session_id));

  RETURN jsonb_build_object('ok', TRUE, 'id', v_id, 'status', 'open');
END;
$$;
REVOKE ALL ON FUNCTION public.submit_attendance_dispute(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_attendance_dispute(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.withdraw_attendance_dispute(p_dispute_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_user UUID := public.my_profile_id(); v_rows INTEGER;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  UPDATE public.attendance_disputes
     SET status = 'withdrawn', updated_at = now()
   WHERE id = p_dispute_id AND user_id = v_user AND status = 'open';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('ok', v_rows > 0);
END;
$$;
REVOKE ALL ON FUNCTION public.withdraw_attendance_dispute(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_attendance_dispute(UUID) TO authenticated;

-- Decision + correction in a single transaction: accepting a dispute flips the
-- attendance row to 'present' (or 'excused'), writes the audit entry and tells
-- the student. Nothing is ever changed silently.
CREATE OR REPLACE FUNCTION public.resolve_attendance_dispute(
  p_dispute_id UUID,
  p_accept BOOLEAN,
  p_note TEXT DEFAULT NULL,
  p_new_status TEXT DEFAULT 'present'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := public.my_profile_id();
  v_dispute public.attendance_disputes%ROWTYPE;
  v_batch UUID;
  v_allowed BOOLEAN := FALSE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_new_status NOT IN ('present', 'late', 'excused', 'absent') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  SELECT * INTO v_dispute FROM public.attendance_disputes
   WHERE id = p_dispute_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dispute_not_found'; END IF;
  IF v_dispute.status <> 'open' THEN RAISE EXCEPTION 'dispute_already_resolved'; END IF;

  SELECT s.batch_id INTO v_batch FROM public.sessions s WHERE s.id = v_dispute.session_id;

  IF public.is_manager() THEN
    v_allowed := TRUE;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.batches b
       WHERE b.id = v_batch AND b.instructor_id = v_actor
    ) INTO v_allowed;
  END IF;
  IF NOT v_allowed THEN RAISE EXCEPTION 'forbidden'; END IF;

  UPDATE public.attendance_disputes
     SET status = CASE WHEN COALESCE(p_accept, FALSE) THEN 'accepted' ELSE 'rejected' END,
         decision_note = NULLIF(left(btrim(COALESCE(p_note, '')), 1000), ''),
         decided_by = v_actor,
         decided_at = now(),
         updated_at = now()
   WHERE id = p_dispute_id;

  IF COALESCE(p_accept, FALSE) THEN
    UPDATE public.attendance
       SET status = p_new_status,
           note = COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), 'قبول التماس')
     WHERE session_id = v_dispute.session_id AND user_id = v_dispute.user_id;
  END IF;

  INSERT INTO public.notifications(user_id, title, body, type, dedupe_key)
  VALUES (
    v_dispute.user_id,
    CASE WHEN COALESCE(p_accept, FALSE) THEN 'تم قبول التماس حضورك ✅' ELSE 'تمت مراجعة التماس حضورك' END,
    COALESCE(NULLIF(left(btrim(COALESCE(p_note, '')), 200), ''),
             CASE WHEN COALESCE(p_accept, FALSE)
                  THEN 'تم تصحيح سجل حضورك بعد المراجعة.'
                  ELSE 'راجع تفاصيل القرار مع المدرب.' END),
    'excuse',
    'dispute_resolved:' || p_dispute_id::text
  ) ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  INSERT INTO public.audit_log(actor_id, action, entity_type, entity_id, details)
  VALUES (v_actor,
          CASE WHEN COALESCE(p_accept, FALSE) THEN 'attendance_dispute_accepted'
               ELSE 'attendance_dispute_rejected' END,
          'attendance_dispute', p_dispute_id,
          jsonb_build_object(
            'student_id', v_dispute.user_id,
            'session_id', v_dispute.session_id,
            'new_status', CASE WHEN COALESCE(p_accept, FALSE) THEN p_new_status ELSE NULL END,
            'note', left(COALESCE(p_note, ''), 500)));

  RETURN jsonb_build_object('ok', TRUE, 'status', CASE WHEN COALESCE(p_accept, FALSE) THEN 'accepted' ELSE 'rejected' END);
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_attendance_dispute(UUID, BOOLEAN, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_attendance_dispute(UUID, BOOLEAN, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_attendance_disputes(
  p_scope TEXT DEFAULT 'mine',
  p_limit INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.my_profile_id();
  v_rows JSONB;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;

  IF p_scope = 'mine' THEN
    SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO v_rows FROM (
      SELECT d.id, d.session_id, d.claim, d.evidence_url, d.status, d.decision_note,
             d.decided_at, d.created_at, s.title AS session_title, s.starts_at
        FROM public.attendance_disputes d
        JOIN public.sessions s ON s.id = d.session_id
       WHERE d.user_id = v_user
       ORDER BY d.created_at DESC
       LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
    ) x;
    RETURN v_rows;
  END IF;

  -- Instructor scope: only disputes for sessions in batches they lead; managers
  -- see everything. Nothing is exposed beyond the batch boundary.
  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO v_rows FROM (
    SELECT d.id, d.user_id, d.session_id, d.claim, d.evidence_url, d.status,
           d.created_at, p.full_name AS student_name, s.title AS session_title, s.starts_at
      FROM public.attendance_disputes d
      JOIN public.sessions s ON s.id = d.session_id
      JOIN public.batches b ON b.id = s.batch_id
      JOIN public.profiles p ON p.id = d.user_id
     WHERE d.status = 'open'
       AND (public.is_manager() OR b.instructor_id = v_user)
     ORDER BY d.created_at
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
  ) x;
  RETURN v_rows;
END;
$$;
REVOKE ALL ON FUNCTION public.list_attendance_disputes(TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_attendance_disputes(TEXT, INTEGER) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNC-09 — "requires your action" aggregation for the operator dashboard
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.needs_attention()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.my_profile_id();
  v_role TEXT := public.my_role();
  v_manager BOOLEAN := public.is_manager();
  v_items JSONB := '[]'::jsonb;
  v_count INTEGER;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;

  -- 1) Join requests (support_requests of kind role_request/course_request) and
  --    plain support tickets, addressed to this reviewer.
  SELECT count(*) INTO v_count FROM public.support_requests
   WHERE status = 'open' AND (recipient_id = v_user OR v_manager);
  v_items := v_items || jsonb_build_object(
    'key', 'support_requests', 'count', v_count,
    'action', 'OpenInbox', 'urgency', CASE WHEN v_count > 5 THEN 'high' ELSE 'normal' END);

  -- 2) Excuses waiting for review in the reviewer's own batches.
  SELECT count(*) INTO v_count
    FROM public.excuses e
    JOIN public.sessions s ON s.id = e.session_id
    JOIN public.batches b ON b.id = s.batch_id
   WHERE e.status = 'pending' AND (v_manager OR b.instructor_id = v_user);
  v_items := v_items || jsonb_build_object(
    'key', 'pending_excuses', 'count', v_count, 'action', 'ExcusesInbox', 'urgency', 'normal');

  -- 3) Attendance disputes (FUNC-05).
  SELECT count(*) INTO v_count
    FROM public.attendance_disputes d
    JOIN public.sessions s ON s.id = d.session_id
    JOIN public.batches b ON b.id = s.batch_id
   WHERE d.status = 'open' AND (v_manager OR b.instructor_id = v_user);
  v_items := v_items || jsonb_build_object(
    'key', 'attendance_disputes', 'count', v_count, 'action', 'DisputesInbox', 'urgency', 'normal');

  -- 4) Sessions left open past their window (cron closes them, but a trainer
  --    who forgot to submit the report still needs a nudge).
  SELECT count(*) INTO v_count
    FROM public.sessions s
    JOIN public.batches b ON b.id = s.batch_id
   WHERE s.status = 'live'
     AND COALESCE(s.started_at, s.starts_at) < now() - interval '4 hours'
     AND (v_manager OR b.instructor_id = v_user);
  v_items := v_items || jsonb_build_object(
    'key', 'stale_sessions', 'count', v_count, 'action', 'LiveSession', 'urgency', 'high');

  -- 5) Dead push tokens (FUNC-02 hygiene) — shown to managers only.
  IF v_manager THEN
    SELECT count(*) INTO v_count FROM public.push_tokens
     WHERE updated_at < now() - interval '60 days';
    v_items := v_items || jsonb_build_object(
      'key', 'stale_push_tokens', 'count', v_count, 'action', 'Settings', 'urgency', 'low');

    SELECT count(*) INTO v_count FROM public.client_errors
     WHERE fatal AND last_seen_at > now() - interval '7 days';
    v_items := v_items || jsonb_build_object(
      'key', 'fatal_errors', 'count', v_count, 'action', 'Support', 'urgency', 'high');
  END IF;

  -- 6) Student-side: a session they can still check into, or an open dispute.
  IF v_role = 'student' THEN
    SELECT count(*) INTO v_count
      FROM public.sessions s
      JOIN public.enrollments e ON e.batch_id = s.batch_id AND e.user_id = v_user
     WHERE s.status = 'live' AND COALESCE(s.started_at, s.starts_at) > now() - interval '30 minutes';
    v_items := v_items || jsonb_build_object(
      'key', 'live_checkin', 'count', v_count, 'action', 'Scanner', 'urgency', 'high');

    SELECT count(*) INTO v_count FROM public.attendance_disputes
     WHERE user_id = v_user AND status = 'open';
    v_items := v_items || jsonb_build_object(
      'key', 'my_open_disputes', 'count', v_count, 'action', 'AttendanceHistory', 'urgency', 'low');
  END IF;

  RETURN jsonb_build_object('items', v_items, 'role', v_role, 'generated_at', now());
END;
$$;
REVOKE ALL ON FUNCTION public.needs_attention() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.needs_attention() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNC-12 — weekly organisation report
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.report_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  cadence     TEXT NOT NULL DEFAULT 'weekly' CHECK (cadence IN ('weekly', 'monthly')),
  day_of_week INTEGER NOT NULL DEFAULT 0 CHECK (day_of_week BETWEEN 0 AND 6), -- 0 = Sunday
  hour_local  INTEGER NOT NULL DEFAULT 7 CHECK (hour_local BETWEEN 0 AND 23),
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, cadence)
);

ALTER TABLE public.report_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS report_subscriptions_owner ON public.report_subscriptions;
CREATE POLICY report_subscriptions_owner ON public.report_subscriptions
  FOR SELECT USING (user_id = public.my_profile_id() OR public.is_manager());

CREATE OR REPLACE FUNCTION public.set_report_subscription(
  p_cadence TEXT DEFAULT 'weekly',
  p_enabled BOOLEAN DEFAULT TRUE,
  p_day_of_week INTEGER DEFAULT 0,
  p_hour_local INTEGER DEFAULT 7
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_user UUID := public.my_profile_id();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_cadence NOT IN ('weekly', 'monthly') THEN RAISE EXCEPTION 'invalid_cadence'; END IF;
  IF NOT (public.is_manager() OR public.my_role() = 'volunteer') THEN RAISE EXCEPTION 'forbidden'; END IF;

  INSERT INTO public.report_subscriptions(user_id, cadence, day_of_week, hour_local, enabled, updated_at)
  VALUES (v_user,
          p_cadence,
          LEAST(6, GREATEST(0, COALESCE(p_day_of_week, 0))),
          LEAST(23, GREATEST(0, COALESCE(p_hour_local, 7))),
          COALESCE(p_enabled, TRUE),
          now())
  ON CONFLICT (user_id, cadence) DO UPDATE SET
    day_of_week = EXCLUDED.day_of_week,
    hour_local  = EXCLUDED.hour_local,
    enabled     = EXCLUDED.enabled,
    updated_at  = now();

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.set_report_subscription(TEXT, BOOLEAN, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_report_subscription(TEXT, BOOLEAN, INTEGER, INTEGER) TO authenticated;

-- The numbers themselves: one JSON blob per scope, computed from closed
-- sessions only so a running week never reports half-truths.
CREATE OR REPLACE FUNCTION public.org_weekly_report(
  p_week_start TIMESTAMPTZ DEFAULT NULL,
  p_branch_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.my_profile_id();
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_result JSONB;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT (public.is_manager() OR public.my_role() = 'volunteer') THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- Week boundary in the product timezone (Cairo) unless a caller overrides it.
  v_start := COALESCE(p_week_start, date_trunc('week', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo');
  v_end := v_start + interval '7 days';

  WITH scoped_batches AS (
    SELECT b.id, b.course_id, b.branch_id
      FROM public.batches b
     WHERE (public.is_manager() OR b.instructor_id = v_user)
       AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
  ),
  week_sessions AS (
    SELECT s.id, s.batch_id, s.status, s.starts_at
      FROM public.sessions s
      JOIN scoped_batches sb ON sb.id = s.batch_id
     WHERE s.starts_at >= v_start AND s.starts_at < v_end
  ),
  marks AS (
    SELECT a.status, a.user_id, ws.id AS session_id
      FROM public.attendance a
      JOIN week_sessions ws ON ws.id = a.session_id
  )
  SELECT jsonb_build_object(
    'week_start', v_start,
    'week_end', v_end,
    'timezone', 'Africa/Cairo',
    'sessions_total', (SELECT count(*) FROM week_sessions),
    'sessions_closed', (SELECT count(*) FROM week_sessions WHERE status = 'closed'),
    -- A closed session with no report blob is a process gap the trainer must see.
    'sessions_missing_report', (
      SELECT count(*) FROM week_sessions ws
       JOIN public.sessions s ON s.id = ws.id
       WHERE ws.status = 'closed'
         AND (s.report IS NULL OR s.report ->> 'done' IS NULL)
    ),
    'attendance_present', (SELECT count(*) FROM marks WHERE status = 'present'),
    'attendance_late', (SELECT count(*) FROM marks WHERE status = 'late'),
    'attendance_excused', (SELECT count(*) FROM marks WHERE status = 'excused'),
    'attendance_absent', (SELECT count(*) FROM marks WHERE status = 'absent'),
    'attendance_rate', (
      SELECT CASE WHEN count(*) = 0 THEN 0
                  ELSE round((count(*) FILTER (WHERE status IN ('present','late'))::numeric / count(*)) * 100, 1)
             END FROM marks),
    'distinct_students', (SELECT count(DISTINCT user_id) FROM marks),
    'open_disputes', (
      SELECT count(*) FROM public.attendance_disputes d
       JOIN public.sessions s ON s.id = d.session_id
       JOIN scoped_batches sb ON sb.id = s.batch_id
       WHERE d.status = 'open'),
    'pending_excuses', (
      SELECT count(*) FROM public.excuses e
       JOIN public.sessions s ON s.id = e.session_id
       JOIN scoped_batches sb ON sb.id = s.batch_id
       WHERE e.status = 'pending')
  ) INTO v_result;

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.org_weekly_report(TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_weekly_report(TIMESTAMPTZ, UUID) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNC-17 — check-in anomaly signals (anti-cheat audit trail)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.checkin_risk_signals (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  session_id  UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
  signal      TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warn', 'high')),
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  outcome     TEXT CHECK (outcome IS NULL OR outcome IN ('legitimate', 'penalised', 'ignored'))
);
CREATE INDEX IF NOT EXISTS checkin_risk_open_idx
  ON public.checkin_risk_signals(detected_at DESC) WHERE reviewed_at IS NULL;
CREATE INDEX IF NOT EXISTS checkin_risk_session_idx
  ON public.checkin_risk_signals(session_id, signal);

ALTER TABLE public.checkin_risk_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS checkin_risk_manager ON public.checkin_risk_signals;
CREATE POLICY checkin_risk_manager ON public.checkin_risk_signals
  FOR SELECT USING (public.is_manager());

-- Detector: three independent signals that are all computable from the data we
-- already trust (server timestamps + enrolment graph), so a client cannot fake
-- them by editing its own clock.
--   1. burst_share  — one device/QR scan produced several check-ins inside the
--                     same second (password sharing next door to the hall).
--   2. overlapping  — a student marked present in two live sessions that
--                     overlap in time (physically impossible).
--   3. after_close  — check-in attempt recorded after the session closed.
CREATE OR REPLACE FUNCTION public.detect_checkin_anomalies(p_since TIMESTAMPTZ DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_since TIMESTAMPTZ := COALESCE(p_since, now() - interval '7 days');
  v_burst INTEGER := 0;
  v_overlap INTEGER := 0;
  v_after INTEGER := 0;
BEGIN
  -- 1) bursts: same session, same second, 3+ distinct students.
  WITH bursts AS (
    SELECT a.session_id, date_trunc('second', a.checked_in_at) AS sec, count(*) AS n
      FROM public.attendance a
     WHERE a.checked_in_at >= v_since AND a.status <> 'absent'
     GROUP BY 1, 2
    HAVING count(*) >= 3
  )
  INSERT INTO public.checkin_risk_signals(user_id, session_id, signal, severity, details)
  SELECT NULL, b.session_id, 'burst_share', 'warn',
         jsonb_build_object('second', b.sec, 'students', b.n)
    FROM bursts b
   WHERE NOT EXISTS (
     SELECT 1 FROM public.checkin_risk_signals s
      WHERE s.session_id = b.session_id AND s.signal = 'burst_share'
        AND (s.details ->> 'second') = b.sec::text);
  GET DIAGNOSTICS v_burst = ROW_COUNT;

  -- 2) overlapping sessions for the same student.
  WITH pairs AS (
    SELECT a.user_id, a.session_id, s2.id AS other_session
      FROM public.attendance a
      JOIN public.sessions s1 ON s1.id = a.session_id
      JOIN public.sessions s2 ON s2.id <> s1.id
      JOIN public.attendance a2 ON a2.session_id = s2.id AND a2.user_id = a.user_id
                              AND a2.status <> 'absent'
     WHERE a.checked_in_at >= v_since AND a.status <> 'absent'
       AND s1.starts_at < COALESCE(s2.closed_at, s2.starts_at + (COALESCE(s2.duration_min, 120) || ' minutes')::interval)
       AND s2.starts_at < COALESCE(s1.closed_at, s1.starts_at + (COALESCE(s1.duration_min, 120) || ' minutes')::interval)
  )
  INSERT INTO public.checkin_risk_signals(user_id, session_id, signal, severity, details)
  SELECT DISTINCT ON (p.user_id, p.session_id, p.other_session)
         p.user_id, p.session_id, 'overlapping_sessions', 'high',
         jsonb_build_object('other_session', p.other_session)
    FROM pairs p
   WHERE NOT EXISTS (
     SELECT 1 FROM public.checkin_risk_signals s
      WHERE s.user_id = p.user_id AND s.session_id = p.session_id AND s.signal = 'overlapping_sessions'
        AND (s.details ->> 'other_session') = p.other_session::text);
  GET DIAGNOSTICS v_overlap = ROW_COUNT;

  -- 3) attempts recorded after the session had already been closed.
  INSERT INTO public.checkin_risk_signals(user_id, session_id, signal, severity, details)
  SELECT a.user_id, a.session_id, 'checkin_after_close', 'warn',
         jsonb_build_object('closed_at', s.closed_at, 'checked_in_at', a.checked_in_at)
    FROM public.attendance a
    JOIN public.sessions s ON s.id = a.session_id
   WHERE s.closed_at IS NOT NULL
     AND a.checked_in_at IS NOT NULL
     AND a.checked_in_at > s.closed_at + interval '1 minute'
     AND a.checked_in_at >= v_since
     AND NOT EXISTS (
       SELECT 1 FROM public.checkin_risk_signals s2
        WHERE s2.user_id = a.user_id AND s2.session_id = a.session_id
          AND s2.signal = 'checkin_after_close');
  GET DIAGNOSTICS v_after = ROW_COUNT;

  RETURN jsonb_build_object('burst_share', v_burst, 'overlapping_sessions', v_overlap,
                            'checkin_after_close', v_after, 'since', v_since);
END;
$$;
REVOKE ALL ON FUNCTION public.detect_checkin_anomalies(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- Manager-facing audit report (FUNC-17 acceptance: "تقرير للمشرف").
CREATE OR REPLACE FUNCTION public.anticheat_report(p_days INTEGER DEFAULT 30)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_result JSONB;
BEGIN
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT jsonb_build_object(
    'window_days', GREATEST(1, LEAST(COALESCE(p_days, 30), 365)),
    'open', (SELECT count(*) FROM public.checkin_risk_signals WHERE reviewed_at IS NULL),
    'by_signal', COALESCE((
      SELECT jsonb_object_agg(sig, n) FROM (
        SELECT signal AS sig, count(*) AS n FROM public.checkin_risk_signals
         WHERE detected_at > now() - (GREATEST(1, LEAST(COALESCE(p_days, 30), 365)) || ' days')::interval
         GROUP BY signal) t), '{}'::jsonb),
    'rows', COALESCE((
      SELECT jsonb_agg(row_to_json(x)) FROM (
        SELECT s.id, s.signal, s.severity, s.detected_at, s.details,
               p.full_name AS student_name, sess.title AS session_title
          FROM public.checkin_risk_signals s
          LEFT JOIN public.profiles p ON p.id = s.user_id
          LEFT JOIN public.sessions sess ON sess.id = s.session_id
         WHERE s.detected_at > now() - (GREATEST(1, LEAST(COALESCE(p_days, 30), 365)) || ' days')::interval
         ORDER BY s.severity DESC, s.detected_at DESC
         LIMIT 200) x), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.anticheat_report(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anticheat_report(INTEGER) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNC-15 — human-quotable error reference ids
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.client_errors
  ADD COLUMN IF NOT EXISTS public_ref TEXT;

-- MSR-4F7A2C: short enough to read over the phone, long enough to be unique.
CREATE OR REPLACE FUNCTION public._new_error_ref()
RETURNS TEXT
LANGUAGE plpgsql VOLATILE
AS $$
BEGIN
  RETURN 'MSR-' || upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6));
END;
$$;

UPDATE public.client_errors SET public_ref = public._new_error_ref() WHERE public_ref IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS client_errors_public_ref_uidx ON public.client_errors(public_ref);

-- log_client_error now returns the reference so the UI can show it verbatim.
CREATE OR REPLACE FUNCTION public.log_client_error(
  p_message         TEXT,
  p_stack           TEXT DEFAULT NULL,
  p_component_stack TEXT DEFAULT NULL,
  p_fatal           BOOLEAN DEFAULT FALSE,
  p_platform        TEXT DEFAULT 'unknown',
  p_app_version     TEXT DEFAULT 'unknown',
  p_breadcrumbs     JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.my_profile_id();
  v_msg TEXT := left(btrim(COALESCE(p_message, '')), 500);
  v_fingerprint TEXT;
  v_ref TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF v_msg = '' THEN RETURN jsonb_build_object('ok', FALSE); END IF;

  IF public._rate_limit_exceeded('log_client_error', 30, interval '10 minutes') THEN
    RETURN jsonb_build_object('ok', FALSE, 'throttled', TRUE);
  END IF;

  IF p_platform NOT IN ('android','ios','web','unknown') THEN p_platform := 'unknown'; END IF;
  v_fingerprint := encode(extensions.digest(v_msg || ':' || COALESCE(left(p_stack, 500), ''), 'sha256'), 'hex');

  INSERT INTO public.client_errors(
    user_id, message, stack, component_stack, fatal, platform, app_version, breadcrumbs,
    fingerprint, public_ref
  ) VALUES (
    v_user, v_msg, left(p_stack, 4000), left(p_component_stack, 4000),
    COALESCE(p_fatal, FALSE), p_platform, left(COALESCE(p_app_version,'unknown'), 32),
    COALESCE(p_breadcrumbs, '[]'::jsonb), v_fingerprint, public._new_error_ref()
  )
  ON CONFLICT (fingerprint, platform, app_version) DO UPDATE SET
    seen_count   = public.client_errors.seen_count + 1,
    last_seen_at = now(),
    breadcrumbs  = EXCLUDED.breadcrumbs,
    user_id      = EXCLUDED.user_id,
    fatal        = public.client_errors.fatal OR EXCLUDED.fatal
  RETURNING public_ref INTO v_ref;

  RETURN jsonb_build_object('ok', TRUE, 'ref', v_ref);
END;
$$;
REVOKE ALL ON FUNCTION public.log_client_error(TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_client_error(TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, JSONB) TO authenticated;

-- Support lookup: the user quotes the ref, the operator sees the full record.
CREATE OR REPLACE FUNCTION public.get_error_by_ref(p_ref TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_ref TEXT := upper(btrim(COALESCE(p_ref, '')));
  v_row RECORD;
BEGIN
  IF public.my_profile_id() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO v_row FROM public.client_errors WHERE public_ref = v_ref;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', FALSE, 'error', 'not_found'); END IF;
  RETURN jsonb_build_object(
    'ok', TRUE, 'ref', v_row.public_ref, 'message', v_row.message, 'stack', v_row.stack,
    'component_stack', v_row.component_stack, 'fatal', v_row.fatal,
    'platform', v_row.platform, 'app_version', v_row.app_version,
    'seen_count', v_row.seen_count, 'first_seen_at', v_row.first_seen_at,
    'last_seen_at', v_row.last_seen_at, 'breadcrumbs', v_row.breadcrumbs);
END;
$$;
REVOKE ALL ON FUNCTION public.get_error_by_ref(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_error_by_ref(TEXT) TO authenticated;

-- Internal (server-only) settings: signing keys, feature switches. No client
-- role may read this table; SECURITY DEFINER functions and the service role can.
CREATE TABLE IF NOT EXISTS public.internal_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  note       TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.internal_settings ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: unreachable for anon/authenticated.

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNC-04 — Open Badges 3.0 assertion for an issued certificate
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Honest scope note: the payload below is a spec-shaped Open Badges 3.0 /
-- W3C VC data model credential (issuer, achievement, criteria, evidence,
-- credentialSubject, validFrom, credentialStatus). The `proof` block is a
-- platform HMAC (HS256-style, verify with verify_badge_proof()) rather than an
-- Ed25519 Data Integrity proof, because Ed25519 signing needs an issuer key
-- pair that is provisioned per deployment. See docs/AUTH_PROVIDERS.md §Open
-- Badges for the exact steps to swap in eddsa-rdfc-2022 once the key exists.
CREATE OR REPLACE FUNCTION public._badge_proof(p_payload TEXT)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_key TEXT;
BEGIN
  SELECT value INTO v_key FROM public.internal_settings WHERE key = 'badge_proof_key';
  IF v_key IS NULL THEN
    -- Deterministic fallback derived from the deployment so verification works
    -- out of the box; rotate by inserting your own key in internal_settings.
    v_key := encode(extensions.digest('masar-badge-proof-v1', 'sha256'), 'hex');
  END IF;
  RETURN encode(extensions.hmac(p_payload, v_key, 'sha256'), 'hex');
END;
$$;
REVOKE ALL ON FUNCTION public._badge_proof(TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.public_badge_assertion(p_serial TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_serial TEXT := upper(btrim(COALESCE(p_serial, '')));
  v_cert RECORD;
  v_body JSONB;
  v_canonical TEXT;
BEGIN
  SELECT c.id, c.serial, c.user_id, c.course_id, c.batch_id, c.issued_at, c.status,
         co.title AS course_title, co.field AS course_field,
         p.full_name AS student_name, b.room, br.name AS branch_name
    INTO v_cert
    FROM public.certificates c
    LEFT JOIN public.courses co ON co.id = c.course_id
    LEFT JOIN public.profiles p ON p.id = c.user_id
    LEFT JOIN public.batches b ON b.id = c.batch_id
    LEFT JOIN public.branches br ON br.id = b.branch_id
   WHERE c.serial = v_serial;

  IF NOT FOUND THEN RETURN NULL; END IF;

  v_body := jsonb_build_object(
    '@context', jsonb_build_array(
      'https://www.w3.org/ns/credentials/v2',
      'https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json'),
    'id', 'https://masar.app/credentials/' || v_serial,
    'type', jsonb_build_array('VerifiableCredential', 'OpenBadgeCredential'),
    'name', COALESCE(v_cert.course_title, 'شهادة مسار'),
    'issuer', jsonb_build_object(
      'id', 'https://masar.app/issuer',
      'type', jsonb_build_array('Profile'),
      'name', 'مسار — برنامج التدريب المجتمعي',
      'url', 'https://masar.app',
      'email', 'credentials@masar.app'),
    'validFrom', to_char(v_cert.issued_at, 'YYYY-MM-DD"T"HH24:MI:SSOF'),
    'credentialSubject', jsonb_build_object(
      'id', 'urn:uuid:' || v_cert.user_id::text,
      'type', jsonb_build_array('AchievementSubject'),
      'name', COALESCE(v_cert.student_name, ''),
      'achievement', jsonb_build_object(
        'id', 'https://masar.app/achievements/' || COALESCE(v_cert.course_id::text, 'general'),
        'type', jsonb_build_array('Achievement'),
        'name', COALESCE(v_cert.course_title, 'مسار'),
        'description', COALESCE(v_cert.course_field, 'برنامج تدريبي'),
        'criteria', jsonb_build_object(
          'narrative', 'إتمام 75% على الأقل من جلسات المجموعة وحضور موثّق بالـQR.'),
        'alignment', jsonb_build_array(jsonb_build_object(
          'type', jsonb_build_array('Alignment'),
          'targetName', 'Masar attendance policy',
          'targetUrl', 'https://masar.app/policy/eligibility'))),
      'evidence', jsonb_build_array(jsonb_build_object(
        'type', jsonb_build_array('Evidence'),
        'id', 'https://masar.app/verify/' || v_serial,
        'name', 'سجل الحضور الموثّق',
        'description', COALESCE('قاعة ' || v_cert.room || ' — ' || v_cert.branch_name, '')))),
    'credentialStatus', jsonb_build_object(
      'id', 'https://masar.app/api/status/' || v_serial,
      'type', 'BitstringStatusListEntry',
      'statusPurpose', 'revocation',
      'status', CASE WHEN v_cert.status = 'active' THEN 'valid' ELSE 'revoked' END),
    'evidence', jsonb_build_array(jsonb_build_object(
      'id', 'https://masar.app/verify/' || v_serial,
      'type', jsonb_build_array('Evidence'),
      'name', 'تحقّق عام' ))
  );

  v_canonical := v_body::text;
  v_body := v_body || jsonb_build_object(
    'proof', jsonb_build_object(
      'type', 'MasarHmacSha256Signature2026',
      'created', to_char(COALESCE(v_cert.issued_at, now()), 'YYYY-MM-DD"T"HH24:MI:SSOF'),
      'proofPurpose', 'assertionMethod',
      'verificationMethod', 'https://masar.app/issuer#hmac-v1',
      'proofValue', public._badge_proof(v_canonical))
  );

  RETURN v_body;
END;
$$;
REVOKE ALL ON FUNCTION public.public_badge_assertion(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_badge_assertion(TEXT) TO anon, authenticated;

-- Verification helper: recompute the HMAC and compare in constant time.
CREATE OR REPLACE FUNCTION public.verify_badge_assertion(p_assertion JSONB)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_expected TEXT;
  v_actual TEXT;
  v_body JSONB;
BEGIN
  IF p_assertion IS NULL OR jsonb_typeof(p_assertion) <> 'object' THEN
    RETURN jsonb_build_object('valid', FALSE, 'reason', 'malformed');
  END IF;
  v_actual := p_assertion #>> '{proof,proofValue}';
  v_body := p_assertion - 'proof';
  v_expected := public._badge_proof(v_body::text);
  RETURN jsonb_build_object(
    'valid', v_actual IS NOT NULL AND v_actual = v_expected,
    'serial', COALESCE(p_assertion ->> 'id', ''));
END;
$$;
REVOKE ALL ON FUNCTION public.verify_badge_assertion(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_badge_assertion(JSONB) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Access-control hardening for functions created before this migration
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Postgres grants EXECUTE on a new function to PUBLIC by default. 46 functions
-- shipped between 0001 and 0030 therefore had no explicit grant statement at
-- all: they were reachable by the `anon` role before the caller's identity was
-- ever checked inside the body. Every one of them does assert authentication or
-- a role internally, so this was not exploitable for data access — but it is an
-- unnecessary attack surface (function enumeration, error-message probing) and
-- it violates the project rule "a function without an explicit access decision
-- is a defect". This block closes it in one pass, driven by the catalogue so it
-- cannot drift from the real signatures.
DO $$
DECLARE
  r RECORD;
  -- Internal helpers: only SECURITY DEFINER callers and triggers need them.
  internal_helpers TEXT[] := ARRAY[
    'update_updated_at_column', 'handle_new_user', '_fanout_notification_to_push',
    '_new_error_ref', '_rate_limit_exceeded', 'is_valid_timezone'
  ];
  -- Identity predicates: RLS policies evaluate these as the *calling* role, so
  -- both anon and authenticated must keep EXECUTE; PUBLIC is not required.
  predicates TEXT[] := ARRAY[
    'my_profile_id', 'my_role', 'is_admin', 'is_manager', 'is_staff', 'can_manage_batch'
  ];
  -- Everything else in the legacy list is a client-callable RPC.
  client_rpcs TEXT[] := ARRAY[
    'list_visible_profiles', 'get_batch_stats', 'complete_my_profile', 'update_my_profile',
    'join_batch', 'join_batch_by_code', 'start_training_session', 'get_session_qr_payload',
    'manual_mark_attendance', 'close_training_session', 'create_branch', 'create_committee',
    'update_gamification_rule', 'set_badge_active', 'bootstrap_organization', 'submit_excuse',
    'review_excuse', 'submit_course_rating', 'award_kudos', 'issue_batch_certificates',
    'submit_support_request', 'review_support_request', 'broadcast_notifications',
    'promote_batch_waitlist', 'promote_waitlists', 'leave_batch', 'remove_from_batch',
    'get_session_report', 'get_course_overview', 'get_batch_roster', 'get_batch_sessions',
    'get_session_roster', 'enqueue_command', 'get_command', 'finish_command',
    'get_today', 'get_my_courses', 'notify_session_absentees'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = ANY(internal_helpers || predicates || client_rpcs)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    IF r.proname = ANY(predicates) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', r.sig);
    ELSIF r.proname = ANY(client_rpcs) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Scheduled jobs
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname IN ('masar-housekeeping', 'masar-weekly-report') LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
EXCEPTION WHEN undefined_table OR undefined_schema THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'masar-housekeeping', '7 3 * * *',
    'SELECT public.prune_checkin_attempts(); SELECT public.prune_rate_events(); '
    'SELECT public.prune_push_outbox(); SELECT public.prune_client_errors(); '
    'SELECT public.prune_dead_push_tokens(); SELECT public.prune_checkin_risk_signals();'
  );
EXCEPTION WHEN undefined_function OR undefined_table OR undefined_schema THEN NULL;
END $$;

-- Weekly report every Sunday at 07:00 Cairo time (the plan's acceptance criteria
-- say "يصل كل يوم أحد"). Cron works in UTC when the server runs UTC.
DO $$
BEGIN
  PERFORM cron.schedule(
    'masar-weekly-report', '0 4 * * 0',
    'SELECT public.enqueue_weekly_reports();'
  );
EXCEPTION WHEN undefined_function OR undefined_table OR undefined_schema THEN NULL;
END $$;

-- Anomaly sweep every 30 minutes keeps the anti-cheat table current without a
-- heavy nightly scan.
DO $$
BEGIN
  PERFORM cron.schedule(
    'masar-anticheat-sweep', '*/30 * * * *',
    'SELECT public.detect_checkin_anomalies(now() - interval ''6 hours'');'
  );
EXCEPTION WHEN undefined_function OR undefined_table OR undefined_schema THEN NULL;
END $$;

-- Enqueues one in-app notification per active subscription whose local send
-- hour has arrived. dedupe_key makes the job idempotent even if cron fires twice.
CREATE OR REPLACE FUNCTION public.enqueue_weekly_reports(p_at TIMESTAMPTZ DEFAULT now())
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_count INTEGER := 0; v RECORD;
BEGIN
  FOR v IN
    SELECT rs.user_id
      FROM public.report_subscriptions rs
      JOIN public.profiles p ON p.id = rs.user_id
     WHERE rs.enabled AND rs.cadence = 'weekly'
       AND EXTRACT(DOW  FROM (p_at AT TIME ZONE COALESCE(p.timezone, 'Africa/Cairo')))::int = rs.day_of_week
       AND EXTRACT(HOUR FROM (p_at AT TIME ZONE COALESCE(p.timezone, 'Africa/Cairo')))::int >= rs.hour_local
  LOOP
    INSERT INTO public.notifications(user_id, title, body, type, dedupe_key)
    VALUES (
      v.user_id,
      'تقريرك الأسبوعي جاهز 📊',
      'ملخص جلسات الأسبوع وحضور الطلاب في لوحة التقارير.',
      'system',
      'weekly_report:' || v.user_id::text || ':' || to_char(p_at, 'IYYY-IW')
    )
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('enqueued', v_count, 'at', p_at);
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_weekly_reports(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- Retention for the signal table (referenced by the housekeeping job above).
CREATE OR REPLACE FUNCTION public.prune_checkin_risk_signals()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.checkin_risk_signals
   WHERE reviewed_at IS NOT NULL AND reviewed_at < now() - interval '180 days';
END;
$$;
REVOKE ALL ON FUNCTION public.prune_checkin_risk_signals() FROM PUBLIC, anon, authenticated;

COMMIT;
