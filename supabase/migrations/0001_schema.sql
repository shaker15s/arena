-- ═══════════════════════════════════════════════════════════════════
-- مسار 3.0 — Migration 0001: المخطط الأساسي + جداول الجيميفيكيشن الجديدة
-- (وثيقة 06 §3) — تُراجع يدويًا وتُطبَّق على staging قبل الإنتاج.
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── الجداول المنقولة من 2.0 (بتنقيح) ──
create table if not exists branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  governorate text not null,
  address text default '',
  supervisor_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text unique not null,
  role text not null default 'student' check (role in ('student','volunteer','supervisor','admin')),
  branch_id uuid references branches(id),
  avatar_url text,
  gender text default 'm' check (gender in ('m','f')),
  status text not null default 'active' check (status in ('active','disabled')),
  joined_at timestamptz not null default now()
);

create table if not exists committees (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id) on delete cascade,
  name text not null
);

create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  committee_id uuid not null references committees(id),
  title text not null,
  field text not null,
  description text default '',
  topics text[] default '{}',
  sessions_count int not null default 8,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  color text default '#4F46E5'
);

create table if not exists batches (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id),
  branch_id uuid not null references branches(id),
  instructor_id uuid not null references profiles(user_id),
  capacity int not null default 25,
  schedule_json jsonb not null,          -- {days:[6,2], time:"18:00", durationMin:120}
  start_date timestamptz not null,
  room text default '',
  status text not null default 'scheduled' check (status in ('scheduled','active','completed','archived')),
  join_code text unique
);

create table if not exists enrollments (
  user_id uuid not null references profiles(user_id),
  batch_id uuid not null references batches(id),
  status text not null default 'active' check (status in ('active','waitlist')),
  joined_at timestamptz not null default now(),
  primary key (user_id, batch_id)
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references batches(id) on delete restrict, -- لا حذف لتاريخ التدريب
  seq int not null,
  title text not null,
  starts_at timestamptz not null,
  duration_min int not null default 120,
  status text not null default 'scheduled' check (status in ('scheduled','live','closed')),
  started_at timestamptz,
  closed_at timestamptz,
  qr_seed text,
  unique (batch_id, seq)
);

create table if not exists attendance (
  session_id uuid not null references sessions(id) on delete restrict,
  user_id uuid not null references profiles(user_id),
  status text not null check (status in ('present','late','absent','excused')),
  checked_in_at timestamptz,
  method text check (method in ('qr','code','manual')),
  note text,
  primary key (session_id, user_id)
);

create table if not exists excuses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(user_id),
  session_id uuid not null references sessions(id),
  reason text not null,
  file_url text,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  note text,
  reviewed_by uuid references profiles(user_id),
  created_at timestamptz not null default now()
);

create table if not exists session_reports (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id),
  done text default '',
  planned text default '',
  challenges text default '',
  submitted_at timestamptz not null default now()
);

create table if not exists certificates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(user_id),
  batch_id uuid not null references batches(id),
  serial text unique not null,
  issued_at timestamptz not null default now(),
  unique (user_id, batch_id)
);

create table if not exists course_ratings (
  user_id uuid not null references profiles(user_id),
  course_id uuid not null references courses(id),
  stars int not null check (stars between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  primary key (user_id, course_id)
);

-- ── الجداول الجديدة: قلب مسار 3.0 ──

-- دفتر النقاط: مصدر الحقيقة الوحيد — الرصيد = SUM(points)
create table if not exists point_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(user_id),
  points int not null check (points >= 0),          -- لا سالب أبدًا
  reason_code text not null,
  ref_type text,
  ref_id uuid,
  awarded_by uuid references profiles(user_id),      -- NULL = النظام
  idempotency_key text not null unique,              -- الضغطة المكررة = نتيجة واحدة
  created_at timestamptz not null default now()
);
create index if not exists point_events_user_week on point_events (user_id, created_at);

-- الاستريك: تقييم أسبوعي محفوظ للتاريخ
create table if not exists streak_weeks (
  user_id uuid not null references profiles(user_id),
  week_start date not null,
  status text not null check (status in ('tracking','kept','frozen','pending','broken')),
  sessions_total int not null default 0,
  sessions_honored int not null default 0,
  freeze_used boolean not null default false,
  primary key (user_id, week_start)
);

