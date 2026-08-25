-- MASAR 3.2 — 0019: private note saves become an RPC (DATA-002).
--
-- Previously the client wrote instructor→student private notes through a generic
-- local diff writer (pushDelta in src/data/remote.ts). That left a live,
-- general-purpose "mutate anything" primitive in the client, even though its only
-- table (private_notes) was RLS-permitted. This replaces it with a validated,
-- audited RPC so the client has no direct-table write path at all, and removes the
-- diff-writer primitive entirely server-side aside from auth checks.

BEGIN;

CREATE OR REPLACE FUNCTION public.save_private_note(p_user_id UUID, p_note TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID := public.my_profile_id();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF char_length(btrim(COALESCE(p_note,''))) > 2000 THEN RAISE EXCEPTION 'note_too_long'; END IF;
  -- The writer must teach (or manage) the student. This mirrors the contact
  -- visibility rule in list_visible_profiles: manager, or instructor of a batch
  -- the student is actively enrolled in.
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles s
    WHERE s.id = p_user_id
      AND s.role = 'student'
      AND (
        public.is_manager()
        OR EXISTS (
          SELECT 1 FROM public.batches b
          JOIN public.enrollments e ON e.batch_id = b.id AND e.user_id = s.id
          WHERE b.instructor_id = v_actor AND e.status = 'active'
        )
      )
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  INSERT INTO public.private_notes(instructor_id, user_id, note, updated_at)
  VALUES (v_actor, p_user_id, btrim(p_note), now())
  ON CONFLICT (instructor_id, user_id)
  DO UPDATE SET note = EXCLUDED.note, updated_at = now();

  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES (v_actor, 'save_private_note', p_user_id::text,
          jsonb_build_object('note_len', char_length(btrim(p_note))));

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.save_private_note(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_private_note(uuid,text) TO authenticated;

COMMIT;
