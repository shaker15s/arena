/**
 * e2e/certificates.spec.ts — اختبار دورة حياة الشهادات: حساب الاستحقاق (≥75%)، الإصدار، التحقق العام، الإلغاء، وإعادة الإصدار
 */
import { buildSeedDb, IDS } from '../scripts/fixtures/seed';
import {
  isBatchComplete,
  issuanceTable,
  rpcIssueCertificates,
  lookupCertificate,
  rpcRevokeCertificate,
  rpcReissueCertificate,
} from '../src/data/engine';

export async function testCertificatesFlow(assert: (ok: boolean, msg: string) => void) {
  console.log('\n--- [E2E] فحص دورة حياة الشهادات المعتمدة (Certificates Lifecycle Flow) ---');
  const db = buildSeedDb();
  const completedBatchId = IDS.g4;

  // 1. التحقق من اكتمال المجموعة وتجاوز كافة المحاضرات
  const isComplete = isBatchComplete(db, completedBatchId);
  assert(isComplete === true, 'المجموعة التدريبية مكتملة وجاهزة لتوليد الشهادات');

  // 2. فحص جدول الاستحقاق بنسبة الحضور المعتمدة (≥ 75%)
  const table = issuanceTable(db, completedBatchId);
  assert(table.length > 0, 'استخراج قائمة الطلاب ونسب حضورهم ومطابقتها للقواعد');
  const eligibleStudents = table.filter(row => row.eligible);
  assert(eligibleStudents.length === 5, 'تحديد 5 طلاب مستحقين للشهادة بنسبة حضور ≥ 75%');

  // 3. إصدار الشهادات الرسمية وتوليد الأرقام التسلسلية الفريدة
  const issueRes = rpcIssueCertificates(db, IDS.mahmoud, completedBatchId);
  assert(issueRes.issued.length === 5, 'إصدار 5 شهادات للمستحقين بنجاح');
  const serials = issueRes.issued.map(c => c.serial);
  const uniqueSerials = new Set(serials);
  assert(uniqueSerials.size === serials.length, 'الأرقام التسلسلية لجميع الشهادات الصادرة فريدة ومؤمنة');

  // 4. خاصية عدم التكرار (Idempotency)
  const reIssueAttempt = rpcIssueCertificates(db, IDS.mahmoud, completedBatchId);
  assert(reIssueAttempt.issued.length === 0, 'منع التكرار: محاولة إعادة الإصدار ترجع 0 شهادة جديدة');

  // 5. التحقق العام برقم الشهادة (دون الحاجة لتسجيل دخول)
  const targetSerial = serials[0];
  const publicLookup = lookupCertificate(db, targetSerial);
  assert(publicLookup !== null && publicLookup.cert.serial === targetSerial, 'التحقق العام من صحة الشهادة والبيانات المرتبطة بها');
  
  // التحقق غير الحساس لحالة الأحرف
  const lowerLookup = lookupCertificate(db, targetSerial.toLowerCase());
  assert(lowerLookup !== null, 'التحقق العام يعمل بسلاسة دون حساسية لحالة الأحرف (case-insensitive)');

  // 6. إلغاء الشهادة الإداري مع توثيق السبب
  const certId = issueRes.issued[0].id;
  const badRevoke = rpcRevokeCertificate(db, IDS.mahmoud, certId, '');
  assert(badRevoke.ok === false && badRevoke.error === 'reason_required', 'رفض إلغاء الشهادة دون ذكر سبب تدقيق صريح');

  const goodRevoke = rpcRevokeCertificate(db, IDS.mahmoud, certId, 'خطأ إداري في اسم المتدرب');
  assert(goodRevoke.ok === true, 'إلغاء الشهادة بنجاح وتغيير حالتها إلى revoked');
  assert(lookupCertificate(db, targetSerial) === null, 'التحقق العام يرفض الشهادات الملغاة');

  // 7. إعادة إصدار الشهادة مع تحديث السيريال
  const reissueRes = rpcReissueCertificate(db, IDS.mahmoud, certId);
  assert(reissueRes.ok === true && typeof reissueRes.serial === 'string', 'إعادة إصدار الشهادة برقم تسلسلي جديد');
  assert(reissueRes.serial !== targetSerial, 'الرقم التسلسلي الجديد مختلف عن الرقم الملغي القديم');
  assert(lookupCertificate(db, targetSerial) === null, 'الرقم التسلسلي القديم لا يزال غير صالح');
  assert(lookupCertificate(db, reissueRes.serial!) !== null, 'الرقم التسلسلي الجديد صالح ويعمل بالتحقق العام');
}
