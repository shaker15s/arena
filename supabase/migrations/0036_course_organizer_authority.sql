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
