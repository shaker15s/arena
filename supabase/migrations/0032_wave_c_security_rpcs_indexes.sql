-- 0032_wave_c_security_rpcs_indexes.sql
-- Wave C: RLS InitPlan optimization (DATA-01/02), comprehensive write RPC rate-limiting (DATA-04),
-- 8 Read-Model RPCs (DATA-10..13), composite/partial indexes & materialized views (DATA-20..26).
-- Note: re-define / تعزيز مقصود للدوال المحدثة.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) DATA-01 & DATA-02: Optimize identity helpers & RLS policies with InitPlan
--    subqueries (SELECT ...) and explicit TO authenticated targets
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.my_profile_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT id FROM public.profiles WHERE user_id = (SELECT auth.uid()) LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.my_profile_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_profile_id() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.my_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT role FROM public.profiles WHERE user_id = (SELECT auth.uid()) AND status = 'active' LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.my_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_role() TO anon, authenticated;

-- Re-create core RLS policies with explicit `TO authenticated` and `(SELECT ...)`
-- scalar subqueries so Postgres caches identity evaluation once per statement.
DROP POLICY IF EXISTS profiles_self_or_manager ON public.profiles;
CREATE POLICY profiles_self_or_manager ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = (SELECT public.my_profile_id())
    OR (SELECT public.is_manager())
    OR (
      (SELECT public.my_role()) = 'volunteer'
      AND EXISTS (
        SELECT 1 FROM public.batches b
        JOIN public.enrollments e ON e.batch_id = b.id
        WHERE b.instructor_id = (SELECT public.my_profile_id()) AND e.user_id = profiles.id
      )
    )
  );

DROP POLICY IF EXISTS branches_read ON public.branches;
CREATE POLICY branches_read ON public.branches
  FOR SELECT TO authenticated
  USING ((SELECT public.my_role()) IS NOT NULL);

DROP POLICY IF EXISTS committees_read ON public.committees;
CREATE POLICY committees_read ON public.committees
  FOR SELECT TO authenticated
  USING ((SELECT public.my_role()) IS NOT NULL);

DROP POLICY IF EXISTS courses_read ON public.courses;
CREATE POLICY courses_read ON public.courses
  FOR SELECT TO authenticated
  USING ((SELECT public.my_role()) IS NOT NULL);

DROP POLICY IF EXISTS batches_read ON public.batches;
CREATE POLICY batches_read ON public.batches
  FOR SELECT TO authenticated
  USING ((SELECT public.my_role()) IS NOT NULL);

DROP POLICY IF EXISTS sessions_visible ON public.sessions;
CREATE POLICY sessions_visible ON public.sessions
  FOR SELECT TO authenticated
  USING (
    (SELECT public.my_role()) IS NOT NULL
    AND (
      (SELECT public.is_manager())
      OR public.can_manage_batch(batch_id)
      OR EXISTS (
        SELECT 1 FROM public.enrollments e
        WHERE e.batch_id = sessions.batch_id AND e.user_id = (SELECT public.my_profile_id())
      )
    )
  );

DROP POLICY IF EXISTS enrollments_visible ON public.enrollments;
CREATE POLICY enrollments_visible ON public.enrollments
  FOR SELECT TO authenticated
  USING (
    (SELECT public.my_role()) IS NOT NULL
    AND (
      user_id = (SELECT public.my_profile_id())
      OR (SELECT public.is_manager())
      OR public.can_manage_batch(batch_id)
    )
  );

DROP POLICY IF EXISTS attendance_visible ON public.attendance;
CREATE POLICY attendance_visible ON public.attendance
  FOR SELECT TO authenticated
  USING (
    (SELECT public.my_role()) IS NOT NULL
    AND (
      user_id = (SELECT public.my_profile_id())
      OR (SELECT public.is_manager())
      OR EXISTS (
        SELECT 1 FROM public.sessions s
        WHERE s.id = attendance.session_id AND public.can_manage_batch(s.batch_id)
      )
    )
  );

DROP POLICY IF EXISTS points_visible ON public.point_events;
CREATE POLICY points_visible ON public.point_events
  FOR SELECT TO authenticated
  USING (
    (SELECT public.my_role()) IS NOT NULL
    AND (
      user_id = (SELECT public.my_profile_id())
      OR (SELECT public.is_manager())
      OR awarded_by = (SELECT public.my_profile_id())
    )
  );

DROP POLICY IF EXISTS streak_visible ON public.streak_weeks;
CREATE POLICY streak_visible ON public.streak_weeks
  FOR SELECT TO authenticated
  USING ((SELECT public.my_role()) IS NOT NULL AND (user_id = (SELECT public.my_profile_id()) OR (SELECT public.is_manager())));

