-- MASAR 3.2 — 0011: server-side analytics layer.
-- The app computes attendance percentage and occupancy client-side from the whole Db.
-- This adds materialized reporting facts + aggregate RPCs so dashboards can answer
-- scope-based questions without loading every row into the client. All read RPCs are
-- permission-scoped via my_role / can_manage_batch, mirroring the rest of the schema.

BEGIN;

-- ── Reporting facts (read-only views, RLS-visible to authenticated) ──
CREATE OR REPLACE VIEW public.attendance_fact AS
SELECT
  a.session_id, a.user_id, a.status, a.checked_in_at,
  s.batch_id, s.starts_at, s.seq AS session_seq,
  b.branch_id, b.course_id, b.instructor_id
FROM public.attendance a
JOIN public.sessions s ON s.id = a.session_id
JOIN public.batches b ON b.id = s.batch_id;

CREATE OR REPLACE VIEW public.enrollment_fact AS
SELECT
  e.user_id, e.batch_id, e.status AS enrollment_status, e.joined_at,
  b.branch_id, b.course_id, b.instructor_id, b.status AS batch_status
FROM public.enrollments e
JOIN public.batches b ON b.id = e.batch_id;

CREATE OR REPLACE VIEW public.session_fact AS
SELECT
  s.id AS session_id, s.batch_id, s.seq, s.starts_at, s.duration_min, s.status,
  b.branch_id, b.course_id, b.instructor_id, b.capacity
FROM public.sessions s
JOIN public.batches b ON b.id = s.batch_id;

CREATE OR REPLACE VIEW public.course_fact AS
SELECT
  c.id AS course_id, c.title, c.field, c.status AS course_status, c.sessions_count,
  b.id AS batch_id, b.branch_id, b.status AS batch_status,
  count(DISTINCT CASE WHEN e.status = 'active' THEN e.user_id END) AS enrolled
FROM public.courses c
LEFT JOIN public.batches b ON b.course_id = c.id
LEFT JOIN public.enrollments e ON e.batch_id = b.id
GROUP BY c.id, c.title, c.field, c.status, c.sessions_count, b.id, b.branch_id, b.status;

-- ── Aggregate RPC: branch/course/batch/session analytics, scope-aware ──
CREATE OR REPLACE FUNCTION public.get_analytics(
  p_scope TEXT,          -- 'branch' | 'course' | 'batch' | 'session'
  p_scope_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := public.my_profile_id();
  v_json JSONB;
  v_filter TEXT;
BEGIN
  IF v_actor IS NULL OR public.my_role() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_scope NOT IN ('branch','course','batch','session') THEN RAISE EXCEPTION 'invalid_scope'; END IF;

  -- Branch/course-level (incl. global, p_scope_id IS NULL) analytics are staff-only.
  IF p_scope IN ('branch','course') AND NOT public.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- Batch / session: manager or a member of the batch may read.
  IF p_scope = 'batch' AND p_scope_id IS NOT NULL AND NOT public.can_manage_batch(p_scope_id)
     AND NOT EXISTS(SELECT 1 FROM public.enrollments WHERE batch_id = p_scope_id AND user_id = v_actor)
  THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_scope = 'session' AND p_scope_id IS NOT NULL THEN
    IF NOT EXISTS(
      SELECT 1 FROM public.sessions s JOIN public.batches b ON b.id = s.batch_id
      WHERE s.id = p_scope_id AND (public.can_manage_batch(b.id) OR EXISTS(
        SELECT 1 FROM public.enrollments e WHERE e.batch_id = b.id AND e.user_id = v_actor))
    ) THEN RAISE EXCEPTION 'forbidden'; END IF;
  END IF;
  IF p_scope = 'batch' AND p_scope_id IS NULL AND NOT public.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- Filter predicates applied consistently across the three facts.
  IF p_scope_id IS NULL THEN
    v_filter := 'TRUE';
  ELSE
    v_filter := CASE p_scope
      WHEN 'branch'  THEN format('branch_id = %L', p_scope_id)
      WHEN 'course'  THEN format('course_id = %L', p_scope_id)
      WHEN 'batch'   THEN format('batch_id = %L', p_scope_id)
      WHEN 'session' THEN format('session_id = %L', p_scope_id)
    END;
  END IF;

  EXECUTE format(
    'SELECT jsonb_build_object(''scope'', %L, ''scope_id'', %L, '
    ' ''sessions'', (SELECT count(*) FROM public.session_fact WHERE %s), '
    ' ''enrollments'', (SELECT count(*) FROM public.enrollment_fact WHERE %s AND enrollment_status = ''active''), '
    ' ''attendance'', (SELECT count(*) FROM public.attendance_fact WHERE %s AND status <> ''absent''), '
    ' ''attendanceRatio'', '
    '   CASE WHEN (SELECT count(*) FROM public.attendance_fact WHERE %s) = 0 THEN 0 '
    '   ELSE round(100.0 * '
    '     (SELECT count(*) FROM public.attendance_fact WHERE %s AND status <> ''absent'') '
    '     / (SELECT count(*) FROM public.attendance_fact WHERE %s)) END)',
    p_scope, p_scope_id, v_filter, v_filter, v_filter, v_filter, v_filter, v_filter
  ) INTO v_json;

  RETURN v_json;
END;
$$;

REVOKE ALL ON FUNCTION public.get_analytics(text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_analytics(text,uuid) TO authenticated;

COMMIT;
