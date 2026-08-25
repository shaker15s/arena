-- MASAR 3.2 — 0021: optional geofence for attendance (P2).
--
-- Adds an OPT-IN geofence to a batch. When `geofence_enabled` is true, a student
-- scanning a QR code or entering the 6-digit code must be within `radius_m` of
-- the batch's (latitude, longitude). If coordinates are missing the check-in is
-- refused (`location_required`); if outside the radius it is refused (`offsite`).
-- Batches default to geofence DISABLED, so existing flows are unchanged.

BEGIN;

ALTER TABLE public.batches
  ADD COLUMN IF NOT EXISTS geofence_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS radius_m INTEGER NOT NULL DEFAULT 500;

-- Haversine distance in meters (Great-circle).
CREATE OR REPLACE FUNCTION public._haversine_m(
  p_lat1 DOUBLE PRECISION, p_lng1 DOUBLE PRECISION,
  p_lat2 DOUBLE PRECISION, p_lng2 DOUBLE PRECISION
)
RETURNS DOUBLE PRECISION
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $$
  SELECT 6371000 * 2 * asin(sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2) +
    cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
  ))
$$;
REVOKE ALL ON FUNCTION public._haversine_m(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon, authenticated;

-- check_in_with_token(p_payload, p_lat, p_lng): adds an optional location; the
-- server is the enforcement boundary (the client only supplies the reading).
CREATE OR REPLACE FUNCTION public.check_in_with_token(
  p_payload TEXT,
  p_lat DOUBLE PRECISION DEFAULT NULL,
  p_lng DOUBLE PRECISION DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_user UUID := public.my_profile_id(); v public.sessions%ROWTYPE;
        v_parts TEXT[]; v_slot BIGINT; v_current BIGINT; v_method TEXT := 'qr';
        v_elapsed NUMERIC; v_late INTEGER; v_points INTEGER; v_status TEXT;
        v_existing TEXT; v_recent_fails INTEGER;
        v_gf_enabled BOOLEAN; v_gf_lat DOUBLE PRECISION; v_gf_lng DOUBLE PRECISION; v_gf_radius INTEGER;
BEGIN
  IF v_user IS NULL OR public.my_role() <> 'student' THEN RAISE EXCEPTION 'authentication_required'; END IF;
  p_payload := btrim(p_payload);
  IF p_payload ~ '^MSRQ:[0-9a-fA-F-]{36}:[0-9]+:[0-9a-f]{20}$' THEN
    v_parts := string_to_array(p_payload, ':');
    SELECT * INTO v FROM public.sessions WHERE id = v_parts[2]::uuid FOR UPDATE;
    IF NOT FOUND OR v.status <> 'live' OR v.qr_seed IS NULL THEN RETURN jsonb_build_object('kind','no_session'); END IF;
    v_slot := v_parts[3]::bigint;
    v_current := GREATEST(0, floor(extract(epoch FROM (clock_timestamp() - v.started_at)) / 25)::bigint);
    IF v_slot NOT IN (v_current, v_current - 1)
       OR public._qr_signature(v.qr_seed, v.id, v_slot) <> v_parts[4]
    THEN RETURN jsonb_build_object('kind','expired'); END IF;
  ELSIF p_payload ~ '^[0-9]{6}$' THEN
    v_method := 'code';
    -- Rate limit: 8 failed guesses per 10 minutes locks 6-digit entry.
    SELECT count(*) INTO v_recent_fails FROM public.checkin_attempts
    WHERE user_id = v_user AND attempted_at > now() - interval '10 minutes';
    IF v_recent_fails >= 8 THEN
      INSERT INTO public.audit_log(actor_id, action, target, payload)
      VALUES (v_user, 'checkin_rate_limited', v_user::text,
              jsonb_build_object('recent_fails', v_recent_fails));
      RETURN jsonb_build_object('kind','rate_limited');
    END IF;
    SELECT s.* INTO v FROM public.sessions s
    JOIN public.enrollments e ON e.batch_id = s.batch_id AND e.user_id = v_user AND e.status = 'active'
    WHERE s.status = 'live' AND s.qr_seed IS NOT NULL
      AND public._backup_code(s.qr_seed, s.id) = p_payload
    LIMIT 1 FOR UPDATE OF s;
    IF NOT FOUND THEN
      INSERT INTO public.checkin_attempts(user_id) VALUES (v_user);
      RETURN jsonb_build_object('kind','no_session');
    END IF;
    -- Successful match clears the failure window.
    DELETE FROM public.checkin_attempts WHERE user_id = v_user;
  ELSE
    RETURN jsonb_build_object('kind','invalid');
  END IF;

  -- Geofence (اختياري): يُفعَّل فقط على مجموعات مفعّلة.
  SELECT geofence_enabled, latitude, longitude, radius_m
    INTO v_gf_enabled, v_gf_lat, v_gf_lng, v_gf_radius
    FROM public.batches WHERE id = v.batch_id;
  IF v_gf_enabled THEN
    IF p_lat IS NULL OR p_lng IS NULL THEN RETURN jsonb_build_object('kind','location_required'); END IF;
    IF public._haversine_m(p_lat, p_lng, v_gf_lat, v_gf_lng) > v_gf_radius THEN
      RETURN jsonb_build_object('kind','offsite');
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.enrollments e WHERE e.batch_id = v.batch_id AND e.user_id = v_user AND e.status = 'active')
  THEN RETURN jsonb_build_object('kind','not_enrolled'); END IF;
  SELECT status INTO v_existing FROM public.attendance WHERE session_id = v.id AND user_id = v_user;
  IF v_existing IS NOT NULL AND v_existing <> 'absent' THEN RETURN jsonb_build_object('kind','already'); END IF;

  v_elapsed := extract(epoch FROM (clock_timestamp() - COALESCE(v.started_at, v.starts_at))) / 60;
  IF v_elapsed > 30 THEN RETURN jsonb_build_object('kind','too_late'); END IF;
  SELECT COALESCE((value->>'value')::int, 15) INTO v_late FROM public.gamification_rules WHERE key = 'attendance.late_window_min';
  v_late := COALESCE(v_late, 15);
  v_status := CASE WHEN v_elapsed <= v_late THEN 'present' ELSE 'late' END;
  SELECT COALESCE((value->>'value')::int, CASE WHEN v_status='present' THEN 10 ELSE 7 END)
  INTO v_points FROM public.gamification_rules WHERE key = 'points.' || v_status;
  v_points := COALESCE(v_points, CASE WHEN v_status='present' THEN 10 ELSE 7 END);

  INSERT INTO public.attendance(session_id, user_id, status, checked_in_at, method)
  VALUES(v.id, v_user, v_status, now(), v_method)
  ON CONFLICT(session_id,user_id) DO UPDATE SET status=EXCLUDED.status, checked_in_at=EXCLUDED.checked_in_at, method=EXCLUDED.method;
  INSERT INTO public.point_events(user_id, points, reason_code, ref_type, ref_id, idempotency_key)
  VALUES(v_user, v_points, 'attendance.' || v_status, 'session', v.id, 'attendance:' || v.id || ':' || v_user)
  ON CONFLICT(idempotency_key) DO NOTHING;
  PERFORM public.evaluate_user_badges(v_user);
  RETURN jsonb_build_object('kind','ok','status',v_status,'points',v_points,'session_id',v.id);
END;
$$;

REVOKE ALL ON FUNCTION public.check_in_with_token(TEXT, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_in_with_token(TEXT, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;

COMMIT;
