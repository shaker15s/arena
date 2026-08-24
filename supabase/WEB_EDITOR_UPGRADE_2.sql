-- ═══════════════════════════════════════════════════════════════════════
-- MASAR 3.2 — DB upgrade for the SQL Editor  (Batches A + B + Domain layer)
-- شغّل هذا الملف كاملًا كـ Query واحدة في Supabase SQL Editor.
-- ⚠️ يفترض أن مشروعك لديه بالفعل مخطط 0001–0006 (الجداول + auth + RLS).
--    هذا الملف لا يُنشئ جداول، ولا يمسح بيانات — كل شيء CREATE OR REPLACE
--    وأي أمر قابل لإعادة التشغيل بأمان (idempotent).
-- المصدر: supabase/migrations/0007 → 0012 (بترتيبها).
-- ═══════════════════════════════════════════════════════════════════════

-- أمان إضافي: تأكّد أن المشروع لديه المخطط الأساسي (0001–0006) قبل الترقية.
-- إن لم يكن موجودًا، أوقف التنفيذ برسالة واضحة بدل فشل صامت.
DO $$ DECLARE v_missing TEXT;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY name) INTO v_missing
  FROM unnest(ARRAY[
    'profiles','branches','committees','courses','batches','enrollments','sessions',
    'attendance','point_events','gamification','badges','user_badges','certificates',
    'excuses','audit_log','notifications','gamification_rules'
  ]) AS required(name)
  WHERE to_regclass('public.' || name) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'المخطط الأساسي غير مكتمل — شغّل 0001–0006 أولاً. الناقص: %', v_missing;
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────
-- ↳ 0007_room_collision_check.sql
-- ───────────────────────────────────────────────────────────────
-- MASAR 3.2 — 0007: room-collision validation in batch publication (BATCH-001).
-- The prior create_batch_with_sessions only rejected instructor schedule overlaps.
-- A batch could be published into a room already booked by another active/scheduled
-- batch at the same time. This redefines the function to also reject room conflicts
-- within the same branch (rooms are per-branch physical spaces).

BEGIN;