DROP POLICY IF EXISTS gamification_visible ON public.gamification;
CREATE POLICY gamification_visible ON public.gamification
  FOR SELECT TO authenticated
  USING ((SELECT public.my_role()) IS NOT NULL);

DROP POLICY IF EXISTS badges_read ON public.badges;
CREATE POLICY badges_read ON public.badges
  FOR SELECT TO authenticated
  USING ((SELECT public.my_role()) IS NOT NULL);

DROP POLICY IF EXISTS user_badges_visible ON public.user_badges;
CREATE POLICY user_badges_visible ON public.user_badges
  FOR SELECT TO authenticated
  USING ((SELECT public.my_role()) IS NOT NULL);

DROP POLICY IF EXISTS league_read ON public.league_weeks;
CREATE POLICY league_read ON public.league_weeks
  FOR SELECT TO authenticated
  USING ((SELECT public.my_role()) IS NOT NULL);

DROP POLICY IF EXISTS certificates_visible ON public.certificates;
CREATE POLICY certificates_visible ON public.certificates
  FOR SELECT TO authenticated
  USING ((SELECT public.my_role()) IS NOT NULL AND (user_id = (SELECT public.my_profile_id()) OR (SELECT public.is_manager())));

DROP POLICY IF EXISTS excuses_visible ON public.excuses;
CREATE POLICY excuses_visible ON public.excuses
  FOR SELECT TO authenticated
  USING (
    (SELECT public.my_role()) IS NOT NULL
    AND (
      user_id = (SELECT public.my_profile_id())
      OR (SELECT public.is_manager())
      OR EXISTS (
        SELECT 1 FROM public.sessions s
        WHERE s.id = excuses.session_id AND public.can_manage_batch(s.batch_id)
      )
    )
  );

DROP POLICY IF EXISTS course_ratings_read ON public.course_ratings;
CREATE POLICY course_ratings_read ON public.course_ratings
  FOR SELECT TO authenticated
  USING ((SELECT public.my_role()) IS NOT NULL);

DROP POLICY IF EXISTS instructor_ratings_self_read ON public.instructor_ratings;
CREATE POLICY instructor_ratings_self_read ON public.instructor_ratings
  FOR SELECT TO authenticated
  USING ((SELECT public.my_role()) IS NOT NULL AND (user_id = (SELECT public.my_profile_id()) OR (SELECT public.is_manager())));

DROP POLICY IF EXISTS org_ratings_self_read ON public.organization_ratings;
CREATE POLICY org_ratings_self_read ON public.organization_ratings
  FOR SELECT TO authenticated
  USING ((SELECT public.my_role()) IS NOT NULL AND (user_id = (SELECT public.my_profile_id()) OR (SELECT public.is_manager())));

DROP POLICY IF EXISTS rules_read ON public.gamification_rules;
CREATE POLICY rules_read ON public.gamification_rules
  FOR SELECT TO authenticated
  USING ((SELECT public.my_role()) IS NOT NULL);

DROP POLICY IF EXISTS audit_admin_read ON public.audit_log;
CREATE POLICY audit_admin_read ON public.audit_log
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS kudos_visible ON public.kudos_quotas;
CREATE POLICY kudos_visible ON public.kudos_quotas
  FOR SELECT TO authenticated
  USING ((SELECT public.my_role()) IS NOT NULL AND (instructor_id = (SELECT public.my_profile_id()) OR (SELECT public.is_manager())));

DROP POLICY IF EXISTS notes_owner ON public.private_notes;
CREATE POLICY notes_owner ON public.private_notes
  FOR ALL TO authenticated
  USING ((SELECT public.my_role()) IS NOT NULL AND instructor_id = (SELECT public.my_profile_id()))
  WITH CHECK ((SELECT public.my_role()) IS NOT NULL AND instructor_id = (SELECT public.my_profile_id()));

DROP POLICY IF EXISTS notifications_own_read ON public.notifications;
CREATE POLICY notifications_own_read ON public.notifications
  FOR SELECT TO authenticated
  USING ((SELECT public.my_role()) IS NOT NULL AND user_id = (SELECT public.my_profile_id()));

DROP POLICY IF EXISTS notifications_own_update ON public.notifications;
CREATE POLICY notifications_own_update ON public.notifications
  FOR UPDATE TO authenticated
  USING ((SELECT public.my_role()) IS NOT NULL AND user_id = (SELECT public.my_profile_id()))
  WITH CHECK ((SELECT public.my_role()) IS NOT NULL AND user_id = (SELECT public.my_profile_id()));

DROP POLICY IF EXISTS requests_visible ON public.support_requests;
CREATE POLICY requests_visible ON public.support_requests
  FOR SELECT TO authenticated
  USING (
    (SELECT public.my_role()) IS NOT NULL
    AND (
      sender_id = (SELECT public.my_profile_id())
      OR recipient_id = (SELECT public.my_profile_id())
      OR (SELECT public.is_admin())
      OR ((SELECT public.my_role()) = 'supervisor' AND kind <> 'role_request')
    )
  );

