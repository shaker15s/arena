-- MASAR 3.2 — 0031: نظام حضور الكورس (حضوري/أونلاين/هجين) + رقم المنظم
--               + seed كورس «شبكات الحاسب» (Computer Network) — سبتمبر 2026.
--
-- لماذا هذا الملف؟
--   1) الكورسات محتاجة تعرف هي حضوري في المقر (offline) ولا أونلاين —
--      والشاشات محتاجة تعرض ده للطالب قبل ما يسجل.
--   2) المنظم بيحتاج رقم موبايل واضح للطلبة يتصلوا بيه (كان مكتوب في الوصف
--      بشكل يدوي ومش موحّد).
--   3) `create_course` و `update_course_details` كانوا في 0023 بباراميترات
--      (`p_code`, `p_desc`) مش موجودة في مخطط الجداول ولا في نداء العميل، يعني
--      «إضافة/تعديل كورس» من التطبيق بيفشل. الملف ده يعيد تعريفهم بنفس عقد
--      العميل في 0005/0018 + الباراميترات الجديدة (اختيارية بقيم افتراضية).
--   4) seed بيانات كورس «شبكات الحاسب» الفعلي: 4 محاضرات يوم الاتنين
--      7/14/21/28 سبتمبر 2026 الساعة 6:30 مساءً، المدرب أحمد رجب،
--      رقم المنظم 01125028050، حضور حضوري (offline).
--
-- الملف idempotent: تشغيله أكتر من مرة ما بيعملش تكرار.

BEGIN;

-- ═══════════════════════════════════════════════════════════════
-- 1) المخطط: حقول جديدة
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS delivery_mode TEXT NOT NULL DEFAULT 'offline';
ALTER TABLE public.courses DROP CONSTRAINT IF EXISTS courses_delivery_mode_check;
ALTER TABLE public.courses ADD CONSTRAINT courses_delivery_mode_check
  CHECK (delivery_mode IN ('offline', 'online', 'hybrid'));

ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS organizer_phone TEXT;
ALTER TABLE public.courses DROP CONSTRAINT IF EXISTS courses_organizer_phone_check;
ALTER TABLE public.courses ADD CONSTRAINT courses_organizer_phone_check
  CHECK (organizer_phone IS NULL OR organizer_phone ~ '^[0-9+]{8,20}$');

-- اسم المدرب كنص عرض احتياطي: بعض المدربين لسه معندهاش profile (ميسجّلوش
-- بـ Google)، فمن غير الحقل ده اسم المدرب يختفي من كل الشاشات.
ALTER TABLE public.batches ADD COLUMN IF NOT EXISTS trainer_name TEXT;

COMMENT ON COLUMN public.courses.delivery_mode IS 'offline = حضوري في المقر · online = أونلاين · hybrid = هجين';
COMMENT ON COLUMN public.courses.organizer_phone IS 'رقم موبايل المنظم للتواصل (يظهر للطلبة)';

