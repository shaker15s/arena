-- MASAR 3.2 — 0007: room-collision validation in batch publication (BATCH-001).
-- The prior create_batch_with_sessions only rejected instructor schedule overlaps.
-- A batch could be published into a room already booked by another active/scheduled
-- batch at the same time. This redefines the function to also reject room conflicts
-- within the same branch (rooms are per-branch physical spaces).

BEGIN;

CREATE OR REPLACE FUNCTION public.create_batch_with_sessions(
  p_course_id UUID, p_branch_id UUID, p_instructor_id UUID, p_capacity INTEGER,
  p_schedule JSONB, p_start_date DATE, p_room TEXT, p_sessions JSONB
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID:=public.my_profile_id(); v_batch UUID; v_join TEXT;
  v_expected INTEGER; v_count INTEGER;
BEGIN
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT sessions_count INTO v_expected FROM public.courses WHERE id=p_course_id AND status='published';
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.branches WHERE id=p_branch_id AND status='active')
     OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_instructor_id AND status='active' AND role IN ('volunteer','supervisor','admin'))
     OR p_capacity NOT BETWEEN 1 AND 500 OR p_start_date IS NULL
     OR char_length(btrim(COALESCE(p_room,''))) NOT BETWEEN 1 AND 120
     OR jsonb_typeof(p_schedule)<>'object' OR jsonb_typeof(p_sessions)<>'array'
  THEN RAISE EXCEPTION 'invalid_batch'; END IF;
  v_count:=jsonb_array_length(p_sessions);
  IF v_count<>v_expected THEN RAISE EXCEPTION 'invalid_session_count'; END IF;

  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_sessions) WITH ORDINALITY x(item,ord)
    WHERE (item->>'seq')::INTEGER<>ord
      OR char_length(btrim(COALESCE(item->>'title',''))) NOT BETWEEN 1 AND 200
      OR (item->>'duration_min')::INTEGER NOT BETWEEN 15 AND 600
      OR (item->>'starts_at')::TIMESTAMPTZ < now()-interval '1 day'
  ) THEN RAISE EXCEPTION 'invalid_sessions'; END IF;

  IF EXISTS(
    SELECT 1
    FROM jsonb_array_elements(p_sessions) WITH ORDINALITY a(item,ord)
    JOIN jsonb_array_elements(p_sessions) WITH ORDINALITY b(item,ord) ON a.ord<b.ord
    WHERE tstzrange(
      (a.item->>'starts_at')::TIMESTAMPTZ,
      (a.item->>'starts_at')::TIMESTAMPTZ+make_interval(mins=>(a.item->>'duration_min')::INTEGER),'[)'
    ) && tstzrange(
      (b.item->>'starts_at')::TIMESTAMPTZ,
      (b.item->>'starts_at')::TIMESTAMPTZ+make_interval(mins=>(b.item->>'duration_min')::INTEGER),'[)'
    )
  ) THEN RAISE EXCEPTION 'sessions_overlap'; END IF;

  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_sessions) n(item)
    JOIN public.sessions s ON tstzrange(
      (n.item->>'starts_at')::TIMESTAMPTZ,
      (n.item->>'starts_at')::TIMESTAMPTZ+make_interval(mins=>(n.item->>'duration_min')::INTEGER),'[)'
    ) && tstzrange(s.starts_at,s.starts_at+make_interval(mins=>s.duration_min),'[)')
    JOIN public.batches b ON b.id=s.batch_id
    WHERE b.instructor_id=p_instructor_id AND s.status<>'closed'
  ) THEN RAISE EXCEPTION 'instructor_schedule_conflict'; END IF;

  -- Room is a per-branch physical space; reject if any new session overlaps a
  -- non-closed session already booked by another batch in the same branch/room.
  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_sessions) n(item)
    JOIN public.sessions s ON tstzrange(
      (n.item->>'starts_at')::TIMESTAMPTZ,
      (n.item->>'starts_at')::TIMESTAMPTZ+make_interval(mins=>(n.item->>'duration_min')::INTEGER),'[)'
    ) && tstzrange(s.starts_at,s.starts_at+make_interval(mins=>s.duration_min),'[)')
    JOIN public.batches b ON b.id=s.batch_id
    WHERE b.branch_id=p_branch_id
      AND b.room IS NOT NULL
      AND upper(btrim(b.room))=upper(btrim(p_room))
      AND s.status<>'closed'
  ) THEN RAISE EXCEPTION 'room_schedule_conflict'; END IF;

  v_join:='MSR-'||upper(substr(encode(extensions.gen_random_bytes(8),'hex'),1,12));
  INSERT INTO public.batches(course_id,branch_id,instructor_id,capacity,schedule,start_date,room,status,join_code)
  VALUES(p_course_id,p_branch_id,p_instructor_id,p_capacity,p_schedule,p_start_date,btrim(p_room),'scheduled',v_join)
  RETURNING id INTO v_batch;
  INSERT INTO public.sessions(batch_id,seq,title,starts_at,duration_min,status)
  SELECT v_batch,(item->>'seq')::INTEGER,btrim(item->>'title'),(item->>'starts_at')::TIMESTAMPTZ,
         (item->>'duration_min')::INTEGER,'scheduled'
  FROM jsonb_array_elements(p_sessions) x(item);
  INSERT INTO public.audit_log(actor_id,action,target,payload)
  VALUES(v_actor,'create_batch',v_batch::text,jsonb_build_object('course_id',p_course_id,'branch_id',p_branch_id,'sessions',v_count));
  RETURN jsonb_build_object('ok',TRUE,'batch_id',v_batch,'join_code',v_join);
END;
$$;

-- Reapply the explicit grant (redefining a function resets its ACL to the owner).
REVOKE ALL ON FUNCTION public.create_batch_with_sessions(uuid,uuid,uuid,integer,jsonb,date,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_batch_with_sessions(uuid,uuid,uuid,integer,jsonb,date,text,jsonb) TO authenticated;

COMMIT;
