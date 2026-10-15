-- ═══════════════════════════════════════════════════════════════════════════
-- migration_level.sql — «أنا واصل لترحيل رقم كام؟» (قراءة فقط، لا يكتب شيئًا)
--
-- مُولَّد آليًا بواسطة: node scripts/gen-migration-level.js  — لا تُحرّره يدويًا.
--
-- لماذا؟ لا يوجد جدول schema_version مركزي، فلمّا يُشغَّل ترحيل يعتمد على ترحيل
-- سابق غير مُطبَّق تظهر أخطاء Postgres غامضة مثل:
--     ERROR: 42703: column "module_id" does not exist
--     ERROR: 42P01: relation "public.session_feedback" does not exist
--
-- الاستخدام: الصق الملف كاملًا في Supabase SQL Editor → Run.
-- ابدأ من **أول ترحيل مكتوب أمامه ❌** وطبّقه بالترتيب. كل الترحيلات idempotent،
-- وإعادة تطبيق ترحيل مكتمل آمنة.
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  '0001' AS "#", '0001_schema.sql' AS "الترحيل", 'table profiles' AS "الكائن المميّز",
  CASE WHEN to_regclass('public.profiles') IS NOT NULL THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
UNION ALL
SELECT
  '0002' AS "#", '0002_gamification_rpcs.sql' AS "الترحيل", 'function rule_num' AS "الكائن المميّز",
  CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'rule_num') > 0 THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
UNION ALL
SELECT
  '0004' AS "#", '0004_real_auth_and_policies.sql' AS "الترحيل", 'function my_profile_id' AS "الكائن المميّز",
  CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'my_profile_id') > 0 THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
UNION ALL
SELECT
  '0005' AS "#", '0005_production_hardening.sql' AS "الترحيل", 'table support_requests' AS "الكائن المميّز",
  CASE WHEN to_regclass('public.support_requests') IS NOT NULL THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
UNION ALL
SELECT
  '0006' AS "#", '0006_automation_jobs.sql' AS "الترحيل", 'function auto_close_stale_sessions' AS "الكائن المميّز",
  CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'auto_close_stale_sessions') > 0 THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
UNION ALL
SELECT
  '0007' AS "#", '0007_room_collision_check.sql' AS "الترحيل", 'function create_batch_with_sessions' AS "الكائن المميّز",
  CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'create_batch_with_sessions') > 0 THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
UNION ALL
SELECT
  '0008' AS "#", '0008_account_deletion.sql' AS "الترحيل", 'function delete_my_account' AS "الكائن المميّز",
  CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'delete_my_account') > 0 THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
UNION ALL
SELECT
  '0009' AS "#", '0009_waitlist_promotion.sql' AS "الترحيل", 'function promote_batch_waitlist' AS "الكائن المميّز",
  CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'promote_batch_waitlist') > 0 THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
UNION ALL
SELECT
  '0010' AS "#", '0010_session_report.sql' AS "الترحيل", 'function get_session_report' AS "الكائن المميّز",
  CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'get_session_report') > 0 THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
UNION ALL
SELECT
  '0011' AS "#", '0011_analytics_views.sql' AS "الترحيل", 'function get_analytics' AS "الكائن المميّز",
  CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'get_analytics') > 0 THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
UNION ALL
SELECT
  '0012' AS "#", '0012_domain_query_layer.sql' AS "الترحيل", 'function get_course_overview' AS "الكائن المميّز",
  CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'get_course_overview') > 0 THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
UNION ALL
SELECT
  '0013' AS "#", '0013_offline_command_queue.sql' AS "الترحيل", 'table command_queue' AS "الكائن المميّز",
  CASE WHEN to_regclass('public.command_queue') IS NOT NULL THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
UNION ALL
SELECT
  '0014' AS "#", '0014_critical_fixes.sql' AS "الترحيل", 'table checkin_attempts' AS "الكائن المميّز",
  CASE WHEN to_regclass('public.checkin_attempts') IS NOT NULL THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
UNION ALL
SELECT
  '0015' AS "#", '0015_command_executor.sql' AS "الترحيل", 'function run_command' AS "الكائن المميّز",
  CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'run_command') > 0 THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
UNION ALL
SELECT
  '0016' AS "#", '0016_avatar_storage_hardening.sql' AS "الترحيل", 'function prune_old_avatars' AS "الكائن المميّز",
  CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'prune_old_avatars') > 0 THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
UNION ALL
SELECT
  '0017' AS "#", '0017_completion_rule_fix.sql' AS "الترحيل", 'function _batch_is_complete' AS "الكائن المميّز",
  CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = '_batch_is_complete') > 0 THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
