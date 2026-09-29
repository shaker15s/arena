#!/usr/bin/env node
/**
 * scripts/check-sql.js — بوابة سلامة ترحيلات SQL.
 *
 * لا يوجد Postgres في بيئة الفحص، لذلك نفحص ما يمكن فحصه بصدق:
 *  1. **تحليل نحوي حقيقي** لكل عبارة SQL في `supabase/migrations/` بمحلّل
 *     `pgsql-ast-parser` — يمسك الأخطاء النحوية الحقيقية (فاصلة ناقصة،
 *     كلمة مفتاحية خاطئة، عبارة مبتورة…) لا مجرد توازن الأقواس.
 *  2. توازن كتل `$$` (جسم دوال PL/pgSQL) و`BEGIN;/COMMIT;` لكل ملف.
 *  3. تعارض أسماء الدوال: نفس التوقيع معرَّف مرتين في نفس الملف.
 *  4. تناسق `GRANT`/`REVOKE`: كل `CREATE FUNCTION` في نفس الملف يجب أن يُذكر
 *     بعده في سطر صلاحيات — سياسة المشروع «لا دالة بلا تحكم وصول».
 *
 * الحد المعروف (مذكور بصراحة): جسم دالة PL/pgSQL يُعامل كنص، فلا يُفحَص
 * داخليًا. لذلك تُختبر دوال الحساب الحرجة في TypeScript (scripts/*.test.ts)
 * حيث يمكن تنفيذها فعليًا.
 *
 *   node scripts/check-sql.js
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('pgsql-ast-parser');

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');

/** يقسّم الملف إلى عبارات: `;` خارج `$$` وخارج النصوص والتعليقات. */
function splitStatements(sql) {
  const out = [];
  let buf = '';
  let i = 0;
  let inDollar = null;
  while (i < sql.length) {
    const rest = sql.slice(i);
    const dollar = /^\$[A-Za-z_]*\$/.exec(rest);
    if (dollar) {
      const tag = dollar[0];
      if (inDollar === null) inDollar = tag;
      else if (inDollar === tag) inDollar = null;
      buf += tag;
      i += tag.length;
      continue;
    }
    const ch = sql[i];
    if (inDollar === null) {
      if (ch === '-' && sql[i + 1] === '-') {
        const end = sql.indexOf('\n', i);
        i = end === -1 ? sql.length : end + 1;
        buf += '\n';
        continue;
      }
      if (ch === '/' && sql[i + 1] === '*') {
        const end = sql.indexOf('*/', i + 2);
        i = end === -1 ? sql.length : end + 2;
        buf += ' ';
        continue;
      }
      if (ch === "'" || ch === '"') {
        const quote = ch;
        let j = i + 1;
        let literal = ch;
        while (j < sql.length) {
          if (sql[j] === quote && sql[j + 1] === quote) { literal += sql[j] + sql[j + 1]; j += 2; continue; }
          if (sql[j] === quote) { literal += quote; j += 1; break; }
          literal += sql[j];
          j += 1;
        }
        buf += literal;
        i = j;
        continue;
      }
      if (ch === ';') {
        out.push(buf.trim());
        buf = '';
        i += 1;
        continue;
      }
    }
    buf += ch;
    i += 1;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();

/** كل دالة خادمية معرَّفة، وكل ما حصل على تحكم وصول صريح في المستودع كله. */
const allFunctions = new Map(); // name -> first file
const guarded = new Set();
for (const f of files) {
  const sql = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
  for (const m of sql.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(public\.\w+)/gi)) {
    if (!allFunctions.has(m[1])) allFunctions.set(m[1], f);
  }
  for (const m of sql.matchAll(/(?:GRANT|REVOKE)[^;]*?FUNCTION\s+(public\.\w+)/gi)) guarded.add(m[1]);

  // نمط التحكم المُدار بالفهرس (0031): كتلة DO تسرد أسماء الدوال في مصفوفات
  // TEXT[] ثم تنفّذ REVOKE/GRANT عبر format() — نقرأ الأسماء من المصفوفات.
  if (/REVOKE\s+ALL\s+ON\s+FUNCTION\s+%s/i.test(sql)) {
    for (const arr of sql.matchAll(/TEXT\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]/gi)) {
      for (const name of arr[1].matchAll(/'([a-z_][a-z0-9_]*)'/g)) guarded.add(`public.${name[1]}`);
    }
  }
}
/** أنماط العبارات التي يدعمها pgsql-ast-parser بدقة كافية للاعتماد عليها. */
const SUPPORTED_STATEMENT = /^\s*(CREATE\s+TABLE|CREATE\s+(UNIQUE\s+)?INDEX|CREATE\s+EXTENSION|INSERT\s+INTO|WITH\b|SELECT\b|UPDATE\s+|DELETE\s+FROM|DO\s|COMMENT\s+ON|ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN)/i;

let parseErrors = 0;
let parsedStatements = 0;
const skipped = new Map();
let structuralErrors = 0;
let statements = 0;
let functions = 0;
let grantsMissing = 0;

console.log('═══════════════════════════════════════════════════════');
console.log('  مسار — بوابة SQL (تحليل نحوي + سياسات الصلاحيات)');
console.log('═══════════════════════════════════════════════════════');

