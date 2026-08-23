#!/usr/bin/env node
/**
 * فاحص التكافؤ عربي/إنجليزي (وثيقة 06 — قاعدة بناء: لا نص حرفي).
 * يفشل الـ CI لو أي مفتاح ناقص في أي من القاموسين.
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
console.log(`✅ i18n parity OK — ${ar.size} keys in both dictionaries`);
