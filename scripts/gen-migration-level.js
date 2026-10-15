#!/usr/bin/env node
/**
 * scripts/gen-migration-level.js — يولّد `supabase/diagnostics/migration_level.sql`.
 *
 * لماذا؟ لا يوجد جدول `schema_version` مركزي، فلمّا يُشغَّل ترحيل يعتمد على ترحيل
 * سابق غير مُطبَّق تظهر أخطاء Postgres غامضة (42703 / 42P01). هذا الملف يبني
 * استعلامًا للقراءة فقط يُخبر المشغّل: «أول ترحيل ناقص هو كذا، طبّقه وابدأ منه».
 *
 * العلامة المميّزة لكل ترحيل تُستخرج آليًا (أول جدول أو دالة يُنشئها الملف)، ونستبعد
 * أي علامة معرَّفة في أكثر من ملف حتى تكون دلالتها على ملف واحد فقط.
 *
 *   node scripts/gen-migration-level.js            # توليد/تحديث الملف
 *   node scripts/gen-migration-level.js --check    # يفشل إن كان الملف قديمًا (بوابة)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const OUT = path.join(ROOT, 'supabase', 'diagnostics', 'migration_level.sql');

/** أول كائن مميّز في كل ترحيل: جدول ← دالة. */
function markers() {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  const raw = [];
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
    const table = /CREATE TABLE IF NOT EXISTS public\.([a-z_0-9]+)/.exec(sql);
    const fn = /CREATE OR REPLACE FUNCTION public\.([a-z_0-9]+)/.exec(sql);
    if (table) raw.push({ file, kind: 'table', name: table[1] });
    else if (fn) raw.push({ file, kind: 'function', name: fn[1] });
  }
  // علامة مكرّرة في أكثر من ملف ⇒ لا تصلح للدلالة على ترحيل واحد
  const seen = new Map();
  for (const m of raw) seen.set(`${m.kind}:${m.name}`, (seen.get(`${m.kind}:${m.name}`) ?? 0) + 1);
  return raw.filter((m) => seen.get(`${m.kind}:${m.name}`) === 1);
}

function probe(marker) {
  const ord = marker.file.split('_')[0];
  const label = `${marker.kind} ${marker.name}`;
  const check = marker.kind === 'table'
    ? `to_regclass('public.${marker.name}') IS NOT NULL`
    : `(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = '${marker.name}') > 0`;
  return `SELECT
  '${ord}' AS "#", '${marker.file}' AS "الترحيل", '${label}' AS "الكائن المميّز",
  CASE WHEN ${check} THEN '✅ مُطبَّق' ELSE '❌ ناقص — طبّقه' END AS "الحالة"`;
}

function build() {
  const list = markers();
  const body = list.map(probe).join('\nUNION ALL\n');
  return `-- ═══════════════════════════════════════════════════════════════════════════
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
${body}
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
`;
}

const check = process.argv.includes('--check');
const sql = build();
if (check) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== sql) {
    console.log('✗ supabase/diagnostics/migration_level.sql قديم — شغّل: node scripts/gen-migration-level.js');
    process.exit(1);
  }
  console.log('✅ ملف مستوى الترحيلات محدَّث.');
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, sql, 'utf8');
  console.log(`✅ كُتب ${path.relative(ROOT, OUT)} — ${markers().length} علامة ترحيل.`);
}
