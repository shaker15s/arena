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

REVOKE ALL ON FUNCTION public.evaluate_user_badges(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.evaluate_user_badges(UUID) TO authenticated, service_role;

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