-- كاش مشتق — يُعاد بناؤه دائمًا من الدفاتر
create table if not exists profiles_gamification (
  user_id uuid primary key references profiles(user_id),
  current_streak_weeks int not null default 0,
  longest_streak_weeks int not null default 0,
  freezes_held int not null default 1,
  level int not null default 1,
  league_tier text not null default 'bronze' check (league_tier in ('bronze','silver','gold','ruby','master')),
  updated_at timestamptz not null default now()
);

create table if not exists badges (
  code text primary key,
  name_ar text not null,
  name_en text not null,
  desc_ar text not null default '',
  desc_en text not null default '',
  rarity text not null check (rarity in ('common','rare','epic','legendary')),
  icon text not null,
  active boolean not null default true
);

create table if not exists user_badges (
  user_id uuid not null references profiles(user_id),
  badge_code text not null references badges(code),
  context_json jsonb default '{}',
  awarded_at timestamptz not null default now(),
  primary key (user_id, badge_code)
);

create table if not exists league_weeks (
  user_id uuid not null references profiles(user_id),
  week_start date not null,
  tier text not null,
  xp_week int not null default 0,
  final_rank int,
  outcome text check (outcome in ('promoted','stayed','relegated')),
  primary key (user_id, week_start)
);

-- توكنات QR الدوّارة (تسلسل كل 25 ثانية)
create table if not exists session_qr_tokens (
  session_id uuid not null references sessions(id) on delete cascade,
  seq int not null,
  token_hash text not null,
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  primary key (session_id, seq)
);

-- قواعد اللعبة — يظبطها المشرف من S49
create table if not exists gamification_rules (
  key text primary key,
  value jsonb not null,
  scope jsonb not null default '"global"',
  updated_by uuid references profiles(user_id),
  updated_at timestamptz not null default now()
);

-- شفافية إدارية — لا يُحذف أبدًا
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(user_id),
  action text not null,
  target text,
  payload jsonb default '{}',
  created_at timestamptz not null default now()
);

create table if not exists kudos_quota (
  instructor_id uuid not null references profiles(user_id),
  month text not null,                    -- 'YYYY-M'
  spent int not null default 0,
  primary key (instructor_id, month)
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(user_id),
  title text not null,
  body text not null,
  type text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists private_notes (
  instructor_id uuid not null references profiles(user_id),
  user_id uuid not null references profiles(user_id),
  note text not null,
  updated_at timestamptz not null default now(),
  primary key (instructor_id, user_id)
);

-- ── RLS: Zero-Trust — الطالب يرى نفسه فقط في الدفاتر ──
alter table profiles enable row level security;
alter table point_events enable row level security;
alter table attendance enable row level security;
alter table certificates enable row level security;
alter table gamification_rules enable row level security;
alter table audit_log enable row level security;

-- قراءة القواعد للجميع (شفافية)، تعديلها لمشرف/أدمن فقط
drop policy if exists rules_read_all on gamification_rules;
create policy rules_read_all on gamification_rules for select using (true);
drop policy if exists rules_write_admin on gamification_rules;
create policy rules_write_admin on gamification_rules for all using (
  exists (select 1 from profiles p where p.user_id = auth.uid() and p.role in ('supervisor','admin'))
);

-- المستخدم يرى دفتره فقط
drop policy if exists points_read_own on point_events;
create policy points_read_own on point_events for select using (user_id = auth.uid());

-- حضور الطالب لنفسه، والمدرب لباتشاته
drop policy if exists attendance_read_scope on attendance;
create policy attendance_read_scope on attendance for select using (
  user_id = auth.uid()
  or exists (
    select 1 from sessions s join batches b on b.id = s.batch_id
    where s.id = attendance.session_id and b.instructor_id = auth.uid()
  )
  or exists (select 1 from profiles p where p.user_id = auth.uid() and p.role in ('supervisor','admin'))
);

-- التحقق العام من الشهادات: قراءة بالسيريال فقط (بدون مستخدم)
drop policy if exists certs_public_verify on certificates;
create policy certs_public_verify on certificates for select using (true);

-- العمليات: قراءة للمشرف/الأدمن فقط
drop policy if exists audit_read_admin on audit_log;
create policy audit_read_admin on audit_log for select using (
  exists (select 1 from profiles p where p.user_id = auth.uid() and p.role in ('supervisor','admin'))
);