CREATE OR REPLACE FUNCTION public.create_batch_with_sessions(
  p_course_id UUID, p_branch_id UUID, p_instructor_id UUID, p_capacity INTEGER,
  p_schedule JSONB, p_start_date DATE, p_room TEXT, p_sessions JSONB
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID:=public.my_profile_id(); v_batch UUID; v_join TEXT;
  v_expected INTEGER; v_count INTEGER;
BEGIN
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT sessions_count INTO v_expected FROM public.courses WHERE id=p_course_id AND status='published';
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.branches WHERE id=p_branch_id AND status='active')
     OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_instructor_id AND status='active' AND role IN ('volunteer','supervisor','admin'))
     OR p_capacity NOT BETWEEN 1 AND 500 OR p_start_date IS NULL
     OR char_length(btrim(COALESCE(p_room,''))) NOT BETWEEN 1 AND 120
     OR jsonb_typeof(p_schedule)<>'object' OR jsonb_typeof(p_sessions)<>'array'
  THEN RAISE EXCEPTION 'invalid_batch'; END IF;
  v_count:=jsonb_array_length(p_sessions);
  IF v_count<>v_expected THEN RAISE EXCEPTION 'invalid_session_count'; END IF;

  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_sessions) WITH ORDINALITY x(item,ord)
    WHERE (item->>'seq')::INTEGER<>ord
      OR char_length(btrim(COALESCE(item->>'title',''))) NOT BETWEEN 1 AND 200
      OR (item->>'duration_min')::INTEGER NOT BETWEEN 15 AND 600
      OR (item->>'starts_at')::TIMESTAMPTZ < now()-interval '1 day'
  ) THEN RAISE EXCEPTION 'invalid_sessions'; END IF;

  IF EXISTS(
    SELECT 1
    FROM jsonb_array_elements(p_sessions) WITH ORDINALITY a(item,ord)
    JOIN jsonb_array_elements(p_sessions) WITH ORDINALITY b(item,ord) ON a.ord<b.ord
    WHERE tstzrange(
      (a.item->>'starts_at')::TIMESTAMPTZ,
      (a.item->>'starts_at')::TIMESTAMPTZ+make_interval(mins=>(a.item->>'duration_min')::INTEGER),'[)'
    ) && tstzrange(
      (b.item->>'starts_at')::TIMESTAMPTZ,
      (b.item->>'starts_at')::TIMESTAMPTZ+make_interval(mins=>(b.item->>'duration_min')::INTEGER),'[)'
    )
  ) THEN RAISE EXCEPTION 'sessions_overlap'; END IF;

  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_sessions) n(item)
    JOIN public.sessions s ON tstzrange(
      (n.item->>'starts_at')::TIMESTAMPTZ,
      (n.item->>'starts_at')::TIMESTAMPTZ+make_interval(mins=>(n.item->>'duration_min')::INTEGER),'[)'
    ) && tstzrange(s.starts_at,s.starts_at+make_interval(mins=>s.duration_min),'[)')
    JOIN public.batches b ON b.id=s.batch_id
    WHERE b.instructor_id=p_instructor_id AND s.status<>'closed'
  ) THEN RAISE EXCEPTION 'instructor_schedule_conflict'; END IF;

  -- Room is a per-branch physical space; reject if any new session overlaps a
  -- non-closed session already booked by another batch in the same branch/room.
  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_sessions) n(item)
    JOIN public.sessions s ON tstzrange(
      (n.item->>'starts_at')::TIMESTAMPTZ,
      (n.item->>'starts_at')::TIMESTAMPTZ+make_interval(mins=>(n.item->>'duration_min')::INTEGER),'[)'
    ) && tstzrange(s.starts_at,s.starts_at+make_interval(mins=>s.duration_min),'[)')
    JOIN public.batches b ON b.id=s.batch_id
    WHERE b.branch_id=p_branch_id
      AND b.room IS NOT NULL
      AND upper(btrim(b.room))=upper(btrim(p_room))
      AND s.status<>'closed'
  ) THEN RAISE EXCEPTION 'room_schedule_conflict'; END IF;

  v_join:='MSR-'||upper(substr(encode(extensions.gen_random_bytes(8),'hex'),1,12));
  INSERT INTO public.batches(course_id,branch_id,instructor_id,capacity,schedule,start_date,room,status,join_code)
  VALUES(p_course_id,p_branch_id,p_instructor_id,p_capacity,p_schedule,p_start_date,btrim(p_room),'scheduled',v_join)
  RETURNING id INTO v_batch;
  INSERT INTO public.sessions(batch_id,seq,title,starts_at,duration_min,status)
  SELECT v_batch,(item->>'seq')::INTEGER,btrim(item->>'title'),(item->>'starts_at')::TIMESTAMPTZ,
         (item->>'duration_min')::INTEGER,'scheduled'
  FROM jsonb_array_elements(p_sessions) x(item);
  INSERT INTO public.audit_log(actor_id,action,target,payload)
  VALUES(v_actor,'create_batch',v_batch::text,jsonb_build_object('course_id',p_course_id,'branch_id',p_branch_id,'sessions',v_count));
  RETURN jsonb_build_object('ok',TRUE,'batch_id',v_batch,'join_code',v_join);
END;
$$;