-- ═══════════════════════════════════════════════════════════════
-- 2) مساعد مشترك (idempotent — كان متعرّف في 0004/0023)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.my_role() IN ('admin', 'supervisor', 'volunteer');
$$;
REVOKE ALL ON FUNCTION public.is_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 3) create_course — بنفس عقد العميل + delivery_mode + organizer_phone
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_course(
  p_committee_id UUID,
  p_title TEXT,
  p_field TEXT,
  p_description TEXT,
  p_topics TEXT[],
  p_sessions_count INTEGER,
  p_color TEXT DEFAULT '#4F46E5',
  p_delivery_mode TEXT DEFAULT 'offline',
  p_organizer_phone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := public.my_profile_id();
  v_id UUID;
  v_mode TEXT := lower(btrim(COALESCE(p_delivery_mode, 'offline')));
  v_phone TEXT := NULLIF(regexp_replace(COALESCE(p_organizer_phone, ''), '[^0-9+]', '', 'g'), '');
BEGIN
  IF NOT public.is_staff() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_committee_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.committees WHERE id = p_committee_id) THEN
    RAISE EXCEPTION 'invalid_committee';
  END IF;
  IF char_length(btrim(COALESCE(p_title, ''))) NOT BETWEEN 3 AND 160
     OR char_length(btrim(COALESCE(p_field, ''))) NOT BETWEEN 2 AND 100
     OR char_length(COALESCE(p_description, '')) > 4000
     OR p_sessions_count NOT BETWEEN 1 AND 100
     OR p_color !~ '^#[0-9A-Fa-f]{6}$'
     OR v_mode NOT IN ('offline', 'online', 'hybrid')
     OR (v_phone IS NOT NULL AND v_phone !~ '^[0-9+]{8,20}$')
  THEN RAISE EXCEPTION 'invalid_course'; END IF;

  INSERT INTO public.courses(committee_id, title, field, description, topics, sessions_count, status, color,
                             delivery_mode, organizer_phone)
  VALUES(p_committee_id, btrim(p_title), btrim(p_field), NULLIF(btrim(p_description), ''),
         COALESCE(p_topics, '{}'), p_sessions_count, 'published', upper(p_color),
         v_mode, v_phone)
  RETURNING id INTO v_id;

  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES(v_actor, 'create_course', v_id::text,
    jsonb_build_object('title', btrim(p_title), 'sessions_count', p_sessions_count,
                       'delivery_mode', v_mode, 'organizer_phone', v_phone));

  RETURN jsonb_build_object('ok', TRUE, 'id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.create_course(uuid,text,text,text,text[],integer,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_course(uuid,text,text,text,text[],integer,text,text,text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 4) update_course_details — نفس عقد العميل + الحقول الجديدة
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.update_course_details(
  p_course_id UUID,
  p_title TEXT,
  p_field TEXT,
  p_description TEXT,
  p_topics TEXT[],
  p_sessions_count INTEGER,
  p_color TEXT DEFAULT NULL,
  p_delivery_mode TEXT DEFAULT NULL,
  p_organizer_phone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := public.my_profile_id();
  v_old TEXT;
  v_mode TEXT := lower(btrim(COALESCE(p_delivery_mode, '')));
  v_phone TEXT := NULLIF(regexp_replace(COALESCE(p_organizer_phone, ''), '[^0-9+]', '', 'g'), '');
BEGIN
  IF NOT (public.is_manager() OR public.can_manage_course(p_course_id)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF char_length(btrim(COALESCE(p_title, ''))) NOT BETWEEN 3 AND 160
     OR char_length(btrim(COALESCE(p_field, ''))) NOT BETWEEN 2 AND 100
     OR char_length(COALESCE(p_description, '')) > 4000
     OR p_sessions_count NOT BETWEEN 1 AND 100
     OR (p_color IS NOT NULL AND p_color !~ '^#[0-9A-Fa-f]{6}$')
     OR (v_mode <> '' AND v_mode NOT IN ('offline', 'online', 'hybrid'))
     OR (v_phone IS NOT NULL AND v_phone !~ '^[0-9+]{8,20}$')
     OR NOT EXISTS (SELECT 1 FROM public.courses WHERE id = p_course_id)
  THEN RAISE EXCEPTION 'invalid_course'; END IF;

  SELECT title INTO v_old FROM public.courses WHERE id = p_course_id;

  UPDATE public.courses
    SET title = btrim(p_title),
        field = btrim(p_field),
        description = NULLIF(btrim(p_description), ''),
        topics = COALESCE(p_topics, '{}'),
        sessions_count = p_sessions_count,
        color = COALESCE(upper(p_color), color),
        delivery_mode = CASE WHEN v_mode = '' THEN delivery_mode ELSE v_mode END,
        organizer_phone = CASE WHEN p_organizer_phone IS NULL THEN organizer_phone ELSE v_phone END,
        updated_at = now()
  WHERE id = p_course_id;

  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES(v_actor, 'update_course', p_course_id::text,
    jsonb_build_object('old_title', v_old, 'title', btrim(p_title),
                       'sessions_count', p_sessions_count,
                       'delivery_mode', v_mode, 'organizer_phone', v_phone));

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.update_course_details(uuid,text,text,text,text[],integer,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_course_details(uuid,text,text,text,text[],integer,text,text,text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 5) seed: كورس «شبكات الحاسب» — 4 محاضرات، الاتنين، 6:30 مساءً
--    من 7 سبتمبر لـ 28 سبتمبر 2026 — حضوري (offline)
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_course_id   UUID;
  v_batch_id    UUID;
  v_branch_id   UUID;
  v_instructor  UUID;
  v_join_code   TEXT := 'MSR-NET2026';
  v_title       TEXT := 'شبكات الحاسب';
  v_field       TEXT := 'الشبكات وتكنولوجيا المعلومات';
  v_room        TEXT := 'قاعة الشبكات';
  v_tz          TEXT := 'Africa/Cairo';   -- بدّلها لو الفرع في دولة تانية
  v_duration    INTEGER := 120;
  v_capacity    INTEGER := 25;
  v_phone       TEXT := '01125028050';
  v_trainer     TEXT := 'أحمد رجب';
  v_dates       DATE[] := ARRAY['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']::DATE[];
  v_topics      TEXT[] := ARRAY[
    'مقدمة في شبكات الحاسب: الأنواع (LAN/WAN) ونماذج OSI و TCP/IP',
    'وسائط الإرسال وأجهزة الشبكة: كابلات Ethernet والسويتش والراوتر ونقطة الوصول',
    'العنونة: IPv4 و IPv6 وأقنعة الشبكات الفرعية (Subnetting)',
    'تطبيق عملي: إعداد الواي فاي والتوجيه وأساسيات أمن الشبكة وحل المشكلات'
  ];
  v_desc        TEXT :=
    'كورس شبكات الحاسب (Computer Network) — 4 محاضرات عملية يوم الاتنين من كل أسبوع، '
    'الساعة 6:30 مساءً، من الاثنين 7 سبتمبر حتى الاثنين 28 سبتمبر 2026. '
    'الحضور حضوري (offline) في مقر الفرع. '
    'المدرب: أحمد رجب. للاستفسار والتسجيل: المنظم 01125028050.';
  v_start       TIMESTAMPTZ;
  v_session     UUID;
  i             INTEGER;
BEGIN
  -- الفرع: أول فرع فعّال (الكورس لازم يتبع فرع)
  SELECT id INTO v_branch_id FROM public.branches WHERE status = 'active' ORDER BY created_at LIMIT 1;
  IF v_branch_id IS NULL THEN
    SELECT id INTO v_branch_id FROM public.branches ORDER BY created_at LIMIT 1;
  END IF;
  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'no_branch: أنشئ فرعًا من التطبيق (إعدادات الفرع) قبل تشغيل الـ seed';
  END IF;

  -- المدرب: ندوّر على profile مطابق لـ «أحمد رجب» (بيتجاهل المسافات ويوحّد
  -- الألف). لو لسه مسجّلش بحساب Google، الباتش يفضل شغّال واسم المدرب يظهر
  -- من batches.trainer_name.
  SELECT p.id INTO v_instructor
  FROM public.profiles p
  WHERE p.status = 'active'
    AND p.role IN ('volunteer', 'supervisor', 'admin')
    AND regexp_replace(translate(lower(COALESCE(p.full_name, '')), 'أإآ', 'ااا'),
                       '[[:space:]\-_.]', '', 'g')
        ~ '(احمد.*رجب|رجب.*احمد|ahmadragab|ahmedragab)'
  ORDER BY (regexp_replace(translate(lower(COALESCE(p.full_name, '')), 'أإآ', 'ااا'),
                           '[[:space:]\-_.]', '', 'g')
            ~ '(احمد.*رجب|رجب.*احمد|ahmadragab|ahmedragab)') DESC,
           p.joined_at ASC
  LIMIT 1;

  IF v_instructor IS NULL THEN
    RAISE NOTICE 'تنبيه: مفيش profile للمدرب «%» — اتأكد إنه سجّل دخول بحساب Google، أو عيّن مدرب من شاشة المجموعات.', v_trainer;
  ELSE
    RAISE NOTICE 'تم العثور على المدرب: %', v_instructor;
  END IF;

  -- الكورس (idempotent بالعنوان)
  SELECT id INTO v_course_id FROM public.courses WHERE title = v_title LIMIT 1;
  IF v_course_id IS NULL THEN
    INSERT INTO public.courses(committee_id, title, field, description, topics, sessions_count,
                               status, color, delivery_mode, organizer_phone)
    VALUES(NULL, v_title, v_field, v_desc, v_topics, 4, 'published', '#3B82F6', 'offline', v_phone)
    RETURNING id INTO v_course_id;
    RAISE NOTICE 'تم إنشاء كورس «%» (%)', v_title, v_course_id;
  ELSE
    UPDATE public.courses
      SET field = v_field,
          description = v_desc,
          topics = v_topics,
          sessions_count = 4,
          status = 'published',
          delivery_mode = 'offline',
          organizer_phone = v_phone,
          updated_at = now()
    WHERE id = v_course_id;
    RAISE NOTICE 'الكورس «%» موجود بالفعل (%) — تم تحديث مواصفاته', v_title, v_course_id;
  END IF;

  -- المجموعة (idempotent بكود الانضمام)
  SELECT id INTO v_batch_id FROM public.batches
  WHERE course_id = v_course_id AND join_code = v_join_code LIMIT 1;
  IF v_batch_id IS NULL THEN
    INSERT INTO public.batches(course_id, branch_id, instructor_id, capacity, schedule, start_date,
                               room, status, join_code, trainer_name)
    VALUES(v_course_id, v_branch_id, v_instructor, v_capacity,
           jsonb_build_object('days', ARRAY[1], 'time', '18:30', 'durationMin', v_duration),
           v_dates[1], v_room, 'scheduled', v_join_code, v_trainer)
    RETURNING id INTO v_batch_id;
    RAISE NOTICE 'تم إنشاء المجموعة (%) بكود انضمام %', v_batch_id, v_join_code;
  ELSE
    UPDATE public.batches
      SET instructor_id = COALESCE(v_instructor, instructor_id),
          capacity = v_capacity,
          schedule = jsonb_build_object('days', ARRAY[1], 'time', '18:30', 'durationMin', v_duration),
          start_date = v_dates[1],
          room = v_room,
          trainer_name = v_trainer,
          updated_at = now()
    WHERE id = v_batch_id;
    RAISE NOTICE 'المجموعة موجودة بالفعل (%) — تم تحديث بياناتها', v_batch_id;
  END IF;

  -- المحاضرات الأربع — أي محاضرة فاتت تبقى «مغلقة» عشان زر «ابدأ الجلسة»
  -- يختار محاضرة النهاردة صح (start_training_session بياخد أول scheduled).
  FOR i IN 1..4 LOOP
    v_start := ((v_dates[i] || ' 18:30')::timestamp AT TIME ZONE v_tz);

    SELECT id INTO v_session FROM public.sessions WHERE batch_id = v_batch_id AND seq = i LIMIT 1;
    IF v_session IS NULL THEN
      INSERT INTO public.sessions(batch_id, seq, title, starts_at, duration_min, status)
      VALUES(v_batch_id, i,
             'المحاضرة ' || i || ' — ' || v_topics[i],
             v_start, v_duration,
             CASE WHEN i < 4 THEN 'closed' ELSE 'scheduled' END)
      RETURNING id INTO v_session;
    ELSE
      UPDATE public.sessions
        SET title = 'المحاضرة ' || i || ' — ' || v_topics[i],
            starts_at = v_start,
            duration_min = v_duration,
            status = CASE WHEN i < 4 AND status = 'scheduled' THEN 'closed' ELSE status END
      WHERE id = v_session;
    END IF;

    IF i < 4 THEN
      UPDATE public.sessions
        SET started_at = COALESCE(started_at, v_start),
            closed_at  = COALESCE(closed_at, v_start + make_interval(mins => v_duration))
      WHERE id = v_session AND status = 'closed';
    END IF;
  END LOOP;

  RAISE NOTICE 'جاهز: كورس «%» — 4 محاضرات الاتنين 6:30 م (7 → 28 سبتمبر 2026) — حضوري — كود الانضمام %', v_title, v_join_code;
END $$;

COMMIT;
