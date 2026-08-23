-- ═══════════════════════════════════════════════════════════════════
-- مسار 3.0 — Migration 0002: عقود RPC (وثيقة 06 §3.3)
-- كل منح نقاط/شارات/شهادات عبر SECURITY DEFINER + Idempotency.
-- ═══════════════════════════════════════════════════════════════════

-- ── مساعد: قراءة قاعدة لعبة ──
create or replace function rule_num(p_key text)
returns numeric language sql stable as $$
  select coalesce((select (value #>> '{}')::numeric from gamification_rules where key = p_key), 0)
$$;

-- ── student_check_in_v2: حضور بضغطة واحدة وضد التحايل ──
create or replace function student_check_in_v2(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_session_id uuid;
  v_token record;
  v_session record;
  v_existing attendance;
  v_status text;
  v_points int;
  v_late_window int := coalesce(rule_num('attendance.late_window_min'), 15);
  v_hard_cutoff int := 30;
  v_elapsed numeric;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;

  -- التوكن: كود يدوي 6 أرقام أو توكن دوّار
  if p_token ~ '^\d{6}$' then
    select * into v_token from session_qr_tokens qt
      join sessions s on s.id = qt.session_id
     where qt.seq = -1 -- الكود الاحتياطي يخزن كتسلسل -1
       and qt.token_hash = md5(p_token || s.qr_seed)
       and now() between qt.valid_from and qt.valid_until
       and s.status = 'live'
     limit 1;
  else
    select * into v_token from session_qr_tokens qt
      join sessions s on s.id = qt.session_id
     where qt.token_hash = md5(p_token || s.qr_seed)
       and now() between qt.valid_from and qt.valid_until
       and s.status = 'live'
     limit 1;
  end if;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  v_session_id := v_token.session_id;
  select * into v_session from sessions where id = v_session_id;

  -- العضوية في المجموعة
  if not exists (select 1 from enrollments e where e.batch_id = v_session.batch_id and e.user_id = v_uid and e.status = 'active') then
    return jsonb_build_object('ok', false, 'error', 'not_enrolled');
  end if;

  -- Idempotency: مسجل مسبقًا = نفس النتيجة، لا نقاط مكررة
  select * into v_existing from attendance where session_id = v_session_id and user_id = v_uid;
  if v_existing.status is not null and v_existing.status <> 'absent' then
    return jsonb_build_object('ok', true, 'already', true, 'status', v_existing.status, 'points', 0);
  end if;

  v_elapsed := extract(epoch from (now() - v_session.started_at)) / 60.0;
  if v_elapsed > v_hard_cutoff then
    return jsonb_build_object('ok', false, 'error', 'too_late');
  end if;

  if v_elapsed <= v_late_window then
    v_status := 'present';
    v_points := rule_num('points.present')::int;
  else
    v_status := 'late';
    v_points := rule_num('points.late')::int;
  end if;

  insert into attendance (session_id, user_id, status, checked_in_at, method)
  values (v_session_id, v_uid, v_status, now(), case when p_token ~ '^\d{6}$' then 'code' else 'qr' end)
  on conflict (session_id, user_id) do update
    set status = excluded.status, checked_in_at = excluded.checked_in_at, method = excluded.method;

  insert into point_events (user_id, points, reason_code, ref_type, ref_id, idempotency_key)
  values (v_uid, v_points, 'attendance.' || v_status, 'session', v_session_id, 'attendance:' || v_session_id || ':' || v_uid)
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object('ok', true, 'already', false, 'status', v_status, 'points', v_points);
end $$;

-- ── start_session_v2: بدء الجلسة + تسلسل توكنات دوّارة ──
create or replace function start_session_v2(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_session sessions;
  v_i int;
  v_rotation interval := interval '25 seconds';
  v_tokens int;
begin
  -- صلاحية: مدرب المجموعة أو مشرف/أدمن
  if not exists (
    select 1 from batches b
     where b.id = p_batch_id
       and (b.instructor_id = auth.uid()
            or exists (select 1 from profiles p where p.user_id = auth.uid() and p.role in ('supervisor','admin')))
  ) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  update sessions
     set status = 'live', started_at = now(), starts_at = now(),
         qr_seed = encode(gen_random_bytes(12), 'hex')
   where id = (
     select id from sessions where batch_id = p_batch_id and status = 'scheduled'
     order by starts_at asc limit 1
   )
  returning * into v_session;

  if v_session.id is null then
    return jsonb_build_object('ok', false, 'error', 'no_scheduled');
  end if;

  -- توليد التسلسل: مدة الجلسة + هامش 10 دقائق، كل 25 ثانية توكن
  v_tokens := ceil((v_session.duration_min + 10) * 60.0 / 25.0);
  for v_i in 0..v_tokens loop
    insert into session_qr_tokens (session_id, seq, token_hash, valid_from, valid_until)
    values (
      v_session.id, v_i,
      md5(v_session.id || ':' || v_i || ':' || v_session.qr_seed),
      v_session.started_at + v_i * v_rotation,
      v_session.started_at + (v_i + 2) * v_rotation  -- نافذة صلاحية بمهلة نافذة واحدة
    );
  end loop;

  -- الكود الاحتياطي 6 أرقام (seq = -1)
  insert into session_qr_tokens (session_id, seq, token_hash, valid_from, valid_until)
  values (
    v_session.id, -1,
    md5(lpad(((hashtext(v_session.qr_seed || 'backup') % 1000000) + 1000000) % 1000000, 6, '0') || v_session.qr_seed),
    v_session.started_at, v_session.started_at + interval '1 day'
  );

  return jsonb_build_object('ok', true, 'session_id', v_session.id);
end $$;

-- ── get_session_qr: التوكن الحالي للمدرب فقط ──
create or replace function get_session_qr(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_seq int;
  v_expires timestamptz;
begin
  if not exists (
    select 1 from sessions s join batches b on b.id = s.batch_id
     where s.id = p_session_id and b.instructor_id = auth.uid()
  ) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select seq, valid_until into v_seq, v_expires from session_qr_tokens
   where session_id = p_session_id and seq >= 0 and now() between valid_from and valid_until
   order by valid_from desc limit 1;
  return jsonb_build_object('ok', true, 'slot', coalesce(v_seq, -1), 'expires_at', v_expires);
end $$;

-- ── close_session_v2: إقفال + محاسبة الغائبين + بونص + تقرير ──
create or replace function close_session_v2(p_session_id uuid, p_done text default '', p_planned text default '', p_challenges text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_session sessions;
  v_student record;
  v_present int := 0; v_absent int := 0; v_total int := 0;
  v_month text;
  v_bonus int := rule_num('points.month_bonus')::int;
begin
  select * into v_session from sessions where id = p_session_id and status = 'live';
  if v_session.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_live');
  end if;

  update sessions set status = 'closed', closed_at = now() where id = p_session_id;

  -- الغائبون: من لم يسجل
  insert into attendance (session_id, user_id, status)
  select p_session_id, e.user_id, 'absent'
    from enrollments e
   where e.batch_id = v_session.batch_id and e.status = 'active'
     and not exists (select 1 from attendance a where a.session_id = p_session_id and a.user_id = e.user_id and a.status <> 'absent')
  on conflict (session_id, user_id) do nothing;

  -- بونص شهر الالتزام الكامل
  v_month := to_char(v_session.starts_at, 'YYYY-FMMM');
  for v_student in
    select e.user_id from enrollments e where e.batch_id = v_session.batch_id and e.status = 'active'
  loop
    if not exists (
      select 1 from sessions s join attendance a on a.session_id = s.id and a.user_id = v_student.user_id
       where s.batch_id = v_session.batch_id and s.status = 'closed'
         and to_char(s.starts_at, 'YYYY-FMMM') = v_month and a.status = 'absent'
    ) then
      insert into point_events (user_id, points, reason_code, ref_type, ref_id, idempotency_key)
      values (v_student.user_id, v_bonus, 'month.bonus', 'admin', null, 'month.bonus:' || v_student.user_id || ':' || v_month)
      on conflict (idempotency_key) do nothing;
    end if;
  end loop;

  insert into session_reports (session_id, done, planned, challenges)
  values (p_session_id, p_done, p_planned, p_challenges);

  select
    coalesce(sum(case when status <> 'absent' then 1 else 0 end), 0),
    coalesce(sum(case when status = 'absent' then 1 else 0 end), 0),
    count(*)
  into v_present, v_absent, v_total
  from attendance where session_id = p_session_id;

  return jsonb_build_object('ok', true, 'present', v_present, 'absent', v_absent, 'total', v_total);
end $$;

-- ── award_kudos: كوتا شهرية ضد التضخم ──
create or replace function award_kudos(p_student_id uuid, p_points int, p_reason text, p_batch_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_quota int := rule_num('kudos.monthly_quota_per_instructor')::int;
  v_month text := to_char(now(), 'YYYY-FMMM');
  v_spent int;
begin
  if p_points < 1 or p_points > 25 or length(trim(p_reason)) < 3 then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  insert into kudos_quota (instructor_id, month, spent) values (auth.uid(), v_month, 0)
  on conflict do nothing;
  select spent into v_spent from kudos_quota where instructor_id = auth.uid() and month = v_month for update;
  if v_spent + p_points > v_quota then
    return jsonb_build_object('ok', false, 'error', 'quota', 'left', v_quota - v_spent);
  end if;
  update kudos_quota set spent = spent + p_points where instructor_id = auth.uid() and month = v_month;
  insert into point_events (user_id, points, reason_code, ref_type, ref_id, awarded_by, idempotency_key)
  values (p_student_id, p_points, 'kudos', 'batch', p_batch_id, auth.uid(), 'kudos:' || gen_random_uuid());
  insert into audit_log (actor_id, action, target, payload)
  values (auth.uid(), 'award_kudos', p_student_id, jsonb_build_object('points', p_points, 'reason', p_reason));
  return jsonb_build_object('ok', true, 'left', v_quota - v_spent - p_points);
end $$;

-- تسلسل سيريالات الشهادات — يجب إنشاؤه قبل الدوال المستخدمة له
do $$ begin
  create sequence if not exists cert_serial_seq start 200;
exception when duplicate_table then null; end $$;

-- ── admin_update_rule: حدود + تدقيق ──
create or replace function admin_update_rule(p_key text, p_value numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_old numeric;
begin
  if not exists (select 1 from profiles where user_id = auth.uid() and role in ('supervisor','admin')) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select (value #>> '{}')::numeric into v_old from gamification_rules where key = p_key;
  insert into gamification_rules (key, value, updated_by, updated_at)
  values (p_key, to_jsonb(p_value), auth.uid(), now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  insert into audit_log (actor_id, action, target, payload)
  values (auth.uid(), 'admin_update_rule', p_key, jsonb_build_object('from', v_old, 'to', p_value));
  return jsonb_build_object('ok', true);
end $$;

-- ── review_excuse_v2: قبول ← معذور + ستريك محفوظ ──
create or replace function review_excuse_v2(p_excuse_id uuid, p_decision text, p_note text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_excuse excuses;
begin
  select * into v_excuse from excuses where id = p_excuse_id and status = 'pending';
  if v_excuse.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_pending');
  end if;
  update excuses set status = p_decision, note = p_note, reviewed_by = auth.uid() where id = p_excuse_id;
  if p_decision = 'accepted' then
    insert into attendance (session_id, user_id, status, note)
    values (v_excuse.session_id, v_excuse.user_id, 'excused', 'عذر مقبول')
    on conflict (session_id, user_id) do update set status = 'excused', note = 'عذر مقبول';
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ── issue_certificates_v2: سيريال + نقاط إتمام + شارة، في معاملة واحدة ──
create or replace function issue_certificates_v2(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_pct numeric := coalesce(rule_num('certificate.min_attendance_pct'), 75);
  v_complete int := rule_num('points.course_complete')::int;
  v_student record;
  v_issued int := 0;
  v_eligible_pct numeric;
  v_total int;
  v_honored int;
begin
  for v_student in
    select e.user_id from enrollments e where e.batch_id = p_batch_id and e.status = 'active'
  loop
    -- تخطَّ من صدرت له
    continue when exists (select 1 from certificates c where c.batch_id = p_batch_id and c.user_id = v_student.user_id);

    select count(*), coalesce(sum(case when a.status <> 'absent' then 1 else 0 end), 0)
      into v_total, v_honored
      from sessions s
      left join attendance a on a.session_id = s.id and a.user_id = v_student.user_id
     where s.batch_id = p_batch_id and s.status = 'closed';

    v_eligible_pct := case when v_total = 0 then 0 else (v_honored::numeric / v_total) * 100 end;
    if v_eligible_pct >= v_pct then
      insert into certificates (user_id, batch_id, serial)
      values (v_student.user_id, p_batch_id, 'MSR-2026-' || lpad(nextval('cert_serial_seq')::text, 6, '0'));
      insert into point_events (user_id, points, reason_code, ref_type, ref_id, idempotency_key)
      values (v_student.user_id, v_complete, 'course.complete', 'batch', p_batch_id, 'course.complete:' || p_batch_id || ':' || v_student.user_id)
      on conflict (idempotency_key) do nothing;
      insert into user_badges (user_id, badge_code)
      values (v_student.user_id, 'cert_hunter')
      on conflict do nothing;
      v_issued := v_issued + 1;
    end if;
  end loop;
  insert into audit_log (actor_id, action, target, payload)
  values (auth.uid(), 'issue_certificates', p_batch_id, jsonb_build_object('count', v_issued));
  return jsonb_build_object('ok', true, 'issued', v_issued);
end $$;

-- ── get_my_gamification: استعلام واحد لشاشة اليوم ──
create or replace function get_my_gamification()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_points int;
  v_week_start date := date_trunc('week', current_date)::date; -- الأحد بداية الأسبوع
begin
  select coalesce(sum(points), 0) into v_points from point_events where user_id = v_uid;
  return jsonb_build_object(
    'points', v_points,
    'gamification', (select row_to_json(g) from profiles_gamification g where g.user_id = v_uid),
    'week_xp', (select coalesce(sum(points), 0) from point_events where user_id = v_uid and created_at >= v_week_start),
    'streak_week', (select row_to_json(w) from streak_weeks w where w.user_id = v_uid and w.week_start = v_week_start)
  );
end $$;
