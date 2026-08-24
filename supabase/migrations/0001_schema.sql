-- MASAR 3.2 — canonical baseline schema.
-- This is the only baseline applied by Supabase CLI; it contains no demo organization data.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ═══════════════════════════════════════════════════════════════
-- 2. CORE TABLES
-- ═══════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- PROFILES - Extended user profiles
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  email TEXT,
  phone TEXT,
  full_name TEXT,
  role TEXT DEFAULT 'student' CHECK (role IN ('student', 'volunteer', 'supervisor', 'admin')),
  avatar_url TEXT,
  avatar_color TEXT DEFAULT '#007AFF',
  branch_id UUID,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  gender TEXT CHECK (gender IS NULL OR gender IN ('m', 'f')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- BRANCHES - RTC Training Centers
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.branches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  governorate TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  email TEXT,
  facebook_url TEXT,
  supervisor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add foreign key for profiles.branch_id
ALTER TABLE public.profiles ADD CONSTRAINT fk_branch FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;

-- ═══════════════════════════════════════════════════════════════
-- COMMITTEES - Committees within branches
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.committees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- COURSES - Training courses
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.courses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  committee_id UUID REFERENCES public.committees(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  field TEXT NOT NULL,
  description TEXT,
  topics TEXT[] DEFAULT '{}',
  sessions_count INTEGER DEFAULT 8,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  color TEXT DEFAULT '#007AFF',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- BATCHES - Training groups/batches
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  instructor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  capacity INTEGER DEFAULT 25,
  schedule JSONB DEFAULT '{"days": [], "time": "18:00", "durationMin": 120}',
  start_date DATE,
  room TEXT,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'completed', 'archived')),
  join_code TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- ENROLLMENTS - Student enrollments
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.enrollments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'waitlist', 'completed')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, batch_id)
);

-- ═══════════════════════════════════════════════════════════════
-- SESSIONS - Training sessions
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  title TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  duration_min INTEGER DEFAULT 120,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'closed')),
  started_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  qr_seed TEXT,
  report JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- ATTENDANCE - Session attendance
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('present', 'late', 'absent', 'excused')),
  checked_in_at TIMESTAMPTZ,
  method TEXT CHECK (method IS NULL OR method IN ('qr', 'code', 'manual')),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, user_id)
);

-- ═══════════════════════════════════════════════════════════════
-- POINT_EVENTS - Points ledger (source of truth)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.point_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  points INTEGER NOT NULL,
  reason_code TEXT NOT NULL,
  ref_type TEXT CHECK (ref_type IS NULL OR ref_type IN ('session', 'course', 'batch', 'admin')),
  ref_id UUID,
  awarded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- STREAK_WEEKS - Weekly streak tracking
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.streak_weeks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('tracking', 'kept', 'frozen', 'pending', 'broken')),
  sessions_total INTEGER DEFAULT 0,
  sessions_honored INTEGER DEFAULT 0,
  freeze_used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, week_start)
);

-- ═══════════════════════════════════════════════════════════════
-- GAMIFICATION - Gamification profiles cache
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.gamification (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE,
  current_streak_weeks INTEGER DEFAULT 0,
  longest_streak_weeks INTEGER DEFAULT 0,
  freezes_held INTEGER DEFAULT 1,
  league_tier TEXT DEFAULT 'bronze' CHECK (league_tier IN ('bronze', 'silver', 'gold', 'ruby', 'master')),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- BADGES - Badge definitions
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.badges (
  code TEXT PRIMARY KEY,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  desc_ar TEXT,
  desc_en TEXT,
  rarity TEXT NOT NULL CHECK (rarity IN ('common', 'rare', 'epic', 'legendary')),
  icon TEXT NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- USER_BADGES - Earned badges
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.user_badges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  badge_code TEXT NOT NULL REFERENCES public.badges(code) ON DELETE CASCADE,
  awarded_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, badge_code)
);

-- ═══════════════════════════════════════════════════════════════
-- LEAGUE_WEEKS - Weekly league history
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.league_weeks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  tier TEXT NOT NULL,
  xp_week INTEGER DEFAULT 0,
  final_rank INTEGER,
  outcome TEXT CHECK (outcome IS NULL OR outcome IN ('promoted', 'stayed', 'relegated')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- CERTIFICATES - Issued certificates
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.certificates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
  serial TEXT UNIQUE NOT NULL,
  issued_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- EXCUSES - Student excuses
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.excuses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  attachment_url TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  note TEXT,
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- COURSE_RATINGS - Course ratings
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.course_ratings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  stars INTEGER NOT NULL CHECK (stars >= 1 AND stars <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, course_id)
);

-- ═══════════════════════════════════════════════════════════════
-- INSTRUCTOR_RATINGS - Instructor ratings (NEW!)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.instructor_ratings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  instructor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  batch_id UUID REFERENCES public.batches(id) ON DELETE CASCADE,
  stars INTEGER NOT NULL CHECK (stars >= 1 AND stars <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- ORGANIZATION_RATINGS - Organization/branch ratings (NEW!)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.organization_ratings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  stars INTEGER NOT NULL CHECK (stars >= 1 AND stars <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- GAMIFICATION_RULES - Game rules (admin-configurable)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.gamification_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT UNIQUE NOT NULL,
  value JSONB NOT NULL,
  scope JSONB DEFAULT '{"type": "global"}',
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- AUDIT_LOG - Audit trail
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- KUDOS_QUOTAS - Monthly kudos quotas
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.kudos_quotas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  instructor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  month TEXT NOT NULL, -- Format: "2026-08" (to_char(now(),'YYYY-MM') — must match client monthKeyOf)
  spent INTEGER DEFAULT 0,
  UNIQUE(instructor_id, month)
);

-- ═══════════════════════════════════════════════════════════════
-- NOTIFICATIONS - User notifications
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  type TEXT NOT NULL CHECK (type IN ('session', 'excuse', 'badge', 'cert', 'league', 'broadcast', 'streak', 'system')),
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- PRIVATE_NOTES - Instructor private notes about students
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.private_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  instructor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(instructor_id, user_id)
);

