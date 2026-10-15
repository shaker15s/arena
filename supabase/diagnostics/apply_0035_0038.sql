-- ═══════════════════════════════════════════════════════════════════════════
-- apply_0035_0038.sql — ملف واحد يطبّق كل الترحيلات الناقصة: 0035 → 0038
--
-- مُولَّد آليًا بواسطة: node scripts/gen-apply-bundle.js — لا تُحرّره يدويًا.
--
-- طريقة الاستخدام (مرة واحدة بس):
--   1) Supabase Dashboard → SQL Editor → New query
--   2) الصق الملف كامل → Run
--   3) شوف آخر جدول ناتج: لو مكتوب فيه ✅ الترحيلات مطبَّقة — خلصت.
--
-- • آمن لإعادة التشغيل: كل جملة داخلية idempotent
--   (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS /
--    CREATE OR REPLACE / DROP ... IF EXISTS / ON CONFLICT DO NOTHING).
-- • لا يوجد أي بيانات وهمية: المستخدمون والفروع والكورسات الحقيقية لا تُلمس
--   (0035 قيد CREATE TABLE + UPDATE بيانات مرجعية فقط... وإنشاء الجداول فارغًا).
-- • لو ظهر خطأ قبل أي شيء: بوابة التحقّق في الأول بتقول لك بالعربي إيه الناقص
--   في قاعدة البيانات، بدل رسالة Postgres الغامضة (42P01 / 42703).
-- • لإعادة التوليد: node scripts/gen-apply-bundle.js
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0) بوابة التحقّق المسبق (0001…0034 لازم تكون مطبَّقة) ─────────────────────
DO $$
DECLARE
  v_missing TEXT[] := '{}';
  v_name TEXT;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['profiles', 'courses', 'batches', 'sessions', 'badges', 'certificates'] LOOP
    IF to_regclass('public.' || v_name) IS NULL THEN
      v_missing := v_missing || ('جدول public.' || v_name);
    END IF;
  END LOOP;

  FOREACH v_name IN ARRAY ARRAY['my_profile_id', 'my_role', 'can_manage_course', 'is_manager'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_name
    ) THEN
      v_missing := v_missing || ('دالة public.' || v_name || '()');
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'certificates' AND column_name = 'status'
  ) THEN
    v_missing := v_missing || 'عمود certificates.status';
  END IF;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'MASAR: ترحيلات الأساس 0001…0034 ناقصة على قاعدة البيانات: %. شغّل supabase/diagnostics/migration_level.sql لمعرفة أول ترحيل ناقص، وطبّقه ثم أعد هذا الملف.',
      array_to_string(v_missing, ' · ');
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 1/4) 0035_lecture_feedback_and_reports.sql — نص الترحيل حرفيًا من supabase/migrations/
-- ═══════════════════════════════════════════════════════════════════════════
-- MASAR 4.0 — 0035: lecture feedback + lecture/course reports + stats center.
--
-- Implements the Repair Master Plan (2026-10-01) core loop:
--   D4  feedback after EVERY lecture  → session_feedback (one row per student,
--       48h submit window, 24h edit window, anonymous aggregates for managers)
--   D5  detailed report after every lecture and every course →
--       get_lecture_report (student view + manager view) and get_course_report
--       (mastery per topic, attendance %, satisfaction, recommendations data)
--   D6  stats center → get_stats_center (learning / attendance / ops /
--       categories / quality — scoped: org-wide for supervisor+admin, own
--       batches for volunteers)
--   Organization → course_modules (course → modules → sessions) and
--       session_content (objectives/topics/summary/resources per lecture)
--
-- Rules preserved from the existing architecture:
--   * NO direct client writes — everything through SECURITY DEFINER RPCs.
--   * session_feedback rows are private to their author (RLS); managers only
--     receive anonymous aggregates through get_lecture_report.
--   * Points are ledger-based (point_events) with idempotency_key, mirroring
--     submit_course_rating (0005). reason_code = 'session.feedback'.
--   * Every sensitive RPC is rate limited (0025 helper) and audited.


-- ═══════════════════════════════════════════════════════════════
-- 1) TABLES
-- ═══════════════════════════════════════════════════════════════

