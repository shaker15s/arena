-- MASAR 3.2 — 0013: offline write queue + server idempotency (P0 #3 from §8).
-- Today the app has NO offline-write path: critical writes are gated on `online`,
-- and there is no command log / idempotency. This adds a durable per-user command
-- ledger and three RPCs so the client can (a) enqueue a command offline, (b) replay
-- pending commands when back online, and (c) mark one applied/failed — all idempotent
-- by a client-generated command id. The client uses this to queue low-stakes writes;
-- time-sensitive ops (QR check-in) stay gated on `online` by design.

BEGIN;

CREATE TABLE IF NOT EXISTS public.command_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),   -- command_id (client-generatable)
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  command TEXT NOT NULL CHECK (char_length(command) BETWEEN 1 AND 64),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  device_created_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS command_queue_user_status_uidx
  ON public.command_queue(user_id, status);

-- Idempotent enqueue: an existing command with the same id returns its current status
-- rather than erroring, so a retry after a network blip cannot double-insert.
CREATE OR REPLACE FUNCTION public.enqueue_command(
  p_command_id UUID,
  p_command TEXT,
  p_payload JSONB DEFAULT '{}'::jsonb,
  p_device_created_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_user UUID := public.my_profile_id(); v_status TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;

  INSERT INTO public.command_queue(id, user_id, command, payload, status, device_created_at)
  VALUES (p_command_id, v_user, btrim(p_command), COALESCE(p_payload, '{}'::jsonb), 'pending', p_device_created_at)
  ON CONFLICT(id) DO NOTHING;

  SELECT status INTO v_status FROM public.command_queue WHERE id = p_command_id AND user_id = v_user;
  RETURN jsonb_build_object('ok', TRUE, 'command_id', p_command_id, 'status', v_status);
END;
$$;

-- Returns the caller's queue position + payload for a command id (pending only),
-- so the client can resume exactly where it stopped. Null when unknown/applied.
CREATE OR REPLACE FUNCTION public.get_command(p_command_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_user UUID := public.my_profile_id(); v_row public.command_queue%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT * INTO v_row FROM public.command_queue WHERE id = p_command_id AND user_id = v_user;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'command_id', v_row.id, 'command', v_row.command, 'payload', v_row.payload,
    'status', v_row.status, 'attempt_count', v_row.attempt_count,
    'device_created_at', v_row.device_created_at
  );
END;
$$;

-- Mark a command applied after the client successfully pushed its effect.
CREATE OR REPLACE FUNCTION public.finish_command(p_command_id UUID, p_status TEXT DEFAULT 'applied')
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_user UUID := public.my_profile_id();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_status NOT IN ('applied','failed') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  UPDATE public.command_queue
    SET status = p_status, applied_at = CASE WHEN p_status = 'applied' THEN now() ELSE applied_at END,
        updated_at = now()
    WHERE id = p_command_id AND user_id = v_user;
  RETURN jsonb_build_object('ok', TRUE, 'command_id', p_command_id, 'status', p_status);
END;
$$;

-- Backfill user_id for any rows that somehow predate it (defensive; empty normally).
UPDATE public.command_queue c SET user_id = public.my_profile_id()
WHERE user_id IS NULL;

-- Grants (SECURITY DEFINER resets ACL to owner).
DO $$ DECLARE f REGPROCEDURE;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.enqueue_command(uuid,text,jsonb,timestamptz)'::regprocedure,
    'public.get_command(uuid)'::regprocedure,
    'public.finish_command(uuid,text)'::regprocedure
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

COMMIT;
