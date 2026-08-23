-- ═══════════════════════════════════════════════════════════════
-- MASAR 3.2 — Google auth bootstrap, initial RLS, storage and realtime.
-- Applied after the canonical 0001 baseline; 0005 replaces these initial policies.
-- ═══════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────
-- 1) دوال مساعدة: ربط auth.uid() ببروفايل المستخدم
--    (كل الجداول تشير إلى profiles.id وليس إلى auth.users.id)
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.my_profile_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1 $$;

CREATE OR REPLACE FUNCTION public.my_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT role FROM public.profiles WHERE user_id = auth.uid() LIMIT 1 $$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT COALESCE(public.my_role() IN ('volunteer', 'supervisor', 'admin'), FALSE) $$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT COALESCE(public.my_role() IN ('supervisor', 'admin'), FALSE) $$;

-- ───────────────────────────────────────────────────────────────
-- 2) إنشاء البروفايل تلقائيًا بعد الدخول بجوجل
--    (يلتقط الاسم والصورة من بيانات Google، وأول مستخدم يصبح أدمن)
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_profile_id UUID;
  v_role TEXT;
BEGIN
  -- Serialize the one-time first-admin decision to prevent concurrent signups
  -- from creating more than one bootstrap administrator.
  PERFORM pg_advisory_xact_lock(hashtextextended('masar-first-admin', 0));
  SELECT CASE
    WHEN COALESCE(NEW.raw_app_meta_data->>'masar_bootstrap_admin','false')='true'
      AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE role='admin')
    THEN 'admin' ELSE 'student' END
  INTO v_role;

  INSERT INTO public.profiles (user_id, email, full_name, avatar_url, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture'),
    v_role
  )
  ON CONFLICT (user_id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = COALESCE(NULLIF(public.profiles.full_name, ''), EXCLUDED.full_name),
        avatar_url = COALESCE(public.profiles.avatar_url, EXCLUDED.avatar_url)
  RETURNING id INTO v_profile_id;

  INSERT INTO public.gamification (user_id)
  VALUES (v_profile_id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ───────────────────────────────────────────────────────────────
-- 3) سياسات RLS صحيحة (السياسات القديمة كانت تقارن auth.uid()
--    بأعمدة تشير إلى profiles.id فتمنع كل الكتابة)
-- ───────────────────────────────────────────────────────────────
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- profiles
CREATE POLICY p_profiles_read ON public.profiles FOR SELECT USING (TRUE);
CREATE POLICY p_profiles_insert_self ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY p_profiles_update_self ON public.profiles FOR UPDATE
  USING (auth.uid() = user_id OR public.is_admin())
  WITH CHECK (auth.uid() = user_id OR public.is_admin());

-- المرجعيات العامة (قراءة للجميع، كتابة للطاقم)
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['branches','committees','courses','batches','sessions','badges','gamification_rules'] LOOP
    EXECUTE format('CREATE POLICY p_%1$s_read ON public.%1$I FOR SELECT USING (TRUE)', t);
    EXECUTE format('CREATE POLICY p_%1$s_write ON public.%1$I FOR ALL USING (public.is_staff()) WITH CHECK (public.is_staff())', t);
  END LOOP;
END $$;

-- enrollments: الطالب يسجّل نفسه، الطاقم يدير الكل
CREATE POLICY p_enroll_read ON public.enrollments FOR SELECT USING (TRUE);
CREATE POLICY p_enroll_self ON public.enrollments FOR ALL
  USING (user_id = public.my_profile_id() OR public.is_staff())
  WITH CHECK (user_id = public.my_profile_id() OR public.is_staff());

-- attendance: الطالب يقرأ سجله ويسجّل حضوره، الطاقم يعدّل
CREATE POLICY p_att_read ON public.attendance FOR SELECT
  USING (user_id = public.my_profile_id() OR public.is_staff());
CREATE POLICY p_att_self_insert ON public.attendance FOR INSERT
  WITH CHECK (user_id = public.my_profile_id() OR public.is_staff());
CREATE POLICY p_att_staff_write ON public.attendance FOR UPDATE
  USING (public.is_staff()) WITH CHECK (public.is_staff());

-- دفتر النقاط والجيميفيكيشن
CREATE POLICY p_points_read ON public.point_events FOR SELECT USING (TRUE);
CREATE POLICY p_points_write ON public.point_events FOR INSERT
  WITH CHECK (user_id = public.my_profile_id() OR public.is_staff());
CREATE POLICY p_streak_read ON public.streak_weeks FOR SELECT USING (TRUE);
CREATE POLICY p_streak_write ON public.streak_weeks FOR ALL
  USING (user_id = public.my_profile_id() OR public.is_staff())
  WITH CHECK (user_id = public.my_profile_id() OR public.is_staff());
CREATE POLICY p_gamif_read ON public.gamification FOR SELECT USING (TRUE);
CREATE POLICY p_gamif_write ON public.gamification FOR ALL
  USING (user_id = public.my_profile_id() OR public.is_staff())
  WITH CHECK (user_id = public.my_profile_id() OR public.is_staff());
CREATE POLICY p_ubadges_read ON public.user_badges FOR SELECT USING (TRUE);
CREATE POLICY p_ubadges_write ON public.user_badges FOR ALL
  USING (user_id = public.my_profile_id() OR public.is_staff())
  WITH CHECK (user_id = public.my_profile_id() OR public.is_staff());
CREATE POLICY p_league_read ON public.league_weeks FOR SELECT USING (TRUE);
CREATE POLICY p_league_write ON public.league_weeks FOR ALL
  USING (public.is_staff() OR user_id = public.my_profile_id())
  WITH CHECK (public.is_staff() OR user_id = public.my_profile_id());

-- الشهادات: تحقق عام + إصدار من الطاقم
CREATE POLICY p_cert_read ON public.certificates FOR SELECT USING (TRUE);
CREATE POLICY p_cert_write ON public.certificates FOR ALL
  USING (public.is_staff()) WITH CHECK (public.is_staff());

-- الأعذار
CREATE POLICY p_excuse_read ON public.excuses FOR SELECT
  USING (user_id = public.my_profile_id() OR public.is_staff());
CREATE POLICY p_excuse_insert ON public.excuses FOR INSERT
  WITH CHECK (user_id = public.my_profile_id());
CREATE POLICY p_excuse_review ON public.excuses FOR UPDATE
  USING (public.is_staff()) WITH CHECK (public.is_staff());

-- التقييمات (قراءة عامة، كتابة لصاحبها)
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['course_ratings','instructor_ratings','organization_ratings'] LOOP
    EXECUTE format('CREATE POLICY p_%1$s_read ON public.%1$I FOR SELECT USING (TRUE)', t);
    EXECUTE format('CREATE POLICY p_%1$s_write ON public.%1$I FOR ALL USING (user_id = public.my_profile_id()) WITH CHECK (user_id = public.my_profile_id())', t);
  END LOOP;
END $$;

-- سجل العمليات + كوتا الكودوس + الملاحظات الخاصة
CREATE POLICY p_audit_read ON public.audit_log FOR SELECT USING (public.is_admin());
CREATE POLICY p_audit_write ON public.audit_log FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY p_kudos_rw ON public.kudos_quotas FOR ALL
  USING (instructor_id = public.my_profile_id() OR public.is_admin())
  WITH CHECK (instructor_id = public.my_profile_id() OR public.is_admin());
CREATE POLICY p_notes_rw ON public.private_notes FOR ALL
  USING (instructor_id = public.my_profile_id() OR public.is_admin())
  WITH CHECK (instructor_id = public.my_profile_id() OR public.is_admin());

-- الإشعارات
CREATE POLICY p_notif_read ON public.notifications FOR SELECT
  USING (user_id = public.my_profile_id() OR public.is_staff());
CREATE POLICY p_notif_write ON public.notifications FOR INSERT
  WITH CHECK (public.is_staff() OR user_id = public.my_profile_id());
CREATE POLICY p_notif_update ON public.notifications FOR UPDATE
  USING (user_id = public.my_profile_id()) WITH CHECK (user_id = public.my_profile_id());

-- ───────────────────────────────────────────────────────────────
-- 4) تخزين صور المستخدمين (bucket: avatars)
-- ───────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', TRUE)
ON CONFLICT (id) DO UPDATE SET public = TRUE;

DROP POLICY IF EXISTS "avatars public read" ON storage.objects;
CREATE POLICY "avatars public read" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars owner write" ON storage.objects;
CREATE POLICY "avatars owner write" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ───────────────────────────────────────────────────────────────
-- 5) قاعدة لعبة جديدة: الحد الأدنى لجلسات الأسبوع للحفاظ على الستريك
-- ───────────────────────────────────────────────────────────────
INSERT INTO public.gamification_rules (key, value)
VALUES ('streak.min_sessions_week', '{"value": 1}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ───────────────────────────────────────────────────────────────
-- 6) الزمن الحقيقي (Realtime) للجداول الحية
-- ───────────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sessions','attendance','notifications','excuses','enrollments','point_events'] LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;