-- وحدات الكورس — تجمع المحاضرات بمحاور (كورسيرا-style)
CREATE TABLE IF NOT EXISTS public.course_modules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  seq INTEGER NOT NULL DEFAULT 1 CHECK (seq BETWEEN 1 AND 999),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (course_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_course_modules_course ON public.course_modules(course_id, seq);

-- ربط المحاضرة بالوحدة (اختياري)
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS module_id UUID REFERENCES public.course_modules(id) ON DELETE SET NULL;

-- محتوى المحاضرة: أهداف التعلّم، المحاور، الملخص، الموارد
CREATE TABLE IF NOT EXISTS public.session_content (
  session_id UUID PRIMARY KEY REFERENCES public.sessions(id) ON DELETE CASCADE,
  objectives TEXT[] NOT NULL DEFAULT '{}',
  topics TEXT[] NOT NULL DEFAULT '{}',
  summary TEXT NOT NULL DEFAULT '',
  resources JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- التغذية الراجعة بعد كل محاضرة — صف واحد لكل طالب (مجهول الهوية في التجميعات)
CREATE TABLE IF NOT EXISTS public.session_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  understanding SMALLINT NOT NULL CHECK (understanding BETWEEN 1 AND 5),
  pace SMALLINT NOT NULL CHECK (pace BETWEEN 1 AND 5),
  clarity SMALLINT NOT NULL CHECK (clarity BETWEEN 1 AND 5),
  sentiment TEXT NOT NULL CHECK (sentiment IN ('excited', 'clear', 'confused', 'tired')),
  comment TEXT NOT NULL DEFAULT '' CHECK (char_length(comment) <= 1000),
  praise_instructor BOOLEAN NOT NULL DEFAULT FALSE,
  topics_ok TEXT[] NOT NULL DEFAULT '{}',
  topics_hard TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_session_feedback_session ON public.session_feedback(session_id);
CREATE INDEX IF NOT EXISTS idx_session_feedback_user ON public.session_feedback(user_id);

-- ═══════════════════════════════════════════════════════════════
-- 2) RLS — قراءة فقط من العميل؛ كل الكتابة عبر RPCs أدناه
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.course_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS course_modules_read ON public.course_modules;
CREATE POLICY course_modules_read ON public.course_modules
  FOR SELECT USING (public.my_role() IS NOT NULL);

DROP POLICY IF EXISTS session_content_read ON public.session_content;
CREATE POLICY session_content_read ON public.session_content
  FOR SELECT USING (public.my_role() IS NOT NULL);

-- الخصوصية: الطالب يرى تغذيته فقط — المدرّمون يحصلون على تجميعات مجهولة عبر RPC
DROP POLICY IF EXISTS session_feedback_own ON public.session_feedback;
CREATE POLICY session_feedback_own ON public.session_feedback
  FOR SELECT USING (user_id = public.my_profile_id());

GRANT SELECT ON public.course_modules TO authenticated;
GRANT SELECT ON public.session_content TO authenticated;
GRANT SELECT ON public.session_feedback TO authenticated;
REVOKE ALL ON public.course_modules FROM anon;
REVOKE ALL ON public.session_content FROM anon;
REVOKE ALL ON public.session_feedback FROM anon;

-- ═══════════════════════════════════════════════════════════════
-- 3) RPC: submit_session_feedback — التغذية الراجعة (D4)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.submit_session_feedback(
  p_session_id UUID,
  p_understanding INTEGER,
  p_pace INTEGER,
  p_clarity INTEGER,
  p_sentiment TEXT DEFAULT NULL,
  p_comment TEXT DEFAULT NULL,
  p_praise_instructor BOOLEAN DEFAULT FALSE,
  p_topics_ok TEXT[] DEFAULT NULL,
  p_topics_hard TEXT[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.my_profile_id();
  v_session public.sessions%ROWTYPE;
  v_existing public.session_feedback%ROWTYPE;
  v_points INTEGER;
  v_awarded INTEGER := 0;
  v_full_day BOOLEAN := FALSE;
  v_already BOOLEAN := FALSE;
  v_attended BOOLEAN;
  v_end TIMESTAMPTZ;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_understanding NOT BETWEEN 1 AND 5 OR p_pace NOT BETWEEN 1 AND 5 OR p_clarity NOT BETWEEN 1 AND 5
  THEN RAISE EXCEPTION 'invalid_scores'; END IF;
  IF p_sentiment NOT IN ('excited', 'clear', 'confused', 'tired') THEN RAISE EXCEPTION 'invalid_sentiment'; END IF;
  IF char_length(COALESCE(p_comment, '')) > 1000 THEN RAISE EXCEPTION 'comment_too_long'; END IF;
  IF public._rate_limit_exceeded('submit_session_feedback', 20, interval '1 hour')
  THEN RAISE EXCEPTION 'rate_limited'; END IF;

  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF v_session.status = 'cancelled' THEN RAISE EXCEPTION 'session_cancelled'; END IF;

  v_end := v_session.starts_at + make_interval(mins => COALESCE(v_session.duration_min, 120));
  -- التغذية الراجعة من بداية المحاضرة حتى 48 ساعة بعد نهايتها
  IF now() < v_session.starts_at THEN RAISE EXCEPTION 'too_early'; END IF;
  IF now() > v_end + interval '48 hours' THEN RAISE EXCEPTION 'window_closed'; END IF;

  -- من يحق له التقييم: مسجَّل في الدفعة وحضر (حاضر/متأخر/معذور)
  SELECT EXISTS(
    SELECT 1 FROM public.attendance a
    WHERE a.session_id = p_session_id AND a.user_id = v_user
      AND a.status IN ('present', 'late', 'excused')
  ) INTO v_attended;
  IF NOT v_attended
     AND NOT EXISTS (SELECT 1 FROM public.enrollments e
                     WHERE e.batch_id = v_session.batch_id AND e.user_id = v_user AND e.status = 'active')
  THEN RAISE EXCEPTION 'not_enrolled'; END IF;
  IF NOT v_attended THEN RAISE EXCEPTION 'not_attended'; END IF;

  SELECT * INTO v_existing FROM public.session_feedback
  WHERE session_id = p_session_id AND user_id = v_user FOR UPDATE;

  IF FOUND THEN
    v_already := TRUE;
    -- التعديل مسموح خلال 24 ساعة من الإرسال الأول فقط
    IF now() > v_existing.created_at + interval '24 hours' THEN
      RAISE EXCEPTION 'edit_window_closed';
    END IF;
    UPDATE public.session_feedback SET
      understanding = p_understanding, pace = p_pace, clarity = p_clarity,
      sentiment = p_sentiment, comment = COALESCE(NULLIF(btrim(p_comment), ''), ''),
      praise_instructor = COALESCE(p_praise_instructor, FALSE),
      -- التعديل بدون قوائم محاور يُبقي القديم (لا يُمسح الإرسال التالي ما سبق)
      topics_ok = COALESCE(p_topics_ok, topics_ok), topics_hard = COALESCE(p_topics_hard, topics_hard),
      updated_at = now()
    WHERE id = v_existing.id;
  ELSE
    INSERT INTO public.session_feedback(
      session_id, user_id, understanding, pace, clarity, sentiment,
      comment, praise_instructor, topics_ok, topics_hard
    ) VALUES (
      p_session_id, v_user, p_understanding, p_pace, p_clarity, p_sentiment,
      COALESCE(NULLIF(btrim(p_comment), ''), ''), COALESCE(p_praise_instructor, FALSE),
      COALESCE(p_topics_ok, '{}'), COALESCE(p_topics_hard, '{}')
    );
    -- نقاط التغذية الراجعة — مرة واحدة لكل محاضرة (دفتر النقاط هو مصدر الحقيقة)
    SELECT COALESCE((value->>'value')::int, 5) INTO v_points
    FROM public.gamification_rules WHERE key = 'points.feedback';
    INSERT INTO public.point_events(user_id, points, reason_code, ref_type, ref_id, idempotency_key)
    VALUES (v_user, COALESCE(v_points, 5), 'session.feedback', 'session', p_session_id,
            'feedback:' || p_session_id || ':' || v_user)
    ON CONFLICT (idempotency_key) DO NOTHING;
    GET DIAGNOSTICS v_awarded = ROW_COUNT;
    PERFORM public.evaluate_user_badges(v_user);
  END IF;

  -- «اليوم الكامل» = حضور + تغذية راجعة
  SELECT EXISTS(
    SELECT 1 FROM public.attendance a
    WHERE a.session_id = p_session_id AND a.user_id = v_user AND a.status IN ('present', 'late')
  ) INTO v_full_day;

  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES (v_user, 'submit_session_feedback', p_session_id::text,
          jsonb_build_object('understanding', p_understanding, 'pace', p_pace,
                             'clarity', p_clarity, 'already', v_already));

  RETURN jsonb_build_object('ok', TRUE, 'already', v_already,
                            'points', CASE WHEN v_awarded > 0 THEN COALESCE(v_points, 5) ELSE 0 END,
                            'full_day', v_full_day);
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 4) RPC: get_lecture_report — تقرير المحاضرة (D5)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_lecture_report(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.my_profile_id();
  v_session public.sessions%ROWTYPE;
  v_batch public.batches%ROWTYPE;
  v_course public.courses%ROWTYPE;
  v_can_manage BOOLEAN := FALSE;
  v_enrolled BOOLEAN;
  v_att public.attendance%ROWTYPE;
  v_feedback public.session_feedback%ROWTYPE;
  v_my_points INTEGER := 0;
  v_content public.session_content%ROWTYPE;
  v_result JSONB;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
  SELECT * INTO v_batch FROM public.batches WHERE id = v_session.batch_id;
  SELECT * INTO v_course FROM public.courses WHERE id = v_batch.course_id;

  v_can_manage := public.can_manage_batch(v_session.batch_id)
                OR (public.is_manager() AND v_batch.branch_id IN (
                      SELECT branch_id FROM public.profiles WHERE id = v_user))
                OR public.my_role() = 'admin'
                OR public.is_manager();

  SELECT EXISTS(SELECT 1 FROM public.enrollments e
                WHERE e.batch_id = v_session.batch_id AND e.user_id = v_user AND e.status = 'active')
    INTO v_enrolled;

  IF NOT v_can_manage AND NOT v_enrolled THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT * INTO v_content FROM public.session_content WHERE session_id = p_session_id;
  SELECT * INTO v_att FROM public.attendance
   WHERE session_id = p_session_id AND user_id = v_user;
  SELECT * INTO v_feedback FROM public.session_feedback
   WHERE session_id = p_session_id AND user_id = v_user;
  SELECT COALESCE(SUM(points), 0) INTO v_my_points FROM public.point_events
   WHERE user_id = v_user AND ref_type = 'session' AND ref_id = p_session_id;

  v_result := jsonb_build_object(
    'viewer', CASE WHEN v_can_manage THEN 'manager' ELSE 'student' END,
    'session', jsonb_build_object(
      'id', v_session.id, 'title', v_session.title, 'seq', v_session.seq,
      'starts_at', v_session.starts_at, 'duration_min', v_session.duration_min,
      'status', v_session.status, 'batch_id', v_session.batch_id,
      'course_title', v_course.title, 'course_id', v_course.id
    ),
    'content', jsonb_build_object(
      'objectives', COALESCE(v_content.objectives, '{}'),
      'topics', COALESCE(v_content.topics, '{}'),
      'summary', COALESCE(v_content.summary, ''),
      'resources', COALESCE(v_content.resources, '[]'::jsonb)
    )
  );

  IF NOT v_can_manage THEN
    -- تقرير الطالب: حضوري، نقاطي، تغذيتي، ما أُنجز
    v_result := v_result || jsonb_build_object(
      'student', jsonb_build_object(
        'attendance', CASE WHEN v_att.id IS NULL THEN 'unmarked' ELSE v_att.status END,
        'checked_in_at', v_att.checked_in_at,
        'points', v_my_points,
        'has_feedback', v_feedback.id IS NOT NULL,
        'feedback', CASE WHEN v_feedback.id IS NULL THEN NULL ELSE jsonb_build_object(
          'understanding', v_feedback.understanding, 'pace', v_feedback.pace,
          'clarity', v_feedback.clarity, 'sentiment', v_feedback.sentiment,
          'comment', v_feedback.comment, 'created_at', v_feedback.created_at,
          'editable_until', v_feedback.created_at + interval '24 hours'
        ) END
      ),
      'report', jsonb_build_object('done', COALESCE(v_session.report->>'done', ''))
    );
  ELSE
    -- تقرير المنظّم: KPIs + تجميعات مجهولة الهوية
    v_result := v_result || jsonb_build_object(
      'manager', jsonb_build_object(
        'expected', (SELECT count(*) FROM public.enrollments
                      WHERE batch_id = v_session.batch_id AND status = 'active'),
        'present', (SELECT count(*) FROM public.attendance WHERE session_id = p_session_id AND status = 'present'),
        'late', (SELECT count(*) FROM public.attendance WHERE session_id = p_session_id AND status = 'late'),
        'absent', (SELECT count(*) FROM public.attendance WHERE session_id = p_session_id AND status = 'absent'),
        'excused', (SELECT count(*) FROM public.attendance WHERE session_id = p_session_id AND status = 'excused'),
        'feedback_count', (SELECT count(*) FROM public.session_feedback WHERE session_id = p_session_id),
        'avg_understanding', (SELECT COALESCE(round(avg(understanding)::numeric, 2), 0) FROM public.session_feedback WHERE session_id = p_session_id),
        'avg_pace', (SELECT COALESCE(round(avg(pace)::numeric, 2), 0) FROM public.session_feedback WHERE session_id = p_session_id),
        'avg_clarity', (SELECT COALESCE(round(avg(clarity)::numeric, 2), 0) FROM public.session_feedback WHERE session_id = p_session_id),
        'sentiments', (SELECT COALESCE(jsonb_object_agg(sentiment, cnt), '{}'::jsonb) FROM (
                         SELECT sentiment, count(*) AS cnt FROM public.session_feedback
                          WHERE session_id = p_session_id GROUP BY sentiment) s),
        'topics_hard', (SELECT COALESCE(jsonb_agg(DISTINCT t), '[]'::jsonb) FROM (
                          SELECT unnest(topics_hard) AS t FROM public.session_feedback
                           WHERE session_id = p_session_id AND cardinality(topics_hard) > 0) hs),
        'comments', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                        'comment', comment, 'sentiment', sentiment, 'created_at', created_at)
                        ORDER BY created_at DESC), '[]'::jsonb)
                       FROM public.session_feedback
                      WHERE session_id = p_session_id AND btrim(comment) <> ''),
        'praise_count', (SELECT count(*) FROM public.session_feedback WHERE session_id = p_session_id AND praise_instructor),
        'report', v_session.report
      )
    );
  END IF;

  RETURN v_result;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 5) RPC: get_course_report — تقرير الكورس (D5)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_course_report(p_course_id UUID, p_user_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.my_profile_id();
  v_course public.courses%ROWTYPE;
  v_target UUID := COALESCE(p_user_id, v_user);
  v_can_manage BOOLEAN;
  v_result JSONB;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT * INTO v_course FROM public.courses WHERE id = p_course_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'course_not_found'; END IF;

  v_can_manage := public.is_manager() OR public.my_role() = 'admin'
                OR public.can_manage_course(p_course_id);
  IF NOT v_can_manage AND v_target <> v_user THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT v_can_manage AND NOT EXISTS (
        SELECT 1 FROM public.enrollments e JOIN public.batches b ON b.id = e.batch_id
         WHERE e.user_id = v_user AND e.status = 'active' AND b.course_id = p_course_id)
  THEN RAISE EXCEPTION 'forbidden'; END IF;

  v_result := jsonb_build_object(
    'course', jsonb_build_object('id', v_course.id, 'title', v_course.title,
                                 'field', v_course.field, 'status', v_course.status,
                                 'sessions_count', v_course.sessions_count)
  );

  IF NOT v_can_manage THEN
    v_result := v_result || jsonb_build_object('student', jsonb_build_object(
      'batches', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'batch_id', b.id, 'room', b.room, 'status', b.status)), '[]'::jsonb)
                    FROM public.enrollments e JOIN public.batches b ON b.id = e.batch_id
                   WHERE e.user_id = v_target AND e.status = 'active' AND b.course_id = p_course_id),
      'sessions_total', (SELECT count(*) FROM public.sessions s JOIN public.batches b ON b.id = s.batch_id
                          JOIN public.enrollments e ON e.batch_id = b.id
                         WHERE b.course_id = p_course_id AND e.user_id = v_target AND e.status = 'active'
                           AND s.status IN ('closed', 'live')),
      'attended', (SELECT count(DISTINCT s.id) FROM public.sessions s JOIN public.batches b ON b.id = s.batch_id
                    JOIN public.attendance a ON a.session_id = s.id
                   WHERE b.course_id = p_course_id AND a.user_id = v_target
                     AND a.status IN ('present', 'late')),
      'late', (SELECT count(*) FROM public.sessions s JOIN public.batches b ON b.id = s.batch_id
                JOIN public.attendance a ON a.session_id = s.id
               WHERE b.course_id = p_course_id AND a.user_id = v_target AND a.status = 'late'),
      'absent', (SELECT count(*) FROM public.sessions s JOIN public.batches b ON b.id = s.batch_id
                  JOIN public.attendance a ON a.session_id = s.id
                 WHERE b.course_id = p_course_id AND a.user_id = v_target AND a.status = 'absent'),
      'excused', (SELECT count(*) FROM public.sessions s JOIN public.batches b ON b.id = s.batch_id
                   JOIN public.attendance a ON a.session_id = s.id
                  WHERE b.course_id = p_course_id AND a.user_id = v_target AND a.status = 'excused'),
      'feedback_given', (SELECT count(*) FROM public.session_feedback f JOIN public.sessions s ON s.id = f.session_id
                          JOIN public.batches b ON b.id = s.batch_id
                         WHERE b.course_id = p_course_id AND f.user_id = v_target),
      'avg_understanding', (SELECT COALESCE(round(avg(f.understanding)::numeric, 2), 0)
                              FROM public.session_feedback f JOIN public.sessions s ON s.id = f.session_id
                              JOIN public.batches b ON b.id = s.batch_id
                             WHERE b.course_id = p_course_id AND f.user_id = v_target),
      'topics_ok', (SELECT COALESCE(jsonb_agg(DISTINCT t), '[]'::jsonb) FROM (
                      SELECT unnest(f.topics_ok) AS t FROM public.session_feedback f
                      JOIN public.sessions s ON s.id = f.session_id JOIN public.batches b ON b.id = s.batch_id
                     WHERE b.course_id = p_course_id AND f.user_id = v_target AND cardinality(f.topics_ok) > 0) ok),
      'topics_hard', (SELECT COALESCE(jsonb_agg(DISTINCT t), '[]'::jsonb) FROM (
                       SELECT unnest(f.topics_hard) AS t FROM public.session_feedback f
                       JOIN public.sessions s ON s.id = f.session_id JOIN public.batches b ON b.id = s.batch_id
                      WHERE b.course_id = p_course_id AND f.user_id = v_target AND cardinality(f.topics_hard) > 0) hard),
      'points', (SELECT COALESCE(SUM(pe.points), 0) FROM public.point_events pe
                  JOIN public.sessions s ON s.id = pe.ref_id JOIN public.batches b ON b.id = s.batch_id
                 WHERE pe.user_id = v_target AND pe.ref_type = 'session' AND b.course_id = p_course_id),
      'certificates', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                         'serial', c.serial, 'status', c.status, 'issued_at', c.issued_at)), '[]'::jsonb)
                         FROM public.certificates c JOIN public.batches b ON b.id = c.batch_id
                        WHERE c.user_id = v_target AND b.course_id = p_course_id),
      'course_rating', (SELECT jsonb_build_object('stars', r.stars, 'comment', r.comment)
                          FROM public.course_ratings r WHERE r.user_id = v_target AND r.course_id = p_course_id)
    ));
  ELSE
    v_result := v_result || jsonb_build_object('manager', jsonb_build_object(
      'batches', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'batch_id', b.id, 'room', b.room, 'status', b.status,
                    'enrolled', (SELECT count(*) FROM public.enrollments e WHERE e.batch_id = b.id AND e.status = 'active'),
                    'attendance_pct', (SELECT COALESCE(round(
                        100.0 * count(*) FILTER (WHERE a.status IN ('present','late'))
                        / NULLIF((SELECT count(*) FROM public.enrollments e2 WHERE e2.batch_id = b.id AND e2.status = 'active')
                                 * (SELECT count(*) FROM public.sessions s2 WHERE s2.batch_id = b.id AND s2.status = 'closed'), 0), 0))
                       FROM public.attendance a JOIN public.sessions s ON s.id = a.session_id
                      WHERE s.batch_id = b.id),
                    'avg_satisfaction', (SELECT COALESCE(round(avg(f.understanding)::numeric, 2), 0)
                       FROM public.session_feedback f JOIN public.sessions s ON s.id = f.session_id
                      WHERE s.batch_id = b.id),
                    'sessions', (SELECT count(*) FROM public.sessions s WHERE s.batch_id = b.id),
                    'missing_reports', (SELECT count(*) FROM public.sessions s
                                         WHERE s.batch_id = b.id AND s.status = 'closed'
                                           AND (s.report IS NULL OR s.report = '{}'::jsonb))
                  )), '[]'::jsonb)
          FROM public.batches b WHERE b.course_id = p_course_id),
      'avg_rating', (SELECT COALESCE(round(avg(stars)::numeric, 2), 0) FROM public.course_ratings WHERE course_id = p_course_id),
      'ratings_count', (SELECT count(*) FROM public.course_ratings WHERE course_id = p_course_id)
    ));
  END IF;

  RETURN v_result;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 6) RPC: get_stats_center — مركز الإحصائيات (D6)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_stats_center()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.my_profile_id();
  v_global BOOLEAN;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT public.is_staff() THEN RAISE EXCEPTION 'forbidden'; END IF;
  v_global := (public.my_role() IN ('supervisor', 'admin'));

  RETURN jsonb_build_object(
    'scope', CASE WHEN v_global THEN 'org' ELSE 'mine' END,
    'learning', jsonb_build_object(
      'sessions_closed', (SELECT count(*) FROM public.sessions s JOIN public.batches b ON b.id = s.batch_id
                           WHERE s.status = 'closed'
                             AND (v_global OR b.instructor_id = v_user
                                  OR EXISTS (SELECT 1 FROM public.course_roles cr
                                              WHERE cr.course_id = b.course_id AND cr.user_id = v_user))),
      'feedback_count', (SELECT count(*) FROM public.session_feedback f JOIN public.sessions s ON s.id = f.session_id
                          JOIN public.batches b ON b.id = s.batch_id
                         WHERE (v_global OR b.instructor_id = v_user
                                OR EXISTS (SELECT 1 FROM public.course_roles cr
                                            WHERE cr.course_id = b.course_id AND cr.user_id = v_user))),
      'avg_understanding', (SELECT COALESCE(round(avg(f.understanding)::numeric, 2), 0)
                              FROM public.session_feedback f JOIN public.sessions s ON s.id = f.session_id
                              JOIN public.batches b ON b.id = s.batch_id
                             WHERE (v_global OR b.instructor_id = v_user)),
      'avg_pace', (SELECT COALESCE(round(avg(f.pace)::numeric, 2), 0)
                     FROM public.session_feedback f JOIN public.sessions s ON s.id = f.session_id
                     JOIN public.batches b ON b.id = s.batch_id
                    WHERE (v_global OR b.instructor_id = v_user)),
      'avg_clarity', (SELECT COALESCE(round(avg(f.clarity)::numeric, 2), 0)
                        FROM public.session_feedback f JOIN public.sessions s ON s.id = f.session_id
                        JOIN public.batches b ON b.id = s.batch_id
                       WHERE (v_global OR b.instructor_id = v_user)),
      'avg_course_rating', (SELECT COALESCE(round(avg(stars)::numeric, 2), 0) FROM public.course_ratings)
    ),
    'attendance', jsonb_build_object(
      'total_marks', (SELECT count(*) FROM public.attendance a JOIN public.sessions s ON s.id = a.session_id
                       JOIN public.batches b ON b.id = s.batch_id
                      WHERE (v_global OR b.instructor_id = v_user)),
      'present', (SELECT count(*) FROM public.attendance a JOIN public.sessions s ON s.id = a.session_id
                   JOIN public.batches b ON b.id = s.batch_id
                  WHERE a.status IN ('present') AND (v_global OR b.instructor_id = v_user)),
      'late', (SELECT count(*) FROM public.attendance a JOIN public.sessions s ON s.id = a.session_id
                JOIN public.batches b ON b.id = s.batch_id
               WHERE a.status = 'late' AND (v_global OR b.instructor_id = v_user)),
      'absent', (SELECT count(*) FROM public.attendance a JOIN public.sessions s ON s.id = a.session_id
                  JOIN public.batches b ON b.id = s.batch_id
                 WHERE a.status = 'absent' AND (v_global OR b.instructor_id = v_user)),
      'excused', (SELECT count(*) FROM public.attendance a JOIN public.sessions s ON s.id = a.session_id
                   JOIN public.batches b ON b.id = s.batch_id
                  WHERE a.status = 'excused' AND (v_global OR b.instructor_id = v_user))
    ),
    'ops', jsonb_build_object(
      'sessions_today', (SELECT count(*) FROM public.sessions s JOIN public.batches b ON b.id = s.batch_id
                          WHERE s.starts_at >= date_trunc('day', now())
                            AND s.starts_at < date_trunc('day', now()) + interval '1 day'
                            AND (v_global OR b.instructor_id = v_user)),
      'sessions_this_week', (SELECT count(*) FROM public.sessions s JOIN public.batches b ON b.id = s.batch_id
                              WHERE s.starts_at >= date_trunc('week', now())
                                AND (v_global OR b.instructor_id = v_user)),
      'live_now', (SELECT count(*) FROM public.sessions s JOIN public.batches b ON b.id = s.batch_id
                    WHERE s.status = 'live' AND (v_global OR b.instructor_id = v_user)),
      'missing_reports', (SELECT count(*) FROM public.sessions s JOIN public.batches b ON b.id = s.batch_id
                           WHERE s.status = 'closed'
                             AND (s.report IS NULL OR s.report = '{}'::jsonb)
                             AND (v_global OR b.instructor_id = v_user)),
      'needs_attention', (SELECT count(*) FROM public.sessions s JOIN public.batches b ON b.id = s.batch_id
                           WHERE s.status = 'closed'
                             AND (s.report IS NULL OR s.report = '{}'::jsonb)
                             AND (v_global OR b.instructor_id = v_user))
        + (SELECT count(*) FROM public.excuses WHERE status = 'pending' AND (v_global OR TRUE))
    ),
    'categories', CASE WHEN v_global THEN jsonb_build_object(
      'students_active', (SELECT count(*) FROM public.profiles WHERE role = 'student' AND status = 'active'),
      'students_disabled', (SELECT count(*) FROM public.profiles WHERE role = 'student' AND status = 'disabled'),
      'volunteers', (SELECT count(*) FROM public.profiles WHERE role = 'volunteer' AND status = 'active'),
      'supervisors', (SELECT count(*) FROM public.profiles WHERE role = 'supervisor' AND status = 'active'),
      'admins', (SELECT count(*) FROM public.profiles WHERE role = 'admin' AND status = 'active'),
      'enrollments_active', (SELECT count(*) FROM public.enrollments WHERE status = 'active')
    ) ELSE '{}'::jsonb END,
    'quality', jsonb_build_object(
      'open_support', (SELECT count(*) FROM public.support_requests WHERE status = 'open'),
      'client_errors_7d', (SELECT count(*) FROM public.client_errors WHERE created_at > now() - interval '7 days'),
      'ratings_count', (SELECT count(*) FROM public.course_ratings),
      'avg_rating', (SELECT COALESCE(round(avg(stars)::numeric, 2), 0) FROM public.course_ratings)
    )
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 7) RPC: save_session_content + create_course_module — التنظيم
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.save_session_content(
  p_session_id UUID,
  p_objectives TEXT[] DEFAULT NULL,
  p_topics TEXT[] DEFAULT NULL,
  p_summary TEXT DEFAULT NULL,
  p_resources JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.my_profile_id();
  v_session public.sessions%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF NOT (public.can_manage_batch(v_session.batch_id) OR public.is_manager())
  THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF char_length(COALESCE(p_summary, '')) > 4000 THEN RAISE EXCEPTION 'summary_too_long'; END IF;

  INSERT INTO public.session_content(session_id, objectives, topics, summary, resources, updated_by)
  VALUES (p_session_id, COALESCE(p_objectives, '{}'), COALESCE(p_topics, '{}'),
          COALESCE(NULLIF(btrim(p_summary), ''), ''), COALESCE(p_resources, '[]'::jsonb), v_user)
  ON CONFLICT (session_id) DO UPDATE SET
    objectives = EXCLUDED.objectives, topics = EXCLUDED.topics,
    summary = EXCLUDED.summary, resources = EXCLUDED.resources,
    updated_by = v_user, updated_at = now();

  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES (v_user, 'save_session_content', p_session_id::text, '{}'::jsonb);
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_course_module(p_course_id UUID, p_title TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.my_profile_id();
  v_id UUID;
  v_seq INTEGER;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT (public.can_manage_course(p_course_id) OR public.is_manager())
  THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF char_length(btrim(COALESCE(p_title, ''))) NOT BETWEEN 1 AND 120
  THEN RAISE EXCEPTION 'invalid_title'; END IF;

  SELECT COALESCE(max(seq), 0) + 1 INTO v_seq FROM public.course_modules WHERE course_id = p_course_id;
  INSERT INTO public.course_modules(course_id, title, seq)
  VALUES (p_course_id, btrim(p_title), LEAST(v_seq, 999))
  RETURNING id INTO v_id;

  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES (v_user, 'create_course_module', v_id::text, jsonb_build_object('course_id', p_course_id));
  RETURN jsonb_build_object('ok', TRUE, 'id', v_id);
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 8) طلب التغذية الراجعة تلقائيًا عند إغلاق المحاضرة (D4)
--    إشعار واحد لكل حاضر (dedupe_key) — لا سبام، ويقود لشاشة التغذية مباشرة.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._notify_lecture_feedback()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' THEN
    INSERT INTO public.notifications(user_id, title, body, type, dedupe_key)
    SELECT a.user_id,
           'رأيك مطلوب بعد المحاضرة ✍️',
           'شاركنا تقييمك لمحاضرة: ' || COALESCE(NULLIF(btrim(NEW.title), ''), 'جلسة تدريبية') || ' — تستغرق 20 ثانية.',
           'session',
           'feedback-ask:' || NEW.id || ':' || a.user_id
    FROM public.attendance a
    WHERE a.session_id = NEW.id AND a.status IN ('present', 'late', 'excused')
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_lecture_feedback ON public.sessions;
CREATE TRIGGER trg_notify_lecture_feedback
  AFTER UPDATE OF status ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public._notify_lecture_feedback();

-- ═══════════════════════════════════════════════════════════════
-- 9) run_command: تمرير التغذية الراجعة عبر طابور الأوفلاين
-- ═══════════════════════════════════════════════════════════════

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

  INSERT INTO public.command_queue(id, user_id, command, payload, status, device_created_at)
  VALUES (p_command_id, v_user, p_command, COALESCE(p_payload, '{}'::jsonb), 'pending', p_device_created_at)
  ON CONFLICT (id) DO NOTHING;

  SELECT * INTO v_row FROM public.command_queue
  WHERE id = p_command_id AND user_id = v_user
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'forbidden'; END IF;

  IF v_row.status = 'applied' THEN
    RETURN jsonb_build_object('ok', TRUE, 'command_id', p_command_id, 'status', 'applied', 'already', TRUE);
  END IF;
  IF v_row.status = 'failed' THEN
    RETURN jsonb_build_object('ok', FALSE, 'command_id', p_command_id, 'status', 'failed',
                              'already', TRUE, 'error', v_row.last_error);
  END IF;

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
      WHEN 'submit_session_feedback' THEN
        v_result := public.submit_session_feedback(
          (v_row.payload->>'session_id')::uuid,
          (v_row.payload->>'understanding')::int,
          (v_row.payload->>'pace')::int,
          (v_row.payload->>'clarity')::int,
          v_row.payload->>'sentiment',
          v_row.payload->>'comment',
          COALESCE((v_row.payload->>'praise_instructor')::boolean, FALSE),
          (SELECT array_agg(x) FROM jsonb_array_elements_text(COALESCE(v_row.payload->'topics_ok', '[]'::jsonb)) x),
          (SELECT array_agg(x) FROM jsonb_array_elements_text(COALESCE(v_row.payload->'topics_hard', '[]'::jsonb)) x)
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

-- ═══════════════════════════════════════════════════════════════
-- 9) الصلاحيات — «لا دالة بلا تحكم وصول»
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
  r RECORD;
  -- الدوال الداخلية (trigger) لا تُستدعى من العميل.
  internal_helpers TEXT[] := ARRAY[
    '_notify_lecture_feedback'
  ];
  -- كل دوال هذه الترقية RPCs يستدعيها العميل الموثَّق — لا دالة بلا تحكم وصول.
  client_rpcs TEXT[] := ARRAY[
    'submit_session_feedback', 'get_lecture_report', 'get_course_report', 'get_stats_center',
    'save_session_content', 'create_course_module', 'run_command'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = ANY(client_rpcs || internal_helpers)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    IF r.proname = ANY(client_rpcs) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
  END LOOP;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2/4) 0036_course_organizer_authority.sql — نص الترحيل حرفيًا من supabase/migrations/
