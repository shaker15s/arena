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

BEGIN;

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
                                 * (SELECT count(*) FROM public.sessions s2 WHERE s2.batch_id = b.id AND s2.status = 'closed'), 0), 0)
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

COMMIT;
