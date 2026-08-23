-- MASAR 3.2 — schema-compatible automatic settlement and notification jobs.
-- Supabase projects must have pg_cron available (enabled below).

CREATE EXTENSION IF NOT EXISTS pg_cron;

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_uidx
  ON public.notifications(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS league_user_week_uidx
  ON public.league_weeks(user_id,week_start);

-- Close abandoned live sessions after their duration plus a one-hour grace
-- period. Missing active students are recorded absent in the same transaction.
CREATE OR REPLACE FUNCTION public.auto_close_stale_sessions()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE r RECORD; v_closed INTEGER:=0;
BEGIN
  FOR r IN
    SELECT s.id,s.batch_id FROM public.sessions s
    WHERE s.status='live' AND s.started_at IS NOT NULL
      AND s.started_at + make_interval(mins=>s.duration_min+60) < now()
    FOR UPDATE SKIP LOCKED
  LOOP
    INSERT INTO public.attendance(session_id,user_id,status,note)
    SELECT r.id,e.user_id,'absent','أُغلقت الجلسة تلقائيًا'
    FROM public.enrollments e
    WHERE e.batch_id=r.batch_id AND e.status='active'
    ON CONFLICT(session_id,user_id) DO NOTHING;
    UPDATE public.sessions SET status='closed',closed_at=now(),qr_seed=NULL,
      report=COALESCE(report,jsonb_build_object(
        'done','','planned','','challenges','أُغلقت تلقائيًا بعد انتهاء المهلة',
        'submittedAt',floor(extract(epoch FROM now())*1000)
      )) WHERE id=r.id;
    IF NOT EXISTS(SELECT 1 FROM public.sessions WHERE batch_id=r.batch_id AND status<>'closed') THEN
      UPDATE public.batches b SET status='completed',updated_at=now()
      WHERE b.id=r.batch_id
        AND EXISTS(SELECT 1 FROM public.enrollments e WHERE e.batch_id=b.id AND e.status='active')
        AND (SELECT count(*) FROM public.sessions s WHERE s.batch_id=b.id)=(
          SELECT c.sessions_count FROM public.courses c WHERE c.id=b.course_id
        );
    END IF;
    INSERT INTO public.audit_log(actor_id,action,target,payload)
    VALUES(NULL,'auto_close_session',r.id::text,jsonb_build_object('batch_id',r.batch_id));
    v_closed:=v_closed+1;
  END LOOP;
  RETURN v_closed;
END;
$$;

-- Reconcile the previous Cairo/Sunday week. Pending excuses remain pending;
-- accepted late reviews can promote a frozen/broken week to kept exactly once.
CREATE OR REPLACE FUNCTION public.settle_previous_streak_week()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_today DATE:=(now() AT TIME ZONE 'Africa/Cairo')::DATE;
  v_current_sunday DATE; v_week DATE; v_next DATE;
  v_min INTEGER:=COALESCE(public.rule_num('streak.min_sessions_week'),1)::INTEGER;
  v_max_freeze INTEGER:=COALESCE(public.rule_num('streak.freeze_max_hold'),2)::INTEGER;
  r RECORD; v_old TEXT; v_old_freeze BOOLEAN; v_new TEXT; v_freeze BOOLEAN; v_changed INTEGER:=0;
  v_held INTEGER; v_current INTEGER;
BEGIN
  v_current_sunday:=v_today-extract(dow FROM v_today)::INTEGER;
  v_week:=v_current_sunday-7;
  v_next:=v_week+7;
  FOR r IN
    SELECT e.user_id,
      count(DISTINCT s.id)::INTEGER AS total,
      count(DISTINCT s.id) FILTER(WHERE a.status IS NOT NULL AND a.status<>'absent')::INTEGER AS honored,
      count(DISTINCT s.id) FILTER(WHERE a.status IS NULL OR a.status='absent')::INTEGER AS absent,
      bool_or(ex.status='pending') AS has_pending
    FROM public.enrollments e
    JOIN public.sessions s ON s.batch_id=e.batch_id AND s.status='closed'
      AND (s.starts_at AT TIME ZONE 'Africa/Cairo')::DATE>=v_week
      AND (s.starts_at AT TIME ZONE 'Africa/Cairo')::DATE<v_next
    LEFT JOIN public.attendance a ON a.session_id=s.id AND a.user_id=e.user_id
    LEFT JOIN public.excuses ex ON ex.session_id=s.id AND ex.user_id=e.user_id
    WHERE e.status='active'
    GROUP BY e.user_id
  LOOP
    IF r.total=0 THEN CONTINUE; END IF;
    SELECT status,freeze_used INTO v_old,v_old_freeze FROM public.streak_weeks
      WHERE user_id=r.user_id AND week_start=v_week FOR UPDATE;
    INSERT INTO public.gamification(user_id) VALUES(r.user_id) ON CONFLICT(user_id) DO NOTHING;
    SELECT COALESCE(freezes_held,0),COALESCE(current_streak_weeks,0) INTO v_held,v_current
    FROM public.gamification WHERE user_id=r.user_id FOR UPDATE;

    IF r.absent=0 AND r.honored>=LEAST(v_min,r.total) THEN v_new:='kept'; v_freeze:=FALSE;
    ELSIF COALESCE(r.has_pending,FALSE) THEN v_new:='pending'; v_freeze:=FALSE;
    ELSIF v_held>0 THEN v_new:='frozen'; v_freeze:=TRUE;
    ELSE v_new:='broken'; v_freeze:=FALSE;
    END IF;

    IF v_old='kept' OR (v_old IN ('frozen','broken') AND v_new<>'kept') THEN CONTINUE; END IF;
    IF v_new='kept' AND v_old IS DISTINCT FROM 'kept' THEN
      IF v_old='frozen' AND COALESCE(v_old_freeze,FALSE) AND v_held<v_max_freeze THEN v_held:=v_held+1; END IF;
      v_current:=v_current+1;
      UPDATE public.gamification SET current_streak_weeks=v_current,
        longest_streak_weeks=GREATEST(longest_streak_weeks,v_current),
        freezes_held=LEAST(v_held + CASE WHEN v_current%4=0 AND v_held<v_max_freeze THEN 1 ELSE 0 END,v_max_freeze),
        updated_at=now() WHERE user_id=r.user_id;
    ELSIF v_new='frozen' AND v_old IS DISTINCT FROM 'frozen' THEN
      UPDATE public.gamification SET freezes_held=GREATEST(0,freezes_held-1),updated_at=now() WHERE user_id=r.user_id;
    ELSIF v_new='broken' AND v_old IS DISTINCT FROM 'broken' THEN
      UPDATE public.gamification SET current_streak_weeks=0,updated_at=now() WHERE user_id=r.user_id;
    END IF;

    INSERT INTO public.streak_weeks(user_id,week_start,status,sessions_total,sessions_honored,freeze_used)
    VALUES(r.user_id,v_week,v_new,r.total,r.honored,v_freeze)
    ON CONFLICT(user_id,week_start) DO UPDATE SET status=EXCLUDED.status,
      sessions_total=EXCLUDED.sessions_total,sessions_honored=EXCLUDED.sessions_honored,freeze_used=EXCLUDED.freeze_used;
    INSERT INTO public.notifications(user_id,title,body,type,dedupe_key)
    VALUES(r.user_id,
      CASE v_new WHEN 'kept' THEN 'تم حفظ الستريك 🔥' WHEN 'pending' THEN 'الستريك قيد المراجعة'
        WHEN 'frozen' THEN 'تم استخدام مُجمّد الستريك 🛡️' ELSE 'ابدأ ستريك جديد هذا الأسبوع' END,
      'تمت تسوية أسبوع '||v_week::text,'streak','streak:'||v_week||':'||r.user_id||':'||v_new)
    ON CONFLICT(dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    PERFORM public.evaluate_user_badges(r.user_id);
    v_changed:=v_changed+1;
  END LOOP;
  RETURN v_changed;
END;
$$;

-- Snapshot the previous league week and atomically update tiers. Small pools do
-- not move tiers; this avoids arbitrary promotion/relegation in new branches.
CREATE OR REPLACE FUNCTION public.close_previous_league_week()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_today DATE:=(now() AT TIME ZONE 'Africa/Cairo')::DATE; v_sunday DATE; v_week DATE; v_next DATE;
  v_prom NUMERIC:=COALESCE(public.rule_num('league.promotion_pct'),15);
  v_rel NUMERIC:=COALESCE(public.rule_num('league.relegation_pct'),15);
  r RECORD; v_outcome TEXT; v_new_tier TEXT; v_count INTEGER:=0;
BEGIN
  v_sunday:=v_today-extract(dow FROM v_today)::INTEGER; v_week:=v_sunday-7; v_next:=v_week+7;
  IF EXISTS(SELECT 1 FROM public.league_weeks WHERE week_start=v_week) THEN RETURN 0; END IF;
  FOR r IN
    WITH scores AS (
      SELECT p.id AS user_id,p.branch_id,p.joined_at,g.league_tier,
        COALESCE(sum(pe.points) FILTER(WHERE pe.created_at >= (v_week::timestamp AT TIME ZONE 'Africa/Cairo')
          AND pe.created_at < (v_next::timestamp AT TIME ZONE 'Africa/Cairo')),0)::INTEGER AS xp
      FROM public.profiles p JOIN public.gamification g ON g.user_id=p.id
      LEFT JOIN public.point_events pe ON pe.user_id=p.id
      WHERE p.role='student' AND p.status='active'
      GROUP BY p.id,p.branch_id,p.joined_at,g.league_tier
    ), ranked AS (
      SELECT *,row_number() OVER(PARTITION BY branch_id,league_tier ORDER BY xp DESC,joined_at,user_id) AS pos,
        count(*) OVER(PARTITION BY branch_id,league_tier) AS pool
      FROM scores
    ) SELECT * FROM ranked
  LOOP
    v_outcome:='stayed'; v_new_tier:=r.league_tier;
    IF r.pool>=5 AND r.xp>0 AND r.pos<=GREATEST(1,ceil(r.pool*v_prom/100.0)) THEN
      v_new_tier:=CASE r.league_tier WHEN 'bronze' THEN 'silver' WHEN 'silver' THEN 'gold'
        WHEN 'gold' THEN 'ruby' WHEN 'ruby' THEN 'master' ELSE 'master' END;
      IF v_new_tier<>r.league_tier THEN v_outcome:='promoted'; END IF;
    ELSIF r.pool>=5 AND r.pos>r.pool-GREATEST(1,ceil(r.pool*v_rel/100.0)) THEN
      v_new_tier:=CASE r.league_tier WHEN 'master' THEN 'ruby' WHEN 'ruby' THEN 'gold'
        WHEN 'gold' THEN 'silver' WHEN 'silver' THEN 'bronze' ELSE 'bronze' END;
      IF v_new_tier<>r.league_tier THEN v_outcome:='relegated'; END IF;
    END IF;
    INSERT INTO public.league_weeks(user_id,week_start,tier,xp_week,final_rank,outcome)
    VALUES(r.user_id,v_week,r.league_tier,r.xp,r.pos,v_outcome);
    UPDATE public.gamification SET league_tier=v_new_tier,updated_at=now() WHERE user_id=r.user_id;
    IF r.pos=1 AND r.xp>0 THEN
      INSERT INTO public.user_badges(user_id,badge_code)
      SELECT r.user_id,'top_scorer' WHERE EXISTS(SELECT 1 FROM public.badges WHERE code='top_scorer' AND active)
      ON CONFLICT(user_id,badge_code) DO NOTHING;
      IF FOUND THEN
        INSERT INTO public.notifications(user_id,title,body,type,dedupe_key)
        VALUES(r.user_id,'شارة جديدة 🎉','المتصدر','badge','badge:'||r.user_id||':top_scorer')
        ON CONFLICT(dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
      END IF;
    END IF;
    IF v_outcome='promoted' THEN
      INSERT INTO public.user_badges(user_id,badge_code)
      SELECT r.user_id,'climber' WHERE EXISTS(SELECT 1 FROM public.badges WHERE code='climber' AND active)
      ON CONFLICT(user_id,badge_code) DO NOTHING;
      IF FOUND THEN
        INSERT INTO public.notifications(user_id,title,body,type,dedupe_key)
        VALUES(r.user_id,'شارة جديدة 🎉','الصاعد','badge','badge:'||r.user_id||':climber')
        ON CONFLICT(dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
      END IF;
    END IF;
    IF v_outcome<>'stayed' THEN
      INSERT INTO public.notifications(user_id,title,body,type,dedupe_key)
      VALUES(r.user_id,CASE WHEN v_outcome='promoted' THEN 'تمت ترقيتك في الدوري 🎉' ELSE 'بدأ أسبوع دوري جديد' END,
        'ترتيب الأسبوع السابق: '||r.pos,'league','league:'||v_week||':'||r.user_id)
      ON CONFLICT(dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    END IF;
    v_count:=v_count+1;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_previous_month_bonus()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_month DATE:=(date_trunc('month',now() AT TIME ZONE 'Africa/Cairo')-interval '1 month')::DATE;
  v_next DATE:=(date_trunc('month',now() AT TIME ZONE 'Africa/Cairo'))::DATE;
  v_points INTEGER:=COALESCE(public.rule_num('points.month_bonus'),50)::INTEGER; r RECORD; v_count INTEGER:=0;
BEGIN
  FOR r IN
    SELECT e.user_id,count(DISTINCT s.id) AS total,
      count(DISTINCT s.id) FILTER(WHERE a.status IS NULL OR a.status='absent') AS absent
    FROM public.enrollments e JOIN public.sessions s ON s.batch_id=e.batch_id AND s.status='closed'
      AND (s.starts_at AT TIME ZONE 'Africa/Cairo')::DATE>=v_month
      AND (s.starts_at AT TIME ZONE 'Africa/Cairo')::DATE<v_next
    LEFT JOIN public.attendance a ON a.session_id=s.id AND a.user_id=e.user_id
    WHERE e.status='active' GROUP BY e.user_id
  LOOP
    IF r.total>0 AND r.absent=0 AND v_points>0 THEN
      INSERT INTO public.point_events(user_id,points,reason_code,ref_type,idempotency_key)
      VALUES(r.user_id,v_points,'month.bonus','admin','month.bonus:'||r.user_id||':'||to_char(v_month,'YYYY-MM'))
      ON CONFLICT(idempotency_key) DO NOTHING;
      IF FOUND THEN v_count:=v_count+1; END IF;
    END IF;
    PERFORM public.evaluate_user_badges(r.user_id);
  END LOOP;
  WITH scores AS (
    SELECT p.id AS user_id,p.branch_id,COALESCE(sum(pe.points),0) AS points
    FROM public.profiles p JOIN public.point_events pe ON pe.user_id=p.id
      AND pe.created_at >= (v_month::timestamp AT TIME ZONE 'Africa/Cairo')
      AND pe.created_at < (v_next::timestamp AT TIME ZONE 'Africa/Cairo')
    WHERE p.role='student' AND p.status='active' AND p.branch_id IS NOT NULL
    GROUP BY p.id,p.branch_id
  ), ranked AS (
    SELECT *,row_number() OVER(PARTITION BY branch_id ORDER BY points DESC,user_id) AS pos FROM scores
  ), awarded AS (
    INSERT INTO public.user_badges(user_id,badge_code)
    SELECT user_id,'month_star' FROM ranked
    WHERE pos=1 AND points>0 AND EXISTS(SELECT 1 FROM public.badges WHERE code='month_star' AND active)
    ON CONFLICT(user_id,badge_code) DO NOTHING RETURNING user_id
  )
  INSERT INTO public.notifications(user_id,title,body,type,dedupe_key)
  SELECT user_id,'شارة جديدة 🎉','نجم الشهر','badge','badge:'||user_id||':month_star' FROM awarded
  ON CONFLICT(dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_session_reminders()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_count INTEGER;
BEGIN
  WITH targets AS (
    SELECT s.id AS session_id,e.user_id,s.title,s.starts_at FROM public.sessions s
    JOIN public.enrollments e ON e.batch_id=s.batch_id AND e.status='active'
    WHERE s.status='scheduled' AND s.starts_at BETWEEN now()+interval '20 minutes' AND now()+interval '50 minutes'
    UNION
    SELECT s.id,b.instructor_id,s.title,s.starts_at FROM public.sessions s JOIN public.batches b ON b.id=s.batch_id
    WHERE b.instructor_id IS NOT NULL AND s.status='scheduled'
      AND s.starts_at BETWEEN now()+interval '20 minutes' AND now()+interval '50 minutes'
  ), added AS (
    INSERT INTO public.notifications(user_id,title,body,type,dedupe_key)
    SELECT user_id,'تذكير بموعد الجلسة',COALESCE(title,'جلسة تدريبية')||' تبدأ خلال أقل من ساعة','session',
      'session-reminder:'||session_id||':'||user_id FROM targets
    ON CONFLICT(dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING 1
  ) SELECT count(*) INTO v_count FROM added;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_close_stale_sessions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_previous_streak_week() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.close_previous_league_week() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_previous_month_bonus() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_session_reminders() FROM PUBLIC, anon, authenticated;

DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname IN (
    'masar-auto-close','masar-streak-settlement','masar-league-close','masar-month-bonus','masar-session-reminders'
  ) LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
END $$;
SELECT cron.schedule('masar-auto-close','*/15 * * * *','SELECT public.auto_close_stale_sessions()');
SELECT cron.schedule('masar-streak-settlement','15 * * * *','SELECT public.settle_previous_streak_week()');
SELECT cron.schedule('masar-league-close','35 */2 * * *','SELECT public.close_previous_league_week()');
SELECT cron.schedule('masar-month-bonus','45 */2 * * *','SELECT public.settle_previous_month_bonus()');
SELECT cron.schedule('masar-session-reminders','*/10 * * * *','SELECT public.enqueue_session_reminders()');
