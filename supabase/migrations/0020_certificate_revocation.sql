-- MASAR 3.2 — 0020: certificate revocation & reissue (P2).
--
-- Adds a lifecycle to certificates: a manager can revoke a certificate (status
-- 'revoked', with reason + audit) and later reissue it (status back to 'active'
-- with a BRAND-NEW serial, so the old serial+QR stop verifying). The UNIQUE
-- (user_id, batch_id) constraint is preserved — we reuse the same row and rotate
-- its serial on reissue instead of inserting a second row.
--
-- verify_certificate now rejects any non-active certificate (previously it
-- verified ANY serial, so a revoked cert would still pass).

BEGIN;

ALTER TABLE public.certificates
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revoke_reason TEXT,
  ADD COLUMN IF NOT EXISTS reissued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reissued_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reissue_count INTEGER NOT NULL DEFAULT 0;

-- Revoke a certificate (manager only) — changes status and audits the reason.
CREATE OR REPLACE FUNCTION public.revoke_certificate(p_certificate_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID := public.my_profile_id();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF char_length(btrim(COALESCE(p_reason,''))) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.certificates WHERE id = p_certificate_id AND status = 'active')
  THEN RAISE EXCEPTION 'not_active'; END IF;

  UPDATE public.certificates
    SET status = 'revoked', revoked_at = now(), revoked_by = v_actor, revoke_reason = btrim(p_reason)
  WHERE id = p_certificate_id;

  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES (v_actor, 'revoke_certificate', p_certificate_id::text,
          jsonb_build_object('reason', btrim(p_reason)));

  RETURN jsonb_build_object('ok', TRUE, 'status', 'revoked');
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_certificate(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_certificate(UUID, TEXT) TO authenticated;

-- Reissue a revoked certificate (manager only) — reactivates the SAME row under
-- a brand-new serial, so the previously shared QR/serial stops verifying.
CREATE OR REPLACE FUNCTION public.reissue_certificate(p_certificate_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID := public.my_profile_id();
DECLARE v_serial TEXT;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.certificates WHERE id = p_certificate_id AND status = 'revoked')
  THEN RAISE EXCEPTION 'not_revoked'; END IF;

  v_serial := 'MSR-' || to_char(now(),'YYYY') || '-' || upper(substr(encode(extensions.gen_random_bytes(8),'hex'),1,12));
  UPDATE public.certificates
    SET status = 'active', serial = v_serial,
        revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL,
        reissued_at = now(), reissued_by = v_actor, reissue_count = reissue_count + 1
  WHERE id = p_certificate_id;

  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES (v_actor, 'reissue_certificate', p_certificate_id::text,
          jsonb_build_object('new_serial', v_serial));

  RETURN jsonb_build_object('ok', TRUE, 'status', 'active', 'serial', v_serial);
END;
$$;

REVOKE ALL ON FUNCTION public.reissue_certificate(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reissue_certificate(UUID) TO authenticated;

-- Public verification now returns NULL for anything that is not currently active.
CREATE OR REPLACE FUNCTION public.verify_certificate(p_serial TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_result JSONB;
BEGIN
  IF char_length(btrim(COALESCE(p_serial,''))) NOT BETWEEN 8 AND 80 THEN RETURN NULL; END IF;
  SELECT jsonb_build_object(
    'serial', c.serial,
    'status', c.status,
    'issued_at', c.issued_at,
    'student_name', p.full_name,
    'course_title', co.title,
    'branch_name', br.name
  ) INTO v_result
  FROM public.certificates c
  JOIN public.profiles p ON p.id = c.user_id
  JOIN public.batches b ON b.id = c.batch_id
  JOIN public.courses co ON co.id = b.course_id
  JOIN public.branches br ON br.id = b.branch_id
  WHERE upper(c.serial) = upper(btrim(p_serial)) AND c.status = 'active';
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_certificate(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_certificate(TEXT) TO anon, authenticated;

COMMIT;