-- ═══════════════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- 0036_course_organizer_authority.sql — سلطة المنظّم الكاملة على الكورس (UX-C1/C2)
--
-- المشكلة المُغلقة: كان المنظّم يستطيع *إنشاء* وحدة تعليمية (create_course_module)
-- لكن لا يستطيع **ربط محاضرة بوحدة** ولا **تعديل/حذف وحدة** — أي أن ميزة «تنظيم
-- الكورس» كانت نصف مبنيّة، والعمود sessions.module_id ظل فارغًا إلى الأبد. كذلك
-- لا توجد واجهة خلفية تجمع **كل** التغذية الراجعة للكورس في نظرة واحدة، فيضطر
-- المنظّم لفتح تقرير كل محاضرة على حدة.
--
-- هذا الملف يعطي:
--   1) set_session_module      — ربط/فصل محاضرة بوحدة (سلطة كاملة على البناء)
--   2) rename_course_module    — إعادة تسمية وحدة
--   3) delete_course_module    — حذف وحدة (المحاضرات تُفصل تلقائيًا ON DELETE SET NULL)
--   4) reorder_course_module   — ترتيب الوحدات
--   5) get_course_feedback     — تجميع مجهول الهوية لكل تغذية الكورس (لكل محاضرة) + المحاور
--                                المحتاجة توضيحًا + ملخص الرضا + تقييمات الكورس
--
-- ملاحظات أمنية: كل الدوال SECURITY DEFINER مع تحقّق صلاحية صريح، وكل تغيير يُسجَّل
-- في audit_log، وتفاصيل التغذية تبقى **مجهولة الهوية** (لا user_id في أي مخرَج).
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- 1) ربط محاضرة بوحدة تعليمية (p_module_id = NULL ⇒ فصل المحاضرة)
-- ────────────────────────────────────────────────────────────────────────────
-- ───────────────────────────────────────────────────────────────────────────
-- ⚠️ تحقّق مسبق: 0036 يبني على كائنات أنشأها 0035 (جدول course_modules والعمود
-- sessions.module_id). لو لم يُطبَّق 0035 كانت النتيجة خطأ Postgres غامضًا:
--     ERROR: 42703: column "module_id" does not exist
-- الآن يفشل الترحيل برسالة واضحة تسمّي الترحيل المطلوب بالتحديد.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.course_modules') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'module_id'
     ) THEN
    RAISE EXCEPTION 'MASAR 0036 needs migration 0035 first (course_modules + sessions.module_id). Shaghel 0035_lecture_feedback_and_reports.sql then 0036.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_session_module(p_session_id UUID, p_module_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.my_profile_id();
  v_session public.sessions%ROWTYPE;
  v_course UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;

  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF NOT (public.can_manage_batch(v_session.batch_id) OR public.is_manager())
  THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT b.course_id INTO v_course FROM public.batches b WHERE b.id = v_session.batch_id;

  IF p_module_id IS NOT NULL THEN
    -- الوحدة يجب أن تنتمي **لنفس الكورس** — وإلا صار التنظيم فوضى عبر الكورسات.
    IF NOT EXISTS (SELECT 1 FROM public.course_modules m WHERE m.id = p_module_id AND m.course_id = v_course)
    THEN RAISE EXCEPTION 'module_not_in_course'; END IF;
  END IF;

  UPDATE public.sessions SET module_id = p_module_id WHERE id = p_session_id;

  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES (v_user, 'set_session_module', p_session_id::text,
          jsonb_build_object('module_id', p_module_id, 'course_id', v_course));

  RETURN jsonb_build_object('ok', TRUE, 'module_id', p_module_id);
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2) إعادة تسمية وحدة
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rename_course_module(p_module_id UUID, p_title TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.my_profile_id();
  v_course UUID;
  v_clean TEXT := btrim(COALESCE(p_title, ''));
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF char_length(v_clean) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'invalid_title'; END IF;

  SELECT course_id INTO v_course FROM public.course_modules WHERE id = p_module_id;
  IF v_course IS NULL THEN RAISE EXCEPTION 'module_not_found'; END IF;
  IF NOT (public.can_manage_course(v_course) OR public.is_manager())
  THEN RAISE EXCEPTION 'forbidden'; END IF;

  UPDATE public.course_modules SET title = v_clean WHERE id = p_module_id;

  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES (v_user, 'rename_course_module', p_module_id::text, jsonb_build_object('title', v_clean));
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3) حذف وحدة — المحاضرات تُفصل تلقائيًا (ON DELETE SET NULL) ولا تُحذف
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_course_module(p_module_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.my_profile_id();
  v_course UUID;
  v_detached INTEGER := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;

  SELECT course_id INTO v_course FROM public.course_modules WHERE id = p_module_id;
  IF v_course IS NULL THEN RAISE EXCEPTION 'module_not_found'; END IF;
  IF NOT (public.can_manage_course(v_course) OR public.is_manager())
  THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT count(*) INTO v_detached FROM public.sessions WHERE module_id = p_module_id;
  DELETE FROM public.course_modules WHERE id = p_module_id;

  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES (v_user, 'delete_course_module', p_module_id::text,
          jsonb_build_object('course_id', v_course, 'detached_sessions', v_detached));
  RETURN jsonb_build_object('ok', TRUE, 'detached_sessions', v_detached);
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4) ترتيب وحدة (نقل لأعلى/لأسفل عبر تبديل seq)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reorder_course_module(p_module_id UUID, p_direction INTEGER)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.my_profile_id();
  v_course UUID;
  v_seq INTEGER;
  v_neighbour_id UUID;
  v_neighbour_seq INTEGER;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_direction NOT IN (-1, 1) THEN RAISE EXCEPTION 'invalid_direction'; END IF;

  SELECT course_id, seq INTO v_course, v_seq FROM public.course_modules WHERE id = p_module_id;
  IF v_course IS NULL THEN RAISE EXCEPTION 'module_not_found'; END IF;
  IF NOT (public.can_manage_course(v_course) OR public.is_manager())
  THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT id, seq INTO v_neighbour_id, v_neighbour_seq
    FROM public.course_modules
   WHERE course_id = v_course
     AND (CASE WHEN p_direction < 0 THEN seq < v_seq ELSE seq > v_seq END)
   ORDER BY (CASE WHEN p_direction < 0 THEN seq END) DESC NULLS LAST,
            (CASE WHEN p_direction > 0 THEN seq END) ASC NULLS LAST
   LIMIT 1;

  IF v_neighbour_id IS NULL THEN
    RETURN jsonb_build_object('ok', TRUE, 'moved', FALSE);
  END IF;

  UPDATE public.course_modules SET seq = v_neighbour_seq WHERE id = p_module_id;
  UPDATE public.course_modules SET seq = v_seq WHERE id = v_neighbour_id;

  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES (v_user, 'reorder_course_module', p_module_id::text,
          jsonb_build_object('direction', p_direction, 'swapped_with', v_neighbour_id));
  RETURN jsonb_build_object('ok', TRUE, 'moved', TRUE);
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5) get_course_feedback — نظرة واحدة على **كل** تغذية الكورس (للمنظّم)
--    • لكل محاضرة: عدد الاستجابات + متوسط الفهم/الإيقاع/الوضوح + توزيع الانطباع
--      + عدد الثناء على المدرّب + المحاور الصعبة + حالة التقرير.
--    • على مستوى الكورس: المتوسطات، المحاور الأكثر احتياجًا للتوضيح، تقييمات النجوم.
--    • مجهول الهوية 100%: لا يظهر أي user_id ولا أي تعليق فردي مربوط بصاحبه.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_course_feedback(p_course_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.my_profile_id();
  v_result JSONB;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT (public.can_manage_course(p_course_id) OR public.is_manager())
  THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT jsonb_build_object(
    'course', jsonb_build_object(
      'id', c.id, 'title', c.title
    ),
    'totals', jsonb_build_object(
      'responses', (SELECT count(*) FROM public.session_feedback f
                     JOIN public.sessions s ON s.id = f.session_id
                     JOIN public.batches b ON b.id = s.batch_id
                    WHERE b.course_id = p_course_id),
      'sessions_with_feedback', (SELECT count(DISTINCT f.session_id) FROM public.session_feedback f
                     JOIN public.sessions s ON s.id = f.session_id
                     JOIN public.batches b ON b.id = s.batch_id
                    WHERE b.course_id = p_course_id),
      'sessions_total', (SELECT count(*) FROM public.sessions s
                     JOIN public.batches b ON b.id = s.batch_id
                    WHERE b.course_id = p_course_id),
      'avg_understanding', (SELECT COALESCE(round(avg(f.understanding)::numeric, 2), 0)
                     FROM public.session_feedback f
                     JOIN public.sessions s ON s.id = f.session_id
                     JOIN public.batches b ON b.id = s.batch_id
                    WHERE b.course_id = p_course_id),
      'avg_pace', (SELECT COALESCE(round(avg(f.pace)::numeric, 2), 0)
                     FROM public.session_feedback f
                     JOIN public.sessions s ON s.id = f.session_id
                     JOIN public.batches b ON b.id = s.batch_id
                    WHERE b.course_id = p_course_id),
      'avg_clarity', (SELECT COALESCE(round(avg(f.clarity)::numeric, 2), 0)
                     FROM public.session_feedback f
                     JOIN public.sessions s ON s.id = f.session_id
                     JOIN public.batches b ON b.id = s.batch_id
                    WHERE b.course_id = p_course_id),
      'praise_count', (SELECT count(*) FROM public.session_feedback f
                     JOIN public.sessions s ON s.id = f.session_id
                     JOIN public.batches b ON b.id = s.batch_id
                    WHERE b.course_id = p_course_id AND f.praise_instructor),
      'missing_reports', (SELECT count(*) FROM public.sessions s
                     JOIN public.batches b ON b.id = s.batch_id
                    WHERE b.course_id = p_course_id AND s.status = 'closed'
                      AND (s.report IS NULL OR COALESCE(btrim(s.report->>'done'), '') = ''))
    ),
    'sentiments', (SELECT COALESCE(jsonb_object_agg(sentiment, cnt), '{}'::jsonb) FROM (
                     SELECT f.sentiment, count(*) AS cnt
                       FROM public.session_feedback f
                       JOIN public.sessions s ON s.id = f.session_id
                       JOIN public.batches b ON b.id = s.batch_id
                      WHERE b.course_id = p_course_id
                      GROUP BY f.sentiment) x),
    'topics_hard', (SELECT COALESCE(jsonb_agg(jsonb_build_object('topic', t, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
                      FROM (SELECT t, count(*) AS cnt
                              FROM public.session_feedback f
                              JOIN public.sessions s ON s.id = f.session_id
                              JOIN public.batches b ON b.id = s.batch_id,
                                   unnest(f.topics_hard) AS t
                             WHERE b.course_id = p_course_id
                             GROUP BY t) y),
    'sessions', (SELECT COALESCE(jsonb_agg(row ORDER BY seq), '[]'::jsonb) FROM (
                    SELECT s.seq,
                           jsonb_build_object(
                             'session_id', s.id,
                             'title', s.title,
                             'batch_id', s.batch_id,
                             'starts_at', s.starts_at,
                             'status', s.status,
                             'responses', (SELECT count(*) FROM public.session_feedback f WHERE f.session_id = s.id),
                             'avg_understanding', (SELECT COALESCE(round(avg(f.understanding)::numeric, 2), 0) FROM public.session_feedback f WHERE f.session_id = s.id),
                             'avg_pace', (SELECT COALESCE(round(avg(f.pace)::numeric, 2), 0) FROM public.session_feedback f WHERE f.session_id = s.id),
                             'avg_clarity', (SELECT COALESCE(round(avg(f.clarity)::numeric, 2), 0) FROM public.session_feedback f WHERE f.session_id = s.id),
                             'praise_count', (SELECT count(*) FROM public.session_feedback f WHERE f.session_id = s.id AND f.praise_instructor),
                             'sentiments', (SELECT COALESCE(jsonb_object_agg(sentiment, cnt), '{}'::jsonb) FROM (
                                              SELECT sentiment, count(*) AS cnt FROM public.session_feedback
                                               WHERE session_id = s.id GROUP BY sentiment) z),
                             'topics_hard', (SELECT COALESCE(jsonb_agg(DISTINCT t), '[]'::jsonb)
                                               FROM public.session_feedback f, unnest(f.topics_hard) AS t
                                              WHERE f.session_id = s.id),
                             'has_report', (s.report IS NOT NULL AND COALESCE(btrim(s.report->>'done'), '') <> ''),
                             'comments', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                                              'comment', f.comment, 'sentiment', f.sentiment, 'created_at', f.created_at)
                                              ORDER BY f.created_at DESC), '[]'::jsonb)
                                            FROM public.session_feedback f
                                           WHERE f.session_id = s.id AND btrim(f.comment) <> '')
                           ) AS row
                      FROM public.sessions s
                      JOIN public.batches b ON b.id = s.batch_id
                     WHERE b.course_id = p_course_id) q),
    'ratings', jsonb_build_object(
      'count', (SELECT count(*) FROM public.course_ratings WHERE course_id = p_course_id),
      'avg', (SELECT COALESCE(round(avg(stars)::numeric, 2), 0) FROM public.course_ratings WHERE course_id = p_course_id),
      'distribution', (SELECT COALESCE(jsonb_object_agg(stars, cnt), '{}'::jsonb) FROM (
                         SELECT stars, count(*) AS cnt FROM public.course_ratings
                          WHERE course_id = p_course_id GROUP BY stars) d)
    )
  ) INTO v_result
  FROM public.courses c WHERE c.id = p_course_id;

  IF v_result IS NULL THEN RAISE EXCEPTION 'course_not_found'; END IF;

  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES (v_user, 'get_course_feedback', p_course_id::text, '{}'::jsonb);

  RETURN v_result;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- الصلاحيات: authenticated فقط، ولا وصول لـ anon
