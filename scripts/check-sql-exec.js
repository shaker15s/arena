#!/usr/bin/env node
/**
 * scripts/check-sql-exec.js — بوّابة تنفيذ SQL حقيقي (Postgres داخل Node عبر PGlite).
 *
 * لماذا؟ `check-sql.js` بيتحقّق من الجملة الواحدة بـ pgsql-ast-parser، ومش بيدخل
 * **جوه أجسام plpgsql**. النتيجة: خطأ حقيقي (قوس ناقص في get_course_report داخل
 * 0035) عدّى كل الفحوص ووصل للمستخدم كخطأ غامض. البوّابة دي بتشغّل الترحيلات فعلًا
 * على Postgres 18 في WASM، فبتكتشف: أخطاء الأقواس في الأجسام، GRANT على دالة مش
 * موجودة، ALTER على عمود/جدول مش موجود، ترتيب الترحيلات… إلخ.
 *
 * المراحل:
 *   1) السلسلة الكاملة من قاعدة فاضية: 0001…0034 (تسامح موثَّق) ثم 0035…0038 بلا أخطاء.
 *   2) ملف التطبيق الموحّد supabase/diagnostics/apply_0035_0038.sql على قاعدة
 *      عندها 0001…0034 فقط (نفس حالة المستخدم) — مرة، ثم مرة تانية (الأمان).
 *   3) أمان ودلالة: RLS على الجداول الجديدة، وevaluate_user_badges لـ service_role فقط.
 *
 *   node scripts/check-sql-exec.js
 *
 * ملاحظة: بيحتاج devDependency اسمها @electric-sql/pglite. لو مش مثبّتة، السكربت
 * بيطبع تحذيرًا واضحًا ويكمل بلا فحص (ما بيكسرش الباقي).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const BUNDLE = path.join(ROOT, 'supabase', 'diagnostics', 'apply_0035_0038.sql');
const PRELUDE = path.join(__dirname, 'sql-exec', 'prelude.sql');
const STRICT_FROM = '0035'; // ده اللي المستخدم محتاج يطبّقه فعليًا

const all = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();

/** PGlite مش عنده pg_cron — الترحيلات بتنشئ الإضافة صراحة فبنستبدل الجملة فقط. */
function adapt(sql) {
  return sql
    .replace(/^\uFEFF/, '')
    .replace(/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+pg_cron\s*;/gi, '-- [pglite] cron stub')
    .replace(/CREATE\s+EXTENSION\s+pg_cron\s*;/gi, '-- [pglite] cron stub')
    .replace(/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+"?uuid-ossp"?\s*;/gi, '-- [pglite] uuid-ossp preloaded')
    .replace(/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+"?pgcrypto"?(\s+WITH\s+SCHEMA\s+\w+)?\s*;/gi, '-- [pglite] pgcrypto preloaded');
}

const brief = (e) => String(e.message || e).split('\n').filter(Boolean).slice(0, 1).join(' ').slice(0, 300);

async function loadPglite() {
  try {
    const { PGlite } = require('@electric-sql/pglite');
    const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp');
    const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
    return { PGlite, extensions: { uuid_ossp, pgcrypto } };
  } catch {
    return null;
  }
}

async function freshDb(PGlite, extensions) {
  const db = new PGlite({ extensions });
  await db.exec(fs.readFileSync(PRELUDE, 'utf8'));
  return db;
}

