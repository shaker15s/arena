-- ═══════════════════════════════════════════════════════════════════
-- مسار 3.0 — Seed: قواعد اللعبة الافتراضية + كتالوج الشارات الـ 12
-- (وثيقة 04 §8 + §4) — بيانات بذر مراجعَة.
-- ═══════════════════════════════════════════════════════════════════

insert into gamification_rules (key, value) values
  ('points.present', '{"value":10}'),
  ('points.late', '{"value":7}'),
  ('attendance.late_window_min', '{"value":15}'),
  ('certificate.min_attendance_pct', '{"value":75}'),
  ('kudos.monthly_quota_per_instructor', '{"value":200}'),
  ('streak.freeze_max_hold', '{"value":2}'),
  ('streak.min_sessions_week', '{"value":1}'),
  ('league.promotion_pct', '{"value":15}'),
  ('league.relegation_pct', '{"value":15}'),
  ('points.month_bonus', '{"value":50}'),
  ('points.course_complete', '{"value":100}'),
  ('points.rating', '{"value":5}')
on conflict (key) do nothing;

insert into badges (code, name_ar, name_en, desc_ar, desc_en, rarity, icon, active) values
  ('first_step', 'البداية الصح', 'Right Start', 'أول حضور في تاريخك على مسار', 'Your first ever attendance', 'common', 'footsteps', true),
  ('consistent', 'المواظب', 'Consistent', '4 محاضرات متتالية في كورس واحد', '4 consecutive sessions in one course', 'common', 'calendar', true),
  ('early_bird', 'الطائر المبكر', 'Early Bird', '10 حضورات قبل بدء الجلسة', '10 check-ins before session start', 'rare', 'sunny', true),
  ('perfection', 'الكمال', 'Perfection', 'شهر ميلادي حضور 100% بلا غياب', 'A calendar month at 100% attendance', 'epic', 'diamond', true),
  ('super_streak', 'السوبر ستريك', 'Super Streak', '8 أسابيع التزام متتالية', '8 consecutive committed weeks', 'epic', 'flame', true),
  ('month_star', 'نجم الشهر', 'Star of the Month', 'أعلى نقاط شهر على مستوى فرعك', 'Top monthly points in your branch', 'epic', 'star', true),
  ('top_scorer', 'المتصدر', 'Top Scorer', 'صدارة الدوري الأسبوعي في أي مرة', 'Topping a weekly league any time', 'common', 'trophy', true),
  ('climber', 'الصاعد', 'Climber', 'الصعود لفئة دوري أعلى', 'Promoting to a higher league tier', 'rare', 'trending-up', true),
  ('cert_hunter', 'صائد الشهادات', 'Certificate Hunter', 'أول شهادة مصدرة لك', 'Your first issued certificate', 'rare', 'ribbon', true),
  ('pro_expert', 'الخبير المحترف', 'Pro Expert', '3 شهادات مكتملة', '3 completed certificates', 'epic', 'medal', true),
  ('honest_reviewer', 'المقيّم الأمين', 'Honest Reviewer', 'تقييم 3 كورسات بعد إتمامها', 'Rating 3 completed courses', 'common', 'chatbubble-ellipses', true),
  ('season_legend', 'أسطورة الموسم', 'Season Legend', 'إنهاء موسم بأعلى نقاط الفرع', 'Top branch points across a season', 'legendary', 'crown', false)  -- Seasons are not a persisted domain yet; keep hidden (matches 0001)
on conflict (code) do nothing;
