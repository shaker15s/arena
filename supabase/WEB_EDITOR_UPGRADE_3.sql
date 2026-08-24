-- MASAR — ملف ترقية SQL Editor (مولَّد آليًا — لا تعدّله يدويًا)
-- المصدر: 0014_critical_fixes.sql, 0015_command_executor.sql, 0016_avatar_storage_hardening.sql, 0017_completion_rule_fix.sql
-- توليد: node scripts/build-web-editor-sql.js 0014 0015 0016 0017
-- شغّل الملف كاملًا كـ Query واحدة على مشروع مطبَّق عليه الترقيات السابقة.

-- ═══════════════ ↳ 0014_critical_fixes.sql ═══════════════
-- MASAR 3.2 — 0014: critical fixes from the production critique (2026-08-24).
--
--  1) mark_notifications_read RPC — the client used a direct upsert on
--     `notifications`, which 0005's RLS (SELECT+UPDATE only, no INSERT) rejects.
--     PostgREST upsert = INSERT ... ON CONFLICT and therefore always failed.
--  2) Broken CHECK constraints: `x IN ('a','b',NULL)` evaluates to NULL for any
--     non-listed value, and a NULL CHECK passes. These constraints never
--     rejected anything. Rewritten as `IS NULL OR IN (...)`.
--  3) Backup-code brute force: check_in_with_token accepted unlimited 6-digit
--     guesses (10^6 space). Adds a per-user sliding-window rate limit with
--     audit logging of lockouts.
--  4) command_queue had no RLS enabled (defense-in-depth: access is RPC-only,
--     but every other table is belt-and-braces).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Notifications: server-side "mark all read" (idempotent, self-scoped).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_notifications_read()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_user UUID := public.my_profile_id(); v_count INTEGER;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  UPDATE public.notifications SET read = TRUE
  WHERE user_id = v_user AND read = FALSE;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('ok', TRUE, 'updated', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_notifications_read() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Repair CHECK constraints neutralized by the IN(...,NULL) pitfall.
--    Existing invalid data (if any) is normalized to NULL first so the
--    constraints can be applied.
-- ---------------------------------------------------------------------------
UPDATE public.profiles SET gender = NULL
  WHERE gender IS NOT NULL AND gender NOT IN ('m','f');
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_gender_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_gender_check
  CHECK (gender IS NULL OR gender IN ('m','f'));

UPDATE public.attendance SET method = NULL
  WHERE method IS NOT NULL AND method NOT IN ('qr','code','manual');
ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_method_check;
ALTER TABLE public.attendance ADD CONSTRAINT attendance_method_check
  CHECK (method IS NULL OR method IN ('qr','code','manual'));

UPDATE public.point_events SET ref_type = NULL
  WHERE ref_type IS NOT NULL AND ref_type NOT IN ('session','course','batch','admin');
ALTER TABLE public.point_events DROP CONSTRAINT IF EXISTS point_events_ref_type_check;
ALTER TABLE public.point_events ADD CONSTRAINT point_events_ref_type_check
  CHECK (ref_type IS NULL OR ref_type IN ('session','course','batch','admin'));

UPDATE public.league_weeks SET outcome = NULL
  WHERE outcome IS NOT NULL AND outcome NOT IN ('promoted','stayed','relegated');
ALTER TABLE public.league_weeks DROP CONSTRAINT IF EXISTS league_weeks_outcome_check;
ALTER TABLE public.league_weeks ADD CONSTRAINT league_weeks_outcome_check
  CHECK (outcome IS NULL OR outcome IN ('promoted','stayed','relegated'));

-- ---------------------------------------------------------------------------
-- 3) Backup-code rate limiting.
--    Sliding window: max 8 failed 6-digit attempts per 10 minutes per user.
--    QR-token scans are not throttled (tokens are unforgeable 20-hex sha256).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.checkin_attempts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS checkin_attempts_user_time_idx
  ON public.checkin_attempts(user_id, attempted_at DESC);
ALTER TABLE public.checkin_attempts ENABLE ROW LEVEL SECURITY;
-- No policies: table is written/read exclusively inside SECURITY DEFINER RPCs.

