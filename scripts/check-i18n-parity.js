#!/usr/bin/env node
/**
 * فاحص التكافؤ عربي/إنجليزي (وثيقة 06 — قاعدة بناء: لا نص حرفي).
 * يفشل الـ CI لو أي مفتاح ناقص في أي من القاموسين.
 *
 * صعوبة إضافية (Wave-F): مطابقة الاستخدام — كل مفتاح يُستدعى ثابتًا في الكود
 * (`t('…')` / `tStatic('…')`) يجب أن يوجد في القاموسين. هذا الفحص هو الذي
 * كشف `common.pressBackAgainToExit` الناقصة (كان المستخدم يرى المفتاح خام).
 */
const fs = require('fs');
const path = require('path');

function extractKeys(file) {
  const content = fs.readFileSync(file, 'utf8');
  const keys = new Set();
  const re = /^\s*'([^']+)':/gm;
  let m;
  while ((m = re.exec(content)) !== null) keys.add(m[1]);
  return keys;
}

const root = path.join(__dirname, '..');
const ar = extractKeys(path.join(root, 'src/i18n/ar.ts'));
const en = extractKeys(path.join(root, 'src/i18n/en.ts'));

const missingInEn = [...ar].filter((k) => !en.has(k));
const missingInAr = [...en].filter((k) => !ar.has(k));

if (missingInEn.length || missingInAr.length) {
  console.error('❌ i18n parity check FAILED');
  if (missingInEn.length) console.error('Missing in en.ts:', missingInEn);
  if (missingInAr.length) console.error('Missing in ar.ts:', missingInAr);
  process.exit(1);
}

// ── فحص الاستخدام مقابل القاموس ─────────────────────────────────────────────
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (/\.tsx?$/.test(e.name)) acc.push(full);
  }
  return acc;
}

/** يقطع التعليقات حتى لا نفحص مفاتيح كانت في كود مهجور. */
function stripComments(s) {
  return s
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\/.*$/gm, '');
}

const srcDir = path.join(root, 'src');
const usedKeys = new Map(); // key → [files]
for (const file of walk(srcDir)) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  if (rel.startsWith('src/i18n/')) continue; // القواميس نفسها
  const content = stripComments(fs.readFileSync(file, 'utf8'));
  // t('…') / tStatic('…') — فقط عندما يُمرَّر نص حرفي ثابت
  const re = /\bt(?:Static)?\(\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const key = m[1];
    if (key.includes('${')) continue; // قالب ديناميكي — تغطيه أسرة المفاتيح أدناه
    if (!usedKeys.has(key)) usedKeys.set(key, []);
    usedKeys.get(key).push(rel);
  }
}

const missingUsage = [...usedKeys.keys()].filter((k) => !ar.has(k) || !en.has(k));

if (missingUsage.length) {
  console.error('❌ i18n usage audit FAILED — مفاتيح مستخدمة غير موجودة في القاموس:');
  for (const k of missingUsage) {
    console.error(`   ${k} — ${usedKeys.get(k).join(', ')}`);
  }
  process.exit(1);
}

console.log(`✅ i18n parity OK — ${ar.size} keys in both dictionaries · ${usedKeys.size} static usages verified`);
