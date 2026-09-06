#!/usr/bin/env node
/**
 * scripts/check-rpc-contract.js — يمنع تكرار CRIT-FUNC-01.
 *
 * كان العميل يستدعي `update_course_details` بينما الدالة غير موجودة في أي
 * migration — فتعطّلت ميزة «تعديل الكورس» بالكامل ولم يكتشفها أي فحص. هذا
 * السكربت يقارن **كل RPC يستدعيها العميل** بما هو معرَّف فعليًا في
 * `supabase/migrations/`، ويفشل عند أول انحراف.
 *
 *   node scripts/check-rpc-contract.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');

/** كل ملفات المصدر (نبحث في المشروع كله لا في data/ فقط). */
function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.tsx?$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

// 1) ما يعرّفه الخادم فعليًا.
const defined = new Set();
for (const f of fs.readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql'))) {
  const sql = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
  for (const m of sql.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-z0-9_]+)\s*\(/gi)) {
    defined.add(m[1]);
  }
}

// 2) ما يستدعيه العميل.
const called = new Map(); // name -> Set(files)
for (const file of walk(SRC)) {
  const s = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  // .rpc('name'  |  rpc<T>('name'  |  rpc('name'
  for (const m of s.matchAll(/(?:\.rpc|(?<![A-Za-z0-9_])rpc)\s*(?:<[^>]*>)?\(\s*['"]([a-z0-9_]+)['"]/g)) {
    if (!called.has(m[1])) called.set(m[1], new Set());
    called.get(m[1]).add(rel);
  }
}

const missing = [...called.keys()].filter((n) => !defined.has(n)).sort();

if (missing.length) {
  console.error('✗ RPC contract broken — the client calls functions that no migration defines:\n');
  for (const name of missing) {
    console.error(`  • ${name}()`);
    for (const f of called.get(name)) console.error(`      called from ${f}`);
  }
  console.error('\nAdd the missing CREATE OR REPLACE FUNCTION, or fix the call site.');
  process.exit(1);
}

console.log(`✅ RPC contract OK — ${called.size} client calls, all defined across ${defined.size} server functions`);