CREATE OR REPLACE FUNCTION public.check_in_with_token(p_payload TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_user UUID := public.my_profile_id(); v public.sessions%ROWTYPE;
        v_parts TEXT[]; v_slot BIGINT; v_current BIGINT; v_method TEXT := 'qr';
        v_elapsed NUMERIC; v_late INTEGER; v_points INTEGER; v_status TEXT;
        v_existing TEXT; v_recent_fails INTEGER;
BEGIN
  IF v_user IS NULL OR public.my_role() <> 'student' THEN RAISE EXCEPTION 'authentication_required'; END IF;
  p_payload := btrim(p_payload);
  IF p_payload ~ '^MSRQ:[0-9a-fA-F-]{36}:[0-9]+:[0-9a-f]{20}$' THEN
    v_parts := string_to_array(p_payload, ':');
    SELECT * INTO v FROM public.sessions WHERE id = v_parts[2]::uuid FOR UPDATE;
    IF NOT FOUND OR v.status <> 'live' OR v.qr_seed IS NULL THEN RETURN jsonb_build_object('kind','no_session'); END IF;
    v_slot := v_parts[3]::bigint;
    v_current := GREATEST(0, floor(extract(epoch FROM (clock_timestamp() - v.started_at)) / 25)::bigint);
    IF v_slot NOT IN (v_current, v_current - 1)
       OR public._qr_signature(v.qr_seed, v.id, v_slot) <> v_parts[4]
    THEN RETURN jsonb_build_object('kind','expired'); END IF;
  ELSIF p_payload ~ '^[0-9]{6}$' THEN
    v_method := 'code';
    -- Rate limit: 8 failed guesses per 10 minutes locks 6-digit entry.
    SELECT count(*) INTO v_recent_fails FROM public.checkin_attempts
    WHERE user_id = v_user AND attempted_at > now() - interval '10 minutes';
    IF v_recent_fails >= 8 THEN
      INSERT INTO public.audit_log(actor_id, action, target, payload)
      VALUES (v_user, 'checkin_rate_limited', v_user::text,
              jsonb_build_object('recent_fails', v_recent_fails));
      RETURN jsonb_build_object('kind','rate_limited');
    END IF;
    SELECT s.* INTO v FROM public.sessions s
    JOIN public.enrollments e ON e.batch_id = s.batch_id AND e.user_id = v_user AND e.status = 'active'
    WHERE s.status = 'live' AND s.qr_seed IS NOT NULL
      AND public._backup_code(s.qr_seed, s.id) = p_payload
    LIMIT 1 FOR UPDATE OF s;
    IF NOT FOUND THEN
      INSERT INTO public.checkin_attempts(user_id) VALUES (v_user);
      RETURN jsonb_build_object('kind','no_session');
    END IF;
    -- Successful match clears the failure window.
    DELETE FROM public.checkin_attempts WHERE user_id = v_user;
  ELSE
    RETURN jsonb_build_object('kind','invalid');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.enrollments e WHERE e.batch_id = v.batch_id AND e.user_id = v_user AND e.status = 'active')
  THEN RETURN jsonb_build_object('kind','not_enrolled'); END IF;
  SELECT status INTO v_existing FROM public.attendance WHERE session_id = v.id AND user_id = v_user;
  IF v_existing IS NOT NULL AND v_existing <> 'absent' THEN RETURN jsonb_build_object('kind','already'); END IF;

  v_elapsed := extract(epoch FROM (clock_timestamp() - COALESCE(v.started_at, v.starts_at))) / 60;
  IF v_elapsed > 30 THEN RETURN jsonb_build_object('kind','too_late'); END IF;
  SELECT COALESCE((value->>'value')::int, 15) INTO v_late FROM public.gamification_rules WHERE key = 'attendance.late_window_min';
  v_late := COALESCE(v_late, 15);
  v_status := CASE WHEN v_elapsed <= v_late THEN 'present' ELSE 'late' END;
  SELECT COALESCE((value->>'value')::int, CASE WHEN v_status='present' THEN 10 ELSE 7 END)
  INTO v_points FROM public.gamification_rules WHERE key = 'points.' || v_status;
  v_points := COALESCE(v_points, CASE WHEN v_status='present' THEN 10 ELSE 7 END);

  INSERT INTO public.attendance(session_id, user_id, status, checked_in_at, method)
  VALUES(v.id, v_user, v_status, now(), v_method)
  ON CONFLICT(session_id,user_id) DO UPDATE SET status=EXCLUDED.status, checked_in_at=EXCLUDED.checked_in_at, method=EXCLUDED.method;
  INSERT INTO public.point_events(user_id, points, reason_code, ref_type, ref_id, idempotency_key)
  VALUES(v_user, v_points, 'attendance.' || v_status, 'session', v.id, 'attendance:' || v.id || ':' || v_user)
  ON CONFLICT(idempotency_key) DO NOTHING;
  PERFORM public.evaluate_user_badges(v_user);
  RETURN jsonb_build_object('kind','ok','status',v_status,'points',v_points,'session_id',v.id);
