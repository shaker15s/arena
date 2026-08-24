-- MASAR 3.2 — 0015: offline command EXECUTOR (completes 0013).
--
-- 0013 added a durable command ledger but nothing ever *executed* a queued
-- command: enqueue_command inserted a row and the client immediately marked it
-- applied — data went into a ledger nobody read. This migration adds
-- `run_command`: an atomic, idempotent enqueue-AND-apply. The ledger row is the
-- idempotency key; a retry with the same id returns the recorded outcome
-- without re-applying. Supported commands dispatch to the existing audited
-- RPCs, so queued writes obey exactly the same validation as online writes.

BEGIN;

CREATE OR REPLACE FUNCTION public.run_command(
  p_command_id UUID,
  p_command TEXT,
  p_payload JSONB DEFAULT '{}'::jsonb,
  p_device_created_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.my_profile_id();
  v_row public.command_queue%ROWTYPE;
  v_result JSONB;
  v_error TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  p_command := btrim(COALESCE(p_command, ''));
  IF char_length(p_command) NOT BETWEEN 1 AND 64 THEN RAISE EXCEPTION 'invalid_command'; END IF;

  -- Idempotent claim: first caller inserts; retries observe the recorded state.
  INSERT INTO public.command_queue(id, user_id, command, payload, status, device_created_at)
  VALUES (p_command_id, v_user, p_command, COALESCE(p_payload, '{}'::jsonb), 'pending', p_device_created_at)
  ON CONFLICT (id) DO NOTHING;

  SELECT * INTO v_row FROM public.command_queue
  WHERE id = p_command_id AND user_id = v_user
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'forbidden'; END IF;  -- id owned by another user

  -- Already settled → return recorded outcome, never re-apply.
  IF v_row.status = 'applied' THEN
    RETURN jsonb_build_object('ok', TRUE, 'command_id', p_command_id, 'status', 'applied', 'already', TRUE);
  END IF;
  IF v_row.status = 'failed' THEN
    RETURN jsonb_build_object('ok', FALSE, 'command_id', p_command_id, 'status', 'failed',
                              'already', TRUE, 'error', v_row.last_error);
  END IF;

  -- Dispatch. Each branch reuses the audited online RPC so queued writes get
  -- identical validation, notifications and side effects.
  BEGIN
    CASE v_row.command
      WHEN 'submit_excuse' THEN
        v_result := public.submit_excuse(
          (v_row.payload->>'session_id')::uuid,
          v_row.payload->>'reason',
          v_row.payload->>'attachment_url'
        );
      WHEN 'mark_notifications_read' THEN
        v_result := public.mark_notifications_read();
      WHEN 'submit_course_rating' THEN
        v_result := public.submit_course_rating(
          (v_row.payload->>'course_id')::uuid,
          (v_row.payload->>'stars')::int,
          v_row.payload->>'comment'
        );
      ELSE
        RAISE EXCEPTION 'unknown_command';
    END CASE;
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
    UPDATE public.command_queue
      SET status = 'failed', last_error = v_error,
          attempt_count = attempt_count + 1, updated_at = now()
      WHERE id = p_command_id;
    -- Duplicate-style business errors are terminal-but-benign for a replayer:
    -- the intent already holds on the server (e.g. excuse already submitted).
    IF v_error IN ('excuse_exists', 'already_rated') THEN
      UPDATE public.command_queue SET status = 'applied', applied_at = now(), updated_at = now()
        WHERE id = p_command_id;
      RETURN jsonb_build_object('ok', TRUE, 'command_id', p_command_id, 'status', 'applied', 'deduped', TRUE);
    END IF;
    RETURN jsonb_build_object('ok', FALSE, 'command_id', p_command_id, 'status', 'failed', 'error', v_error);
  END;

  UPDATE public.command_queue
    SET status = 'applied', applied_at = now(),
        attempt_count = attempt_count + 1, updated_at = now()
    WHERE id = p_command_id;
  RETURN jsonb_build_object('ok', TRUE, 'command_id', p_command_id, 'status', 'applied', 'result', v_result);
END;
$$;

REVOKE ALL ON FUNCTION public.run_command(uuid,text,jsonb,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_command(uuid,text,jsonb,timestamptz) TO authenticated;

-- Janitor: settled commands older than 7 days are dropped (ledger stays small;
-- 7 days >> any realistic offline window while preserving debuggability).
CREATE OR REPLACE FUNCTION public.prune_command_queue()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_count INTEGER;
BEGIN
  DELETE FROM public.command_queue
  WHERE status IN ('applied','failed') AND updated_at < now() - interval '7 days';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.prune_command_queue() FROM PUBLIC, anon, authenticated;
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'masar-prune-command-queue'
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
DO $$ BEGIN
  PERFORM cron.schedule('masar-prune-command-queue','40 3 * * *','SELECT public.prune_command_queue()');
EXCEPTION WHEN undefined_function OR undefined_table THEN NULL;
END $$;

COMMIT;