UNION ALL
SELECT
  '0018' AS "#", '0018_update_course_details.sql' AS "الترحيل", 'function update_course_details' AS "الكائن المميّز",
  CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'update_course_details') > 0 THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
UNION ALL
SELECT
  '0019' AS "#", '0019_save_private_note.sql' AS "الترحيل", 'function save_private_note' AS "الكائن المميّز",
  CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'save_private_note') > 0 THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
UNION ALL
SELECT
  '0020' AS "#", '0020_certificate_revocation.sql' AS "الترحيل", 'function revoke_certificate' AS "الكائن المميّز",
  CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'revoke_certificate') > 0 THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
UNION ALL
SELECT
  '0021' AS "#", '0021_geofence_optional.sql' AS "الترحيل", 'function _haversine_m' AS "الكائن المميّز",
  CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = '_haversine_m') > 0 THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
UNION ALL
SELECT
  '0022' AS "#", '0022_push_tokens.sql' AS "الترحيل", 'table push_tokens' AS "الكائن المميّز",
  CASE WHEN to_regclass('public.push_tokens') IS NOT NULL THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
UNION ALL
SELECT
  '0024' AS "#", '0024_course_operating_system.sql' AS "الترحيل", 'table course_roles' AS "الكائن المميّز",
  CASE WHEN to_regclass('public.course_roles') IS NOT NULL THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
UNION ALL
SELECT
  '0025' AS "#", '0025_rpc_rate_limits.sql' AS "الترحيل", 'table rpc_rate_events' AS "الكائن المميّز",
  CASE WHEN to_regclass('public.rpc_rate_events') IS NOT NULL THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
UNION ALL
SELECT
  '0026' AS "#", '0026_push_delivery_outbox.sql' AS "الترحيل", 'table push_outbox' AS "الكائن المميّز",
  CASE WHEN to_regclass('public.push_outbox') IS NOT NULL THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
UNION ALL
SELECT
  '0027' AS "#", '0027_client_error_log.sql' AS "الترحيل", 'table client_errors' AS "الكائن المميّز",
  CASE WHEN to_regclass('public.client_errors') IS NOT NULL THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
UNION ALL
SELECT
  '0028' AS "#", '0028_get_today.sql' AS "الترحيل", 'function get_today' AS "الكائن المميّز",
  CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'get_today') > 0 THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
UNION ALL
SELECT
  '0031' AS "#", '0031_functional_completeness.sql' AS "الترحيل", 'table attendance_disputes' AS "الكائن المميّز",
  CASE WHEN to_regclass('public.attendance_disputes') IS NOT NULL THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
UNION ALL
SELECT
  '0032' AS "#", '0032_wave_c_security_rpcs_indexes.sql' AS "الترحيل", 'table metrics_snapshot' AS "الكائن المميّز",
  CASE WHEN to_regclass('public.metrics_snapshot') IS NOT NULL THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
UNION ALL
SELECT
  '0035' AS "#", '0035_lecture_feedback_and_reports.sql' AS "الترحيل", 'table course_modules' AS "الكائن المميّز",
  CASE WHEN to_regclass('public.course_modules') IS NOT NULL THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
UNION ALL
SELECT
  '0036' AS "#", '0036_course_organizer_authority.sql' AS "الترحيل", 'function set_session_module' AS "الكائن المميّز",
  CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'set_session_module') > 0 THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
UNION ALL
SELECT
  '0037' AS "#", '0037_course_reports.sql' AS "الترحيل", 'table course_reports' AS "الكائن المميّز",
  CASE WHEN to_regclass('public.course_reports') IS NOT NULL THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
UNION ALL
SELECT
  '0038' AS "#", '0038_more_badges.sql' AS "الترحيل", 'function evaluate_user_badges' AS "الكائن المميّز",
  CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'evaluate_user_badges') > 0 THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"
ORDER BY "#";

-- فحص تكميلي لترحيل الشارات (0038): الأعمدة الجديدة + الشارات الجديدة + الدالة
SELECT 'أعمدة badges.target/metric' AS "الفحص",
       CASE WHEN EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'badges' AND column_name = 'metric'
       ) THEN '✅ موجودة' ELSE '❌ ناقصة — طبّق 0038' END AS "الحالة"
UNION ALL
SELECT 'عدد الشارات المعرَّفة',
       (SELECT count(*)::text || ' شارة (المتوقّع 16 بعد 0038)' FROM public.badges)
UNION ALL
SELECT 'دالة my_badge_progress()',
       CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'my_badge_progress') > 0
            THEN '✅ موجودة' ELSE '❌ ناقصة — طبّق 0038' END;
