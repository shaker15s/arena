// scripts/engine.test.ts — اختبارات سلوكية لقلب مسار (المحاكي = مرآة عقود RPC)
// npx tsc -p tsconfig.test.json && node /tmp/masar-engine-test/scripts/engine.test.js
import {
  attendanceOf, backupCodeOf, balanceOf, currentQrToken, evaluateBadges, evaluateStreakWeek,
  gamifOf, issuanceTable, lookupCertificate, qrSlotOf, rpcAwardKudos, rpcCheckIn, rpcCloseSession,
  rpcIssueCertificates, rpcManualMark, rpcReviewExcuse, rpcStartSession, rpcSubmitExcuse,
  rpcUpdateRule, simulateWeekClose,
} from '../src/data/engine';
import { buildSeedDb, IDS } from '../src/data/seed';
import { RULE_DEFS } from '../src/data/rules';
import { hashStr, monthKeyOf, weekStartOf } from '../src/shared/format';

let passed = 0, failed = 0;
function ok(cond: boolean, name: string, extra?: unknown) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
}

const MIN = 60_000;

(() => {
  // ═ 0) بذور واقعية ═
  console.log('\n═ إعداد ═');
  const db = buildSeedDb();
  ok(db.profiles.length >= 20, 'seed: ملفات شخصية ≥ 20', db.profiles.length);
  ok(db.rules.length >= 10, 'seed: قواعد اللعبة', db.rules.length);
  const live0 = db.sessions.find((s) => s.status === 'live')!;
  ok(!!live0, 'seed: جلسة حية جاهزة', live0.id);

  // ═ 1) الحضور: QR دوّار ضد التحايل ═
  console.log('\n═ 1) الحضور ═');
  const balOmar0 = balanceOf(db, IDS.omar);
  let token = currentQrToken(live0, Date.now());
  const invalid = rpcCheckIn(db, IDS.omar, 'masar-bogus');
  ok(invalid.kind === 'invalid', 'توكن مزيّف ← invalid', invalid.kind);
  const p1 = rpcCheckIn(db, IDS.omar, token);
  ok(p1.kind === 'ok' && p1.status === 'present' && p1.points === 10, 'حضور مبكر (4د) = 10 نقاط', p1.kind);
  ok(balanceOf(db, IDS.omar) === balOmar0 + 10, 'الرصيد انضاف للدفتر مرة واحدة');
  const dup = rpcCheckIn(db, IDS.omar, currentQrToken(live0, Date.now()));
  ok(dup.kind === 'already', 'ضغطة مكررة ← already، صفر نقاط إضافية', dup.kind);
  ok(balanceOf(db, IDS.omar) === balOmar0 + 10, 'الدفتر لا يتكرر');

  // توكن منتهي الصلاحية (سلوت قديم) ← expired
  const slot = Math.max(1, qrSlotOf(live0, Date.now()) - 3);
  const oldHash = hashStr(`${live0.qrSeed}:${live0.id}:${slot}`).slice(0, 10);
  const expired = rpcCheckIn(db, 'u_zyad', `MSRQ:${live0.id}:${slot}:${oldHash}`);
  ok(expired.kind === 'expired', 'توكن قديم ← expired (ضد screenshot)', expired.kind);

  // متأخر: غلق النافذة بإرجاع بداية الجلسة 20 دقيقة
  live0.startedAt = live0.startsAt = Date.now() - 20 * MIN;
  const late = rpcCheckIn(db, 'u_zyad', currentQrToken(live0, Date.now()));
  ok(late.kind === 'ok' && late.status === 'late' && late.points === 7, 'تأخير 20د = متأخر 7 نقاط', late.kind);

  // قطع صلب 30 دقيقة
  live0.startedAt = live0.startsAt = Date.now() - 45 * MIN;
  const hard = rpcCheckIn(db, 'u_adam', currentQrToken(live0, Date.now()));
  ok(hard.kind === 'too_late', 'بعد 30د ← too_late', hard.kind);

  // الكود الاحتياطي 6 أرقام
  live0.startedAt = live0.startsAt = Date.now() - 2 * MIN;
  const bcode = backupCodeOf(live0);
  ok(/^\d{6}$/.test(bcode), 'كود احتياطي 6 أرقام', bcode);
  const viaCode = rpcCheckIn(db, 'u_adam', bcode);
  ok(viaCode.kind === 'ok' && viaCode.status === 'present', 'الكود الاحتياطي يسجل حضورًا', viaCode.kind);
  ok(attendanceOf(db, live0.id, 'u_adam')?.method === 'code', 'وسيلة التسجيل = code');

  // غير منضم للمجموعة
  const outsider = rpcCheckIn(db, IDS.admin, currentQrToken(live0, Date.now()));
  ok(outsider.kind === 'not_enrolled', 'غير المنضم ← not_enrolled', outsider.kind);

  // ═ 2) التسجيل اليدوي والإقفال ═
  console.log('\n═ 2) الإقفال ═');
  const m1 = rpcManualMark(db, { sessionId: live0.id, userId: 'u_farida', status: 'present', reason: 'الإنترنت قطعت أثناء المسح', actorId: IDS.sara });
  ok(m1.ok === true, 'تسجيل يدوي بمبرر');
  const m2 = rpcManualMark(db, { sessionId: live0.id, userId: 'u_farida', status: 'present', reason: 'تكرار', actorId: IDS.sara });
  ok(m2.ok === false && m2.already === true, 'يدوي مكرر ← already');
  const m3 = rpcManualMark(db, { sessionId: live0.id, userId: 'u_hesham', status: 'present', reason: '', actorId: IDS.sara });
  ok(m3.ok === false, 'يدوي بدون مبرر مرفوض');
  rpcManualMark(db, { sessionId: live0.id, userId: 'u_hesham', status: 'late', reason: 'وصل متأخرًا واعتذر', actorId: IDS.sara });

  const gOmar0 = { ...gamifOf(db, IDS.omar) };
  const summary = rpcCloseSession(db, live0.id, IDS.sara, {
    done: 'مشروع تطبيقي — الجزء الأول', planned: 'متابعة المشروع', challenges: 'مكيف القاعة', submittedAt: Date.now(),
  });
  ok(summary.total === 19, 'إجمالي المجموعة = 19', summary.total);
  ok(summary.present + summary.late + summary.absent + summary.excused === summary.total, 'حاصل التقرير متطابق', summary);
  ok(summary.absent === 4, 'غير المسجلين الأربعة ← غائب', summary.absent);
  ok(live0.status === 'closed', 'الجلسة أُقفلت');

  // بونص شهر الالتزام الكامل (أغسطس 2026 — كل الجلسات فيه)
  const mKey = monthKeyOf(live0.startsAt);
  const bonusOmar = db.pointEvents.some((e) => e.idempotencyKey === `month.bonus:${IDS.omar}:${mKey}`);
  const bonusHabiba = db.pointEvents.some((e) => e.idempotencyKey === `month.bonus:u_habiba:${mKey}`);
  const bonusMariam = db.pointEvents.some((e) => e.idempotencyKey === `month.bonus:u_mariam:${mKey}`);
  ok(bonusOmar && bonusHabiba && !bonusMariam, 'بونص الشهر: عمر وحبيبة نعم، مريم (غياب) لا', { bonusOmar, bonusHabiba, bonusMariam });

  // ═ 3) الستريك: عدّ واحد فقط + لا تدهور ═
  console.log('\n═ 3) الستريك ═');
  const week = weekStartOf(live0.startsAt);
  ok(gamifOf(db, IDS.omar).currentStreakWeeks === gOmar0.currentStreakWeeks + 1, 'أسبوع محفوظ ← ستريك +1', { before: gOmar0.currentStreakWeeks, after: gamifOf(db, IDS.omar).currentStreakWeeks });
  const reEval = evaluateStreakWeek(db, IDS.omar, week);
  ok(reEval === 'kept' && gamifOf(db, IDS.omar).currentStreakWeeks === gOmar0.currentStreakWeeks + 1, 'إعادة التقييم لا تعدّ مرتين (لاصق)', reEval);

  // ═ 4) العذر: قبول ← معذور + ستريك محفوظ ═
  console.log('\n═ 4) الأعذار ═');
  const sub = rpcSubmitExcuse(db, 'u_dina', live0.id, 'حالة طارئة في البيت');
  ok(sub.ok, 'تقديم عذر لغياب');
  const dupEx = rpcSubmitExcuse(db, 'u_dina', live0.id, 'محاولة مكررة');
  ok(!dupEx.ok && dupEx.error === 'alreadyExcused', 'عذر مكرر مرفوض');
  const exId = db.excuses.find((e) => e.userId === 'u_dina' && e.sessionId === live0.id)!.id;
  const rev = rpcReviewExcuse(db, exId, IDS.sara, 'accepted', 'بالسلامة');
  ok(rev.ok, 'قبول العذر');
  ok(attendanceOf(db, live0.id, 'u_dina')?.status === 'excused', 'الحالة ← معذور');
  const dinaWeek = db.streakWeeks.find((r) => r.userId === 'u_dina' && r.weekStart === week);
  ok(dinaWeek?.status === 'kept', 'الستريك محفوظ بعد قبول العذر', dinaWeek?.status);
  ok(!db.pointEvents.some((e) => e.userId === 'u_dina' && e.idempotencyKey === `attendance:${live0.id}:u_dina`), 'المعذور بلا نقاط حضور');

  // ═ 5) شارات ═
  console.log('\n═ 5) الشارات ═');
  // شارة farida اتمنحت لحظة التسجيل اليدوي (evaluateBadges يُستدعى جوّه RPC)
  const fBadge = db.userBadges.some((b) => b.userId === 'u_farida' && b.badgeCode === 'first_step');
  ok(fBadge, 'أول حضور ← شارة البداية الصح');
  const fNew = evaluateBadges(db, 'u_farida');
  ok(fNew.every((b) => !db.userBadges.some((u) => u.userId === 'u_farida' && u.badgeCode === b.badge.code)) || fNew.length === 0, 'لا شارة مكررة أبدًا', fNew.length);

  // ═ 6) كودوس بكوتا ═
  console.log('\n═ 6) الد كودوس ═');
  const quota = RULE_DEFS.find((d) => d.key === 'kudos.monthly_quota_per_instructor')!.def as number; // 200
  const k0 = rpcAwardKudos(db, IDS.sara, IDS.mahmoud === '' ? '' : 'u_gana', IDS.g1, 25, 'إجابة ممتازة');
  ok(k0.ok && k0.left === quota - 25 - 25, 'أول كودوس: كوتا صحيحة (25 مستهلكة بذورًا)', k0.left);
  const kBad = rpcAwardKudos(db, IDS.sara, 'u_gana', IDS.g1, 26, 'تجاوز');
  ok(!kBad.ok && kBad.error === 'range', 'أكثر من 25 للمنحة الواحدة ← range');
  let last = k0;
  while (last.ok) last = rpcAwardKudos(db, IDS.sara, 'u_mazen', IDS.g1, 25, 'تفاعل');
  ok(!last.ok && last.error === 'quota' && last.left === 0, 'استنفاد الكوتا ← quota', last.error);

  // ═ 7) شهادات G4 ═
  console.log('\n═ 7) الشهادات ═');
  const table = issuanceTable(db, IDS.g4);
  ok(table.length === 8, 'جدول الإصدار = 8 طلاب', table.length);
  const i1 = rpcIssueCertificates(db, IDS.mahmoud, IDS.g4);
  ok(i1.issued.length === 5, 'إصدار 5 شهادات (المستحقون ≥75%)', i1.issued.length);
  const serials = i1.issued.map((c) => c.serial);
  ok(new Set(serials).size === serials.length, 'سيريالات فريدة', serials[0]);
  const i2 = rpcIssueCertificates(db, IDS.mahmoud, IDS.g4);
  ok(i2.issued.length === 0, 'إعادة الإصدار = صفر (Idempotent)');
  const looked = lookupCertificate(db, serials[0]);
  ok(!!looked && looked.cert.serial === serials[0], 'التحقق العام بالسيريال يعمل', serials[0].toLowerCase());
  const lookedLower = lookupCertificate(db, serials[0].toLowerCase());
  ok(!!lookedLower, 'التحقق لا يرعى حالة الأحرف');

  // ═ 8) قواعد اللعبة: حدود ═
  console.log('\n═ 8) قواعد اللعبة ═');
  const def = RULE_DEFS.find((d) => d.key === 'points.present')!;
  const u1 = rpcUpdateRule(db, IDS.mahmoud, 'points.present', def.min + 1);
  ok(u1.ok, 'ضمن الحدود مسموح', { min: def.min, max: def.max });
  const u2 = rpcUpdateRule(db, IDS.mahmoud, 'points.present', def.max + 1);
  ok(!u2.ok && u2.error === 'bounds', 'خارج الحدود ← bounds');
  const u3 = rpcUpdateRule(db, IDS.mahmoud, 'no.such.rule', 5);
  ok(!u3.ok && u3.error === 'unknown', 'مفتاح مجهول ← unknown');

  // ═ 9) إقفال أسبوع الدوري ═
  console.log('\n═ 9) الدوري الأسبوعي ═');
  const before = db.gamification.map((g) => ({ ...g }));
  const res = simulateWeekClose(db, IDS.mahmoud);
  ok(db.leagueWeeks.length > 0, 'سجل الأسابيع اتملى', db.leagueWeeks.length);
  const movedAny = db.gamification.some((g, idx) => g.leagueTier !== before[idx].leagueTier);
  ok(movedAny, 'في ترقيات فعلية', res.moved);
  ok(res.moved > 0, 'شارات «الصاعد» اتمنحت', res.moved);

  // ═ 10) بدء جلسة جديدة بعد الإقفال ═
  console.log('\n═ 10) دورة جديدة ═');
  const st1 = rpcStartSession(db, IDS.g1, IDS.sara);
  ok('session' in st1 && st1.session.id !== live0.id, 'الجلسة القادمة تُفتح بعد الإقفال', 'session' in st1 ? st1.session.id : st1.error);

  console.log(`\n════ النتيجة: ${passed} ناجح، ${failed} فاشل ════`);
  if (failed > 0) process.exit(1);
})();
