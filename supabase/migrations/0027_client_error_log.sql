-- MASAR 3.2 — 0027: client crash/error telemetry sink (OPS-01).
--
-- Until now a crash on a user's device was invisible to the team: ErrorBoundary
-- printed to console and nothing left the device. This adds the minimal durable
-- sink so operators can actually see production failures without adopting a
-- third-party SDK (Sentry can be layered on later via setTelemetrySink).
--
-- Privacy: the client never sends user content (field values, names, phones).
-- Only message/stack/breadcrumb labels. Rows are pruned after 30 days.

BEGIN;

CREATE TABLE IF NOT EXISTS public.client_errors (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  message         TEXT NOT NULL,
  stack           TEXT,
  component_stack TEXT,
  fatal           BOOLEAN NOT NULL DEFAULT FALSE,
  platform        TEXT NOT NULL DEFAULT 'unknown'
                    CHECK (platform IN ('android','ios','web','unknown')),
  app_version     TEXT NOT NULL DEFAULT 'unknown',
  breadcrumbs     JSONB NOT NULL DEFAULT '[]'::jsonb,
  fingerprint     TEXT NOT NULL,
  seen_count      INTEGER NOT NULL DEFAULT 1,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per (fingerprint, platform, version): repeated crashes bump a counter
-- instead of flooding the table — 10k users hitting one bug = 1 row, count 10000.
CREATE UNIQUE INDEX IF NOT EXISTS client_errors_fingerprint_uidx
  ON public.client_errors(fingerprint, platform, app_version);
CREATE INDEX IF NOT EXISTS client_errors_recent_idx
  ON public.client_errors(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS client_errors_fatal_idx
  ON public.client_errors(fatal, last_seen_at DESC) WHERE fatal;

ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;

-- Only admins/supervisors may read the crash log; nobody may write directly.
DROP POLICY IF EXISTS client_errors_manager_read ON public.client_errors;
CREATE POLICY client_errors_manager_read ON public.client_errors
  FOR SELECT USING (public.is_manager());

-- Report a client error. Rate-limited so a crash-loop cannot DoS the table.
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
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF v_msg = '' THEN RETURN jsonb_build_object('ok', FALSE); END IF;

  -- 30 reports / 10 minutes per user is generous for real usage and still caps
  -- a crash loop. Silently drop past the limit (never surface to the user).
  IF public._rate_limit_exceeded('log_client_error', 30, interval '10 minutes') THEN
    RETURN jsonb_build_object('ok', FALSE, 'throttled', TRUE);
  END IF;

  IF p_platform NOT IN ('android','ios','web','unknown') THEN p_platform := 'unknown'; END IF;
  v_fingerprint := encode(extensions.digest(v_msg || ':' || COALESCE(left(p_stack, 500), ''), 'sha256'), 'hex');

  INSERT INTO public.client_errors(
    user_id, message, stack, component_stack, fatal, platform, app_version, breadcrumbs, fingerprint
  ) VALUES (
    v_user, v_msg, left(p_stack, 4000), left(p_component_stack, 4000),
    COALESCE(p_fatal, FALSE), p_platform, left(COALESCE(p_app_version,'unknown'), 32),
    COALESCE(p_breadcrumbs, '[]'::jsonb), v_fingerprint
  )
  ON CONFLICT (fingerprint, platform, app_version) DO UPDATE SET
    seen_count   = public.client_errors.seen_count + 1,
    last_seen_at = now(),
    -- keep the most recent context
    breadcrumbs  = EXCLUDED.breadcrumbs,
    user_id      = EXCLUDED.user_id,
    fatal        = public.client_errors.fatal OR EXCLUDED.fatal;

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.log_client_error(TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_client_error(TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.prune_client_errors()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.client_errors WHERE last_seen_at < now() - interval '30 days';
END;
$$;
REVOKE ALL ON FUNCTION public.prune_client_errors() FROM PUBLIC, anon, authenticated;

-- Fold into the existing housekeeping job.
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'masar-housekeeping' LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
EXCEPTION WHEN undefined_table OR undefined_schema THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'masar-housekeeping', '7 3 * * *',
    'SELECT public.prune_checkin_attempts(); SELECT public.prune_rate_events(); SELECT public.prune_push_outbox(); SELECT public.prune_client_errors();'
  );
EXCEPTION WHEN undefined_function OR undefined_table OR undefined_schema THEN NULL;
END $$;

COMMIT;
