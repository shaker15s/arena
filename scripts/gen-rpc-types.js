#!/usr/bin/env node
/**
 * scripts/gen-rpc-types.js — يولّد تعريفات وسائط RPC من ملفات migration مباشرة.
 *
 * السبب: `src/types/database.ts` انجرف مرتين عن الواقع (TYPE-001) لأنه مكتوب
 * يدويًا. المصدر الوحيد للحقيقة هو تعريف SQL نفسه، فنقرأه بدل تخمينه.
 *
 *   node scripts/gen-rpc-types.js            # يفحص التطابق (وضع CI) — يفشل عند الانجراف
 *   node scripts/gen-rpc-types.js --write    # يكتب الكتلة المولَّدة داخل database.ts
 *
 * ما يفعله: يستخرج كل `CREATE OR REPLACE FUNCTION public.<name>(args)` ويحوّل
 * أنواع Postgres إلى TypeScript. آخر تعريف للدالة يفوز (يحاكي ترتيب تطبيق
 * الترقيات) — فإعادة تعريف دالة في migration لاحق تُلتقط تلقائيًا.
 */
const fs = require('fs');
const path = require('path');

const MIGRATIONS = path.resolve(__dirname, '..', 'supabase', 'migrations');
const TARGET = path.resolve(__dirname, '..', 'src', 'types', 'database.ts');
const BEGIN = '  // ─── BEGIN GENERATED RPC ARGS (scripts/gen-rpc-types.js) ───';
const END = '  // ─── END GENERATED RPC ARGS ───';

/** الدوال الداخلية (مصادَرة عن العميل) لا تُصدَّر في نوع العميل. */
const INTERNAL = /^(_|handle_new_user|evaluate_user_badges|auto_close|settle_|close_previous|enqueue_session_reminders|prune_|claim_push_batch|settle_push_batch|my_profile_id|my_role|is_manager|can_manage)/;

function sqlTypeToTs(sqlType) {
  const t = sqlType.trim().toLowerCase().replace(/\s+/g, ' ');
  if (/\[\]$/.test(t)) return `${sqlTypeToTs(t.replace(/\[\]$/, ''))}[]`;
  if (/^(uuid|text|char|varchar|character)/.test(t)) return 'string';
  if (/^(int|integer|bigint|smallint|numeric|decimal|double|real|float)/.test(t)) return 'number';
  if (/^bool/.test(t)) return 'boolean';
  if (/^jsonb?$/.test(t)) return 'Json';
  if (/^timestamp|^date$|^time/.test(t)) return 'string';
  return 'unknown';
}

/** يقسم قائمة الوسائط احترامًا للأقواس المتداخلة والنصوص المقتبسة. */
function splitArgs(raw) {
  const out = [];
  let depth = 0, cur = '', quote = null;
  for (const ch of raw) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

function parseArg(arg) {
  // شكل: p_name TYPE [DEFAULT expr]
  const hasDefault = /\sDEFAULT\s/i.test(arg);
  const withoutDefault = arg.replace(/\sDEFAULT\s[\s\S]*$/i, '').trim();
  const m = withoutDefault.match(/^(?:IN|OUT|INOUT|VARIADIC)?\s*([A-Za-z_][A-Za-z0-9_]*)\s+([\s\S]+)$/);
  if (!m) return null;
  const [, name, type] = m;
  return { name, ts: sqlTypeToTs(type), optional: hasDefault };
}

function collect() {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  const fns = new Map(); // آخر تعريف يفوز
  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
    const re = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-z0-9_]+)\s*\(([\s\S]*?)\)\s*\r?\n\s*RETURNS/gi;
    let m;
    while ((m = re.exec(sql))) {
      const [, name, rawArgs] = m;
      if (INTERNAL.test(name)) continue;
      // نتجاهل تعليقات SQL داخل قائمة الوسائط
      const cleaned = rawArgs.replace(/--[^\n]*/g, '');
      const args = splitArgs(cleaned).map(parseArg).filter(Boolean);
      fns.set(name, { args, source: f });
    }
  }
  return fns;
}

function render(fns) {
  const names = [...fns.keys()].sort();
  const lines = [BEGIN];
  lines.push('  // مولَّد آليًا من supabase/migrations — لا تحرّره يدويًا.');
  lines.push(`  // أعِد التوليد: node scripts/gen-rpc-types.js --write`);
  for (const name of names) {
    const { args, source } = fns.get(name);
    const argType = args.length === 0
      ? 'Record<string, never>'
      : `{ ${args.map((a) => `${a.name}${a.optional ? '?' : ''}: ${a.ts}${a.optional ? ' | null' : ''}`).join('; ')} }`;
    lines.push(`  /** ${source} */`);
    lines.push(`  ${name}: { Args: ${argType}; Returns: Json };`);
  }
  lines.push(END);
  return lines.join('\n');
}

const fns = collect();
const block = render(fns);
const current = fs.readFileSync(TARGET, 'utf8');
const write = process.argv.includes('--write');

const startIdx = current.indexOf(BEGIN);
const endIdx = current.indexOf(END);

if (startIdx === -1 || endIdx === -1) {
  if (!write) {
    console.error('✗ generated RPC block not found in database.ts — run: node scripts/gen-rpc-types.js --write');
    process.exit(1);
  }
  console.error('✗ marker block missing; add BEGIN/END markers inside GeneratedRpc first.');
  process.exit(1);
}

const existing = current.slice(startIdx, endIdx + END.length);
if (existing.trim() === block.trim()) {
  console.log(`✅ RPC types in sync — ${fns.size} functions`);
  process.exit(0);
}

if (!write) {
  console.error(`✗ RPC types drifted from supabase/migrations (${fns.size} functions).`);
  console.error('  Run: node scripts/gen-rpc-types.js --write');
  process.exit(1);
}

fs.writeFileSync(TARGET, current.slice(0, startIdx) + block + current.slice(endIdx + END.length));
console.log(`✅ wrote ${fns.size} RPC signatures into src/types/database.ts`);
