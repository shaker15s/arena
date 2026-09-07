-- 0029_secure_qr_seed.sql
-- Enforce column-level security: qr_seed is NEVER readable by clients via direct table SELECT.
-- Only server-side SECURITY DEFINER functions (get_session_qr_payload, check_in_with_token)
-- are allowed to read or compute with qr_seed.
BEGIN;

REVOKE ALL ON public.sessions FROM PUBLIC, anon, authenticated;

-- Only grant non-sensitive columns to authenticated users.
GRANT SELECT (
  id,
  batch_id,
  seq,
  title,
  starts_at,
  duration_min,
  status,
  started_at,
  closed_at,
  report,
  created_at
) ON public.sessions TO authenticated;

-- Re-verify internal cryptographic helpers cannot be called directly by clients
REVOKE ALL ON FUNCTION public._qr_signature(TEXT,UUID,BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._backup_code(TEXT,UUID) FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.sessions.qr_seed IS 'Cryptographic rotating seed. Strictly shielded from table SELECT by REVOKE. Readable only by SECURITY DEFINER RPCs.';

COMMIT;
