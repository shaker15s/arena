#!/usr/bin/env node
/**
 * scripts/check-rpc-contract.js — يمنع تكرار CRIT-FUNC-01 و PGRST203.
 *
 * 1) يقارن كل RPC يستدعيها العميل بما هو معرَّف فعليًا في `supabase/migrations/`،
 *    ويفشل عند أي نداء لدالة مفقودة.
 * 2) كاشف تعارض البصمات (PGRST203 guard): يفحص تكرار البصمات النشطة لنفس الاسم
 *    عبر ملفات الترحيل، محاكيًا تتابع CREATE و DROP.
 *
 *   node scripts/check-rpc-contract.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const SUPABASE = path.join(ROOT, 'supabase');
const MIGRATIONS = path.join(SUPABASE, 'migrations');

/**
 * توحيد مسميات الأنواع في Postgres لمطابقة دقيقة.
 */
function normalizeType(t) {
  t = t.trim().toLowerCase().replace(/\s+/g, ' ');
  t = t.replace(/\bint4\b|\bint\b/g, 'integer');
  t = t.replace(/\bint8\b/g, 'bigint');
  t = t.replace(/\bbool\b/g, 'boolean');
  t = t.replace(/\bfloat8\b/g, 'double precision');
  t = t.replace(/\btimestamptz\b/g, 'timestamp with time zone');
  t = t.replace(/\bcharacter varying\b/g, 'varchar');
  return t;
}

/**
 * يحوّل قائمة وسائط SQL إلى بصمة أنواع مُطبَّعة: «uuid,text,text».
 * يتجاهل أسماء الوسائط والقيم الافتراضية ووسائط OUT — البصمة = أنواع الدخل فقط بترتيبها.
 */
function signatureOf(argList) {
  if (!argList || !argList.trim()) return '';
  const parts = [];
  let cur = '';
  let depth = 0;
  for (let i = 0; i < argList.length; i++) {
    const c = argList[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());

  const types = [];
  for (const raw of parts) {
    const defIdx = raw.search(/\s+DEFAULT\s+/i);
    const beforeDef = defIdx !== -1 ? raw.substring(0, defIdx).trim() : raw.trim();
    const tokens = beforeDef.split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;

    let start = 0;
    const mode = tokens[0].toLowerCase();
    if (['in', 'out', 'inout', 'variadic'].includes(mode)) {
      if (mode === 'out') continue; // OUT params do not form Postgres input signature
      start = 1;
    }

    const remaining = tokens.slice(start);
    if (!remaining.length) continue;

    if (remaining.length === 1) {
      types.push(normalizeType(remaining[0]));
    } else {
      // multi-word type without name (e.g. DOUBLE PRECISION) vs name + type (p_lat DOUBLE PRECISION)
      const first = remaining[0].toLowerCase();
      if (['double', 'character', 'timestamp', 'time'].includes(first)) {
        types.push(normalizeType(remaining.join(' ')));
      } else {
        types.push(normalizeType(remaining.slice(1).join(' ')));
      }
    }
  }
  return types.join(',');
}

/**
 * كاشف انحراف وتكرار البصمات (الدرع ضد PGRST203):
 * يحاكي تطبيق الملفات بالترتيب — كل CREATE [OR REPLACE] FUNCTION يسجل بصمة نشطة،
 * وكل DROP FUNCTION يزيلها — ثم يفشل إن بقيت لأي دالة غير معفاة أكثر من بصمة نشطة.
 * @param {{file: string, sql: string}[]} entries بترتيب التطبيق
 * @param {Set<string>} allowlist دوال موروثة معفاة مؤقتًا
 * @returns {{name: string, signatures: Map<string, string>}[]} الدوال المكررة
 */
function detectOverloadDrift(entries, allowlist = new Set()) {
  const CREATE_RE = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z0-9_]+)\s*\(([^)]*)\)/gi;
  const DROP_RE = /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?([a-z0-9_]+)\s*(?:\(([^)]*)\))?/gi;
  const live = new Map(); // name -> Map(sigKey -> file)

  for (const { file, sql } of entries) {
    // 1) Drops
    for (const m of sql.matchAll(DROP_RE)) {
      const name = m[1].toLowerCase();
      const rawArgs = m[2];
      if (!rawArgs || !rawArgs.trim()) {
        live.delete(name);
      } else {
        const sig = signatureOf(rawArgs);
        live.get(name)?.delete(sig);
      }
    }

    // 2) Creates
    for (const m of sql.matchAll(CREATE_RE)) {
      const name = m[1].toLowerCase();
      const sig = signatureOf(m[2]);
      if (!live.has(name)) live.set(name, new Map());
      live.get(name).set(sig, file);
    }
  }

  return [...live.entries()]
    .filter(([name, sigs]) => sigs.size > 1 && !allowlist.has(name.toLowerCase()))
    .map(([name, signatures]) => ({ name, signatures }));
}

/** كل ملفات المصدر (نبحث في المشروع كله لا في data/ فقط). */
function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.tsx?$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

function runCheck() {
  const migrationFiles = fs.readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort();
  const migrationEntries = migrationFiles.map((f) => ({
    file: f,
    sql: fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'),
  }));

  // 1) ما يعرّفه الخادم فعليًا.
  const defined = new Set();
  for (const { sql } of migrationEntries) {
    for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.([a-z0-9_]+)\s*\(/gi)) {
      defined.add(m[1].toLowerCase());
    }
  }

  // 2) ما يستدعيه العميل.
  const called = new Map(); // name -> Set(files)
  for (const file of walk(SRC)) {
    const s = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    for (const m of s.matchAll(/(?:\.rpc|(?<![A-Za-z0-9_])rpc)\s*(?:<[^>]*>)?\(\s*['"]([a-z0-9_]+)['"]/g)) {
      const name = m[1].toLowerCase();
      if (!called.has(name)) called.set(name, new Set());
      called.get(name).add(rel);
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

  // 3) فحص تعارض وتكرار البصمات (الدرع ضد PGRST203)
  const KNOWN_LEGACY_OVERLOADS = new Set(['create_course', 'create_batch_with_sessions']);
  const overloads = detectOverloadDrift(migrationEntries, KNOWN_LEGACY_OVERLOADS);

  if (overloads.length) {
    console.error('✗ Duplicate active function overloads detected (PGRST203 risk):\n');
    for (const { name, signatures } of overloads) {
      console.error(`  • ${name}:`);
      for (const [sig, file] of signatures.entries()) {
        console.error(`      – (${sig}) in ${file}`);
      }
    }
    console.error('\nEnsure older overloads are dropped via DROP FUNCTION, or unify function signatures.');
    process.exit(1);
  }

  console.log(`✅ RPC contract OK — ${called.size} client calls, all defined across ${defined.size} server functions`);
  console.log(`✅ Overload guard OK — no conflicting active overloads across ${migrationFiles.length} migrations`);
}

if (require.main === module) {
  runCheck();
}

module.exports = {
  signatureOf,
  detectOverloadDrift,
  runCheck,
};
