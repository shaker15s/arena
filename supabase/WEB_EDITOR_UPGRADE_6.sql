-- MASAR — ملف ترقية SQL Editor (مولَّد آليًا — لا تعدّله يدويًا)
-- المصدر: 0028_get_today.sql
-- توليد: node scripts/build-web-editor-sql.js 0028
-- شغّل الملف كاملًا كـ Query واحدة على مشروع مطبَّق عليه الترقيات السابقة.

-- ═══════════════ ↳ 0028_get_today.sql ═══════════════
-- Domain reads for Today / my courses (spec §09).
BEGIN;

CREATE OR REPLACE FUNCTION public.get_today()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := public.my_profile_id();
  v_live JSONB;
  v_next JSONB;
  v_pending INT;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;

  SELECT jsonb_build_object(
    'id', s.id, 'batch_id', s.batch_id, 'title', s.title, 'starts_at', s.starts_at,
    'status', s.status, 'course_title', c.title
  ) INTO v_live
  FROM public.sessions s
  JOIN public.batches b ON b.id = s.batch_id
  JOIN public.courses c ON c.id = b.course_id
  JOIN public.enrollments e ON e.batch_id = b.id AND e.user_id = v_actor AND e.status = 'active'
  WHERE s.status = 'live'
  ORDER BY s.starts_at
  LIMIT 1;

  SELECT jsonb_build_object(
    'id', s.id, 'batch_id', s.batch_id, 'title', s.title, 'starts_at', s.starts_at,
    'status', s.status, 'course_title', c.title, 'room', b.room
  ) INTO v_next
  FROM public.sessions s
  JOIN public.batches b ON b.id = s.batch_id
  JOIN public.courses c ON c.id = b.course_id
  JOIN public.enrollments e ON e.batch_id = b.id AND e.user_id = v_actor AND e.status = 'active'
  WHERE s.status = 'scheduled' AND s.starts_at >= now()
  ORDER BY s.starts_at
  LIMIT 1;

  SELECT count(*)::int INTO v_pending
  FROM public.excuses x
  WHERE x.user_id = v_actor AND x.status = 'pending';

  RETURN jsonb_build_object(
    'live', v_live,
    'next', v_next,
    'pending_excuses', v_pending
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_courses()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID := public.my_profile_id(); v_json JSONB;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'course_id', c.id,
    'title', c.title,
    'color', c.color,
    'batch_id', b.id,
    'status', e.status,
    'room', b.room
  ) ORDER BY c.title), '[]'::jsonb)
  INTO v_json
  FROM public.enrollments e
  JOIN public.batches b ON b.id = e.batch_id
  JOIN public.courses c ON c.id = b.course_id
  WHERE e.user_id = v_actor AND e.status IN ('active', 'waitlist');

  RETURN v_json;
END;
$$;

DO $$ DECLARE f REGPROCEDURE;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.get_today()'::regprocedure,
    'public.get_my_courses()'::regprocedure
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

COMMIT;