-- ────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.set_session_module(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rename_course_module(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_course_module(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reorder_course_module(UUID, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_course_feedback(UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_session_module(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rename_course_module(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_course_module(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_course_module(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_course_feedback(UUID) TO authenticated;

-- فهرس مساعد لتجميع تغذية الكورس كاملًا بسرعة
CREATE INDEX IF NOT EXISTS idx_sessions_module ON public.sessions(module_id);
CREATE INDEX IF NOT EXISTS idx_course_modules_course_seq ON public.course_modules(course_id, seq);


-- ═══════════════════════════════════════════════════════════════════════════
-- 3/4) 0037_course_reports.sql — نص الترحيل حرفيًا من supabase/migrations/
-- ═══════════════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- 0037_course_reports.sql — تقرير الكورس: كتابة المنظّم ونشره (UX-C3)
--
-- الفجوة: كانت تقارير **المحاضرة** موجودة (close_training_session.report) وعرض
-- تقرير الكورس موجودًا للقراءة فقط (get_course_report: أرقام وإحصاءات)، لكن لا
-- توجد وسيلة لمنظّم الكورس أن **يكتب** تقريرًا سرديًا للكورس (ماذا تحقق، ما
-- التحديات، التوصيات) ولا أن ينشره للطلاب. هذه الميزة مطلوبة صراحة: «المنظّم له
-- سلطة كاملة على الكورس، يرى التغذية الراجعة، ويكتب تقارير الكورس».
--
-- ما يضيفه هذا الملف:
--   1) جدول course_reports — تقرير سردي (مسودة/منشور) لكل كورس أو دفعة.
--   2) save_course_report   — إنشاء/تحديث (كتابة مسودة أو نشر).
--   3) publish_course_report — نشر/إلغاء نشر بخطوة واحدة + خطوة إشعار للطلاب.
--   4) delete_course_report  — حذف التقرير (سلطة كاملة) مع تدقيق.
--   5) get_course_reports    — التقارير المتاحة للمستخدم: المنظّم يرى كل شيء،
--                              الطالب يرى **المنشور** فقط.
--   6) get_course_report_summary — ملخص مرقّم للتقرير (حضور/تغذية/تقييم/شهادات)
--                              ليُدرج في متن التقرير المكتوب بلا نسخ يدوي.
--
-- الأمان: كل الكتابة عبر RPCs مُدقَّقة، وRLS يمنع أي كتابة مباشرة من العميل.
-- ════════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════
-- 1) الجدول
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.course_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  -- تقرير لكورس كامل (NULL) أو لدفعة بعينها
  batch_id UUID REFERENCES public.batches(id) ON DELETE SET NULL,
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '' CHECK (char_length(title) <= 160),
  summary TEXT NOT NULL DEFAULT '' CHECK (char_length(summary) <= 4000),
  achievements TEXT NOT NULL DEFAULT '' CHECK (char_length(achievements) <= 4000),
  challenges TEXT NOT NULL DEFAULT '' CHECK (char_length(challenges) <= 4000),
  recommendations TEXT NOT NULL DEFAULT '' CHECK (char_length(recommendations) <= 4000),
  published BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_course_reports_course ON public.course_reports(course_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_course_reports_published ON public.course_reports(course_id, published) WHERE published;

-- ═══════════════════════════════════════════════════════════════
-- 2) RLS — قراءة من العميل؛ الكتابة عبر RPCs فقط
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.course_reports ENABLE ROW LEVEL SECURITY;

-- المنظّمون (مشرف/أدمن/مدير كورس) يرون كل التقارير، والطلاب يرون المنشور فقط.
DROP POLICY IF EXISTS course_reports_read ON public.course_reports;
CREATE POLICY course_reports_read ON public.course_reports
  FOR SELECT USING (
    public.is_manager()
    OR public.can_manage_course(course_id)
    OR author_id = public.my_profile_id()
    OR (
      published
      AND EXISTS (
        SELECT 1 FROM public.enrollments e
         JOIN public.batches b ON b.id = e.batch_id
        WHERE e.user_id = public.my_profile_id()
          AND b.course_id = course_reports.course_id
          AND e.status IN ('active', 'completed')
      )
    )
  );

GRANT SELECT ON public.course_reports TO authenticated;
REVOKE ALL ON public.course_reports FROM anon;

-- ═══════════════════════════════════════════════════════════════
-- 3) RPC: save_course_report — كتابة/تحديث (مسودة أو منشور)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.save_course_report(
  p_course_id UUID,
  p_report_id UUID DEFAULT NULL,
  p_batch_id UUID DEFAULT NULL,
  p_title TEXT DEFAULT '',
  p_summary TEXT DEFAULT '',
  p_achievements TEXT DEFAULT '',
  p_challenges TEXT DEFAULT '',
  p_recommendations TEXT DEFAULT '',
  p_publish BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.my_profile_id();
  v_id UUID;
  v_existing public.course_reports%ROWTYPE;
  v_published BOOLEAN := COALESCE(p_publish, FALSE);
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT (public.can_manage_course(p_course_id) OR public.is_manager())
  THEN RAISE EXCEPTION 'forbidden'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.courses WHERE id = p_course_id)
  THEN RAISE EXCEPTION 'course_not_found'; END IF;

  -- الدفعة (إن وُجدت) يجب أن تكون من نفس الكورس
  IF p_batch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.batches WHERE id = p_batch_id AND course_id = p_course_id
  ) THEN RAISE EXCEPTION 'batch_not_in_course'; END IF;

  IF char_length(COALESCE(p_title, '')) > 160
     OR char_length(COALESCE(p_summary, '')) > 4000
     OR char_length(COALESCE(p_achievements, '')) > 4000
     OR char_length(COALESCE(p_challenges, '')) > 4000
     OR char_length(COALESCE(p_recommendations, '')) > 4000
  THEN RAISE EXCEPTION 'content_too_long'; END IF;

  -- تقرير مُفرَغ تمامًا ولا يُنشَر ⇒ لا معنى لحفظه
  IF btrim(COALESCE(p_summary, '')) = ''
     AND btrim(COALESCE(p_achievements, '')) = ''
     AND btrim(COALESCE(p_challenges, '')) = ''
     AND btrim(COALESCE(p_recommendations, '')) = ''
     AND NOT v_published
  THEN RAISE EXCEPTION 'empty_report'; END IF;

  IF p_report_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.course_reports WHERE id = p_report_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'report_not_found'; END IF;
    IF v_existing.course_id <> p_course_id THEN RAISE EXCEPTION 'report_course_mismatch'; END IF;
    -- النشر يبقى قرارًا صريحًا: التحديث لا يُلغي النشر السابق إلا بطلب صريح.
    v_id := v_existing.id;
    UPDATE public.course_reports SET
      batch_id = p_batch_id,
      title = btrim(COALESCE(p_title, '')),
      summary = btrim(COALESCE(p_summary, '')),
      achievements = btrim(COALESCE(p_achievements, '')),
      challenges = btrim(COALESCE(p_challenges, '')),
      recommendations = btrim(COALESCE(p_recommendations, '')),
      published = v_published,
      published_at = CASE
        WHEN v_published AND NOT v_existing.published THEN now()
        WHEN v_published THEN COALESCE(v_existing.published_at, now())
        ELSE NULL
      END,
      updated_at = now()
    WHERE id = v_id;
  ELSE
    INSERT INTO public.course_reports(
      course_id, batch_id, author_id, title, summary, achievements, challenges,
      recommendations, published, published_at
    ) VALUES (
      p_course_id, p_batch_id, v_user, btrim(COALESCE(p_title, '')),
      btrim(COALESCE(p_summary, '')), btrim(COALESCE(p_achievements, '')),
      btrim(COALESCE(p_challenges, '')), btrim(COALESCE(p_recommendations, '')),
      v_published, CASE WHEN v_published THEN now() ELSE NULL END
    ) RETURNING id INTO v_id;
  END IF;

  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES (v_user, 'save_course_report', v_id::text,
          jsonb_build_object('course_id', p_course_id, 'published', v_published, 'is_update', p_report_id IS NOT NULL));

  RETURN jsonb_build_object('ok', TRUE, 'id', v_id, 'published', v_published);
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 4) RPC: publish_course_report — نشر/إلغاء نشر + إشعار الطلاب
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.publish_course_report(p_report_id UUID, p_publish BOOLEAN DEFAULT TRUE)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.my_profile_id();
  v_report public.course_reports%ROWTYPE;
  v_course_title TEXT;
  v_notified INTEGER := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;

  SELECT * INTO v_report FROM public.course_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'report_not_found'; END IF;
  IF NOT (public.can_manage_course(v_report.course_id) OR public.is_manager())
  THEN RAISE EXCEPTION 'forbidden'; END IF;

  UPDATE public.course_reports SET
    published = COALESCE(p_publish, TRUE),
    published_at = CASE WHEN COALESCE(p_publish, TRUE) THEN COALESCE(published_at, now()) ELSE NULL END,
    updated_at = now()
  WHERE id = p_report_id;

  -- إشعار مرة واحدة فقط لكل طالب عند النشر (dedupe_key يمنع التكرار)
  IF COALESCE(p_publish, TRUE) THEN
    SELECT title INTO v_course_title FROM public.courses WHERE id = v_report.course_id;
    INSERT INTO public.notifications(user_id, title, body, type, dedupe_key)
    SELECT DISTINCT e.user_id,
           'تقرير الكورس جاهز 📘',
           COALESCE(NULLIF(btrim(v_course_title), ''), 'كورسك') || ' — اقرأ ملخص النتائج والتوصيات.',
           -- 'system' هو النوع المسموح في قيد notifications.type (0001) — لا نوسّع القيد بلا داعٍ.
           'system',
           'course-report:' || p_report_id::text || ':' || e.user_id::text
      FROM public.enrollments e
      JOIN public.batches b ON b.id = e.batch_id
     WHERE b.course_id = v_report.course_id
       AND e.status IN ('active', 'completed')
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_notified = ROW_COUNT;
  END IF;

  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES (v_user, 'publish_course_report', p_report_id::text,
          jsonb_build_object('published', COALESCE(p_publish, TRUE), 'notified', v_notified));

  RETURN jsonb_build_object('ok', TRUE, 'published', COALESCE(p_publish, TRUE), 'notified', v_notified);
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 5) RPC: delete_course_report — سلطة كاملة مع تدقيق
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.delete_course_report(p_report_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.my_profile_id();
  v_report public.course_reports%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;

  SELECT * INTO v_report FROM public.course_reports WHERE id = p_report_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'report_not_found'; END IF;
  IF NOT (public.can_manage_course(v_report.course_id) OR public.is_manager())
  THEN RAISE EXCEPTION 'forbidden'; END IF;

  DELETE FROM public.course_reports WHERE id = p_report_id;

  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES (v_user, 'delete_course_report', p_report_id::text,
          jsonb_build_object('course_id', v_report.course_id, 'was_published', v_report.published));

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 6) RPC: get_course_reports — ما يراه المستخدم حسب دوره
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_course_reports(p_course_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.my_profile_id();
  v_can_manage BOOLEAN;
  v_enrolled BOOLEAN;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;

  v_can_manage := public.can_manage_course(p_course_id) OR public.is_manager();
  v_enrolled := EXISTS (
    SELECT 1 FROM public.enrollments e
      JOIN public.batches b ON b.id = e.batch_id
     WHERE e.user_id = v_user AND b.course_id = p_course_id
       AND e.status IN ('active', 'completed')
  );

  IF NOT (v_can_manage OR v_enrolled) THEN RAISE EXCEPTION 'forbidden'; END IF;

  RETURN jsonb_build_object(
    'can_manage', v_can_manage,
    'reports', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', r.id, 'course_id', r.course_id, 'batch_id', r.batch_id,
               'author_id', r.author_id, 'author_name', COALESCE(p.full_name, ''),
               'title', r.title, 'summary', r.summary, 'achievements', r.achievements,
               'challenges', r.challenges, 'recommendations', r.recommendations,
               'published', r.published, 'published_at', r.published_at,
               'created_at', r.created_at, 'updated_at', r.updated_at,
               'batch_room', COALESCE(b.room, '')
             ) ORDER BY r.created_at DESC)
        FROM public.course_reports r
        LEFT JOIN public.profiles p ON p.id = r.author_id
        LEFT JOIN public.batches b ON b.id = r.batch_id
       WHERE r.course_id = p_course_id
         AND (v_can_manage OR r.published)
    ), '[]'::jsonb)
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 7) RPC: get_course_report_summary — ملخص رقمي يُدرج داخل التقرير
--    (نفس أرقام get_course_report لكن مختصرة للنص السردي)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_course_report_summary(p_course_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.my_profile_id();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT (public.can_manage_course(p_course_id) OR public.is_manager())
  THEN RAISE EXCEPTION 'forbidden'; END IF;

  RETURN jsonb_build_object(
    'course', (SELECT jsonb_build_object('id', id, 'title', title) FROM public.courses WHERE id = p_course_id),
    'batches', (SELECT count(*) FROM public.batches WHERE course_id = p_course_id),
    'sessions_total', (SELECT count(*) FROM public.sessions s JOIN public.batches b ON b.id = s.batch_id WHERE b.course_id = p_course_id),
    'sessions_closed', (SELECT count(*) FROM public.sessions s JOIN public.batches b ON b.id = s.batch_id WHERE b.course_id = p_course_id AND s.status = 'closed'),
    'students', (SELECT count(DISTINCT e.user_id) FROM public.enrollments e JOIN public.batches b ON b.id = e.batch_id WHERE b.course_id = p_course_id AND e.status IN ('active', 'completed')),
    'certificates', (SELECT count(*) FROM public.certificates c WHERE c.course_id = p_course_id AND c.status = 'valid'),
    'attendance', (SELECT jsonb_build_object(
        'total', count(*),
        'present', count(*) FILTER (WHERE a.status = 'present'),
        'late', count(*) FILTER (WHERE a.status = 'late'),
        'absent', count(*) FILTER (WHERE a.status = 'absent'),
        'excused', count(*) FILTER (WHERE a.status = 'excused'))
      FROM public.attendance a
      JOIN public.sessions s ON s.id = a.session_id
      JOIN public.batches b ON b.id = s.batch_id
      WHERE b.course_id = p_course_id),
    'learning', (SELECT jsonb_build_object(
        'responses', count(*),
        'avg_understanding', COALESCE(round(avg(f.understanding)::numeric, 2), 0),
        'avg_pace', COALESCE(round(avg(f.pace)::numeric, 2), 0),
        'avg_clarity', COALESCE(round(avg(f.clarity)::numeric, 2), 0))
      FROM public.session_feedback f
      JOIN public.sessions s ON s.id = f.session_id
      JOIN public.batches b ON b.id = s.batch_id
      WHERE b.course_id = p_course_id),
    'ratings', jsonb_build_object(
      'count', (SELECT count(*) FROM public.course_ratings WHERE course_id = p_course_id),
      'avg', (SELECT COALESCE(round(avg(stars)::numeric, 2), 0) FROM public.course_ratings WHERE course_id = p_course_id)),
    'missing_reports', (SELECT count(*) FROM public.sessions s JOIN public.batches b ON b.id = s.batch_id
                         WHERE b.course_id = p_course_id AND s.status = 'closed'
                           AND (s.report IS NULL OR COALESCE(btrim(s.report->>'done'), '') = ''))
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 8) الصلاحيات
-- ═══════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION public.save_course_report(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.publish_course_report(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_course_report(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_course_reports(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_course_report_summary(UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.save_course_report(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_course_report(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_course_report(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_course_reports(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_course_report_summary(UUID) TO authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4/4) 0038_more_badges.sql — نص الترحيل حرفيًا من supabase/migrations/
-- ═══════════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════════════
-- 0038_more_badges.sql — شارات أكثر + تقدّم صادق + تقييم كامل للشارات.
--
-- لماذا هذا الترحيل؟
--   (1) كانت 12 شارة معرَّفة و8 فقط قابلة للكسب فعليًا. `month_star`,
--       `top_scorer`, `climber` معرَّفة في 0001 ومذكورة في العميل، لكن
--       `evaluate_user_badges` لا تمنحها أبدًا ⇒ شارات ميتة.
--   (2) كرت «أقرب شارة» يحتاج **هدفًا ووحدة قياس** ليصدق مع المستخدم
--       («باقي 3 محاضرات») بدل أن يُظهر رقمًا مُخمَّنًا. لذلك نضيف
--       عمودَي `target` و `metric` إلى جدول التعريفات.
--   (3) نضيف 4 شارات جديدة تغطي سلوكيات حقيقية في التطبيق: التغذية الراجعة،
--       الماراثون الأسبوعي، العودة بعد انقطاع، وسلسلة 12 أسبوعًا.
--
-- هذا الملف **بيانات مرجعية + منطق** فقط: لا يُنشئ فرعًا أو كورسًا أو مستخدمًا.
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- 1. هدف الشارة ووحدة قياسها (للعرض الصادق في كرت «أقرب شارة»)
-- ---------------------------------------------------------------------------
-- ───────────────────────────────────────────────────────────────────────────
-- ⚠️ تحقّق مسبق: 0038 يعتمد على جدول session_feedback (من 0035) وعلى العمود
-- certificates.status (من 0020). بدونهما كان الترحيل يفشل بخطأ غامض:
--     ERROR: 42P01: relation "public.session_feedback" does not exist
-- لمعرفة أول ترحيل ناقص: شغّل supabase/diagnostics/migration_level.sql
-- ───────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.session_feedback') IS NULL THEN
    RAISE EXCEPTION 'MASAR 0038 needs migration 0035 first (session_feedback table). Required order: 0035 -> 0036 -> 0037 -> 0038.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'certificates' AND column_name = 'status'
  ) THEN
    RAISE EXCEPTION 'MASAR 0038 needs migration 0020 first (certificates.status column).';
  END IF;
END $$;

ALTER TABLE public.badges ADD COLUMN IF NOT EXISTS target INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.badges ADD COLUMN IF NOT EXISTS metric TEXT NOT NULL DEFAULT 'attendance';
DO $$ BEGIN
  ALTER TABLE public.badges ADD CONSTRAINT badges_metric_check
    CHECK (metric IN ('attendance','weeks','certificates','ratings','feedback','kudos','rank'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

UPDATE public.badges SET target = 1,  metric = 'attendance'   WHERE code = 'first_step';
UPDATE public.badges SET target = 4,  metric = 'attendance'   WHERE code = 'consistent';
UPDATE public.badges SET target = 10, metric = 'attendance'   WHERE code = 'early_bird';
UPDATE public.badges SET target = 4,  metric = 'attendance'   WHERE code = 'perfection';
UPDATE public.badges SET target = 8,  metric = 'weeks'        WHERE code = 'super_streak';
UPDATE public.badges SET target = 1,  metric = 'rank'         WHERE code = 'month_star';
UPDATE public.badges SET target = 1,  metric = 'rank'         WHERE code = 'top_scorer';
UPDATE public.badges SET target = 1,  metric = 'rank'         WHERE code = 'climber';
UPDATE public.badges SET target = 1,  metric = 'certificates' WHERE code = 'cert_hunter';
UPDATE public.badges SET target = 3,  metric = 'certificates' WHERE code = 'pro_expert';
UPDATE public.badges SET target = 3,  metric = 'ratings'      WHERE code = 'honest_reviewer';

-- ---------------------------------------------------------------------------
-- 2. شارات جديدة (مبنية على بيانات موجودة فعلًا: feedback / حضور / أسابيع)
-- ---------------------------------------------------------------------------
INSERT INTO public.badges
  (code,name_ar,name_en,desc_ar,desc_en,rarity,icon,active,target,metric)
VALUES
  ('feedback_star','نجم التغذية الراجعة','Feedback Star',
   '10 تقييمات لمحاضراتك','10 lecture feedbacks given','common','create',true,10,'feedback'),
  ('marathon','الماراثون','Marathon',
   '5 محاضرات في أسبوع واحد','5 sessions in a single week','rare','bicycle',true,5,'attendance'),
  ('comeback','العودة القوية','Comeback',
   'رجعت بعد انقطاع أسبوعين','Came back after a two-week gap','rare','refresh',true,1,'attendance'),
  ('streak_12','الأسطورة الحيّة','Living Legend',
   '12 أسبوع التزام متتالي','12 consecutive committed weeks','legendary','rocket',true,12,'weeks')
ON CONFLICT(code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. تقييم كامل للشارات: كل شارة نشطة لها شرط حقيقي (لا شارة ميتة).
--    `month_star` و`top_scorer` و`climber` صارت قابلة للكسب من بيانات الدوري.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.evaluate_user_badges(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_count INTEGER;
BEGIN
  WITH candidates(code) AS (
    SELECT 'first_step' WHERE EXISTS(
      SELECT 1 FROM public.attendance WHERE user_id=p_user_id AND status<>'absent')
    UNION ALL SELECT 'consistent' WHERE EXISTS(
      SELECT 1 FROM public.batches b WHERE (
        SELECT count(*)=4 AND bool_and(x.status<>'absent') FROM (
          SELECT a.status FROM public.sessions s JOIN public.attendance a ON a.session_id=s.id AND a.user_id=p_user_id
          WHERE s.batch_id=b.id AND s.status='closed' ORDER BY s.starts_at DESC LIMIT 4
        ) x
      ))
    UNION ALL SELECT 'early_bird' WHERE (
      SELECT count(*) FROM public.attendance a JOIN public.sessions s ON s.id=a.session_id
      WHERE a.user_id=p_user_id AND a.status='present' AND a.checked_in_at<s.starts_at)>=10
    UNION ALL SELECT 'super_streak' WHERE COALESCE((
      SELECT current_streak_weeks FROM public.gamification WHERE user_id=p_user_id),0)>=8
    UNION ALL SELECT 'streak_12' WHERE COALESCE((
      SELECT current_streak_weeks FROM public.gamification WHERE user_id=p_user_id),0)>=12
    UNION ALL SELECT 'perfection' WHERE EXISTS(
      SELECT 1 FROM public.enrollments e JOIN public.sessions s ON s.batch_id=e.batch_id AND s.status='closed'
      LEFT JOIN public.attendance a ON a.session_id=s.id AND a.user_id=e.user_id
      WHERE e.user_id=p_user_id
      GROUP BY date_trunc('month',s.starts_at AT TIME ZONE 'Africa/Cairo')
      HAVING count(DISTINCT s.id)>=4
        AND count(DISTINCT s.id) FILTER(WHERE a.status IS NOT NULL AND a.status<>'absent')=count(DISTINCT s.id)
    )
    UNION ALL SELECT 'cert_hunter' WHERE (SELECT count(*) FROM public.certificates
      WHERE user_id=p_user_id AND status='active')>=1
    UNION ALL SELECT 'pro_expert' WHERE (SELECT count(*) FROM public.certificates
      WHERE user_id=p_user_id AND status='active')>=3
    UNION ALL SELECT 'honest_reviewer' WHERE (SELECT count(*) FROM public.course_ratings
      WHERE user_id=p_user_id)>=3
    UNION ALL SELECT 'feedback_star' WHERE (SELECT count(*) FROM public.session_feedback
      WHERE user_id=p_user_id)>=10
    -- الماراثون: 5 حضورات داخل نفس الأسبوع الميلادي (بداية الأحد بتوقيت القاهرة)
    UNION ALL SELECT 'marathon' WHERE EXISTS(
      SELECT 1 FROM public.attendance a JOIN public.sessions s ON s.id=a.session_id
      WHERE a.user_id=p_user_id AND a.status<>'absent'
      GROUP BY date_trunc('week', s.starts_at AT TIME ZONE 'Africa/Cairo')
      HAVING count(*)>=5
    )
    -- العودة القوية: حضوران بينهما 14 يومًا أو أكثر، والأحدث خلال 30 يومًا
    UNION ALL SELECT 'comeback' WHERE EXISTS(
      SELECT 1 FROM (
        SELECT s.starts_at,
               lag(s.starts_at) OVER (ORDER BY s.starts_at) AS prev_at,
               row_number() OVER (ORDER BY s.starts_at DESC) AS recency
        FROM public.attendance a JOIN public.sessions s ON s.id=a.session_id
        WHERE a.user_id=p_user_id AND a.status<>'absent'
      ) t
      WHERE t.prev_at IS NOT NULL
        AND t.starts_at - t.prev_at >= INTERVAL '14 days'
        AND t.recency=1
        AND t.starts_at >= now() - INTERVAL '30 days'
    )
    -- المتصدر: المركز الأول في دوري أسبوعه الحالي (فئته)
    UNION ALL SELECT 'top_scorer' WHERE (
      SELECT count(*) FROM (
        SELECT p.id, row_number() OVER (ORDER BY COALESCE(sum(pe.points),0) DESC) AS rn
        FROM public.profiles p
        LEFT JOIN public.gamification gp ON gp.user_id=p.id
        LEFT JOIN public.point_events pe ON pe.user_id=p.id
          AND pe.created_at >= date_trunc('week', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo'
        WHERE p.role='student' AND p.status='active'
        GROUP BY p.id, gp.league_tier
        HAVING gp.league_tier = COALESCE((
          SELECT league_tier FROM public.gamification WHERE user_id=p_user_id),'bronze')
      ) ranked WHERE ranked.id=p_user_id AND ranked.rn=1
    )=1
    -- الصاعد: سجل ترقية فعلية في سجل الدوريات
    UNION ALL SELECT 'climber' WHERE EXISTS(
      SELECT 1 FROM public.league_weeks WHERE user_id=p_user_id AND outcome='promoted'
    )
    -- نجم الشهر: أعلى نقاط الشهر الحالي في فرعه (بحد أدنى نقاط يمنع الفوز بمجموعة فارغة)
    UNION ALL SELECT 'month_star' WHERE (
      SELECT count(*) FROM (
        SELECT p.id, row_number() OVER (ORDER BY COALESCE(sum(pe.points),0) DESC) AS rn
        FROM public.profiles p
        JOIN public.point_events pe ON pe.user_id=p.id
          AND date_trunc('month', pe.created_at AT TIME ZONE 'Africa/Cairo')
            = date_trunc('month', now() AT TIME ZONE 'Africa/Cairo')
        WHERE p.role='student' AND p.status='active'
          AND p.branch_id IS NOT DISTINCT FROM (
            SELECT branch_id FROM public.profiles WHERE id=p_user_id)
        GROUP BY p.id
        HAVING COALESCE(sum(pe.points),0) > 0
      ) ranked WHERE ranked.id=p_user_id AND ranked.rn=1
    )=1
  ), inserted AS (
    INSERT INTO public.user_badges(user_id,badge_code)
    SELECT p_user_id,c.code FROM candidates c JOIN public.badges b ON b.code=c.code AND b.active
    ON CONFLICT(user_id,badge_code) DO NOTHING RETURNING badge_code
  ), notified AS (
    INSERT INTO public.notifications(user_id,title,body,type,dedupe_key)
    SELECT p_user_id,'شارة جديدة 🎉',b.name_ar,'badge','badge:'||p_user_id||':'||i.badge_code
    FROM inserted i JOIN public.badges b ON b.code=i.badge_code
    ON CONFLICT(dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING 1
  ) SELECT count(*) INTO v_count FROM inserted;
  RETURN v_count;
END;
$$;

-- ⚠️ أمان: هذه الدالة تستقبل `p_user_id` لأي مستخدم، لذلك تبقى **داخلية فقط**:
-- تُستدعى من دوال التسوية (SECURITY DEFINER) ومن service_role، ولا تُمنح
-- للمستخدم المُسجَّل — وإلا استطاع أي طالب تشغيلها على معرّف غيره.
REVOKE ALL ON FUNCTION public.evaluate_user_badges(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_user_badges(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. تقدّم الشارة للعميل: أرقام حقيقية (current/target) لا نسب مُخمَّنة.
--    تُستخدم في كرت «أقرب شارة» وفي شاشة الإنجازات.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_badge_progress()
RETURNS TABLE(
  code TEXT, current INTEGER, target INTEGER, progress NUMERIC,
  metric TEXT, earned BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH me AS (SELECT auth.uid() AS uid),
  my_att AS (
    SELECT count(*)::INTEGER AS n FROM public.attendance a, me
    WHERE a.user_id=me.uid AND a.status<>'absent'
  ),
  my_early AS (
    SELECT count(*)::INTEGER AS n FROM public.attendance a
    JOIN public.sessions s ON s.id=a.session_id, me
    WHERE a.user_id=me.uid AND a.status='present' AND a.checked_in_at < s.starts_at
  ),
  my_certs AS (
    SELECT count(*)::INTEGER AS n FROM public.certificates c, me
    WHERE c.user_id=me.uid AND c.status='active'
  ),
  my_ratings AS (
    SELECT count(*)::INTEGER AS n FROM public.course_ratings r, me WHERE r.user_id=me.uid
  ),
  my_feedback AS (
    SELECT count(*)::INTEGER AS n FROM public.session_feedback f, me WHERE f.user_id=me.uid
  ),
  my_streak AS (
    SELECT COALESCE(g.current_streak_weeks,0)::INTEGER AS n FROM me
    LEFT JOIN public.gamification g ON g.user_id=me.uid
  ),
  best_streak AS (
    SELECT COALESCE(max(x.run),0)::INTEGER AS n FROM (
      SELECT count(*) FILTER (WHERE a.status IS NOT NULL AND a.status<>'absent') AS run
      FROM public.sessions s
      LEFT JOIN public.attendance a ON a.session_id=s.id
      JOIN me ON a.user_id=me.uid
      WHERE s.status='closed'
      GROUP BY s.batch_id
    ) x
  ),
  best_week AS (
    SELECT COALESCE(max(cnt),0)::INTEGER AS n FROM (
      SELECT count(*) AS cnt FROM public.attendance a
      JOIN public.sessions s ON s.id=a.session_id, me
      WHERE a.user_id=me.uid AND a.status<>'absent'
      GROUP BY date_trunc('week', s.starts_at AT TIME ZONE 'Africa/Cairo')
    ) w
  ),
  earned AS (SELECT ub.badge_code FROM public.user_badges ub, me WHERE ub.user_id=me.uid),
  computed(code,current,target) AS (
    SELECT 'first_step',      (SELECT n FROM my_att),      1
    UNION ALL SELECT 'consistent',     (SELECT n FROM best_streak), 4
    UNION ALL SELECT 'early_bird',     (SELECT n FROM my_early),    10
    UNION ALL SELECT 'perfection',     (SELECT n FROM best_streak), 4
    UNION ALL SELECT 'super_streak',   (SELECT n FROM my_streak),   8
    UNION ALL SELECT 'streak_12',      (SELECT n FROM my_streak),   12
    UNION ALL SELECT 'cert_hunter',    (SELECT n FROM my_certs),    1
    UNION ALL SELECT 'pro_expert',     (SELECT n FROM my_certs),    3
    UNION ALL SELECT 'honest_reviewer',(SELECT n FROM my_ratings),  3
    UNION ALL SELECT 'feedback_star',  (SELECT n FROM my_feedback), 10
    UNION ALL SELECT 'marathon',       (SELECT n FROM best_week),   5
    UNION ALL SELECT 'comeback',       0,                           1
    UNION ALL SELECT 'top_scorer',     0,                           1
    UNION ALL SELECT 'climber',        0,                           1
    UNION ALL SELECT 'month_star',     0,                           1
  )
  SELECT b.code,
         LEAST(GREATEST(COALESCE(c.current,0),0), b.target) AS current,
         b.target,
         ROUND((LEAST(GREATEST(COALESCE(c.current,0),0), b.target)::NUMERIC / GREATEST(b.target,1)), 4) AS progress,
         b.metric,
         (e.badge_code IS NOT NULL) AS earned
  FROM public.badges b
  LEFT JOIN computed c ON c.code=b.code
  LEFT JOIN earned e ON e.badge_code=b.code
  WHERE b.active
  ORDER BY (e.badge_code IS NOT NULL) DESC, progress DESC, b.code;
$$;

REVOKE ALL ON FUNCTION public.my_badge_progress() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_badge_progress() TO authenticated, service_role;


-- ── 5) التحقّق النهائي — المفروض تشوف صف واحد فيه ✅ ─────────────────────────
SELECT
  (SELECT count(*) FROM public.badges) AS "عدد الشارات (المتوقّع 16)",
  (SELECT count(*) FROM public.badges WHERE code IN ('streak_12','feedback_star','marathon','comeback'))
    AS "الشارات الجديدة الأربعة (المتوقّع 4)",
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'badges' AND column_name IN ('target','metric'))
    AS "أعمدة badges الجديدة (المتوقّع 2)",
  to_regclass('public.course_modules')::text   AS "جدول course_modules",
  to_regclass('public.session_feedback')::text AS "جدول session_feedback",
  to_regclass('public.course_reports')::text   AS "جدول course_reports",
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'module_id')
    AS "عمود sessions.module_id (المتوقّع 1)",
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'evaluate_user_badges')
    AS "دالة evaluate_user_badges",
  CASE
    WHEN (SELECT count(*) FROM public.badges) >= 16
     AND to_regclass('public.course_modules') IS NOT NULL
     AND to_regclass('public.session_feedback') IS NOT NULL
     AND to_regclass('public.course_reports') IS NOT NULL
    THEN '✅ الترحيلات 0035 → 0038 مطبَّقة — مبروك'
    ELSE '❌ ناقص — ابعت لي نتيجة الاستعلام ده'
  END AS "الحالة";

-- ── (اختياري) امنح الشارات المستحقة للمستخدمين الحاليين مرة واحدة ─────────────
--     الشارات الجديدة (marathon / comeback / streak_12 / feedback_star) والثلاثة
--     المُحيَوا (month_star / top_scorer / climber) لا تُمنح تلقائيًا لمستخدم قديم
--     إلا بعد أول تقييم. نفّذ السطر التالي بعد الملف لو عايزها فورًا:
-- SELECT public.evaluate_user_badges(id) FROM public.profiles WHERE role = 'student' AND status = 'active';