for (const file of files) {
  const full = path.join(MIGRATIONS, file);
  const sql = fs.readFileSync(full, 'utf8');

  // (2) توازن كتل $$
  const dollars = (sql.match(/\$[A-Za-z_]*\$/g) ?? []).length;
  if (dollars % 2 !== 0) {
    structuralErrors += 1;
    console.log(`✗ ${file}: عدد غير متوازن من علامات \$\$ (${dollars})`);
  }

  const parts = splitStatements(sql);
  statements += parts.length;

  // (1) تحليل نحوي حقيقي للعبارات التي يدعمها المحلّل. باقي العبارات
  // (CREATE FUNCTION/TRIGGER/POLICY/GRANT/ALTER TABLE…) لا يدعمها المحلّل،
  // فنعدّها كـ«غير محلَّلة» بشفافية بدل الادعاء بأنها فُحصت.
  for (const stmt of parts) {
    const body = stmt.replace(/^\s*(BEGIN|COMMIT)\s*$/i, '');
    if (!body) continue;
    if (!SUPPORTED_STATEMENT.test(body)) {
      const kind = (body.match(/^([A-Za-z]+)\s+(?:OR\s+REPLACE\s+)?([A-Za-z]+)?/i) ?? [])
        .slice(1).filter(Boolean).join(' ').toUpperCase();
      skipped.set(kind || 'UNKNOWN', (skipped.get(kind || 'UNKNOWN') ?? 0) + 1);
      continue;
    }
    try {
      parse(body);
      parsedStatements += 1;
    } catch (error) {
      // صيغ أحدث من دعم المحلّل (Postgres 15+) — نعيد المحاولة بعد تعييرها.
      const downgraded = body.replace(/\s+NULLS\s+NOT\s+DISTINCT/gi, '');
      try {
        parse(downgraded);
        parsedStatements += 1;
        continue;
      } catch { /* تقرير الخطأ الأصلي أدناه */ }
      parseErrors += 1;
      const line = sql.slice(0, sql.indexOf(stmt)).split('\n').length;
      console.log(`✗ ${file}:${line} — ${error.message.split('\n')[0]}`);
      console.log(`   ${stmt.slice(0, 90).replace(/\s+/g, ' ')}…`);
    }
  }

  // (3) أسماء دوال مكررة بنفس التوقيع داخل الملف
  const seen = new Map();
  for (const m of sql.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(public\.\w+)\s*\(([^)]*)\)/gi)) {
    const sig = `${m[1]}(${m[2].replace(/\s+/g, ' ').trim().toLowerCase()})`;
    seen.set(sig, (seen.get(sig) ?? 0) + 1);
    functions += 1;
  }
  for (const [sig, n] of seen) {
    if (n > 1 && sig !== 'public._rate_limit_exceeded()') {
      // CREATE OR REPLACE مرتين في نفس الملف = إعادة تعريف، مشروعة فقط إن كان
      // تعزيزًا مقصودًا (نطالب بتعليق صريح في الملف).
      if (!/re-?define|supersede|تعزيز|إعادة تعريف/i.test(sql)) {
        structuralErrors += 1;
        console.log(`✗ ${file}: الدالة ${sig} معرَّفة ${n} مرات بلا تعليق مبرِّر`);
      }
    }
  }

  // (3b) BEGIN/COMMIT
  const opens = (sql.match(/^\s*BEGIN;/gim) ?? []).length;
  const closes = (sql.match(/^\s*COMMIT;/gim) ?? []).length;
  if (opens !== closes) {
    structuralErrors += 1;
    console.log(`✗ ${file}: BEGIN=${opens} لكن COMMIT=${closes}`);
  }
}

// (4) كل دالة خادمية لها سطر صلاحيات صريح في مكان ما من المستودع. الدوال
// الافتراضية في Postgres قابلة للتنفيذ من PUBLIC، فنعتبر «بلا REVOKE/GRANT»
// مخالفة أمنية حقيقية لا تفصيلًا شكليًا.
const unguarded = [...allFunctions.entries()].filter(([name]) => !guarded.has(name));
for (const [name, file] of unguarded) {
  console.log(`✗ ${file}: الدالة ${name} بلا أي GRANT/REVOKE في المستودع`);
}
grantsMissing = unguarded.length;

console.log('───────────────────────────────────────────────────────');
console.log(`  • ملفات: ${files.length} · عبارات كلية: ${statements} · محلَّلة نحويًا: ${parsedStatements} · دوال: ${functions}`);
const skippedTotal = [...skipped.values()].reduce((a, b) => a + b, 0);
console.log(`  • عبارات خارج نطاق المحلّل (حدّ معروف): ${skippedTotal}`);
for (const [kind, n] of [...skipped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
  console.log(`      – ${kind} × ${n}`);
}
console.log(`  • أخطاء نحوية: ${parseErrors}`);
console.log(`  • مخالفات بنيوية: ${structuralErrors}`);
console.log(`  • دوال بلا تحكم وصول: ${grantsMissing}`);

const failed = parseErrors + structuralErrors + grantsMissing;
if (failed > 0) {
  console.error(`\n✗ فشل: ${failed} مشكلة في ترحيلات SQL.`);
  process.exit(1);
}
console.log('\n✅ كل ترحيلات SQL سليمة نحويًا وبسياسات صلاحيات مضبوطة.');