/** يطبّق 0001…قبل `stopAt` بتسامح (قاعدة الإنتاج فيها كائنات أقدم من ملفات الترحيل). */
async function applyBaseChain(db, stopAt) {
  const soft = [];
  let ok = 0;
  for (const file of all) {
    if (file >= stopAt) break;
    try {
      await db.exec(adapt(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8')));
      ok++;
    } catch (e) {
      soft.push({ file, msg: brief(e) });
      try { await db.exec('rollback;'); } catch {}
    }
  }
  return { ok, soft };
}

async function run() {
  const pglite = await loadPglite();
  if (!pglite) {
    console.log('⚠️  فحص تنفيذ SQL متخطّى: مفيش @electric-sql/pglite.');
    console.log('   للإضافة: npm install --save-dev @electric-sql/pglite');
    return 0;
  }
  const { PGlite, extensions } = pglite;
  const failures = [];

  // ── 1) السلسلة الكاملة ────────────────────────────────────────────────────
  console.log('── 1) تطبيق السلسلة الكاملة على قاعدة فاضية ────────────────────────────');
  const db1 = await freshDb(PGlite, extensions);
  const base = await applyBaseChain(db1, STRICT_FROM);
  console.log(`   0001…0034: ${base.ok}/${all.filter((f) => f < STRICT_FROM).length} ملفًا طُبِّق`);
  for (const s of base.soft) console.log(`   ⚠️  ${s.file} (متسامح — كائنات أقدم من ملفات الترحيل): ${s.msg}`);
  let strict = 0;
  for (const file of all.filter((f) => f >= STRICT_FROM)) {
    try {
      await db1.exec(adapt(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8')));
      strict++;
      console.log(`   ✅ ${file}`);
    } catch (e) {
      failures.push(`${file}: ${brief(e)}`);
      console.log(`   ❌ ${file} → ${brief(e)}`);
      try { await db1.exec('rollback;'); } catch {}
      break;
    }
  }
  const strictTotal = all.filter((f) => f >= STRICT_FROM).length;
  if (strict === strictTotal) console.log(`   ✅ ${strictTotal}/${strictTotal} ترحيلات 0035…0038 بلا أخطاء`);

  // ── 2) ملف التطبيق الموحّد (نفس حالة المستخدم) ───────────────────────────
  console.log('\n── 2) ملف التطبيق الموحّد على قاعدة عندها 0001…0034 ───────────────────');
  const db2 = await freshDb(PGlite, extensions);
  await applyBaseChain(db2, STRICT_FROM);
  const before = (await db2.query(
    `select (select count(*) from public.badges)::int as badges,
            to_regclass('public.session_feedback') as feedback,
            to_regclass('public.course_reports') as reports`)).rows[0];
  console.log(`   قبل: شارات=${before.badges} · session_feedback=${before.feedback ?? 'ناقص'} · course_reports=${before.reports ?? 'ناقص'}`);
  const bundleSql = fs.readFileSync(BUNDLE, 'utf8');
  let verify = null;
  try {
    const res = await db2.exec(bundleSql);
    const last = res[res.length - 1];
    verify = last && last.rows && last.rows[0];
    console.log(`   ✅ التشغيل الأول نجح — ${JSON.stringify(verify)}`);
  } catch (e) {
    failures.push(`apply_0035_0038.sql (تشغيل أول): ${brief(e)}`);
    console.log(`   ❌ التشغيل الأول فشل → ${brief(e)}`);
  }
  if (verify) {
    const badges = Number(verify['عدد الشارات (المتوقّع 16)']);
    const status = String(verify['الحالة'] || '');
    if (!(badges >= 16)) failures.push(`عدد الشارات بعد الملف = ${badges} (المتوقّع 16)`);
    if (!status.startsWith('✅')) failures.push(`حالة التحقّق النهائي = ${status}`);
    if (badges >= 16 && status.startsWith('✅')) console.log('   ✅ التحقّق الداخلي للملف: 16 شارة + كل الجداول موجودة');
  }
  try {
    const res2 = await db2.exec(bundleSql);
    const last2 = res2[res2.length - 1];
    const row2 = last2 && last2.rows && last2.rows[0];
    console.log(`   ✅ إعادة التشغيل (نفس الملف على نفس القاعدة) نجحت — ${JSON.stringify(row2)}`);
  } catch (e) {
    failures.push(`apply_0035_0038.sql (إعادة تشغيل): ${brief(e)}`);
    console.log(`   ❌ إعادة التشغيل فشلت → ${brief(e)}`);
  }

  // ── 3) أمان ودلالة ────────────────────────────────────────────────────────
  console.log('\n── 3) الأمان والدلالة ──────────────────────────────────────────────────');
  const q = (await db2.query(
    `select
       (select p.proacl::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'evaluate_user_badges') as eval_acl,
       (select count(*) from pg_class where relnamespace = 'public'::regnamespace
         and relname in ('course_modules','session_content','session_feedback','course_reports')
         and relrowsecurity) as rls_on,
       (select count(*) from public.badges where active) as active_badges`)).rows[0];
  const acl = String(q.eval_acl || '');
  console.log(`   evaluate_user_badges → ${acl || '(بلا صلاحيات)'}`);
  console.log(`   RLS على الجداول الأربعة الجديدة: ${q.rls_on}/4 · شارات نشطة: ${q.active_badges}`);
  if (/(^|[,{])(anon|authenticated)=/.test(acl)) failures.push('evaluate_user_badges ممنوحة لـ anon/authenticated — خطر أمني');
  if (Number(q.rls_on) !== 4) failures.push(`RLS مفعّل على ${q.rls_on}/4 من الجداول الجديدة`);

  // ── 4) قاعدة «نصف مطبَّقة» (لو تشغيل سابق مات في المنتصف) ───────────────
  console.log('\n── 4) الملف على قاعدة نصف مطبَّقة (تشغيل مات في المنتصف) ───────────────');
  const db3 = await freshDb(PGlite, extensions);
  await applyBaseChain(db3, STRICT_FROM);
  const { splitStatements } = require(path.join(__dirname, 'sql-exec', 'split.js'));
  const stmts = splitStatements(fs.readFileSync(BUNDLE, 'utf8'));
  const cut = stmts.findIndex((s, i) => i > 6 && /CREATE OR REPLACE FUNCTION/i.test(s));
  let applied = 0;
  for (let i = 0; i < cut; i++) {
    try { await db3.exec(stmts[i]); applied++; } catch (e) { try { await db3.exec('rollback;'); } catch {} }
  }
  const mid = (await db3.query(
    `select to_regclass('public.course_modules') as cm, to_regclass('public.session_feedback') as sf,
            (select count(*) from public.badges)::int as badges`)).rows[0];
  console.log(`   طبّقنا ${applied}/${stmts.length} عبارة فقط (جداول 0035 موجودة، الدوال لأ) · شارات=${mid.badges}`);
  try {
    const res3 = await db3.exec(fs.readFileSync(BUNDLE, 'utf8'));
    const row3 = res3[res3.length - 1].rows[0];
    console.log(`   ✅ الملف كامل نجح على القاعدة النصف مطبَّقة → ${row3['الحالة']} · شارات=${row3['عدد الشارات (المتوقّع 16)']}`);
    if (Number(row3['عدد الشارات (المتوقّع 16)']) < 16) failures.push('الملف على قاعدة نصف مطبَّقة لم يوصل الشارات إلى 16');
  } catch (e) {
    failures.push(`apply_0035_0038.sql (قاعدة نصف مطبَّقة): ${brief(e)}`);
    console.log(`   ❌ فشل → ${brief(e)}`);
  }

  console.log('\n' + '═'.repeat(74));
  if (failures.length) {
    console.log(`❌ فحص تنفيذ SQL فشل — ${failures.length} مشكلة:`);
    for (const f of failures) console.log(`   • ${f}`);
    return 1;
  }
  console.log('✅ فحص تنفيذ SQL تمام: الترحيلات بتُطبَّق فعلًا على Postgres بلا أخطاء،');
  console.log('   والملف الموحّد آمن لتشغيل واحد ولإعادة التشغيل، والصلاحيات سليمة.');
  return 0;
}

run().then((code) => process.exit(code)).catch((e) => {
  console.log('❌ خطأ غير متوقع في فحص تنفيذ SQL:', brief(e));
  process.exit(1);
});
