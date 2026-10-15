#!/usr/bin/env node
/**
 * scripts/gen-apply-bundle.js — يولّد `supabase/diagnostics/apply_0035_0038.sql`.
 *
 * لماذا؟ المستخدم وصل لقاعدة بيانات طبّقت 0001…0034، وشغّل 0038 لوحده فظهرت أخطاء
 * Postgres غامضة (42P01 relation "public.session_feedback" does not exist) لأن
 * 0035 و0036 و0037 ناقصين. الحل الذي يطلبه: **ملف واحد** يُلصق مرة واحدة في
 * SQL Editor ويُشغَّل مرة واحدة، بلا أخطاء.
 *
 * الملف الناتج:
 *   0) بوابة تحقّق مسبق — تتأكد أن الترحيلات الأساسية موجودة، وتقول بالعربي ما الناقص.
 *   1..4) نصوص 0035 → 0036 → 0037 → 0038 حرفيًا (بدون أي تعديل داخل الجسم)،
 *         عدا أسطر BEGIN;/COMMIT; المستقلة: الملف كله يُشغَّل في معاملة واحدة،
 *         فوجودها بالداخل كان سيقسّم التطبيق إلى معاملات ويسمح بحالة نصف مطبَّقة.
 *   5) استعلام تحقّق نهائي يُظهر في صف واحد: عدد الشارات (16)، الجداول الجديدة،
 *      العمود الجديد، والشارات الأربعة الجديدة.
 *
 *   node scripts/gen-apply-bundle.js           # توليد/تحديث الملف
 *   node scripts/gen-apply-bundle.js --check   # يفشل إن كان الملف قديمًا (بوابة)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const OUT = path.join(ROOT, 'supabase', 'diagnostics', 'apply_0035_0038.sql');

/** الترحيلات الناقصة على قاعدة المستخدم، بالترتيب الصحيح. */
const BUNDLE = [
  '0035_lecture_feedback_and_reports.sql',
  '0036_course_organizer_authority.sql',
  '0037_course_reports.sql',
  '0038_more_badges.sql',
];

/** جداول ودوال أساسية من 0001…0034 — غيابها يعني أن المستخدم لم يطبّق الأساس. */
const REQUIRED_TABLES = ['profiles', 'courses', 'batches', 'sessions', 'badges', 'certificates'];
const REQUIRED_FUNCTIONS = ['my_profile_id', 'my_role', 'can_manage_course', 'is_manager'];

const HEADER = `-- ═══════════════════════════════════════════════════════════════════════════
-- apply_0035_0038.sql — ملف واحد يطبّق كل الترحيلات الناقصة: 0035 → 0038
--
-- مُولَّد آليًا بواسطة: node scripts/gen-apply-bundle.js — لا تُحرّره يدويًا.
--
-- طريقة الاستخدام (مرة واحدة بس):
--   1) Supabase Dashboard → SQL Editor → New query
--   2) الصق الملف كامل → Run
--   3) شوف آخر جدول ناتج: لو مكتوب فيه ✅ الترحيلات مطبَّقة — خلصت.
--
-- • آمن لإعادة التشغيل: كل جملة داخلية idempotent
--   (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS /
--    CREATE OR REPLACE / DROP ... IF EXISTS / ON CONFLICT DO NOTHING).
-- • لا يوجد أي بيانات وهمية: الجداول الجديدة تُنشأ فارغة، والمستخدمون والفروع
--   والكورسات الحقيقية لا تُلمس — بيانات مرجعية فقط (تعريفات الشارات).
-- • لو ظهر خطأ قبل أي شيء: بوابة التحقّق في الأول بتقول لك بالعربي إيه الناقص
--   في قاعدة البيانات، بدل رسالة Postgres الغامضة (42P01 / 42703).
-- • لإعادة التوليد: node scripts/gen-apply-bundle.js
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0) بوابة التحقّق المسبق (0001…0034 لازم تكون مطبَّقة) ─────────────────────
DO $$
DECLARE
  v_missing TEXT[] := '{}';
  v_name TEXT;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[${REQUIRED_TABLES.map((t) => `'${t}'`).join(', ')}] LOOP
    IF to_regclass('public.' || v_name) IS NULL THEN
      v_missing := v_missing || ('جدول public.' || v_name);
    END IF;
  END LOOP;

  FOREACH v_name IN ARRAY ARRAY[${REQUIRED_FUNCTIONS.map((f) => `'${f}'`).join(', ')}] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_name
    ) THEN
      v_missing := v_missing || ('دالة public.' || v_name || '()');
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'certificates' AND column_name = 'status'
  ) THEN
    v_missing := v_missing || 'عمود certificates.status';
  END IF;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'MASAR: ترحيلات الأساس 0001…0034 ناقصة على قاعدة البيانات: %. شغّل supabase/diagnostics/migration_level.sql لمعرفة أول ترحيل ناقص، وطبّقه ثم أعد هذا الملف.',
      array_to_string(v_missing, ' · ');
  END IF;
END $$;
`;