-- Reapply the explicit grant (redefining a function resets its ACL to the owner).
REVOKE ALL ON FUNCTION public.create_batch_with_sessions(uuid,uuid,uuid,integer,jsonb,date,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_batch_with_sessions(uuid,uuid,uuid,integer,jsonb,date,text,jsonb) TO authenticated;

COMMIT;

-- ───────────────────────────────────────────────────────────────
-- ↳ 0008_account_deletion.sql
-- ───────────────────────────────────────────────────────────────
-- MASAR 3.2 — 0008: real account deletion (release blocker).
-- Users need an App-Store-compliant deletion path that removes their auth identity
-- and all dependent data. profiles.user_id references auth.users ON DELETE CASCADE,
-- and every table referencing profiles(id) cascades on delete, so removing the
-- auth.users row is the single source of truth for full erasure.
--
-- NOTE ON RUNTIME PRIVILEGES: this function is SECURITY DEFINER and must be owned
-- by a role with DELETE + TRUNCATE on auth.users (Supabase migration context =
-- postgres/supabase_admin). If deployed to a restricted project where the migration
-- role cannot touch auth schema, grant the function owner DELETE on auth.users, or
-- route deletion through an Edge Function calling admin.deleteUser().

BEGIN;

CREATE OR REPLACE FUNCTION public.delete_my_account(p_confirm TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_auth UUID := auth.uid();
  v_profile UUID := public.my_profile_id();
  v_role TEXT := public.my_role();
BEGIN
  IF v_auth IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  -- The client must type a confirmation phrase so an accidental tap cannot erase the account.
  IF btrim(COALESCE(p_confirm, '')) <> 'DELETE' THEN RAISE EXCEPTION 'confirmation_required'; END IF;

  -- Protect the last active admin from self-erasure (mirrors admin_update_user_access).
  IF v_role = 'admin' THEN
    IF (SELECT count(*) FROM public.profiles WHERE role = 'admin' AND status = 'active') <= 1 THEN
      RAISE EXCEPTION 'last_admin';
    END IF;
  END IF;

  -- Audit before destruction (actor_id is SET NULL, so the row survives erasure).
  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES (v_profile, 'account_deleted', v_profile::text, '{}'::jsonb);

  -- Deleting the auth.users row cascades to profiles and every dependent row
  -- (enrollments, attendance, point_events, streak_weeks, gamification, user_badges,
  -- league_weeks, certificates, excuses, course_ratings, private_notes, notifications,
  -- support_requests where sender). Instructor/supervisor SET NULL links are preserved.
  DELETE FROM auth.users WHERE id = v_auth;

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_my_account(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account(text) TO authenticated;

COMMIT;

-- ───────────────────────────────────────────────────────────────
-- ↳ 0009_waitlist_promotion.sql
-- ───────────────────────────────────────────────────────────────
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

-- ───────────────────────────────────────────────────────────────
-- ↳ 0010_session_report.sql
-- ───────────────────────────────────────────────────────────────
-- MASAR 3.2 — 0010: first-class session report + notify absent students.
-- The live-session close returns present/late/absent/excused/total but there is no
-- per-session report detail and no way to notify absentees in one shot. This adds an
-- atomic server-side summary RPC and a notify-absentees RPC (both idempotent), so the
-- client can render a real session report and offer a single-tap "notify absent" action.

BEGIN;

-- Authoritative per-session report: requires the caller to manage the session's batch,
-- so students cannot read arbitrary rosters/summaries through this endpoint.
CREATE OR REPLACE FUNCTION public.get_session_report(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v public.sessions%ROWTYPE;
  v_present INTEGER; v_late INTEGER; v_absent INTEGER; v_excused INTEGER; v_total INTEGER;
  v_students INTEGER;
BEGIN
  SELECT * INTO v FROM public.sessions WHERE id = p_session_id;
  IF NOT FOUND OR NOT public.can_manage_batch(v.batch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v.status <> 'closed' THEN RAISE EXCEPTION 'session_not_closed'; END IF;

  SELECT count(*) FILTER(WHERE status='present'), count(*) FILTER(WHERE status='late'),
         count(*) FILTER(WHERE status='absent'), count(*) FILTER(WHERE status='excused'), count(*)
  INTO v_present, v_late, v_absent, v_excused, v_total
  FROM public.attendance WHERE session_id = p_session_id;

  SELECT count(*) INTO v_students FROM public.enrollments
  WHERE batch_id = v.batch_id AND status = 'active';

  RETURN jsonb_build_object(
    'session_id', v.id,
    'title', v.title,
    'starts_at', v.starts_at,
    'expected', v_students,
    'present', COALESCE(v_present,0),
    'late', COALESCE(v_late,0),
    'absent', COALESCE(v_absent,0),
    'excused', COALESCE(v_excused,0),
    'total', COALESCE(v_total,0),
    'report', v.report
  );
END;
$$;

-- Notify every student who was absent (or has no record) for a closed session.
-- Idempotent via dedupe_key; returns the number notified.
CREATE OR REPLACE FUNCTION public.notify_session_absentees(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v public.sessions%ROWTYPE;
  v_count INTEGER;
BEGIN
  SELECT * INTO v FROM public.sessions WHERE id = p_session_id;
  IF NOT FOUND OR NOT public.can_manage_batch(v.batch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v.status <> 'closed' THEN RAISE EXCEPTION 'session_not_closed'; END IF;

  WITH absentees AS (
    SELECT e.user_id FROM public.enrollments e
    WHERE e.batch_id = v.batch_id AND e.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM public.attendance a
        WHERE a.session_id = p_session_id AND a.user_id = e.user_id AND a.status <> 'absent'
      )
  ), inserted AS (
    INSERT INTO public.notifications(user_id, title, body, type, dedupe_key)
    SELECT user_id, 'غبت عن الجلسة', COALESCE(v.title, 'جلسة تدريبية') || ' — سجّل غيابك أو قدّم عذرًا.', 'session',
      'absent-notify:' || p_session_id || ':' || user_id
    FROM absentees
    ON CONFLICT(dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_count FROM inserted;

  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES (public.my_profile_id(), 'notify_absentees', p_session_id::text, jsonb_build_object('notified', COALESCE(v_count,0)));
  RETURN jsonb_build_object('ok', TRUE, 'notified', COALESCE(v_count,0));
END;
$$;

DO $$ DECLARE f REGPROCEDURE;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.get_session_report(uuid)'::regprocedure,
    'public.notify_session_absentees(uuid)'::regprocedure
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

COMMIT;

-- ───────────────────────────────────────────────────────────────
-- ↳ 0011_analytics_views.sql
-- ───────────────────────────────────────────────────────────────
-- MASAR 3.2 — 0011: server-side analytics layer.
-- The app computes attendance percentage and occupancy client-side from the whole Db.
-- This adds materialized reporting facts + aggregate RPCs so dashboards can answer
-- scope-based questions without loading every row into the client. All read RPCs are
-- permission-scoped via my_role / can_manage_batch, mirroring the rest of the schema.

BEGIN;

-- ── Reporting facts (read-only views, RLS-visible to authenticated) ──
CREATE OR REPLACE VIEW public.attendance_fact AS
SELECT
  a.session_id, a.user_id, a.status, a.checked_in_at,
  s.batch_id, s.starts_at, s.seq AS session_seq,
  b.branch_id, b.course_id, b.instructor_id
FROM public.attendance a
JOIN public.sessions s ON s.id = a.session_id
JOIN public.batches b ON b.id = s.batch_id;

CREATE OR REPLACE VIEW public.enrollment_fact AS
SELECT
  e.user_id, e.batch_id, e.status AS enrollment_status, e.joined_at,
  b.branch_id, b.course_id, b.instructor_id, b.status AS batch_status
FROM public.enrollments e
JOIN public.batches b ON b.id = e.batch_id;

CREATE OR REPLACE VIEW public.session_fact AS
SELECT
  s.id AS session_id, s.batch_id, s.seq, s.starts_at, s.duration_min, s.status,
  b.branch_id, b.course_id, b.instructor_id, b.capacity
FROM public.sessions s
JOIN public.batches b ON b.id = s.batch_id;

CREATE OR REPLACE VIEW public.course_fact AS
SELECT
  c.id AS course_id, c.title, c.field, c.status AS course_status, c.sessions_count,
  b.id AS batch_id, b.branch_id, b.status AS batch_status,
  count(DISTINCT CASE WHEN e.status = 'active' THEN e.user_id END) AS enrolled
FROM public.courses c
LEFT JOIN public.batches b ON b.course_id = c.id
LEFT JOIN public.enrollments e ON e.batch_id = b.id
GROUP BY c.id, c.title, c.field, c.status, c.sessions_count, b.id, b.branch_id, b.status;

-- ── Aggregate RPC: branch/course/batch/session analytics, scope-aware ──
CREATE OR REPLACE FUNCTION public.get_analytics(
  p_scope TEXT,          -- 'branch' | 'course' | 'batch' | 'session'
  p_scope_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := public.my_profile_id();
  v_json JSONB;
  v_filter TEXT;
BEGIN
  IF v_actor IS NULL OR public.my_role() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_scope NOT IN ('branch','course','batch','session') THEN RAISE EXCEPTION 'invalid_scope'; END IF;

  -- Branch/course-level (incl. global, p_scope_id IS NULL) analytics are staff-only.
  IF p_scope IN ('branch','course') AND NOT public.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- Batch / session: manager or a member of the batch may read.
  IF p_scope = 'batch' AND p_scope_id IS NOT NULL AND NOT public.can_manage_batch(p_scope_id)
     AND NOT EXISTS(SELECT 1 FROM public.enrollments WHERE batch_id = p_scope_id AND user_id = v_actor)
  THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_scope = 'session' AND p_scope_id IS NOT NULL THEN
    IF NOT EXISTS(
      SELECT 1 FROM public.sessions s JOIN public.batches b ON b.id = s.batch_id
      WHERE s.id = p_scope_id AND (public.can_manage_batch(b.id) OR EXISTS(
        SELECT 1 FROM public.enrollments e WHERE e.batch_id = b.id AND e.user_id = v_actor))
    ) THEN RAISE EXCEPTION 'forbidden'; END IF;
  END IF;
  IF p_scope = 'batch' AND p_scope_id IS NULL AND NOT public.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- Filter predicates applied consistently across the three facts.
  IF p_scope_id IS NULL THEN
    v_filter := 'TRUE';
  ELSE
    v_filter := CASE p_scope
      WHEN 'branch'  THEN format('branch_id = %L', p_scope_id)
      WHEN 'course'  THEN format('course_id = %L', p_scope_id)
      WHEN 'batch'   THEN format('batch_id = %L', p_scope_id)
      WHEN 'session' THEN format('session_id = %L', p_scope_id)
    END;
  END IF;

  EXECUTE format(
    'SELECT jsonb_build_object(''scope'', %L, ''scope_id'', %L, '
    ' ''sessions'', (SELECT count(*) FROM public.session_fact WHERE %s), '
    ' ''enrollments'', (SELECT count(*) FROM public.enrollment_fact WHERE %s AND enrollment_status = ''active''), '
    ' ''attendance'', (SELECT count(*) FROM public.attendance_fact WHERE %s AND status <> ''absent''), '
    ' ''attendanceRatio'', '
    '   CASE WHEN (SELECT count(*) FROM public.attendance_fact WHERE %s) = 0 THEN 0 '
    '   ELSE round(100.0 * '
    '     (SELECT count(*) FROM public.attendance_fact WHERE %s AND status <> ''absent'') '
    '     / (SELECT count(*) FROM public.attendance_fact WHERE %s)) END)',
    p_scope, p_scope_id, v_filter, v_filter, v_filter, v_filter, v_filter, v_filter
  ) INTO v_json;

  RETURN v_json;
END;
$$;

REVOKE ALL ON FUNCTION public.get_analytics(text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_analytics(text,uuid) TO authenticated;

COMMIT;

-- ───────────────────────────────────────────────────────────────
-- ↳ 0012_domain_query_layer.sql
-- ───────────────────────────────────────────────────────────────
-- MASAR 3.2 — 0012: domain query layer (P0 from the audit, §8 item 1).
-- Today the client loads the whole Db (~23 tables) via fetchRemoteDb and derives
-- every course/batch/session view locally. This is DATA-001: the single biggest
-- scale + authorization risk. These read RPCs let a screen ask the server for exactly
-- one domain object, permission-scoped, without dragging the entire database to the
-- device. Each is STABLE SECURITY DEFINER and authorizes via can_manage_batch /
-- enrollment membership, mirroring get_analytics (0011).

BEGIN;

-- ── Course overview: course + its batches w/ live occupancy & attendance ──
CREATE OR REPLACE FUNCTION public.get_course_overview(p_course_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID := public.my_profile_id(); v_json JSONB;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.courses c
    LEFT JOIN public.batches b ON b.course_id = c.id
    WHERE c.id = p_course_id AND (
      public.is_manager()
      OR b.instructor_id = v_actor
      OR EXISTS(SELECT 1 FROM public.enrollments e WHERE e.batch_id = b.id AND e.user_id = v_actor)
    )
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT jsonb_build_object(
    'course', (SELECT row_to_json(c) FROM public.courses c WHERE c.id = p_course_id),
    'batches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', b.id, 'branch_id', b.branch_id, 'instructor_id', b.instructor_id,
        'capacity', b.capacity, 'room', b.room, 'status', b.status, 'join_code', b.join_code,
        'start_date', b.start_date, 'schedule', b.schedule,
        'enrolled', (SELECT count(*) FROM public.enrollments e WHERE e.batch_id = b.id AND e.status = 'active'),
        'waitlist', (SELECT count(*) FROM public.enrollments e WHERE e.batch_id = b.id AND e.status = 'waitlist'),
        'attendance', (SELECT count(*) FROM public.attendance a JOIN public.sessions s ON s.id = a.session_id WHERE s.batch_id = b.id AND a.status <> 'absent'),
        'attendancePct', (
          SELECT CASE WHEN count(*) = 0 THEN 0
            ELSE round(100.0 * count(*) FILTER (WHERE a.status <> 'absent') / count(*))
          END FROM public.attendance a JOIN public.sessions s ON s.id = a.session_id WHERE s.batch_id = b.id
        )
      ))
      FROM public.batches b WHERE b.course_id = p_course_id
    ), '[]'::jsonb)
  ) INTO v_json;
  RETURN v_json;
END;
$$;

-- ── Batch roster: enrolled students (PII-muted for non-privileged) ──
CREATE OR REPLACE FUNCTION public.get_batch_roster(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID := public.my_profile_id(); v_can_manage BOOLEAN; v_json JSONB;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  v_can_manage := public.can_manage_batch(p_batch_id);

  SELECT jsonb_build_object(
    'batch', (SELECT row_to_json(b) FROM public.batches b WHERE b.id = p_batch_id),
    'students', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'avatar_url', p.avatar_url, 'avatar_color', p.avatar_color,
        'email', CASE WHEN v_can_manage THEN p.email ELSE NULL END,
        'phone', CASE WHEN v_can_manage THEN p.phone ELSE NULL END,
        'status', e.status, 'joined_at', e.joined_at,
        'attended', (SELECT count(*) FROM public.attendance a WHERE a.user_id = p.id AND a.status <> 'absent'),
        'absent', (SELECT count(*) FROM public.attendance a WHERE a.user_id = p.id AND a.status = 'absent')
      ))
      FROM public.enrollments e JOIN public.profiles p ON p.id = e.user_id
      WHERE e.batch_id = p_batch_id
    ), '[]'::jsonb)
  ) INTO v_json;
  RETURN v_json;
END;
$$;

-- ── Batch sessions with per-session attendance summary ──
CREATE OR REPLACE FUNCTION public.get_batch_sessions(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID := public.my_profile_id(); v_json JSONB;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT public.can_manage_batch(p_batch_id)
     AND NOT EXISTS(SELECT 1 FROM public.enrollments WHERE batch_id = p_batch_id AND user_id = v_actor)
  THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id, 'seq', s.seq, 'title', s.title, 'starts_at', s.starts_at,
    'duration_min', s.duration_min, 'status', s.status, 'report', s.report,
    'present', (SELECT count(*) FROM public.attendance a WHERE a.session_id = s.id AND a.status IN ('present','late')),
    'absent', (SELECT count(*) FROM public.attendance a WHERE a.session_id = s.id AND a.status = 'absent'),
    'excused', (SELECT count(*) FROM public.attendance a WHERE a.session_id = s.id AND a.status = 'excused')
  ) ORDER BY s.seq), '[]'::jsonb)
  INTO v_json
  FROM public.sessions s WHERE s.batch_id = p_batch_id;
  RETURN v_json;
END;
$$;

-- ── Single-session roster: attendance records for a session ──
CREATE OR REPLACE FUNCTION public.get_session_roster(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID := public.my_profile_id(); v_batch UUID; v_json JSONB;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT batch_id INTO v_batch FROM public.sessions WHERE id = p_session_id;
  IF v_batch IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT public.can_manage_batch(v_batch)
     AND NOT EXISTS(SELECT 1 FROM public.enrollments WHERE batch_id = v_batch AND user_id = v_actor)
  THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id, 'user_id', a.user_id, 'full_name', p.full_name,
    'status', a.status, 'checked_in_at', a.checked_in_at, 'method', a.method, 'note', a.note
  ) ORDER BY p.full_name), '[]'::jsonb)
  INTO v_json
  FROM public.attendance a JOIN public.profiles p ON p.id = a.user_id
  WHERE a.session_id = p_session_id;
  RETURN v_json;
END;
$$;

-- Grants (SECURITY DEFINER resets ACL to owner).
DO $$ DECLARE f REGPROCEDURE;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.get_course_overview(uuid)'::regprocedure,
    'public.get_batch_roster(uuid)'::regprocedure,
    'public.get_batch_sessions(uuid)'::regprocedure,
    'public.get_session_roster(uuid)'::regprocedure
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

COMMIT;