-- ═══════════════════════════════════════════════════════════════
-- 3. INDEXES
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON public.profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_branch_id ON public.profiles(branch_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_batches_course_id ON public.batches(course_id);
CREATE INDEX IF NOT EXISTS idx_batches_branch_id ON public.batches(branch_id);
CREATE INDEX IF NOT EXISTS idx_batches_instructor_id ON public.batches(instructor_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_user_id ON public.enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_batch_id ON public.enrollments(batch_id);
CREATE INDEX IF NOT EXISTS idx_sessions_batch_id ON public.sessions(batch_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON public.sessions(status);
CREATE INDEX IF NOT EXISTS idx_attendance_session_id ON public.attendance(session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_user_id ON public.attendance(user_id);
CREATE INDEX IF NOT EXISTS idx_point_events_user_id ON public.point_events(user_id);
CREATE INDEX IF NOT EXISTS idx_point_events_created_at ON public.point_events(created_at);
CREATE INDEX IF NOT EXISTS idx_streak_weeks_user_id ON public.streak_weeks(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON public.notifications(read);
CREATE INDEX IF NOT EXISTS idx_certificates_user_id ON public.certificates(user_id);
CREATE INDEX IF NOT EXISTS idx_certificates_serial ON public.certificates(serial);
CREATE INDEX IF NOT EXISTS idx_course_ratings_course_id ON public.course_ratings(course_id);
CREATE INDEX IF NOT EXISTS idx_instructor_ratings_instructor_id ON public.instructor_ratings(instructor_id);
CREATE INDEX IF NOT EXISTS idx_organization_ratings_branch_id ON public.organization_ratings(branch_id);

-- ═══════════════════════════════════════════════════════════════
-- 4. ROW LEVEL SECURITY (RLS)
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.committees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.point_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streak_weeks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gamification ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_weeks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.excuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instructor_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gamification_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kudos_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_notes ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════
-- Timestamp maintenance (authorization and business RPCs follow later).
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_branches_updated_at BEFORE UPDATE ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_courses_updated_at BEFORE UPDATE ON public.courses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_batches_updated_at BEFORE UPDATE ON public.batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_gamification_updated_at BEFORE UPDATE ON public.gamification
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Reference-only seed data. Organization branches, courses, users and batches
-- are intentionally never fabricated by a production migration.
INSERT INTO public.badges (code,name_ar,name_en,desc_ar,desc_en,rarity,icon,active) VALUES
  ('first_step','البداية الصح','Right Start','أول حضور في تاريخك','Your first attendance','common','footsteps',true),
  ('consistent','المواظب','Consistent','4 محاضرات متتالية','4 consecutive sessions','common','calendar',true),
  ('early_bird','الطائر المبكر','Early Bird','10 حضورات مبكرة','10 early check-ins','rare','sunny',true),
  ('perfection','الكمال','Perfection','شهر حضور 100%','Perfect month','epic','diamond',true),
  ('super_streak','السوبر ستريك','Super Streak','8 أسابيع التزام','8 week streak','epic','flame',true),
  ('month_star','نجم الشهر','Star of Month','أعلى نقاط الشهر','Top monthly points','epic','star',true),
  ('top_scorer','المتصدر','Top Scorer','صدارة الدوري','League leader','common','trophy',true),
  ('climber','الصاعد','Climber','صعود دوري','League promotion','rare','trending-up',true),
  ('cert_hunter','صائد الشهادات','Cert Hunter','أول شهادة','First certificate','rare','ribbon',true),
  ('pro_expert','الخبير','Pro Expert','3 شهادات مكتملة','3 completed certificates','epic','medal',true),
  ('honest_reviewer','المقيّم الأمين','Honest Reviewer','تقييم 3 كورسات','Rate 3 courses','common','chatbubble-ellipses',true),
  -- Seasons are not yet a persisted domain, so this definition remains hidden.
  ('season_legend','أسطورة الموسم','Season Legend','أعلى نقاط الموسم','Top season points','legendary','crown',false)
ON CONFLICT(code) DO NOTHING;

INSERT INTO public.gamification_rules(key,value,scope) VALUES
  ('points.present','{"value":10}','{"type":"global"}'),
  ('points.late','{"value":7}','{"type":"global"}'),
  ('attendance.late_window_min','{"value":15}','{"type":"global"}'),
  ('certificate.min_attendance_pct','{"value":75}','{"type":"global"}'),
  ('kudos.monthly_quota_per_instructor','{"value":200}','{"type":"global"}'),
  ('streak.freeze_max_hold','{"value":2}','{"type":"global"}'),
  ('streak.min_sessions_week','{"value":1}','{"type":"global"}'),
  ('league.promotion_pct','{"value":15}','{"type":"global"}'),
  ('league.relegation_pct','{"value":15}','{"type":"global"}'),
  ('points.month_bonus','{"value":50}','{"type":"global"}'),
  ('points.course_complete','{"value":100}','{"type":"global"}'),
  ('points.rating','{"value":5}','{"type":"global"}')
ON CONFLICT(key) DO NOTHING;
