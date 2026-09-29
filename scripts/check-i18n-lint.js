#!/usr/bin/env node
/**
 * scripts/check-i18n-lint.js — بوابة «لا نص عربي مضمّن» (Ratchet Gate).
 *
 * المشكلة المقيسة: المشروع يدعم العربية والإنجليزية، لكن 275 نصًا عربيًا كان
 * مضمّنًا في الكود (30 ملفًا) ⇒ المستخدم الإنجليزي يرى نصوصًا عربية في منتصف
 * الواجهة. نقلها كلها مرة واحدة مخاطرة كبيرة، فنستخدم **سقفًا متدرّجًا**:
 *
 *   • لكل ملف سقف مسجَّل في `scripts/i18n-hardcoded-baseline.json`.
 *   • تجاوز السقف  ⇒ فشل البناء (لا تزيد المشكلة أبدًا).
 *   • النزول عن السقف ⇒ نجاح + تنبيه لتحديث السقف (تقدّم مطلوب، لا رجوع).
 *
 * الاستثناءات الموثّقة: `src/shared/format.ts` (بيانات لوكال: أسماء الشهور
 * وأيام الأسبوع بالعربية والإنجليزية داخل نفس الدالة — مكانها الصحيح هناك)،
 * و`src/i18n/**` (القواميس نفسها).
 *
 *   node scripts/check-i18n-lint.js            # فحص
 *   node scripts/check-i18n-lint.js --update   # تحديث السقوف بعد تحسين حقيقي
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const BASELINE_FILE = path.join(__dirname, 'i18n-hardcoded-baseline.json');
const ARABIC = /[\u0600-\u06FF]/;

const ALLOWLIST = [
  'src/i18n',
  'src/shared/format.ts', // بيانات لوكال ثنائية اللغة داخل نفس الدالة
];

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (/\.tsx?$/.test(e.name)) acc.push(full);
  }
  return acc;
}

function stripComments(s) {
  return s
    // تعليقات JSX {\/* … *\/} أولًا — أشهر صيغة تعليق في هذا المشروع
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\/.*$/gm, '');
}

/**
 * استثناء سطري صريح: أي سطر يحمل `i18n-lint:ok` لا يُحتسب.
 * يُستخدم للنصوص التي **ليست واجهة**: مثل تحليل صيغ وقت عربية قادمة من
 * المستخدم، أو مفاتيح تخزين. كل استثناء مبرَّر بتعليق في مكانه.
 */
function stripMarkedLines(s) {
  return s
    .split('\n')
    .filter((line) => !line.includes('i18n-lint:ok'))
    .join('\n');
}

function countArabicLiterals(src) {
  const clean = stripComments(src);
  const single = clean.match(/'([^'\n]*[\u0600-\u06FF][^'\n]*)'/g) ?? [];
  const double = clean.match(/"([^"\n]*[\u0600-\u06FF][^"\n]*)"/g) ?? [];
  const template = clean.match(/`([^`]*[\u0600-\u06FF][^`]*)`/g) ?? [];
  return single.length + double.length + template.length;
}

const baseline = fs.existsSync(BASELINE_FILE)
  ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
  : {};

const current = {};
let total = 0;
for (const file of walk(SRC)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (ALLOWLIST.some((a) => rel.startsWith(a))) continue;
  const count = countArabicLiterals(stripMarkedLines(fs.readFileSync(file, 'utf8')));
  if (count > 0) {
    current[rel] = count;
    total += count;
  }
}

if (process.argv.includes('--update')) {
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(current, null, 2) + '\n');
  console.log(`✓ حُدِّث السقف: ${Object.keys(current).length} ملفًا · ${total} نصًا`);
  process.exit(0);
}

const regressions = [];
let improved = 0;
for (const [rel, count] of Object.entries(current)) {
  const cap = baseline[rel];
  if (cap === undefined) regressions.push(`${rel} — ملف جديد فيه ${count} نصًا عربيًا مضمّنًا`);
  else if (count > cap) regressions.push(`${rel} — ${count} > السقف ${cap}`);
  else if (count < cap) improved += 1;
}
const removed = Object.keys(baseline).filter((k) => current[k] === undefined);

console.log('═══════════════════════════════════════════════════════');
console.log('  مسار — بوابة التعريب (Hardcoded Arabic Gate)');
console.log('═══════════════════════════════════════════════════════');
console.log(`  • نصوص عربية مضمّنة الآن: ${total} في ${Object.keys(current).length} ملفًا`);
console.log(`  • ملفات تحسّنت عن السقف: ${improved}`);
console.log(`  • ملفات نظفت بالكامل: ${removed.length}`);
if (improved || removed.length) {
  console.log(`  • لتثبيت التقدّم: node scripts/check-i18n-lint.js --update`);
}
if (regressions.length) {
  console.log('\n✗ تراجع:');
  for (const r of regressions) console.log('   ' + r);
  console.error(`\n✗ فشل: ${regressions.length} ملفًا تجاوز سقفه — انقل النص إلى i18n.`);
  process.exit(1);
}
console.log('\n✅ لا تراجع — كل ملف داخل سقفه أو أفضل.');
