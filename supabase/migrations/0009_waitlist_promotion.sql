-- MASAR 3.2 — 0009: waitlist automation + leave/decline batch.
-- Previously a student was inserted as 'waitlist' but nothing ever promoted them when
-- a seat freed up, and there was no way to free a seat (no leave/decline path). This
-- adds an atomic per-batch promoter, a leave_batch RPC (which releases a seat and then
-- promotes), and a cron that sweeps every batch so seats are never left empty.

BEGIN;

CREATE OR REPLACE FUNCTION public.promote_batch_waitlist(p_batch_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch public.batches%ROWTYPE;
  v_active INTEGER;
  v_free INTEGER;
  v_promoted INTEGER := 0;
  r RECORD;
BEGIN
  SELECT * INTO v_batch FROM public.batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND OR v_batch.status NOT IN ('scheduled','active') THEN RETURN 0; END IF;
  IF v_batch.capacity IS NULL THEN RETURN 0; END IF;

  SELECT count(*) INTO v_active FROM public.enrollments
  WHERE batch_id = p_batch_id AND status = 'active';
  v_free := v_batch.capacity - v_active;
  IF v_free <= 0 THEN RETURN 0; END IF;

  FOR r IN
    SELECT e.user_id FROM public.enrollments e
    WHERE e.batch_id = p_batch_id AND e.status = 'waitlist'
    ORDER BY e.joined_at ASC, e.id ASC
    LIMIT v_free
    FOR UPDATE OF e
  LOOP
    UPDATE public.enrollments SET status = 'active' WHERE user_id = r.user_id AND batch_id = p_batch_id;
    INSERT INTO public.notifications(user_id, title, body, type, dedupe_key)
    VALUES (
      r.user_id,
      'مقعدك اتاح 🎉',
      'توفر لك مقعد — سجّل حضورك في أقرب محاضرة.',
      'session',
      'waitlist-promote:' || p_batch_id || ':' || r.user_id
    )
    ON CONFLICT(dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    v_promoted := v_promoted + 1;
  END LOOP;

  RETURN v_promoted;
END;
$$;

-- Sweep every eligible batch and promote waitlisted students into free seats.
CREATE OR REPLACE FUNCTION public.promote_waitlists()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_total INTEGER := 0; r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT b.id FROM public.batches b
    WHERE b.status IN ('scheduled','active')
      AND EXISTS(SELECT 1 FROM public.enrollments e WHERE e.batch_id=b.id AND e.status='waitlist')
  LOOP
    v_total := v_total + public.promote_batch_waitlist(r.id);
  END LOOP;
  RETURN v_total;
END;
$$;

-- Student leaves (or declines) their own enrollment; a freed seat is immediately promoted.
CREATE OR REPLACE FUNCTION public.leave_batch(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_user UUID := public.my_profile_id(); v_status TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT status INTO v_status FROM public.enrollments
  WHERE user_id = v_user AND batch_id = p_batch_id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'not_enrolled'; END IF;
  DELETE FROM public.enrollments WHERE user_id = v_user AND batch_id = p_batch_id;
  PERFORM public.promote_batch_waitlist(p_batch_id);
  INSERT INTO public.notifications(user_id, title, body, type)
  VALUES (v_user, 'خروج من المجموعة', 'تم إلغاء تسجيلك في هذه المجموعة.', 'session');
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

-- Manager/instructor removes a student from an assigned batch, then promotes the waitlist.
CREATE OR REPLACE FUNCTION public.remove_from_batch(p_batch_id UUID, p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID := public.my_profile_id(); v_status TEXT;
BEGIN
  IF NOT public.can_manage_batch(p_batch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT status INTO v_status FROM public.enrollments
  WHERE user_id = p_user_id AND batch_id = p_batch_id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'not_enrolled'; END IF;
  DELETE FROM public.enrollments WHERE user_id = p_user_id AND batch_id = p_batch_id;
  PERFORM public.promote_batch_waitlist(p_batch_id);
  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES (v_actor, 'remove_from_batch', p_user_id::text, jsonb_build_object('batch_id', p_batch_id));
  INSERT INTO public.notifications(user_id, title, body, type)
  VALUES (p_user_id, 'تم إلغاء تسجيلك', 'ألغى منسّق المجموعة تسجيلك في هذه المجموعة.', 'session');
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

-- Reapply grants (SECURITY DEFINER resets ACL to owner).
DO $$ DECLARE f REGPROCEDURE;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.promote_batch_waitlist(uuid)'::regprocedure,
    'public.promote_waitlists()'::regprocedure,
    'public.leave_batch(uuid)'::regprocedure,
    'public.remove_from_batch(uuid,uuid)'::regprocedure
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

-- Cron: never leave a freed seat empty for more than a few minutes.
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'masar-waitlist-promote' LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;
SELECT cron.schedule('masar-waitlist-promote', '*/5 * * * *', 'SELECT public.promote_waitlists()');

COMMIT;
