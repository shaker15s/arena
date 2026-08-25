-- MASAR 3.2 — 0018: course edit details (CRIT-FUNC-01).
-- The client calls `update_course_details` from CourseManagementScreen (edit course
-- sheet), but no such function existed in the schema, so "edit course" always
-- failed with "function public.update_course_details(...) does not exist".
-- This adds a validated, audited RPC with the same authorization (manager only)
-- and validation rules as create_course, minus color (not editable here).

BEGIN;

CREATE OR REPLACE FUNCTION public.update_course_details(
  p_course_id UUID,
  p_title TEXT,
  p_field TEXT,
  p_description TEXT,
  p_topics TEXT[],
  p_sessions_count INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor UUID := public.my_profile_id(); v_old TEXT;
BEGIN
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF char_length(btrim(COALESCE(p_title,''))) NOT BETWEEN 3 AND 160
     OR char_length(btrim(COALESCE(p_field,''))) NOT BETWEEN 2 AND 100
     OR char_length(COALESCE(p_description,''))>4000
     OR p_sessions_count NOT BETWEEN 1 AND 100
     OR NOT EXISTS(SELECT 1 FROM public.courses WHERE id=p_course_id)
  THEN RAISE EXCEPTION 'invalid_course'; END IF;

  SELECT title INTO v_old FROM public.courses WHERE id=p_course_id;
  UPDATE public.courses
    SET title = btrim(p_title),
        field = btrim(p_field),
        description = NULLIF(btrim(p_description),''),
        topics = COALESCE(p_topics,'{}'),
        sessions_count = p_sessions_count
  WHERE id = p_course_id;  -- updated_at يُحدَّث تلقائيًا عبر trigger

  INSERT INTO public.audit_log(actor_id, action, target, payload)
  VALUES (v_actor, 'update_course', p_course_id::text,
    jsonb_build_object('old_title', v_old, 'title', btrim(p_title),
                       'sessions_count', p_sessions_count));

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.update_course_details(uuid,text,text,text,text[],integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_course_details(uuid,text,text,text,text[],integer) TO authenticated;

COMMIT;
