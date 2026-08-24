-- MASAR 3.2 — 0017: batch completion no longer depends on courses.sessions_count.
--
-- close_training_session / auto_close_stale_sessions / issue_batch_certificates
-- required count(sessions) == courses.sessions_count. If an admin edited the
-- course's sessions_count after batches were generated, those batches could
-- silently NEVER complete and certificates could never be issued. The truth is
-- the batch's own generated sessions: a batch is complete when it has at least
-- one session, every session is closed, and it has at least one active student.

BEGIN;

CREATE OR REPLACE FUNCTION public._batch_is_complete(p_batch_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT EXISTS(SELECT 1 FROM public.sessions s WHERE s.batch_id = p_batch_id)
     AND NOT EXISTS(SELECT 1 FROM public.sessions s WHERE s.batch_id = p_batch_id AND s.status <> 'closed')
     AND EXISTS(SELECT 1 FROM public.enrollments e WHERE e.batch_id = p_batch_id AND e.status = 'active')
$$;
REVOKE ALL ON FUNCTION public._batch_is_complete(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.close_training_session(p_session_id UUID, p_report JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v public.sessions%ROWTYPE; v_actor UUID := public.my_profile_id();
        v_remaining INTEGER; v_total INTEGER; v_present INTEGER; v_late INTEGER; v_absent INTEGER; v_excused INTEGER;
BEGIN
  SELECT * INTO v FROM public.sessions WHERE id=p_session_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_batch(v.batch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v.status <> 'live' THEN RAISE EXCEPTION 'session_not_live'; END IF;
  IF jsonb_typeof(COALESCE(p_report,'{}'::jsonb))<>'object'
     OR char_length(COALESCE(p_report->>'done',''))>4000
     OR char_length(COALESCE(p_report->>'planned',''))>4000
     OR char_length(COALESCE(p_report->>'challenges',''))>4000
  THEN RAISE EXCEPTION 'invalid_report'; END IF;
  p_report:=jsonb_build_object(
    'done',COALESCE(p_report->>'done',''),'planned',COALESCE(p_report->>'planned',''),
    'challenges',COALESCE(p_report->>'challenges',''),
    'submittedAt',floor(extract(epoch FROM now())*1000)
  );
  INSERT INTO public.attendance(session_id,user_id,status)
  SELECT v.id,e.user_id,'absent' FROM public.enrollments e
  WHERE e.batch_id=v.batch_id AND e.status='active'
  ON CONFLICT(session_id,user_id) DO NOTHING;
  UPDATE public.sessions SET status='closed',closed_at=now(),qr_seed=NULL,report=p_report WHERE id=v.id;
  SELECT count(*) FILTER(WHERE status='present'), count(*) FILTER(WHERE status='late'),
         count(*) FILTER(WHERE status='absent'), count(*) FILTER(WHERE status='excused'), count(*)
  INTO v_present,v_late,v_absent,v_excused,v_total FROM public.attendance WHERE session_id=v.id;
  SELECT count(*) INTO v_remaining FROM public.sessions WHERE batch_id=v.batch_id AND status<>'closed';
  IF v_remaining=0 THEN
    -- 0017: completion derives from the batch's own sessions (all closed +
    -- at least one active student) — no dependence on courses.sessions_count.
    UPDATE public.batches b SET status='completed',updated_at=now()
    WHERE b.id=v.batch_id AND public._batch_is_complete(b.id);
  END IF;
  INSERT INTO public.audit_log(actor_id,action,target,payload)
  VALUES(v_actor,'close_session',v.id::text,jsonb_build_object('batch_id',v.batch_id,'total',v_total));
  RETURN jsonb_build_object('ok',TRUE,'present',v_present,'late',v_late,'absent',v_absent,'excused',v_excused,'total',v_total);
END;
$$;

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
      WHERE b.id=r.batch_id AND public._batch_is_complete(b.id);
    END IF;
    INSERT INTO public.audit_log(actor_id,action,target,payload)
    VALUES(NULL,'auto_close_session',r.id::text,jsonb_build_object('batch_id',r.batch_id));
    v_closed:=v_closed+1;
  END LOOP;
  RETURN v_closed;
END;
$$;
REVOKE ALL ON FUNCTION public.auto_close_stale_sessions() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.issue_batch_certificates(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID:=public.my_profile_id(); v_pct INTEGER; v_points INTEGER; v_issued INTEGER:=0; r RECORD; v_serial TEXT;
BEGIN
  IF NOT public.can_manage_batch(p_batch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.batches b
    WHERE b.id=p_batch_id AND b.status='completed' AND public._batch_is_complete(b.id)
  ) THEN RAISE EXCEPTION 'batch_not_completed'; END IF;
  SELECT COALESCE((value->>'value')::int,75) INTO v_pct FROM public.gamification_rules WHERE key='certificate.min_attendance_pct';
  SELECT COALESCE((value->>'value')::int,100) INTO v_points FROM public.gamification_rules WHERE key='points.course_complete';
  FOR r IN
    SELECT e.user_id,
      count(s.id) AS total,
      count(a.session_id) FILTER(WHERE a.status<>'absent') AS honored
    FROM public.enrollments e
    JOIN public.sessions s ON s.batch_id=e.batch_id AND s.status='closed'
    LEFT JOIN public.attendance a ON a.session_id=s.id AND a.user_id=e.user_id
    WHERE e.batch_id=p_batch_id AND e.status='active'
    GROUP BY e.user_id
  LOOP
    IF r.total>0 AND (r.honored*100.0/r.total)>=COALESCE(v_pct,75)
       AND NOT EXISTS(SELECT 1 FROM public.certificates WHERE user_id=r.user_id AND batch_id=p_batch_id)
    THEN
      v_serial:='MSR-'||to_char(now(),'YYYY')||'-'||upper(substr(encode(extensions.gen_random_bytes(8),'hex'),1,12));
      INSERT INTO public.certificates(user_id,batch_id,serial) VALUES(r.user_id,p_batch_id,v_serial)
      ON CONFLICT(user_id,batch_id) DO NOTHING;
      IF NOT FOUND THEN CONTINUE; END IF;
      INSERT INTO public.point_events(user_id,points,reason_code,ref_type,ref_id,idempotency_key)
      VALUES(r.user_id,COALESCE(v_points,100),'course.complete','batch',p_batch_id,'course.complete:'||p_batch_id||':'||r.user_id)
      ON CONFLICT(idempotency_key) DO NOTHING;
      INSERT INTO public.notifications(user_id,title,body,type) VALUES(r.user_id,'شهادتك جاهزة','يمكنك تنزيلها ومشاركتها الآن.','cert');
      PERFORM public.evaluate_user_badges(r.user_id);
      v_issued:=v_issued+1;
    END IF;
  END LOOP;
  INSERT INTO public.audit_log(actor_id,action,target,payload)
  VALUES(v_actor,'issue_certificates',p_batch_id::text,jsonb_build_object('issued',v_issued));
  RETURN jsonb_build_object('ok',TRUE,'issued',v_issued);
END;
$$;

-- submit_course_rating had the same sessions_count coupling in its
-- "course completed" eligibility check.
CREATE OR REPLACE FUNCTION public.submit_course_rating(p_course_id UUID, p_stars INTEGER, p_comment TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_user UUID:=public.my_profile_id(); v_points INTEGER;
BEGIN
  IF v_user IS NULL OR p_stars NOT BETWEEN 1 AND 5 OR char_length(COALESCE(p_comment,''))>2000
  THEN RAISE EXCEPTION 'invalid_rating'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.enrollments e JOIN public.batches b ON b.id=e.batch_id
    WHERE e.user_id=v_user AND e.status='active' AND b.course_id=p_course_id
      AND b.status='completed' AND public._batch_is_complete(b.id)
  ) THEN RAISE EXCEPTION 'course_not_completed'; END IF;
  INSERT INTO public.course_ratings(user_id,course_id,stars,comment)
  VALUES(v_user,p_course_id,p_stars,NULLIF(btrim(p_comment),''))
  ON CONFLICT(user_id,course_id) DO UPDATE SET stars=EXCLUDED.stars,comment=EXCLUDED.comment;
  SELECT COALESCE((value->>'value')::int,5) INTO v_points FROM public.gamification_rules WHERE key='points.rating';
  INSERT INTO public.point_events(user_id,points,reason_code,ref_type,ref_id,idempotency_key)
  VALUES(v_user,COALESCE(v_points,5),'rating','course',p_course_id,'rating:'||p_course_id||':'||v_user)
  ON CONFLICT(idempotency_key) DO NOTHING;
  PERFORM public.evaluate_user_badges(v_user);
  RETURN jsonb_build_object('ok',TRUE);
END;
$$;

-- Repair batches already stuck by the old rule: all sessions closed but the
-- batch never flipped to completed because sessions_count drifted.
UPDATE public.batches b SET status='completed', updated_at=now()
WHERE b.status IN ('scheduled','active')
  AND public._batch_is_complete(b.id);

COMMIT;
