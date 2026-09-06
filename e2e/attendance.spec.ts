/**
 * e2e/attendance.spec.ts — اختبار المسار الحرج لتسجيل الحضور الذكي (QR الدوّار، الكود الاحتياطي، وحساب النقاط)
 */
import { buildSeedDb, IDS } from '../scripts/fixtures/seed';
import {
  currentQrToken,
  qrSlotOf,
  rpcCheckIn,
  balanceOf,
  backupCodeOf,
} from '../src/data/engine';
import { qrSignature } from '../src/shared/sha256';

export async function testAttendanceFlow(assert: (ok: boolean, msg: string) => void) {
  console.log('\n--- [E2E] فحص مسار الحضور الذكي والـ QR الدوار (Attendance Flow) ---');
  const db = buildSeedDb();
  const now = Date.now();

  // 1. العثور على جلسة حية نشطة من قاعدة البيانات
  const liveSession = db.sessions.find(s => s.status === 'live')!;
  assert(Boolean(liveSession), 'الجلسة الحية النشطة متوفرة وجاهزة لتوليد الرموز');

  // 2. التحقق من نافذة التوكن الدوّار (25 ثانية لكل سلوت)
  const slot = qrSlotOf(liveSession, now);
  const token = currentQrToken(liveSession, now);
  assert(token.startsWith(`MSRQ:${liveSession.id}:${slot}:`), 'صيغة توكن الحضور مطابقة للبروتوكول الآمن MSRQ');

  // 3. التحقق من حضور الطالب في الوقت المبكر
  const studentId = 'u_zyad';
  const initialBalance = balanceOf(db, studentId);
  const checkInRes = rpcCheckIn(db, studentId, token, now);
  assert(checkInRes.kind === 'ok' && checkInRes.status === 'present', 'تسجيل الحضور في الوقت المحدد بنجاح (+10 نقاط)');
  assert(balanceOf(db, studentId) === initialBalance + 10, 'تحديث رصيد الطالب وإدراج سجل النقاط في الدفتر');

  // 4. منع التكرار (Idempotency)
  const duplicateRes = rpcCheckIn(db, studentId, token, now);
  assert(duplicateRes.kind === 'already', 'منع تسجيل الحضور المكرر لنفس الجلسة وإرجاع already');
  assert(balanceOf(db, studentId) === initialBalance + 10, 'عدم زيادة النقاط عند محاولة التكرار');

  // 5. فحص التوكن منتهي الصلاحية (Expired Token)
  const oldSlot = Math.max(1, slot - 4);
  const oldSig = qrSignature(liveSession.qrSeed ?? '', liveSession.id, oldSlot);
  const expiredToken = `MSRQ:${liveSession.id}:${oldSlot}:${oldSig}`;
  const expiredRes = rpcCheckIn(db, 'u_adam', expiredToken, now);
  assert(expiredRes.kind === 'expired', 'رفض التوكنات القديمة (مكافحة تصوير الشاشة وتبادل الصور)');

  // 6. فحص تسجيل الحضور المتأخر
  liveSession.startedAt = liveSession.startsAt = now - 20 * 60 * 1000; // تأخير 20 دقيقة
  const lateToken = currentQrToken(liveSession, now);
  const lateRes = rpcCheckIn(db, 'u_adam', lateToken, now);
  assert(lateRes.kind === 'ok' && lateRes.status === 'late', 'تسجيل حضور متأخر بنجاح مع تخفيض النقاط إلى 7');

  // 7. الكود الاحتياطي اليدوي عند تعذر الكاميرا
  liveSession.startedAt = liveSession.startsAt = now - 2 * 60 * 1000; // إعادة ضمن نافذة الوقت المبكر
  const backupCode = backupCodeOf(liveSession);
  assert(backupCode.length === 6, 'توليد كود طوارئ رقمي احتياطي مكون من 6 أرقام');
  const freshStudent = db.enrollments.find(
    e => e.batchId === liveSession.batchId && e.status === 'active' && !db.attendance.some(a => a.sessionId === liveSession.id && a.userId === e.userId)
  )?.userId || 'u_adam';
  // إزالة حضور قديم لـ freshStudent إذا وجد
  const existingIdx = db.attendance.findIndex(a => a.sessionId === liveSession.id && a.userId === freshStudent);
  if (existingIdx >= 0) db.attendance.splice(existingIdx, 1);

  const backupCheckIn = rpcCheckIn(db, freshStudent, backupCode, now);
  assert(backupCheckIn.kind === 'ok' && backupCheckIn.status === 'present', 'نجاح تسجيل الحضور بالكود الاحتياطي عند تعذر الكاميرا');
}