const FOOTER = `
-- ── 5) التحقّق النهائي — المفروض تشوف صف واحد فيه ✅ ─────────────────────────
SELECT
  (SELECT count(*) FROM public.badges) AS "عدد الشارات (المتوقّع 16)",
  (SELECT count(*) FROM public.badges WHERE code IN ('streak_12','feedback_star','marathon','comeback'))
    AS "الشارات الجديدة الأربعة (المتوقّع 4)",
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'badges' AND column_name IN ('target','metric'))
    AS "أعمدة badges الجديدة (المتوقّع 2)",
  to_regclass('public.course_modules')::text   AS "جدول course_modules",
  to_regclass('public.session_feedback')::text AS "جدول session_feedback",
  to_regclass('public.course_reports')::text   AS "جدول course_reports",
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'module_id')
    AS "عمود sessions.module_id (المتوقّع 1)",
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'evaluate_user_badges')
    AS "دالة evaluate_user_badges",
  CASE
    WHEN (SELECT count(*) FROM public.badges) >= 16
     AND to_regclass('public.course_modules') IS NOT NULL
     AND to_regclass('public.session_feedback') IS NOT NULL
     AND to_regclass('public.course_reports') IS NOT NULL
    THEN '✅ الترحيلات 0035 → 0038 مطبَّقة — مبروك'
    ELSE '❌ ناقص — ابعت لي نتيجة الاستعلام ده'
  END AS "الحالة";

-- ── (اختياري) امنح الشارات المستحقة للمستخدمين الحاليين مرة واحدة ─────────────
--     الشارات الجديدة (marathon / comeback / streak_12 / feedback_star) والثلاثة
--     المُحيَوا (month_star / top_scorer / climber) لا تُمنح تلقائيًا لمستخدم قديم
--     إلا بعد أول تقييم. نفّذ السطر التالي بعد الملف لو عايزها فورًا:
-- SELECT public.evaluate_user_badges(id) FROM public.profiles WHERE role = 'student' AND status = 'active';
`;

function stripTransactionMarkers(sql) {
  // أسطر BEGIN;/COMMIT; المستقلة فقط (لا نلمس أي كود داخل الأجسام)
  return sql
    .split('\n')
    .filter((line) => !/^\s*(BEGIN|COMMIT)\s*;\s*$/i.test(line))
    .join('\n');
}

function build() {
  const parts = [HEADER];
  BUNDLE.forEach((file, i) => {
    const raw = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
    parts.push(`
-- ═══════════════════════════════════════════════════════════════════════════
-- ${i + 1}/4) ${file} — نص الترحيل حرفيًا من supabase/migrations/
-- ═══════════════════════════════════════════════════════════════════════════
${stripTransactionMarkers(raw).trim()}
`);
  });
  parts.push(FOOTER);
  return parts.join('\n');
}

const content = build();
if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== content) {
    console.error('❌ supabase/diagnostics/apply_0035_0038.sql قديم — شغّل: npm run migrations:bundle');
    process.exit(1);
  }
  console.log('✅ ملف التطبيق الموحّد محدَّث');
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, content);
  const kb = (Buffer.byteLength(content) / 1024).toFixed(1);
  console.log(`✅ كُتب ${path.relative(ROOT, OUT)} (${kb} KB) — 4 ترحيلات + بوابة + تحقّق`);
}
