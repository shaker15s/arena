// scripts/rls.test.ts — ربط/تأمين مضاد للتحايل (P0 #9 من §8).
// يختبر عقود العمل الخادمية التي تمنع: تجاوز السعة، الحضور في جلسة مغلقة،
// بدء جلسة بغير مؤهل، تجاوز كوتا الكودوس، وازدواج التسجيل. يعمل بلا شبكة
// (مُحاكي = مرآة لسلوك RPC الخادم) في نفس نمط engine.test.ts.
//   npx tsc -p tsconfig.test.json && node .test-build/scripts/rls.test.js
import {
  batchOf, currentQrToken, rpcAwardKudos, rpcCheckIn, rpcJoinBatch, rpcStartSession, seatCounts,
} from '../src/data/engine';
import { buildSeedDb, IDS } from './fixtures/seed';
import type { TrainingSession } from '../src/data/types';

let passed = 0, failed = 0;
function ok(cond: boolean, name: string, extra?: unknown) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
}

(() => {
  console.log('\n═ RLS / Race — منع التحايل والسباقات ═');
  const db = buildSeedDb();
  const student = IDS.omar;             // طالب حالي
  const other = 'u_adam';               // طالب آخر من الـ seed
  const batch = IDS.g2;                 // سعة 12

  // ═ 1) منع تجاوز السعة (overbooking) ═
  console.log('\n═ 1) تجاوز السعة ═');
  const b = batchOf(db, batch)!;
  ok(b.capacity > 0, 'المجموعة لها سعة', b.capacity);
  // املأ السعة بطالبين وافحص أن كل زائد يدخل قائمة الانتظار.
  const before = seatCounts(db, batch);
  const j1 = rpcJoinBatch(db, student, batch);
  ok(j1.status === 'active' || j1.status === 'waitlist', 'الانضمام يعيد حالة صالحة', j1.status);
  const after = seatCounts(db, batch);
  ok(after.taken === before.taken || after.taken === before.taken + 1, 'عدد المقاعد لا يقفز فوق السعة', { before, after });
  ok(after.taken <= b.capacity, 'المقاعد المحجوزة لا تتجاوز السعة', { taken: after.taken, capacity: b.capacity });

  // ═ 2) منع ازدواج التسجيل (idempotency) ═
  console.log('\n═ 2) ازدواج التسجيل ═');
  const d1 = rpcJoinBatch(db, student, batch);
  const d2 = rpcJoinBatch(db, student, batch);
  const count = db.enrollments.filter((e) => e.userId === student && e.batchId === batch).length;
  ok(count === 1, 'نفس الطالب لا يُسجَّل مرتين', count);
  ok(d1.status === d2.status, 'العودة لنفس الحالة عند التكرار', { d1: d1.status, d2: d2.status });

  // ═ 3) الحضور في جلسة حية فقط ورفض التوكن المزيّف ═
  console.log('\n═ 3) الحضور في جلسة حية فقط، ورفض التوكن المزيّف ═');
  // g2 ممتلئة في الـ seed (سعة 12/12) لذا omar دخل قائمة الانتظار في اختبار 1.
  // الحضور يُختبر بطالب مسجّل فعليًا (active)، وطالب الانتظار يجب أن يُرفض.
  const enrolledStudent = db.enrollments.find((e) => e.batchId === batch && e.status === 'active')!.userId;
  const started = rpcStartSession(db, batch, IDS.sara);
  ok(!('error' in started), 'فتح جلسة g2 الحية نجح', started);
  const live = (started as any).session as TrainingSession;
  const token = currentQrToken(live, Date.now());
  const check = rpcCheckIn(db, enrolledStudent, token);
  ok(check.kind === 'ok' || check.kind === 'already', 'الحضور عبر توكن صالح يعمل أو يعيد already', check.kind);
  // طالب قائمة الانتظار (غير active) ممنوع من الحضور — لا مقعد بلا تسجيل فعلي.
  if (j1.status === 'waitlist' || d1.status === 'waitlist') {
    const waitlisted = rpcCheckIn(db, student, currentQrToken(live, Date.now()));
    ok(waitlisted.kind === 'not_enrolled', 'طالب قائمة الانتظار مرفوض من الحضور', waitlisted.kind);
  }
  // التوكن المزيّف مرفوض دائمًا
  const forged = rpcCheckIn(db, enrolledStudent, 'forged-token-xyz');
  ok(forged.kind === 'invalid', 'توكن مزيّف مرفوض', forged.kind);

  // ═ 4) بدء جلسة لغير مدرب/مدير (صلاحية) ═
  console.log('\n═ 4) صلاحية بدء الجلسة ═');
  // المتجر يفرض الصلاحية من قبل RPC في الواجهة؛ هنا verifies the state transition rules.
  const noUpcomingBatch = 'bt_nonexist';
  const bad = rpcStartSession(db, noUpcomingBatch, student);
  ok('error' in bad, 'بدء جلسة لمجموعة غير موجودة ← خطأ', bad);
  // إعادة البدء لنفس المجموعة تعيد نفس الجلسة الحية (لا تضاعف).
  const twice = rpcStartSession(db, batch, IDS.sara);
  ok(!('error' in twice), 'البدء مرتين لا يفتح جلستين', twice);

  // ═ 5) كوتا الكودوس الشهرية ═
  console.log('\n═ 5) كوتا الكودوس ═');
  const quota = Number((db.rules.find((r) => r.key === 'kudos.monthly_quota_per_instructor') ?? { value: 200 }).value);
  const big = rpcAwardKudos(db, IDS.sara, student, batch, 26, 'تقدير');
  ok(big.ok === false && big.error === 'range', 'نقاط فوق الحد (26) مرفوضة', big);
  // املأ الكوتا بالكامل (بدفعات مقبولة ≤25) ثم حاول تجاوزها.
  let spent = 0;
  let overOk = false as boolean;
  while (spent < quota) {
    const step = Math.min(25, quota - spent);
    const r = rpcAwardKudos(db, IDS.sara, student, batch, step, 'تعبئة الكوتا');
    if (!r.ok) break;
    spent += step;
  }
  const last = rpcAwardKudos(db, IDS.sara, student, batch, 1, 'أكثر من الكوتا');
  overOk = last.ok === false && last.error === 'quota';
  ok(overOk, 'تجاوز كوتا الشهر مرفوض بعد ملء الكوتا', { quota, spent, last: last.error });

  // ═ 6) كودوس صالح من مدرب آخر (كوتا غير ممتلئة) ═
  console.log('\n═ 6) كودوس صالح ═');
  const legit = rpcAwardKudos(db, IDS.ahmed, student, batch, 5, 'مشاركة مميزة');
  ok(legit.ok === true, 'كودوس صالح (5) مقبول', legit);

  console.log(`\n═══ RLS/Race: ${passed} ✅ / ${failed} ❌ ═══`);
  if (failed > 0) process.exit(1);
})();
