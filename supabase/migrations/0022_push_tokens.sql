-- MASAR 3.2 — 0022: push-notification device token registry (P2).
--
-- Stores Expo push tokens per user so a background worker / cron can send device
-- push for important events (session reminders, excuse reviews, certificate issue).
-- Delivery itself requires a device app registered with Expo (expo-notifications on
-- the client + an EAS project id) — this migration provides the durable registry and
-- the authenticated register/unregister RPCs that the app calls.

BEGIN;

CREATE TABLE IF NOT EXISTS public.push_tokens (
  user_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token    TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'unknown' CHECK (platform IN ('android','ios','web','unknown')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, token)
);

CREATE INDEX IF NOT EXISTS push_tokens_user_idx ON public.push_tokens(user_id);

-- Register the caller's device push token (upsert).
CREATE OR REPLACE FUNCTION public.register_push_token(p_token TEXT, p_platform TEXT DEFAULT 'unknown')
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_user UUID := public.my_profile_id();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF char_length(btrim(COALESCE(p_token,''))) NOT BETWEEN 8 AND 512 THEN RAISE EXCEPTION 'invalid_token'; END IF;
  IF p_platform NOT IN ('android','ios','web','unknown') THEN p_platform := 'unknown'; END IF;
  INSERT INTO public.push_tokens(user_id, token, platform, updated_at)
  VALUES (v_user, btrim(p_token), p_platform, now())
  ON CONFLICT (user_id, token) DO UPDATE SET platform = EXCLUDED.platform, updated_at = now();
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.register_push_token(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_push_token(TEXT, TEXT) TO authenticated;

-- Remove a token (on logout / app uninstall). Caller may only remove its own.
CREATE OR REPLACE FUNCTION public.unregister_push_token(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_user UUID := public.my_profile_id();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  DELETE FROM public.push_tokens WHERE user_id = v_user AND token = btrim(p_token);
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.unregister_push_token(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unregister_push_token(TEXT) TO authenticated;

-- Only the owner (or a manager) may read a user's tokens — never leaks cross-user.
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS push_tokens_owner ON public.push_tokens;
CREATE POLICY push_tokens_owner ON public.push_tokens
  FOR SELECT USING (user_id = public.my_profile_id() OR public.is_manager());

COMMIT;
