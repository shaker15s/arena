-- ═══════════════════════════════════════════════════════════════════════════
-- scripts/sql-exec/prelude.sql — بديل Supabase داخل صندوق اختبار SQL (PGlite)
--
-- لماذا؟ Supabase بيوفّر أشياء **خارج** ملفات الترحيل: مخططات auth/storage/cron،
-- الأدوار (anon / authenticated / service_role)، ودوال extensions.* من pgcrypto.
-- ملفات الترحيل بتفترض وجودها. عشان نقدر نطبّق الترحيلات فعليًا على Postgres
-- حقيقي داخل Node، بنبني هنا نفس البيئة بشكل مصغّر.
--
-- ⚠️ لا يُنفَّذ على Supabase — للاختبار المحلي فقط (scripts/check-sql-exec.js).
-- ═══════════════════════════════════════════════════════════════════════════

set search_path to public, extensions;

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists cron;

-- ── auth ────────────────────────────────────────────────────────────────────
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$fn$;
create or replace function auth.role() returns text language sql stable as $fn$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$fn$;
create or replace function auth.jwt() returns jsonb language sql stable as $fn$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$fn$;

-- ── الأدوار (نفس أدوار Supabase) ────────────────────────────────────────────
do $roles$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then create role supabase_admin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'dashboard_user') then create role dashboard_user noinherit; end if;
end $roles$;

-- ── storage (مصغّر) ─────────────────────────────────────────────────────────
create table if not exists storage.buckets (
  id text primary key, name text, owner uuid, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text, name text,
  owner uuid, metadata jsonb, path_tokens text[], created_at timestamptz default now()
);
create or replace function storage.foldername(name text) returns text[] language sql immutable as $fn$
  select string_to_array(name, '/')
$fn$;

-- ── cron (pg_cron غير مضمّن في PGlite ⇒ بديل بنفس التوقيعات) ─────────────────
create table if not exists cron.job (
  jobid bigserial primary key, schedule text, command text, nodename text default 'localhost',
  nodeport int default 5432, database text default 'postgres', username text default 'postgres',
  active boolean default true, jobname text
);
create table if not exists cron.job_run_details (
  id bigserial primary key, jobid bigint, runid bigint, status text,
  start_time timestamptz, end_time timestamptz, return_message text
);
create or replace function cron.schedule(job_name text, schedule text, command text)
returns bigint language plpgsql as $fn$
declare v_id bigint;
begin
  insert into cron.job (schedule, command, jobname) values (schedule, command, job_name) returning jobid into v_id;
  return v_id;
end $fn$;
create or replace function cron.unschedule(job_name text) returns boolean language plpgsql as $fn$
begin
  delete from cron.job where jobname = job_name;
  return true;
end $fn$;
create or replace function cron.unschedule(p_job_id bigint) returns boolean language plpgsql as $fn$
begin
  delete from cron.job where jobid = p_job_id;
  return true;
end $fn$;

-- ── realtime publication ────────────────────────────────────────────────────
do $pub$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $pub$;

-- ── extensions.* (Supabase بيحطّها في مخطط extensions) ───────────────────────
create extension if not exists pgcrypto schema extensions;
create extension if not exists "uuid-ossp" schema extensions;
-- 27 موضعًا في الترحيلات بينادي uuid_generate_v4() بدون بادئة، وSupabase عنده
-- extensions داخل search_path. هنا نضيف غلافًا صريحًا لنفس الدالة.
create or replace function public.uuid_generate_v4() returns uuid language sql volatile as $fn$
  select extensions.uuid_generate_v4()
$fn$;

-- ── كائنات قديمة موجودة على قاعدة الإنتاج خارج ملفات الترحيل ─────────────────
-- 0005 بيعمل REVOKE على check_in_session(uuid,uuid,text) وهو كائن أقدم من ملفات
-- الترحيل الحالية. بدون هذا الغلاف كانت سلسلة الأساس تنكسر داخل الصندوق فقط.
create or replace function public.check_in_session(p_session uuid, p_user uuid, p_code text)
returns jsonb language sql volatile as $fn$
  select jsonb_build_object('ok', false)
$fn$;
