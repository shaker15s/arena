-- ═══════════════════════════════════════════════════════════════════
-- مسار 3.0 — Migration 0003: وظائف pg_cron
-- (وثيقة 06 §3.4) — إقفال تلقائي للجلسات + الإقفال الأسبوعي للدوري/الستريك.
-- يتطلب تفعيل امتداد pg_cron في مشروع Supabase.
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;

-- ── 1) إقفال تلقائي لأي جلسة نسيها المدرب (كل 30 دقيقة) ──
create or replace function auto_close_stale_sessions()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_session record;
  v_closed int := 0;
begin
  for v_session in
    select s.id from sessions s
     where s.status = 'live'
       and s.started_at < now() - (s.duration_min + 60) * interval '1 minute'
  loop
    perform close_session_v2(v_session.id, '', '', 'أُقفلت تلقائيًا (لم يغلقها المدرب)');
    v_closed := v_closed + 1;
  end loop;
  insert into audit_log (actor_id, action, target, payload)
  values (null, 'auto_close_sessions', null, jsonb_build_object('closed', v_closed));
  return v_closed;
end $$;

select cron.schedule(
  'auto-close-sessions',
  '*/30 * * * *',
  $$select auto_close_stale_sessions()$$
);

-- ── 2) تقييم الستريك الأسبوعي: فجر كل أحد بدء أسبوع جديد ──
create or replace function weekly_streak_settlement(p_week_start date default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_week date := coalesce(p_week_start, (date_trunc('week', current_date) - interval '7 days')::date);
  v_row record;
  v_max_freeze int := coalesce(rule_num('streak.freeze_max_hold'), 2);
  v_g profiles_gamification;
begin
  for v_row in select * from streak_weeks where week_start = v_week and status = 'tracking' loop
    select * into v_g from profiles_gamification where user_id = v_row.user_id;

    if v_row.sessions_total = 0 or v_row.sessions_honored >= v_row.sessions_total then
      commit_status(v_row, 'kept');
      update profiles_gamification
         set current_streak_weeks = current_streak_weeks + 1,
             longest_streak_weeks = greatest(longest_streak_weeks, current_streak_weeks + 1),
             freezes_held = least(freezes_held + 1, v_max_freeze),
             updated_at = now()
       where user_id = v_row.user_id;
      insert into point_events (user_id, points, reason_code, idempotency_key)
      values (v_row.user_id, rule_num('points.streak_week')::int, 'streak.week_kept',
              'streak.week_kept:' || v_row.user_id || ':' || v_week)
      on conflict (idempotency_key) do nothing;
    elsif v_g.freezes_held > 0 then
      update streak_weeks set status = 'frozen', freeze_used = true
       where user_id = v_row.user_id and week_start = v_week;
      update profiles_gamification set freezes_held = freezes_held - 1, updated_at = now()
       where user_id = v_row.user_id;
    else
      update streak_weeks set status = 'broken' where user_id = v_row.user_id and week_start = v_week;
      update profiles_gamification set current_streak_weeks = 0, updated_at = now()
       where user_id = v_row.user_id;
    end if;
  end loop;

  -- أسبوع تتبع جديد لكل طالب نشط
  insert into streak_weeks (user_id, week_start, status)
  select e.user_id, v_week + 7, 'tracking'
    from (select distinct user_id from enrollments where status = 'active') e
  on conflict do nothing;

  return 0;
end $$;

-- helper صغير لفصل المنطق
create or replace function commit_status(p_week streak_weeks, p_status text)
returns void language sql as $$
  update streak_weeks set status = p_status, freeze_used = false
   where user_id = p_week.user_id and week_start = p_week.week_start;
$$;

select cron.schedule(
  'weekly-streak-settle',
  '10 0 * * 0',          -- 00:10 فجر الأحد، الأسبوع السابق فقط
  $$select weekly_streak_settlement()$$
);

-- ── 3) الإقفال الأسبوعي للدوري: ترقية/ثبات/هبوط حسب الشريحة ──
create or replace function weekly_league_close(p_week_start date default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_week date := coalesce(p_week_start, (date_trunc('week', current_date) - interval '7 days')::date);
  v_promo numeric := coalesce(rule_num('league.promotion_pct'), 15) / 100.0;
  v_rel numeric := coalesce(rule_num('league.relegation_pct'), 15) / 100.0;
  v_tiers text[] := array['bronze','silver','gold','ruby','master'];
  v_tier text;
  v_i int;
  v_count int;
  v_row record;
  v_min_xp int := 15;
begin
  -- لقطة إكس بي الأسبوع لكل فئة
  for v_i in 1..array_length(v_tiers, 1) loop
    v_tier := v_tiers[v_i];
    for v_row in
      select pe.user_id, sum(pe.points) as xp
        from point_events pe
        join profiles_gamification g on g.user_id = pe.user_id
       where pe.created_at >= v_week and pe.created_at < v_week + 7
         and g.league_tier = v_tier
       group by pe.user_id
       order by sum(pe.points) desc
    loop
      insert into league_weeks (user_id, week_start, tier, xp_week)
      values (v_row.user_id, v_week, v_tier, v_row.xp)
      on conflict (user_id, week_start) do update set xp_week = excluded.xp_week;
    end loop;

    select count(*) into v_count from league_weeks where week_start = v_week and tier = v_tier;
    if v_count = 0 then continue; end if;

    -- الترتيب النهائي والقرار
    for v_row in
      select user_id, xp_week, row_number() over (order by xp_week desc) as rk
        from league_weeks where week_start = v_week and tier = v_tier
    loop
      update league_weeks
         set final_rank = v_row.rk,
             outcome = case
               when v_i < array_length(v_tiers, 1) and v_row.rk <= greatest(1, ceil(v_count * v_promo)) and v_row.xp_week >= v_min_xp
                 then 'promoted'
               when v_i > 1 and v_row.rk > v_count - greatest(1, ceil(v_count * v_rel))
                 then 'relegated'
               else 'stayed'
             end
       where week_start = v_week and tier = v_tier and user_id = v_row.user_id;
    end loop;

    -- تحديث الفئة الفعلية
    update profiles_gamification g
       set league_tier = case lw.outcome
             when 'promoted' then v_tiers[least(v_i + 1, array_length(v_tiers, 1))]
             when 'relegated' then v_tiers[greatest(v_i - 1, 1)]
             else g.league_tier
           end,
           updated_at = now()
      from league_weeks lw
     where lw.week_start = v_week and lw.tier = v_tier and g.user_id = lw.user_id
       and lw.outcome in ('promoted','relegated');
  end loop;

  insert into audit_log (actor_id, action, target, payload)
  values (null, 'weekly_league_close', v_week::text, jsonb_build_object('week', v_week));
  return 0;
end $$;

select cron.schedule(
  'weekly-league-close',
  '20 0 * * 0',          -- 00:20 فجر الأحد، بعد الستريك
  $$select weekly_league_close()$$
);

-- ── 4) إنذار ستريك «أي حاجة» كل أحد صباحًا للمتتبّعين بلا جلسات ──
create or replace function weekly_streak_nudge()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_n int := 0;
  v_row record;
begin
  for v_row in
    select sw.user_id from streak_weeks sw
     where sw.week_start = date_trunc('week', current_date)::date
       and sw.status = 'tracking'
       and sw.sessions_total > 0 and sw.sessions_honored = 0
  loop
    insert into notifications (user_id, title, body, type)
    values (v_row.user_id, 'خلّيك متتبع', 'سجّل حضورك النهارده عشان تحافظ على الـ tracking بتاعك', 'reminder');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

select cron.schedule('weekly-streak-nudge', '0 8 * * 0', $$select weekly_streak_nudge()$$);
