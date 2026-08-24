#!/usr/bin/env node
// scripts/build-web-editor-sql.js — يولّد ملف ترقية SQL Editor من الـ migrations
// مباشرة بدل الصيانة اليدوية (كانت مصدر انحراف بين المسارين).
//
//   node scripts/build-web-editor-sql.js 0014 0015 0016 > supabase/WEB_EDITOR_UPGRADE_3.sql
//
// بدون وسائط: يطبع قائمة الـ migrations المتاحة.
const fs = require('fs');
const path = require('path');

const DIR = path.resolve(__dirname, '..', 'supabase', 'migrations');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

const wanted = process.argv.slice(2);
if (!wanted.length) {
  console.error('Available migrations:\n  ' + files.join('\n  '));
  console.error('\nUsage: node scripts/build-web-editor-sql.js 0014 0015 ... > supabase/WEB_EDITOR_UPGRADE_N.sql');
  process.exit(1);
}

const picked = wanted.map((w) => {
  const f = files.find((x) => x.startsWith(w));
  if (!f) { console.error(`✗ migration not found: ${w}`); process.exit(1); }
  return f;
});

const parts = [
  '-- MASAR — ملف ترقية SQL Editor (مولَّد آليًا — لا تعدّله يدويًا)',
  `-- المصدر: ${picked.join(', ')}`,
  `-- توليد: node scripts/build-web-editor-sql.js ${wanted.join(' ')}`,
  '-- شغّل الملف كاملًا كـ Query واحدة على مشروع مطبَّق عليه الترقيات السابقة.',
  '',
];
for (const f of picked) {
  parts.push(`-- ═══════════════ ↳ ${f} ═══════════════`);
  parts.push(fs.readFileSync(path.join(DIR, f), 'utf8').trim());
  parts.push('');
}
process.stdout.write(parts.join('\n'));