-- Replace USING (true) on course_roles (DATA-02)
DROP POLICY IF EXISTS course_roles_select_policy ON public.course_roles;
CREATE POLICY course_roles_select_policy ON public.course_roles
  FOR SELECT TO authenticated
  USING (
    (SELECT public.my_role()) IS NOT NULL
    AND (
      user_id = (SELECT public.my_profile_id())
      OR (SELECT public.is_staff())
    )
  );

DROP POLICY IF EXISTS domain_events_select_policy ON public.domain_events;
CREATE POLICY domain_events_select_policy ON public.domain_events
  FOR SELECT TO authenticated
  USING ((SELECT public.is_manager()) OR actor_id = (SELECT public.my_profile_id()));

DROP POLICY IF EXISTS push_tokens_owner ON public.push_tokens;
CREATE POLICY push_tokens_owner ON public.push_tokens
  FOR SELECT TO authenticated
  USING (user_id = (SELECT public.my_profile_id()) OR (SELECT public.is_manager()));

DROP POLICY IF EXISTS report_subscriptions_owner ON public.report_subscriptions;
CREATE POLICY report_subscriptions_owner ON public.report_subscriptions
  FOR SELECT TO authenticated
  USING (user_id = (SELECT public.my_profile_id()) OR (SELECT public.is_manager()));

