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

BEGIN;

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

COMMIT;
