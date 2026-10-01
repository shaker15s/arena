// scripts/role-access.test.ts — اختبارات بناء حمولة الصلاحيات وكاشف انحراف البصمات (P0)
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { buildAccessPayload, type AccessPatch } from '../src/data/accessPayload';

const checkRpcContractPath = path.resolve(__dirname, '../../scripts/check-rpc-contract.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { detectOverloadDrift, signatureOf } = require(checkRpcContractPath);

let passed = 0;
let failed = 0;

function ok(cond: boolean, name: string, extra?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}`, extra !== undefined ? JSON.stringify(extra) : '');
  }
}

console.log('\n═ فحص حمولة الصلاحيات وكاشف البصمات (Role Access & Overload Guard) ═');

// ═ 1) اختبارات بناء الحمولة الأساسية ═
console.log('\n═ 1) بنية الحمولة الأساسية (5 مفاتيح دائمًا) ═');

const p1 = buildAccessPayload('pid', { role: 'volunteer' });
ok(
  p1.p_profile_id === 'pid' &&
    p1.p_role === 'volunteer' &&
    p1.p_status === null &&
    p1.p_branch_id === null &&
    p1.p_clear_branch === false,
  'buildAccessPayload(pid, { role: "volunteer" }) يعيد 5 مفاتيح مع p_clear_branch: false',
  p1,
);

const p2 = buildAccessPayload('pid', { branchId: null, clearBranch: true });
ok(
  p2.p_profile_id === 'pid' &&
    p2.p_role === null &&
    p2.p_status === null &&
    p2.p_branch_id === null &&
    p2.p_clear_branch === true,
  'buildAccessPayload(pid, { branchId: null, clearBranch: true }) يعيد p_clear_branch: true',
  p2,
);

const p3 = buildAccessPayload('pid', { branchId: 'b_cairo' });
ok(
  p3.p_branch_id === 'b_cairo' && p3.p_clear_branch === false,
  'تعيين الفرع يضع المعرّف مع p_clear_branch: false',
  p3,
);

// ═ 2) اختبار تحويلات الوصول السبعة ═
console.log('\n═ 2) تحويلات الصلاحيات السبعة ═');

const transitions: Array<{ name: string; patch: AccessPatch; verify: (p: ReturnType<typeof buildAccessPayload>) => boolean }> = [
  {
    name: '1. ترقية طالب إلى متطوع',
    patch: { role: 'volunteer' },
    verify: (p) => p.p_role === 'volunteer' && p.p_status === null && p.p_clear_branch === false,
  },
  {
    name: '2. ترقية إلى مشرف',
    patch: { role: 'supervisor' },
    verify: (p) => p.p_role === 'supervisor' && p.p_status === null && p.p_clear_branch === false,
  },
  {
    name: '3. ترقية إلى مسؤول نظام (Admin)',
    patch: { role: 'admin' },
    verify: (p) => p.p_role === 'admin' && p.p_status === null && p.p_clear_branch === false,
  },
  {
    name: '4. تعديل الدور فقط (role-only: student)',
    patch: { role: 'student' },
    verify: (p) => p.p_role === 'student' && p.p_status === null && p.p_clear_branch === false,
  },
  {
    name: '5. تعطيل الحساب (disable)',
    patch: { status: 'disabled' },
    verify: (p) => p.p_status === 'disabled' && p.p_role === null && p.p_clear_branch === false,
  },
  {
    name: '6. إعادة تنشيط الحساب (activate)',
    patch: { status: 'active' },
    verify: (p) => p.p_status === 'active' && p.p_role === null && p.p_clear_branch === false,
  },
  {
    name: '7. تفريغ الفرع صراحةً (clear branch)',
    patch: { branchId: null, clearBranch: true },
    verify: (p) => p.p_branch_id === null && p.p_clear_branch === true,
  },
];

for (const t of transitions) {
  const payload = buildAccessPayload('user_test_id', t.patch);
  const keys = Object.keys(payload).sort();
  const has5Keys = JSON.stringify(keys) === JSON.stringify(['p_branch_id', 'p_clear_branch', 'p_profile_id', 'p_role', 'p_status']);
  const booleanClear = typeof payload.p_clear_branch === 'boolean';
  ok(has5Keys && booleanClear && t.verify(payload), t.name, payload);
}

// ═ 3) اختبار كاشف انحراف وتكرار البصمات (Overload Detector) ═
console.log('\n═ 3) كاشف تعارض البصمات واختبارات السلب ═');

ok(
  signatureOf('p_id UUID, p_role TEXT DEFAULT NULL, p_status TEXT') === 'uuid,text,text',
  'signatureOf: استخلاص الأنواع فقط وتجاهل الأسماء والقيم الافتراضية',
);

ok(
  signatureOf('p_lat DOUBLE PRECISION DEFAULT NULL, p_lng DOUBLE PRECISION') === 'double precision,double precision',
  'signatureOf: معالجة الأنواع المركبة مثل DOUBLE PRECISION',
);

ok(
  signatureOf('OUT p_res TEXT, p_id UUID') === 'uuid',
  'signatureOf: استبعاد وسائط OUT من بصمة الاستدعاء',
);

// اختبار سالب: فيكستشر فيه تعارض بصمتين لنفس الدالة
const conflictingFixture = [
  {
    file: '0001_initial.sql',
    sql: 'CREATE OR REPLACE FUNCTION public.demo_calc(p_x INTEGER, p_y INTEGER) RETURNS INTEGER AS $$ BEGIN RETURN p_x + p_y; END; $$ LANGUAGE plpgsql;',
  },
  {
    file: '0002_upgrade.sql',
    sql: 'CREATE OR REPLACE FUNCTION public.demo_calc(p_x INTEGER, p_y INTEGER, p_z INTEGER) RETURNS INTEGER AS $$ BEGIN RETURN p_x + p_y + p_z; END; $$ LANGUAGE plpgsql;',
  },
];

const conflictResults = detectOverloadDrift(conflictingFixture);
ok(
  conflictResults.length === 1 && conflictResults[0].name === 'demo_calc' && conflictResults[0].signatures.size === 2,
  'الاختبار السالب: كشف تعارض البصمات إذا وُجدت بصمتان حيّتان لنفس الدالة',
  conflictResults,
);

// فيكستشر يُحل فيه التعارض عبر DROP صريح
const resolvedFixture = [
  {
    file: '0001_initial.sql',
    sql: 'CREATE OR REPLACE FUNCTION public.demo_calc(p_x INTEGER, p_y INTEGER) RETURNS INTEGER AS $$ BEGIN RETURN p_x + p_y; END; $$ LANGUAGE plpgsql;',
  },
  {
    file: '0002_upgrade.sql',
    sql: 'DROP FUNCTION IF EXISTS public.demo_calc(INTEGER, INTEGER); CREATE OR REPLACE FUNCTION public.demo_calc(p_x INTEGER, p_y INTEGER, p_z INTEGER) RETURNS INTEGER AS $$ BEGIN RETURN p_x + p_y + p_z; END; $$ LANGUAGE plpgsql;',
  },
];

const resolvedResults = detectOverloadDrift(resolvedFixture);
ok(
  resolvedResults.length === 0,
  'حل التعارض: DROP يزيل البصمة القديمة بنجاح',
  resolvedResults,
);

// التحقق من ترحيلات المستودع الحقيقية
const migrationsDir = path.resolve(__dirname, '../../supabase/migrations');
const realFiles = fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort();
const realEntries = realFiles.map((f) => ({
  file: f,
  sql: fs.readFileSync(path.join(migrationsDir, f), 'utf8'),
}));

const repoOverloads = detectOverloadDrift(realEntries, new Set(['create_course', 'create_batch_with_sessions']));
ok(
  repoOverloads.length === 0,
  'المستودع خالي من أي تعارض بصمات غير معتمد (0 مخالفات)',
  repoOverloads,
);

console.log(`\n═══ Role Access: ${passed} ✅ / ${failed} ❌ ═══\n`);
if (failed > 0) {
  process.exit(1);
}
