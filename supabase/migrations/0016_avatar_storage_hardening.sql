-- MASAR 3.2 — 0016: avatar bucket hardening.
-- The public `avatars` bucket accepted any file of any size: any authenticated
-- user could host arbitrary blobs on a public URL under their folder, and old
-- avatars were never cleaned up. This constrains uploads to real images ≤ 2MB
-- and prunes superseded avatar objects daily.

BEGIN;

-- Bucket-level constraints (enforced by Supabase Storage API).
UPDATE storage.buckets
SET file_size_limit = 2097152,  -- 2 MB
    allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']
WHERE id = 'avatars';

-- Keep only the newest avatar object per user folder (uploads are named
-- avatar_<epoch-ms>.<ext>, so lexicographic order == chronological order).
CREATE OR REPLACE FUNCTION public.prune_old_avatars()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_count INTEGER;
BEGIN
  WITH ranked AS (
    SELECT id, row_number() OVER (
      PARTITION BY (storage.foldername(name))[1]
      ORDER BY name DESC
    ) AS pos
    FROM storage.objects
    WHERE bucket_id = 'avatars'
  )
  DELETE FROM storage.objects o
  USING ranked r
  WHERE o.id = r.id AND r.pos > 1;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.prune_old_avatars() FROM PUBLIC, anon, authenticated;

DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'masar-prune-avatars'
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
DO $$ BEGIN
  PERFORM cron.schedule('masar-prune-avatars','10 4 * * *','SELECT public.prune_old_avatars()');
EXCEPTION WHEN undefined_function OR undefined_table THEN NULL;
END $$;

COMMIT;
