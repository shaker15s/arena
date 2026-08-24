-- MASAR 3.2 — 0012: domain query layer (P0 from the audit, §8 item 1).
-- Today the client loads the whole Db (~23 tables) via fetchRemoteDb and derives
-- every course/batch/session view locally. This is DATA-001: the single biggest
-- scale + authorization risk. These read RPCs let a screen ask the server for exactly
-- one domain object, permission-scoped, without dragging the entire database to the
-- device. Each is STABLE SECURITY DEFINER and authorizes via can_manage_batch /
-- enrollment membership, mirroring get_analytics (0011).

BEGIN;

-- ── Course overview: course + its batches w/ live occupancy & attendance ──
CREATE OR REPLACE FUNCTION public.get_course_overview(p_course_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID := public.my_profile_id(); v_json JSONB;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.courses c
    LEFT JOIN public.batches b ON b.course_id = c.id
    WHERE c.id = p_course_id AND (
      public.is_manager()
      OR b.instructor_id = v_actor
      OR EXISTS(SELECT 1 FROM public.enrollments e WHERE e.batch_id = b.id AND e.user_id = v_actor)
    )
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT jsonb_build_object(
    'course', (SELECT row_to_json(c) FROM public.courses c WHERE c.id = p_course_id),
    'batches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', b.id, 'branch_id', b.branch_id, 'instructor_id', b.instructor_id,
        'capacity', b.capacity, 'room', b.room, 'status', b.status, 'join_code', b.join_code,
        'start_date', b.start_date, 'schedule', b.schedule,
        'enrolled', (SELECT count(*) FROM public.enrollments e WHERE e.batch_id = b.id AND e.status = 'active'),
        'waitlist', (SELECT count(*) FROM public.enrollments e WHERE e.batch_id = b.id AND e.status = 'waitlist'),
        'attendance', (SELECT count(*) FROM public.attendance a JOIN public.sessions s ON s.id = a.session_id WHERE s.batch_id = b.id AND a.status <> 'absent'),
        'attendancePct', (
          SELECT CASE WHEN count(*) = 0 THEN 0
            ELSE round(100.0 * count(*) FILTER (WHERE a.status <> 'absent') / count(*))
          END FROM public.attendance a JOIN public.sessions s ON s.id = a.session_id WHERE s.batch_id = b.id
        )
      ))
      FROM public.batches b WHERE b.course_id = p_course_id
    ), '[]'::jsonb)
  ) INTO v_json;
  RETURN v_json;
END;
$$;

-- ── Batch roster: enrolled students (PII-muted for non-privileged) ──
CREATE OR REPLACE FUNCTION public.get_batch_roster(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID := public.my_profile_id(); v_can_manage BOOLEAN; v_json JSONB;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  v_can_manage := public.can_manage_batch(p_batch_id);

  SELECT jsonb_build_object(
    'batch', (SELECT row_to_json(b) FROM public.batches b WHERE b.id = p_batch_id),
    'students', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'avatar_url', p.avatar_url, 'avatar_color', p.avatar_color,
        'email', CASE WHEN v_can_manage THEN p.email ELSE NULL END,
        'phone', CASE WHEN v_can_manage THEN p.phone ELSE NULL END,
        'status', e.status, 'joined_at', e.joined_at,
        'attended', (SELECT count(*) FROM public.attendance a WHERE a.user_id = p.id AND a.status <> 'absent'),
        'absent', (SELECT count(*) FROM public.attendance a WHERE a.user_id = p.id AND a.status = 'absent')
      ))
      FROM public.enrollments e JOIN public.profiles p ON p.id = e.user_id
      WHERE e.batch_id = p_batch_id
    ), '[]'::jsonb)
  ) INTO v_json;
  RETURN v_json;
END;
$$;

-- ── Batch sessions with per-session attendance summary ──
CREATE OR REPLACE FUNCTION public.get_batch_sessions(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID := public.my_profile_id(); v_json JSONB;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT public.can_manage_batch(p_batch_id)
     AND NOT EXISTS(SELECT 1 FROM public.enrollments WHERE batch_id = p_batch_id AND user_id = v_actor)
  THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id, 'seq', s.seq, 'title', s.title, 'starts_at', s.starts_at,
    'duration_min', s.duration_min, 'status', s.status, 'report', s.report,
    'present', (SELECT count(*) FROM public.attendance a WHERE a.session_id = s.id AND a.status IN ('present','late')),
    'absent', (SELECT count(*) FROM public.attendance a WHERE a.session_id = s.id AND a.status = 'absent'),
    'excused', (SELECT count(*) FROM public.attendance a WHERE a.session_id = s.id AND a.status = 'excused')
  ) ORDER BY s.seq), '[]'::jsonb)
  INTO v_json
  FROM public.sessions s WHERE s.batch_id = p_batch_id;
  RETURN v_json;
END;
$$;

-- ── Single-session roster: attendance records for a session ──
CREATE OR REPLACE FUNCTION public.get_session_roster(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID := public.my_profile_id(); v_batch UUID; v_json JSONB;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT batch_id INTO v_batch FROM public.sessions WHERE id = p_session_id;
  IF v_batch IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT public.can_manage_batch(v_batch)
     AND NOT EXISTS(SELECT 1 FROM public.enrollments WHERE batch_id = v_batch AND user_id = v_actor)
  THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id, 'user_id', a.user_id, 'full_name', p.full_name,
    'status', a.status, 'checked_in_at', a.checked_in_at, 'method', a.method, 'note', a.note
  ) ORDER BY p.full_name), '[]'::jsonb)
  INTO v_json
  FROM public.attendance a JOIN public.profiles p ON p.id = a.user_id
  WHERE a.session_id = p_session_id;
  RETURN v_json;
END;
$$;

-- Grants (SECURITY DEFINER resets ACL to owner).
DO $$ DECLARE f REGPROCEDURE;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.get_course_overview(uuid)'::regprocedure,
    'public.get_batch_roster(uuid)'::regprocedure,
    'public.get_batch_sessions(uuid)'::regprocedure,
    'public.get_session_roster(uuid)'::regprocedure
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

COMMIT;
