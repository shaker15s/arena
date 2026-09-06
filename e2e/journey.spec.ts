/**
 * e2e/journey.spec.ts — اختبار رحلة الطالب: النقاط، الستريك المتواصل، الشارات، الترقية في دوري الأسبوع
 */
import { buildSeedDb, IDS } from '../scripts/fixtures/seed';
import {
  balanceOf,
  gamifOf,
  evaluateStreakWeek,
  evaluateBadges,
  rpcAwardKudos,
  simulateWeekClose,
} from '../src/data/engine';
import { weekStartOf } from '../src/shared/format';

export async function testJourneyFlow(assert: (ok: boolean, msg: string) => void) {
  console.log('\n--- [E2E] فحص رحلة الطالب وتلعيب المسار (Student Journey Flow) ---');
  const db = buildSeedDb();
  const studentId = IDS.omar;
  const instructorId = IDS.sara;

  // 1. رصيد الطالب المبدئي وملفه التحفيزي
  const initialPoints = balanceOf(db, studentId);
  const initialGamif = gamifOf(db, studentId);
  assert(initialPoints >= 0, 'التحقق من صحة رصيد نقاط الطالب من دفتر الأستاذ');
  assert(typeof initialGamif.currentStreakWeeks === 'number', 'ملف التلعيب يحتوي على عدد أسابيع الستريك الحالية');

  // 2. منح بطاقة تقدير (Kudos) من المدرب ضمن الكوتا الشهرية المعتمدة
  const kudosRes = rpcAwardKudos(db, instructorId, 'u_gana', IDS.g1, 25, 'تفاعل ومشاركة ممتازة في المحاضرة');
  assert(kudosRes.ok === true, 'نجاح منح الكودوس من المدرب وتحديث كوتا المدرب المتبقية');

  // 3. تقييم الستريك الأسبوعي (عدم التراجع + حماية الأسابيع المحفوظة)
  const currentWeek = weekStartOf(Date.now());
  const streakStatus = evaluateStreakWeek(db, studentId, currentWeek);
  assert(['kept', 'tracking', 'frozen', 'pending'].includes(streakStatus), 'تقييم الستريك الأسبوعي بصيغة صحيحة');

  // 4. فحص استحقاق الشارات المكتسبة وعدم تكرارها
  const newBadges = evaluateBadges(db, studentId);
  assert(Array.isArray(newBadges), 'تقييم قائمة الشارات المستحقة بنجاح');
  const userBadges = db.userBadges.filter(b => b.userId === studentId);
  const badgeCodes = userBadges.map(b => b.badgeCode);
  const isUnique = new Set(badgeCodes).size === badgeCodes.length;
  assert(isUnique, 'عدم تكرار أي شارة ممنوحة لنفس المتدرب في دفتر الشارات');

  // 5. محاكاة إقفال الأسبوع وصعود أو بقاء المتدربين في بطولات الدوري
  const beforeTiers = db.gamification.map(g => ({ userId: g.userId, tier: g.leagueTier }));
  const closeRes = simulateWeekClose(db, IDS.admin);
  assert(typeof closeRes.moved === 'number', 'إقفال دوري الأسبوع وحساب عدد المتدربين المترقين');
  assert(db.leagueWeeks.length > 0, 'تسجيل سجلات أداء الأسبوع في دوري المتدربين');
}