DROP POLICY IF EXISTS checkin_risk_manager ON public.checkin_risk_signals;
CREATE POLICY checkin_risk_manager ON public.checkin_risk_signals
  FOR SELECT TO authenticated
  USING ((SELECT public.is_manager()));

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) DATA-04: Unified check_rate_limit helper + rate limits on remaining write RPCs
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._check_rate_limit(
  p_bucket TEXT,
  p_max INTEGER,
  p_window INTERVAL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF public._rate_limit_exceeded(p_bucket, p_max, p_window) THEN
    RAISE EXCEPTION 'rate_limited';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._check_rate_limit(TEXT, INTEGER, INTERVAL) FROM PUBLIC, anon, authenticated;

-- Harden submit_support_request with rate limit (10 requests / hour)
CREATE OR REPLACE FUNCTION public.submit_support_request(
  p_kind TEXT, p_subject TEXT, p_body TEXT, p_recipient_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_sender UUID := public.my_profile_id(); v_id UUID;
BEGIN
  IF v_sender IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  PERFORM public._check_rate_limit('submit_support_request', 10, interval '1 hour');
  IF p_kind NOT IN ('course_request','role_request','support') THEN RAISE EXCEPTION 'invalid_kind'; END IF;
  IF p_kind IN ('course_request','role_request') AND public.my_role() <> 'student' THEN RAISE EXCEPTION 'students_only'; END IF;
  IF char_length(btrim(p_subject)) NOT BETWEEN 3 AND 120 OR char_length(btrim(p_body)) NOT BETWEEN 10 AND 2000
  THEN RAISE EXCEPTION 'invalid_message'; END IF;
  IF p_kind = 'course_request' AND (p_recipient_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.profiles WHERE id = p_recipient_id AND role = 'volunteer' AND status = 'active'))
  THEN RAISE EXCEPTION 'invalid_recipient'; END IF;
  IF p_kind = 'role_request' THEN p_recipient_id := NULL; END IF;
  INSERT INTO public.support_requests(sender_id, recipient_id, kind, subject, body)
  VALUES (v_sender, p_recipient_id, p_kind, btrim(p_subject), btrim(p_body)) RETURNING id INTO v_id;
  INSERT INTO public.notifications(user_id, title, body, type)
  SELECT p.id,
    CASE WHEN p_kind = 'role_request' THEN 'طلب ترقية جديد' ELSE 'طلب جديد' END,
    btrim(p_subject), 'system'
  FROM public.profiles p
  WHERE (p_kind = 'role_request' AND p.role = 'admin' AND p.status = 'active') OR p.id = p_recipient_id;
  RETURN jsonb_build_object('ok', TRUE, 'id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_support_request(TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_support_request(TEXT, TEXT, TEXT, UUID) TO authenticated;

-- Harden submit_course_rating with rate limit (15 ratings / hour)
CREATE OR REPLACE FUNCTION public.submit_course_rating(
  p_course_id UUID, p_stars INTEGER, p_comment TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_user UUID := public.my_profile_id(); v_points INTEGER;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  PERFORM public._check_rate_limit('submit_course_rating', 15, interval '1 hour');
  IF p_stars NOT BETWEEN 1 AND 5 OR char_length(COALESCE(p_comment, '')) > 1000 THEN
    RAISE EXCEPTION 'invalid_rating';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.enrollments e JOIN public.batches b ON b.id = e.batch_id
    WHERE b.course_id = p_course_id AND e.user_id = v_user AND e.status IN ('active', 'completed')
  ) THEN RAISE EXCEPTION 'not_enrolled'; END IF;
  INSERT INTO public.course_ratings(user_id, course_id, stars, comment)
  VALUES (v_user, p_course_id, p_stars, NULLIF(btrim(p_comment), ''))
  ON CONFLICT (user_id, course_id) DO UPDATE
    SET stars = EXCLUDED.stars, comment = EXCLUDED.comment, created_at = now();
  SELECT COALESCE((value->>'value')::int, 5) INTO v_points FROM public.gamification_rules WHERE key = 'rating.course';
  INSERT INTO public.point_events(user_id, points, reason_code, ref_type, ref_id, idempotency_key)
  VALUES (v_user, COALESCE(v_points, 5), 'rating.course', 'course', p_course_id, 'rating.course:' || p_course_id || ':' || v_user)
  ON CONFLICT (idempotency_key) DO NOTHING;
  PERFORM public.evaluate_user_badges(v_user);
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_course_rating(UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_course_rating(UUID, INTEGER, TEXT) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) DATA-10 .. DATA-13: 8 Read-Model RPCs (Screen-shaped payloads + pagination)
-- ═══════════════════════════════════════════════════════════════════════════

-- 3.1) get_my_home() — Screen S10 (Today / Command Center)
CREATE OR REPLACE FUNCTION public.get_my_home()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.my_profile_id();
  v_today JSONB;
  v_gam JSONB;
  v_unread INTEGER;
  v_active_enrollments INTEGER;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;

  v_today := public.get_today();

  SELECT jsonb_build_object(
    'current_streak_weeks', COALESCE(g.current_streak_weeks, 0),
    'longest_streak_weeks', COALESCE(g.longest_streak_weeks, 0),
    'freezes_held', COALESCE(g.freezes_held, 0),
    'league_tier', COALESCE(g.league_tier, 'bronze'),
    'points', COALESCE((SELECT sum(pe.points) FROM public.point_events pe WHERE pe.user_id = v_user), 0),
    'badges_count', (SELECT count(*) FROM public.user_badges ub WHERE ub.user_id = v_user)
  ) INTO v_gam
  FROM public.profiles p
  LEFT JOIN public.gamification g ON g.user_id = p.id
  WHERE p.id = v_user;

  SELECT count(*)::int INTO v_unread
  FROM public.notifications n
  WHERE n.user_id = v_user AND NOT n.read;

  SELECT count(*)::int INTO v_active_enrollments
  FROM public.enrollments e
  WHERE e.user_id = v_user AND e.status = 'active';

  RETURN jsonb_build_object(
    'today', v_today,
    'gamification', v_gam,
    'unread_count', v_unread,
    'active_enrollments', v_active_enrollments,
    'generated_at', now()
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_home() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_home() TO authenticated;

-- 3.2) get_my_wallet(p_cursor, p_limit) — Screen S16 (Wallet & Paginated Ledger)
CREATE OR REPLACE FUNCTION public.get_my_wallet(
  p_cursor TIMESTAMPTZ DEFAULT NULL,
  p_limit INTEGER DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.my_profile_id();
  v_cap INTEGER := GREATEST(1, LEAST(COALESCE(p_limit, 30), 100));
  v_balance BIGINT;
  v_entries JSONB;
  v_next_cursor TIMESTAMPTZ;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;

  SELECT COALESCE(sum(points), 0) INTO v_balance
  FROM public.point_events
  WHERE user_id = v_user;

  WITH page AS (
    SELECT id, points, reason_code, ref_type, ref_id, awarded_by, created_at
    FROM public.point_events
    WHERE user_id = v_user
      AND (p_cursor IS NULL OR created_at < p_cursor)
    ORDER BY created_at DESC, id DESC
    LIMIT v_cap
  )
  SELECT
    COALESCE(jsonb_agg(row_to_json(page)), '[]'::jsonb),
    min(created_at)
  INTO v_entries, v_next_cursor
  FROM page;

  RETURN jsonb_build_object(
    'balance', v_balance,
    'entries', v_entries,
    'next_cursor', CASE WHEN jsonb_array_length(v_entries) = v_cap THEN v_next_cursor ELSE NULL END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_wallet(TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_wallet(TIMESTAMPTZ, INTEGER) TO authenticated;

-- 3.3) get_leaderboard(p_branch_id, p_week, p_limit) — Screen S17 (League Leaderboard)
CREATE OR REPLACE FUNCTION public.get_leaderboard(
  p_branch_id UUID DEFAULT NULL,
  p_week DATE DEFAULT NULL,
  p_limit INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.my_profile_id();
  v_cap INTEGER := GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
  v_week DATE := COALESCE(p_week, date_trunc('week', now() AT TIME ZONE 'Africa/Cairo')::date);
  v_rows JSONB;
  v_my_rank JSONB;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;

  WITH ranked AS (
    SELECT
      lw.user_id,
      p.full_name,
      p.avatar_url,
      p.avatar_color,
      p.branch_id,
      lw.tier,
      lw.xp_week,
      row_number() OVER (PARTITION BY lw.tier ORDER BY lw.xp_week DESC, p.joined_at ASC) AS rank
    FROM public.league_weeks lw
    JOIN public.profiles p ON p.id = lw.user_id
    WHERE lw.week_start = v_week
      AND p.status = 'active'
      AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
  )
  SELECT
    COALESCE((SELECT jsonb_agg(row_to_json(r)) FROM (SELECT * FROM ranked ORDER BY xp_week DESC LIMIT v_cap) r), '[]'::jsonb),
    (SELECT row_to_json(r)::jsonb FROM ranked r WHERE r.user_id = v_user LIMIT 1)
  INTO v_rows, v_my_rank;

  RETURN jsonb_build_object(
    'week_start', v_week,
    'branch_id', p_branch_id,
    'entries', v_rows,
    'me', v_my_rank
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_leaderboard(UUID, DATE, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(UUID, DATE, INTEGER) TO authenticated;

-- 3.4) list_notifications(p_cursor, p_limit) — Screen S23 (Paginated Notifications)
CREATE OR REPLACE FUNCTION public.list_notifications(
  p_cursor TIMESTAMPTZ DEFAULT NULL,
  p_limit INTEGER DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.my_profile_id();
  v_cap INTEGER := GREATEST(1, LEAST(COALESCE(p_limit, 30), 100));
  v_rows JSONB;
  v_unread INTEGER;
  v_next_cursor TIMESTAMPTZ;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;

  SELECT count(*)::int INTO v_unread
  FROM public.notifications
  WHERE user_id = v_user AND NOT read;

  WITH page AS (
    SELECT id, title, body, type, read, created_at
    FROM public.notifications
    WHERE user_id = v_user
      AND (p_cursor IS NULL OR created_at < p_cursor)
    ORDER BY created_at DESC, id DESC
    LIMIT v_cap
  )
  SELECT
    COALESCE(jsonb_agg(row_to_json(page)), '[]'::jsonb),
    min(created_at)
  INTO v_rows, v_next_cursor
  FROM page;

  RETURN jsonb_build_object(
    'unread_count', v_unread,
    'items', v_rows,
    'next_cursor', CASE WHEN jsonb_array_length(v_rows) = v_cap THEN v_next_cursor ELSE NULL END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.list_notifications(TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_notifications(TIMESTAMPTZ, INTEGER) TO authenticated;

-- 3.5) get_admin_overview(p_branch_id) — Screen S40 (Admin Dashboard KPIs)
CREATE OR REPLACE FUNCTION public.get_admin_overview(p_branch_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.my_profile_id();
  v_res JSONB;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;

  WITH scoped_batches AS (
    SELECT id, course_id, branch_id, status
    FROM public.batches
    WHERE (p_branch_id IS NULL OR branch_id = p_branch_id)
      AND status <> 'archived'
  ),
  scoped_sessions AS (
    SELECT s.id, s.batch_id, s.status
    FROM public.sessions s
    JOIN scoped_batches b ON b.id = s.batch_id
  ),
  scoped_att AS (
    SELECT a.status
    FROM public.attendance a
    JOIN scoped_sessions s ON s.id = a.session_id
    WHERE s.status = 'closed'
  )
  SELECT jsonb_build_object(
    'branch_id', p_branch_id,
    'active_students', (
      SELECT count(DISTINCT e.user_id)
      FROM public.enrollments e
      JOIN scoped_batches b ON b.id = e.batch_id
      WHERE e.status = 'active'
    ),
    'active_batches', (SELECT count(*) FROM scoped_batches WHERE status = 'active'),
    'live_sessions', (SELECT count(*) FROM scoped_sessions WHERE status = 'live'),
    'closed_sessions', (SELECT count(*) FROM scoped_sessions WHERE status = 'closed'),
    'attendance_pct', (
      SELECT CASE WHEN count(*) = 0 THEN 100
        ELSE round(100.0 * count(*) FILTER (WHERE status <> 'absent') / count(*))
      END FROM scoped_att
    ),
    'pending_excuses', (
      SELECT count(*)
      FROM public.excuses ex
      JOIN scoped_sessions s ON s.id = ex.session_id
      WHERE ex.status = 'pending'
    ),
    'open_disputes', (
      SELECT count(*)
      FROM public.attendance_disputes d
      JOIN scoped_sessions s ON s.id = d.session_id
      WHERE d.status = 'open'
    ),
    'open_requests', (
      SELECT count(*)
      FROM public.support_requests sr
      WHERE sr.status = 'open'
    ),
    'certificates_issued', (
      SELECT count(*)
      FROM public.certificates c
      JOIN scoped_batches b ON b.id = c.batch_id
      WHERE c.status = 'active'
    ),
    'generated_at', now()
  ) INTO v_res;

  RETURN v_res;
END;
$$;
REVOKE ALL ON FUNCTION public.get_admin_overview(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_overview(UUID) TO authenticated;

-- 3.6) get_course_detail(p_course_id) — Screen S12 (Public/Student Course Detail)
CREATE OR REPLACE FUNCTION public.get_course_detail(p_course_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.my_profile_id();
  v_course RECORD;
  v_batches JSONB;
  v_ratings JSONB;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT * INTO v_course FROM public.courses WHERE id = p_course_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', b.id,
    'branch_id', b.branch_id,
    'instructor_id', b.instructor_id,
    'capacity', b.capacity,
    'room', b.room,
    'status', b.status,
    'start_date', b.start_date,
    'schedule', b.schedule,
    'enrolled_count', (SELECT count(*) FROM public.enrollments e WHERE e.batch_id = b.id AND e.status = 'active'),
    'waitlist_count', (SELECT count(*) FROM public.enrollments e WHERE e.batch_id = b.id AND e.status = 'waitlist'),
    'my_status', (SELECT e.status FROM public.enrollments e WHERE e.batch_id = b.id AND e.user_id = v_user LIMIT 1)
  ) ORDER BY b.start_date DESC), '[]'::jsonb)
  INTO v_batches
  FROM public.batches b
  WHERE b.course_id = p_course_id AND b.status <> 'archived';

  SELECT jsonb_build_object(
    'count', count(*)::int,
    'avg', COALESCE(round(avg(stars)::numeric, 1), 0)
  ) INTO v_ratings
  FROM public.course_ratings
  WHERE course_id = p_course_id;

  RETURN jsonb_build_object(
    'course', row_to_json(v_course),
    'batches', v_batches,
    'ratings', v_ratings
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_course_detail(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_detail(UUID) TO authenticated;

-- 3.7) get_session_detail(p_session_id) — Screen S32/S37 (Live & Historical Session Detail)
CREATE OR REPLACE FUNCTION public.get_session_detail(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.my_profile_id();
  v_sess RECORD;
  v_can_manage BOOLEAN;
  v_recent JSONB;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;

  SELECT s.id, s.batch_id, s.seq, s.title, s.starts_at, s.duration_min,
         s.status, s.started_at, s.closed_at, s.report,
         b.course_id, b.branch_id, b.instructor_id, b.room, b.capacity,
         c.title AS course_title, c.color AS course_color
    INTO v_sess
    FROM public.sessions s
    JOIN public.batches b ON b.id = s.batch_id
    JOIN public.courses c ON c.id = b.course_id
   WHERE s.id = p_session_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  v_can_manage := public.can_manage_batch(v_sess.batch_id);
  IF NOT v_can_manage AND NOT EXISTS (
    SELECT 1 FROM public.enrollments e WHERE e.batch_id = v_sess.batch_id AND e.user_id = v_user
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO v_recent
  FROM (
    SELECT a.user_id, p.full_name, p.avatar_color, a.status, a.checked_in_at, a.method
    FROM public.attendance a
    JOIN public.profiles p ON p.id = a.user_id
    WHERE a.session_id = p_session_id AND a.status <> 'absent'
    ORDER BY a.checked_in_at DESC NULLS LAST
    LIMIT 10
  ) x;

  RETURN jsonb_build_object(
    'session', row_to_json(v_sess),
    'enrolled_count', (SELECT count(*) FROM public.enrollments e WHERE e.batch_id = v_sess.batch_id AND e.status = 'active'),
    'present_count', (SELECT count(*) FROM public.attendance a WHERE a.session_id = p_session_id AND a.status IN ('present', 'late')),
    'recent_arrivals', v_recent
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_session_detail(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_session_detail(UUID) TO authenticated;

-- 3.8) list_pending_actions(p_limit) — Unified inbox for instructors & managers
CREATE OR REPLACE FUNCTION public.list_pending_actions(p_limit INTEGER DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := public.my_profile_id();
  v_manager BOOLEAN := public.is_manager();
  v_cap INTEGER := GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
  v_excuses JSONB;
  v_disputes JSONB;
  v_requests JSONB;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT public.is_staff() THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO v_excuses
  FROM (
    SELECT e.id, e.user_id, p.full_name AS student_name, e.session_id, s.title AS session_title,
           e.reason, e.attachment_url, e.created_at
    FROM public.excuses e
    JOIN public.sessions s ON s.id = e.session_id
    JOIN public.batches b ON b.id = s.batch_id
    JOIN public.profiles p ON p.id = e.user_id
    WHERE e.status = 'pending' AND (v_manager OR b.instructor_id = v_user)
    ORDER BY e.created_at DESC
    LIMIT v_cap
  ) x;

  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO v_disputes
  FROM (
    SELECT d.id, d.user_id, p.full_name AS student_name, d.session_id, s.title AS session_title,
           d.claim, d.evidence_url, d.created_at
    FROM public.attendance_disputes d
    JOIN public.sessions s ON s.id = d.session_id
    JOIN public.batches b ON b.id = s.batch_id
    JOIN public.profiles p ON p.id = d.user_id
    WHERE d.status = 'open' AND (v_manager OR b.instructor_id = v_user)
    ORDER BY d.created_at DESC
    LIMIT v_cap
  ) x;

  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO v_requests
  FROM (
    SELECT sr.id, sr.sender_id, p.full_name AS sender_name, sr.kind, sr.subject, sr.body, sr.created_at
    FROM public.support_requests sr
    JOIN public.profiles p ON p.id = sr.sender_id
    WHERE sr.status = 'open' AND (v_manager OR sr.recipient_id = v_user)
    ORDER BY sr.created_at DESC
    LIMIT v_cap
  ) x;

  RETURN jsonb_build_object(
    'excuses', v_excuses,
    'disputes', v_disputes,
    'requests', v_requests,
    'generated_at', now()
  );
END;
$$;
REVOKE ALL ON FUNCTION public.list_pending_actions(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_pending_actions(INTEGER) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) DATA-20 .. DATA-26: Composite/partial indexes, Materialized Views & Timeouts
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_attendance_user_checked_in
  ON public.attendance(user_id, checked_in_at DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_session_status
  ON public.attendance(session_id, status);

CREATE INDEX IF NOT EXISTS idx_sessions_batch_starts
  ON public.sessions(batch_id, starts_at);

CREATE INDEX IF NOT EXISTS idx_sessions_live_partial
  ON public.sessions(batch_id, starts_at)
  WHERE status = 'live';

CREATE INDEX IF NOT EXISTS idx_enrollments_user_status
  ON public.enrollments(user_id, status);

CREATE INDEX IF NOT EXISTS idx_enrollments_batch_status
  ON public.enrollments(batch_id, status);

CREATE INDEX IF NOT EXISTS idx_excuses_pending_created
  ON public.excuses(session_id, created_at DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_point_events_user_created
  ON public.point_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id, read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_certificates_serial_lookup
  ON public.certificates(serial);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_desc
  ON public.audit_log(created_at DESC);

-- BRIN indexes on append-only time-series columns (DATA-21)
CREATE INDEX IF NOT EXISTS idx_attendance_checked_in_brin
  ON public.attendance USING brin(checked_in_at);

CREATE INDEX IF NOT EXISTS idx_point_events_created_brin
  ON public.point_events USING brin(created_at);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_brin
  ON public.audit_log USING brin(created_at);

-- Autovacuum tuning on hot tables (DATA-25)
ALTER TABLE public.attendance SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE public.point_events SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE public.notifications SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE public.sessions SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);

-- Materialized views for instant analytical & leaderboard reads (DATA-22)
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_batch_stats AS
SELECT
  b.id AS batch_id,
  b.course_id,
  b.branch_id,
  b.status,
  count(DISTINCT e.user_id) FILTER (WHERE e.status = 'active') AS enrolled_count,
  count(DISTINCT e.user_id) FILTER (WHERE e.status = 'waitlist') AS waitlist_count
FROM public.batches b
LEFT JOIN public.enrollments e ON e.batch_id = b.id
GROUP BY b.id, b.course_id, b.branch_id, b.status;

CREATE UNIQUE INDEX IF NOT EXISTS mv_batch_stats_uidx ON public.mv_batch_stats(batch_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_leaderboard_week AS
SELECT
  lw.week_start,
  lw.tier,
  lw.user_id,
  p.full_name,
  p.avatar_color,
  p.branch_id,
  lw.xp_week,
  row_number() OVER (PARTITION BY lw.week_start, lw.tier ORDER BY lw.xp_week DESC, p.joined_at ASC) AS rank
FROM public.league_weeks lw
JOIN public.profiles p ON p.id = lw.user_id
WHERE p.status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS mv_leaderboard_week_uidx ON public.mv_leaderboard_week(week_start, user_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_admin_overview AS
SELECT
  coalesce(b.id, '00000000-0000-0000-0000-000000000000'::uuid) AS branch_key,
  b.id AS branch_id,
  (SELECT count(*)::int FROM public.profiles p WHERE p.role = 'student' AND p.status = 'active' AND (b.id IS NULL OR p.branch_id = b.id)) AS active_students,
  (SELECT count(*)::int FROM public.profiles p WHERE p.role = 'instructor' AND p.status = 'active' AND (b.id IS NULL OR p.branch_id = b.id)) AS active_instructors,
  (SELECT count(*)::int FROM public.batches bt WHERE bt.status = 'active' AND (b.id IS NULL OR bt.branch_id = b.id)) AS active_batches,
  now() AS refreshed_at
FROM (SELECT NULL::uuid AS id UNION ALL SELECT id FROM public.branches) b;

CREATE UNIQUE INDEX IF NOT EXISTS mv_admin_overview_uidx ON public.mv_admin_overview(branch_key);

CREATE OR REPLACE FUNCTION public.refresh_analytics_views()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_batch_stats;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_leaderboard_week;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_admin_overview;
  RETURN jsonb_build_object('ok', TRUE, 'refreshed_at', now());
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_analytics_views() FROM PUBLIC, anon, authenticated;

-- DATA-26: Role-level statement timeouts to protect connection pool from runaway queries
DO $$
BEGIN
  ALTER ROLE authenticated SET statement_timeout = '5s';
  ALTER ROLE anon SET statement_timeout = '2s';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) DATA-30 .. DATA-32: Data Retention Policy & Scheduled Pruning
--    • attendance: 3 years (1095 days)
--    • point_events: 2 years (730 days)
--    • audit_log: 24 months (730 days)
--    • notifications: 6 months (180 days)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.prune_retention_tables()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_notif INTEGER := 0;
  v_audit INTEGER := 0;
  v_points INTEGER := 0;
  v_att INTEGER := 0;
BEGIN
  DELETE FROM public.notifications
   WHERE created_at < now() - INTERVAL '180 days' AND read = TRUE;
  GET DIAGNOSTICS v_notif = ROW_COUNT;

  DELETE FROM public.audit_log
   WHERE created_at < now() - INTERVAL '730 days';
  GET DIAGNOSTICS v_audit = ROW_COUNT;

  DELETE FROM public.point_events
   WHERE created_at < now() - INTERVAL '730 days';
  GET DIAGNOSTICS v_points = ROW_COUNT;

  DELETE FROM public.attendance
   WHERE checked_in_at < now() - INTERVAL '1095 days';
  GET DIAGNOSTICS v_att = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'pruned_notifications', v_notif,
    'pruned_audit_log', v_audit,
    'pruned_point_events', v_points,
    'pruned_attendance', v_att,
    'executed_at', now()
  );
END;
$$;
REVOKE ALL ON FUNCTION public.prune_retention_tables() FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) DATA-50 .. DATA-56: SLO Telemetry & metrics_snapshot
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.metrics_snapshot (
  id BIGSERIAL PRIMARY KEY,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  active_sessions INTEGER NOT NULL DEFAULT 0,
  outbox_pending INTEGER NOT NULL DEFAULT 0,
  client_errors_24h INTEGER NOT NULL DEFAULT 0,
  checkins_24h INTEGER NOT NULL DEFAULT 0,
  disputes_open INTEGER NOT NULL DEFAULT 0,
  excuses_pending INTEGER NOT NULL DEFAULT 0,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_metrics_snapshot_captured_desc
  ON public.metrics_snapshot(captured_at DESC);

ALTER TABLE public.metrics_snapshot ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS metrics_snapshot_read ON public.metrics_snapshot;
CREATE POLICY metrics_snapshot_read ON public.metrics_snapshot
  FOR SELECT TO authenticated
  USING ((SELECT public.is_manager()));

CREATE OR REPLACE FUNCTION public.capture_metrics_snapshot()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.metrics_snapshot;
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL AND NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  INSERT INTO public.metrics_snapshot (
    active_sessions,
    outbox_pending,
    client_errors_24h,
    checkins_24h,
    disputes_open,
    excuses_pending,
    details
  )
  VALUES (
    (SELECT count(*)::int FROM public.sessions WHERE status = 'live'),
    (SELECT count(*)::int FROM public.notification_outbox WHERE status = 'pending'),
    (SELECT count(*)::int FROM public.client_errors WHERE created_at >= now() - INTERVAL '24 hours'),
    (SELECT count(*)::int FROM public.attendance WHERE checked_in_at >= now() - INTERVAL '24 hours'),
    (SELECT count(*)::int FROM public.attendance_disputes WHERE status = 'open'),
    (SELECT count(*)::int FROM public.excuses WHERE status = 'pending'),
    jsonb_build_object(
      'slo_checkin_target_pct', 99.0,
      'slo_p95_target_ms', 250,
      'slo_uptime_target_pct', 99.5
    )
  )
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.capture_metrics_snapshot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.capture_metrics_snapshot() TO authenticated;

COMMIT;
