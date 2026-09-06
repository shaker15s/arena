-- MASAR 3.2 — 0026: push delivery pipeline (outbox + worker contract).
--
-- 0022 stored device tokens but nothing ever sent a push: notifications lived in
-- `public.notifications` and were only visible when the app was opened. This
-- migration closes the loop:
--
--   notifications (INSERT)  →  trigger  →  push_outbox (one row per device token)
--   push_outbox             →  Edge Function worker (`push-dispatch`)  →  Expo API
--
-- The worker is external on purpose: Postgres should not make blocking HTTPS
-- calls inside a trigger. The two RPCs below are the ONLY contract the worker
-- needs, and both require the service-role key (revoked from anon/authenticated).

BEGIN;

CREATE TABLE IF NOT EXISTS public.push_outbox (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token        TEXT NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at      TIMESTAMPTZ,
  dedupe_key   TEXT
);

CREATE INDEX IF NOT EXISTS push_outbox_pending_idx
  ON public.push_outbox(status, created_at) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS push_outbox_dedupe_uidx
  ON public.push_outbox(dedupe_key) WHERE dedupe_key IS NOT NULL;

ALTER TABLE public.push_outbox ENABLE ROW LEVEL SECURITY;
-- No policies: service-role / SECURITY DEFINER access only.

-- Per-user opt-out. Defaults to "everything on" without needing a row.
CREATE TABLE IF NOT EXISTS public.push_preferences (
  user_id     UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  session     BOOLEAN NOT NULL DEFAULT TRUE,  -- تذكير الجلسات (session)
  excuse      BOOLEAN NOT NULL DEFAULT TRUE,  -- مراجعة الأعذار (excuse)
  cert        BOOLEAN NOT NULL DEFAULT TRUE,  -- إصدار الشهادات (cert)
  progress    BOOLEAN NOT NULL DEFAULT TRUE,  -- شارات/دوري/ستريك (badge, league, streak)
  system      BOOLEAN NOT NULL DEFAULT TRUE,  -- إعلانات وتقدير (broadcast, system)
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.push_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS push_preferences_owner ON public.push_preferences;
CREATE POLICY push_preferences_owner ON public.push_preferences
  FOR SELECT USING (user_id = public.my_profile_id());

CREATE OR REPLACE FUNCTION public.set_push_preferences(p_prefs JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_user UUID := public.my_profile_id();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  INSERT INTO public.push_preferences(user_id, session, excuse, cert, progress, system, updated_at)
  VALUES (
    v_user,
    COALESCE((p_prefs->>'session')::boolean, TRUE),
    COALESCE((p_prefs->>'excuse')::boolean, TRUE),
    COALESCE((p_prefs->>'cert')::boolean, TRUE),
    COALESCE((p_prefs->>'progress')::boolean, TRUE),
    COALESCE((p_prefs->>'system')::boolean, TRUE),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    session    = EXCLUDED.session,
    excuse     = EXCLUDED.excuse,
    cert       = EXCLUDED.cert,
    progress   = EXCLUDED.progress,
    system     = EXCLUDED.system,
    updated_at = now();
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.set_push_preferences(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_push_preferences(JSONB) TO authenticated;

-- ---------------------------------------------------------------------------
-- Fan-out trigger: every new in-app notification becomes one outbox row per
-- registered device, unless the user opted out of that notification type.
-- dedupe_key keeps `enqueue_session_reminders()` idempotent end-to-end.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._fanout_notification_to_push()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_allowed BOOLEAN;
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

  INSERT INTO public.push_outbox(user_id, token, title, body, data, dedupe_key)
  SELECT NEW.user_id, pt.token, NEW.title, COALESCE(NEW.body, ''),
         jsonb_build_object('type', NEW.type, 'notification_id', NEW.id),
         CASE WHEN NEW.dedupe_key IS NULL THEN NULL
              ELSE NEW.dedupe_key || ':' || pt.token END
    FROM public.push_tokens pt
   WHERE pt.user_id = NEW.user_id
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notifications_push_fanout ON public.notifications;
CREATE TRIGGER notifications_push_fanout
AFTER INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public._fanout_notification_to_push();

-- ---------------------------------------------------------------------------
-- Worker contract (service-role only).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_push_batch(p_limit INTEGER DEFAULT 100)
RETURNS TABLE (id BIGINT, token TEXT, title TEXT, body TEXT, data JSONB)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
-- أسماء أعمدة الإخراج تطابق أعمدة الجدول؛ نوجّه plpgsql لحسم التعارض للعمود.
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT o.id FROM public.push_outbox o
     WHERE o.status = 'pending' AND o.attempts < 5
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

-- Report results. `p_invalid_tokens` are tokens Expo reported as DeviceNotRegistered.
CREATE OR REPLACE FUNCTION public.settle_push_batch(
  p_sent BIGINT[],
  p_failed BIGINT[] DEFAULT '{}',
  p_error TEXT DEFAULT NULL,
  p_invalid_tokens TEXT[] DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_sent INTEGER := 0; v_failed INTEGER := 0; v_pruned INTEGER := 0;
BEGIN
  UPDATE public.push_outbox SET status = 'sent', sent_at = now(), last_error = NULL
   WHERE id = ANY(COALESCE(p_sent, '{}'));
  GET DIAGNOSTICS v_sent = ROW_COUNT;

  UPDATE public.push_outbox
     SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
         last_error = left(COALESCE(p_error, 'unknown'), 500)
   WHERE id = ANY(COALESCE(p_failed, '{}'));
  GET DIAGNOSTICS v_failed = ROW_COUNT;

  DELETE FROM public.push_tokens WHERE token = ANY(COALESCE(p_invalid_tokens, '{}'));
  GET DIAGNOSTICS v_pruned = ROW_COUNT;

  RETURN jsonb_build_object('sent', v_sent, 'failed', v_failed, 'pruned_tokens', v_pruned);
END;
$$;
REVOKE ALL ON FUNCTION public.settle_push_batch(BIGINT[], BIGINT[], TEXT, TEXT[]) FROM PUBLIC, anon, authenticated;

-- Housekeeping: keep the outbox small.
CREATE OR REPLACE FUNCTION public.prune_push_outbox()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.push_outbox
   WHERE (status = 'sent'   AND sent_at    < now() - interval '3 days')
      OR (status = 'failed' AND created_at < now() - interval '14 days');
END;
$$;
REVOKE ALL ON FUNCTION public.prune_push_outbox() FROM PUBLIC, anon, authenticated;

-- One housekeeping job for all sliding-window / outbox tables.
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'masar-housekeeping' LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
EXCEPTION WHEN undefined_table THEN NULL;  -- pg_cron not installed (local/dev)
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'masar-housekeeping', '7 3 * * *',
    'SELECT public.prune_checkin_attempts(); SELECT public.prune_rate_events(); SELECT public.prune_push_outbox();'
  );
EXCEPTION WHEN undefined_function OR undefined_table OR undefined_schema THEN NULL;
END $$;

COMMIT;