END;
$$;

-- Grants survive CREATE OR REPLACE, but be explicit anyway.
REVOKE ALL ON FUNCTION public.check_in_with_token(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_in_with_token(TEXT) TO authenticated;

-- Hourly janitor: drop stale attempt rows (>1 day) so the table stays tiny.
CREATE OR REPLACE FUNCTION public.prune_checkin_attempts()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_count INTEGER;
BEGIN
  DELETE FROM public.checkin_attempts WHERE attempted_at < now() - interval '1 day';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.prune_checkin_attempts() FROM PUBLIC, anon, authenticated;
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'masar-prune-checkin-attempts'
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
DO $$ BEGIN
  PERFORM cron.schedule('masar-prune-checkin-attempts','20 * * * *','SELECT public.prune_checkin_attempts()');
EXCEPTION WHEN undefined_function OR undefined_table THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 4) command_queue: enable RLS (RPC-only access; no policies on purpose).
-- ---------------------------------------------------------------------------
ALTER TABLE public.command_queue ENABLE ROW LEVEL SECURITY;

COMMIT;

-- ═══════════════ ↳ 0015_command_executor.sql ═══════════════
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

-- ═══════════════ ↳ 0016_avatar_storage_hardening.sql ═══════════════
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

-- ═══════════════ ↳ 0017_completion_rule_fix.sql ═══════════════
-- MASAR 3.2 — 0017: batch completion no longer depends on courses.sessions_count.
--
-- close_training_session / auto_close_stale_sessions / issue_batch_certificates
-- required count(sessions) == courses.sessions_count. If an admin edited the
-- course's sessions_count after batches were generated, those batches could
-- silently NEVER complete and certificates could never be issued. The truth is
-- the batch's own generated sessions: a batch is complete when it has at least
-- one session, every session is closed, and it has at least one active student.

BEGIN;

CREATE OR REPLACE FUNCTION public._batch_is_complete(p_batch_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT EXISTS(SELECT 1 FROM public.sessions s WHERE s.batch_id = p_batch_id)
     AND NOT EXISTS(SELECT 1 FROM public.sessions s WHERE s.batch_id = p_batch_id AND s.status <> 'closed')
     AND EXISTS(SELECT 1 FROM public.enrollments e WHERE e.batch_id = p_batch_id AND e.status = 'active')
$$;
REVOKE ALL ON FUNCTION public._batch_is_complete(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.close_training_session(p_session_id UUID, p_report JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v public.sessions%ROWTYPE; v_actor UUID := public.my_profile_id();
        v_remaining INTEGER; v_total INTEGER; v_present INTEGER; v_late INTEGER; v_absent INTEGER; v_excused INTEGER;
BEGIN
  SELECT * INTO v FROM public.sessions WHERE id=p_session_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_batch(v.batch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v.status <> 'live' THEN RAISE EXCEPTION 'session_not_live'; END IF;
  IF jsonb_typeof(COALESCE(p_report,'{}'::jsonb))<>'object'
     OR char_length(COALESCE(p_report->>'done',''))>4000
     OR char_length(COALESCE(p_report->>'planned',''))>4000
     OR char_length(COALESCE(p_report->>'challenges',''))>4000
  THEN RAISE EXCEPTION 'invalid_report'; END IF;
  p_report:=jsonb_build_object(
    'done',COALESCE(p_report->>'done',''),'planned',COALESCE(p_report->>'planned',''),
    'challenges',COALESCE(p_report->>'challenges',''),
    'submittedAt',floor(extract(epoch FROM now())*1000)
  );
  INSERT INTO public.attendance(session_id,user_id,status)
  SELECT v.id,e.user_id,'absent' FROM public.enrollments e
  WHERE e.batch_id=v.batch_id AND e.status='active'
  ON CONFLICT(session_id,user_id) DO NOTHING;
  UPDATE public.sessions SET status='closed',closed_at=now(),qr_seed=NULL,report=p_report WHERE id=v.id;
  SELECT count(*) FILTER(WHERE status='present'), count(*) FILTER(WHERE status='late'),
         count(*) FILTER(WHERE status='absent'), count(*) FILTER(WHERE status='excused'), count(*)
  INTO v_present,v_late,v_absent,v_excused,v_total FROM public.attendance WHERE session_id=v.id;
  SELECT count(*) INTO v_remaining FROM public.sessions WHERE batch_id=v.batch_id AND status<>'closed';
  IF v_remaining=0 THEN
    -- 0017: completion derives from the batch's own sessions (all closed +
    -- at least one active student) — no dependence on courses.sessions_count.
    UPDATE public.batches b SET status='completed',updated_at=now()
    WHERE b.id=v.batch_id AND public._batch_is_complete(b.id);
  END IF;
  INSERT INTO public.audit_log(actor_id,action,target,payload)
  VALUES(v_actor,'close_session',v.id::text,jsonb_build_object('batch_id',v.batch_id,'total',v_total));
  RETURN jsonb_build_object('ok',TRUE,'present',v_present,'late',v_late,'absent',v_absent,'excused',v_excused,'total',v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_close_stale_sessions()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE r RECORD; v_closed INTEGER:=0;
BEGIN
  FOR r IN
    SELECT s.id,s.batch_id FROM public.sessions s
    WHERE s.status='live' AND s.started_at IS NOT NULL
      AND s.started_at + make_interval(mins=>s.duration_min+60) < now()
    FOR UPDATE SKIP LOCKED
  LOOP
    INSERT INTO public.attendance(session_id,user_id,status,note)
    SELECT r.id,e.user_id,'absent','أُغلقت الجلسة تلقائيًا'
    FROM public.enrollments e
    WHERE e.batch_id=r.batch_id AND e.status='active'
    ON CONFLICT(session_id,user_id) DO NOTHING;
    UPDATE public.sessions SET status='closed',closed_at=now(),qr_seed=NULL,
      report=COALESCE(report,jsonb_build_object(
        'done','','planned','','challenges','أُغلقت تلقائيًا بعد انتهاء المهلة',
        'submittedAt',floor(extract(epoch FROM now())*1000)
      )) WHERE id=r.id;
    IF NOT EXISTS(SELECT 1 FROM public.sessions WHERE batch_id=r.batch_id AND status<>'closed') THEN
      UPDATE public.batches b SET status='completed',updated_at=now()
      WHERE b.id=r.batch_id AND public._batch_is_complete(b.id);
    END IF;
    INSERT INTO public.audit_log(actor_id,action,target,payload)
    VALUES(NULL,'auto_close_session',r.id::text,jsonb_build_object('batch_id',r.batch_id));
    v_closed:=v_closed+1;
  END LOOP;
  RETURN v_closed;
END;
$$;
REVOKE ALL ON FUNCTION public.auto_close_stale_sessions() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.issue_batch_certificates(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID:=public.my_profile_id(); v_pct INTEGER; v_points INTEGER; v_issued INTEGER:=0; r RECORD; v_serial TEXT;
BEGIN
  IF NOT public.can_manage_batch(p_batch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.batches b
    WHERE b.id=p_batch_id AND b.status='completed' AND public._batch_is_complete(b.id)
  ) THEN RAISE EXCEPTION 'batch_not_completed'; END IF;
  SELECT COALESCE((value->>'value')::int,75) INTO v_pct FROM public.gamification_rules WHERE key='certificate.min_attendance_pct';
  SELECT COALESCE((value->>'value')::int,100) INTO v_points FROM public.gamification_rules WHERE key='points.course_complete';
  FOR r IN
    SELECT e.user_id,
      count(s.id) AS total,
      count(a.session_id) FILTER(WHERE a.status<>'absent') AS honored
    FROM public.enrollments e
    JOIN public.sessions s ON s.batch_id=e.batch_id AND s.status='closed'
    LEFT JOIN public.attendance a ON a.session_id=s.id AND a.user_id=e.user_id
    WHERE e.batch_id=p_batch_id AND e.status='active'
    GROUP BY e.user_id
  LOOP
    IF r.total>0 AND (r.honored*100.0/r.total)>=COALESCE(v_pct,75)
       AND NOT EXISTS(SELECT 1 FROM public.certificates WHERE user_id=r.user_id AND batch_id=p_batch_id)
    THEN
      v_serial:='MSR-'||to_char(now(),'YYYY')||'-'||upper(substr(encode(extensions.gen_random_bytes(8),'hex'),1,12));
      INSERT INTO public.certificates(user_id,batch_id,serial) VALUES(r.user_id,p_batch_id,v_serial)
      ON CONFLICT(user_id,batch_id) DO NOTHING;
      IF NOT FOUND THEN CONTINUE; END IF;
      INSERT INTO public.point_events(user_id,points,reason_code,ref_type,ref_id,idempotency_key)
      VALUES(r.user_id,COALESCE(v_points,100),'course.complete','batch',p_batch_id,'course.complete:'||p_batch_id||':'||r.user_id)
      ON CONFLICT(idempotency_key) DO NOTHING;
      INSERT INTO public.notifications(user_id,title,body,type) VALUES(r.user_id,'شهادتك جاهزة','يمكنك تنزيلها ومشاركتها الآن.','cert');
      PERFORM public.evaluate_user_badges(r.user_id);
      v_issued:=v_issued+1;
    END IF;
  END LOOP;
  INSERT INTO public.audit_log(actor_id,action,target,payload)
  VALUES(v_actor,'issue_certificates',p_batch_id::text,jsonb_build_object('issued',v_issued));
  RETURN jsonb_build_object('ok',TRUE,'issued',v_issued);
END;
$$;

-- submit_course_rating had the same sessions_count coupling in its
-- "course completed" eligibility check.
CREATE OR REPLACE FUNCTION public.submit_course_rating(p_course_id UUID, p_stars INTEGER, p_comment TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_user UUID:=public.my_profile_id(); v_points INTEGER;
BEGIN
  IF v_user IS NULL OR p_stars NOT BETWEEN 1 AND 5 OR char_length(COALESCE(p_comment,''))>2000
  THEN RAISE EXCEPTION 'invalid_rating'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.enrollments e JOIN public.batches b ON b.id=e.batch_id
    WHERE e.user_id=v_user AND e.status='active' AND b.course_id=p_course_id
      AND b.status='completed' AND public._batch_is_complete(b.id)
  ) THEN RAISE EXCEPTION 'course_not_completed'; END IF;
  INSERT INTO public.course_ratings(user_id,course_id,stars,comment)
  VALUES(v_user,p_course_id,p_stars,NULLIF(btrim(p_comment),''))
  ON CONFLICT(user_id,course_id) DO UPDATE SET stars=EXCLUDED.stars,comment=EXCLUDED.comment;
  SELECT COALESCE((value->>'value')::int,5) INTO v_points FROM public.gamification_rules WHERE key='points.rating';
  INSERT INTO public.point_events(user_id,points,reason_code,ref_type,ref_id,idempotency_key)
  VALUES(v_user,COALESCE(v_points,5),'rating','course',p_course_id,'rating:'||p_course_id||':'||v_user)
  ON CONFLICT(idempotency_key) DO NOTHING;
  PERFORM public.evaluate_user_badges(v_user);
  RETURN jsonb_build_object('ok',TRUE);
END;
$$;

-- Repair batches already stuck by the old rule: all sessions closed but the
-- batch never flipped to completed because sessions_count drifted.
UPDATE public.batches b SET status='completed', updated_at=now()
WHERE b.status IN ('scheduled','active')
  AND public._batch_is_complete(b.id);

COMMIT;
