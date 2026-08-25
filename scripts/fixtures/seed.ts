/** بيانات اختبار (fixtures) — تُستخدم في اختبارات المحرك فقط ولا تُشحن داخل التطبيق. */
/**
 * data/seed.ts — بذر قاعدة البيانات المحاكاة على نفس مخطط وثيقة 06.
 * يمثل «السيناريو الذهبي» (وثيقة 07) في منتصفه: فرع نشط، باتش تصميم في
 * محاضرته السابعة الحية الآن، طلاب بحضور ونقاط واستريك، باتش مكتمل
 * لديمومة إصدار الشهادات، وأعذار معلقة.
 */
import { defaultRules } from '../../src/data/rules';
import { weekStartOf, monthKeyOf } from '../../src/shared/format';
import {
  Attendance, Badge, Batch, Branch, Certificate, Committee, Course, Db,
  Enrollment, Excuse, GamificationProfile, PointEvent, Profile,
  StreakWeek, TrainingSession, AppNotification, CourseRating,
} from '../../src/data/types';

export const SEED_VERSION = 3;

export const IDS = {
  admin: 'u_admin',
  mahmoud: 'u_mahmoud',
  sara: 'u_sara',
  ahmed: 'u_ahmed',
  omar: 'u_omar',
  b1: 'b_b1',
  b2: 'b_b2',
  g1: 'bt_g1',
  g2: 'bt_g2',
  g3: 'bt_g3',
  g4: 'bt_g4',
};

const DAY = 86_400_000;
const AVATARS = ['#8B5CF6', '#14B8A6', '#F59E0B', '#EF4444', '#3B82F6', '#EC4899', '#10B981', '#F0B429', '#6366F1', '#0EA5E9'];

function prof(id: string, name: string, phone: string, role: Profile['role'], branchId: string | null, gender: 'm' | 'f', i: number, joinedAt: number): Profile {
  return { id, fullName: name, phone, role, branchId, gender, status: 'active', avatarColor: AVATARS[i % AVATARS.length], joinedAt };
}

export function buildSeedDb(): Db {
  const now = Date.now();

  const branches: Branch[] = [
    { id: IDS.b1, name: 'فرع القاهرة — مدينة نصر', governorate: 'القاهرة', address: 'شارع عباس العقاد، الحي السابع، مقابل النادي', supervisorId: IDS.mahmoud },
    { id: IDS.b2, name: 'فرع الإسكندرية — سموحة', governorate: 'الإسكندرية', address: 'شارع فيكتور عمانويل، سموحة', supervisorId: null },
  ];

  const committees: Committee[] = [
    { id: 'cm_train', branchId: IDS.b1, name: 'لجنة التدريب' },
    { id: 'cm_org', branchId: IDS.b1, name: 'لجنة التنظيم' },
    { id: 'cm_follow', branchId: IDS.b1, name: 'لجنة المتابعة' },
  ];

  // ── المستخدمون ──
  const studentDefs: Array<[string, string, 'm' | 'f']> = [
    ['u_omar', 'عمر خالد', 'm'],
    ['u_karim', 'كريم عادل', 'm'],
    ['u_nour', 'نور الهدى', 'f'],
    ['u_mariam', 'مريم سمير', 'f'],
    ['u_youssef', 'يوسف حسن', 'm'],
    ['u_salma', 'سلمى رضا', 'f'],
    ['u_habiba', 'حبيبة وليد', 'f'],
    ['u_omarf', 'عمر فاروق', 'm'],
    ['u_gana', 'جنى أيمن', 'f'],
    ['u_mazen', 'مازن شريف', 'm'],
    ['u_laila', 'ليلى محسن', 'f'],
    ['u_zyad', 'زياد عمرو', 'm'],
    ['u_rana', 'رنا خالد', 'f'],
    ['u_adam', 'آدم سامي', 'm'],
    ['u_farida', 'فريدة ناصر', 'f'],
    ['u_hesham', 'هشام طارق', 'm'],
    ['u_dina', 'دينا عصام', 'f'],
    ['u_bola', 'بولا رامي', 'm'],
    ['u_sara2', 'سارة مجدي', 'f'],
  ];

  const profiles: Profile[] = [
    prof(IDS.admin, 'إدارة مسار', '01000000000', 'admin', null, 'm', 0, now - 120 * DAY),
    prof(IDS.mahmoud, 'أ. محمود فؤاد', '01000000003', 'supervisor', IDS.b1, 'm', 4, now - 90 * DAY),
    prof(IDS.sara, 'أ. سارة عبد الرحمن', '01000000002', 'volunteer', IDS.b1, 'f', 5, now - 80 * DAY),
    prof(IDS.ahmed, 'أ. أحمد الشاذلي', '01000000007', 'volunteer', IDS.b1, 'm', 8, now - 70 * DAY),
    ...studentDefs.map(([id, name, g], i) =>
      prof(id, name, `01000001${String(10 + i)}`, 'student', IDS.b1, g, i + 1, now - (40 - i) * DAY),
    ),
  ];

  // ── الكورسات ──
  const courses: Course[] = [
    {
      id: 'c_design', committeeId: 'cm_train', title: 'أساسيات التصميم الجرافيكي', field: 'تصميم',
      description: 'كورس تأسيسي يأخذك من الصفر إلى إخراج تصميم أول متكامل: مبادئ التصميم، نظرية الألوان، التايبوغرافي، وأدوات العمل الاحترافية، ثم مشروع تطبيقي ختامي.',
      topics: ['مبادئ التصميم وعناصره', 'نظرية الألوان والتناسق', 'التايبوغرافي العربي واللاتيني', 'أدوات العمل: فوتوشوب وإليستريتور', 'تكوين التصميم والشبكات', 'الهوية البصرية والشعارات', 'مشروع تطبيقي — الجزء الأول', 'مشروع تطبيقي — التسليم والنقد'],
      sessionsCount: 8, status: 'published', color: '#8B5CF6',
    },
    {
      id: 'c_python', committeeId: 'cm_train', title: 'أساسيات البرمجة بلغة بايثون', field: 'برمجة',
      description: 'مدخل عملي للبرمجة من الصفر: المتغيرات، الشروط، الحلقات، الدوال، ثم مشاريع صغيرة تبنى في كل محاضرة.',
      topics: ['مدخل للبرمجة والتثبيت', 'المتغيرات والأنواع', 'الشروط واتخاذ القرار', 'الحلقات التكرارية', 'الدوال', 'القوائم والقواميس', 'التعامل مع الملفات', 'مشروع: آلة حاسبة ذكية', 'مكتبات شائعة', 'مشروع التخرج'],
      sessionsCount: 10, status: 'published', color: '#14B8A6',
    },
    {
      id: 'c_english', committeeId: 'cm_train', title: 'الإنجليزية للمحادثة اليومية', field: 'لغات',
      description: 'كسر حاجز التحدث: مواقف يومية، مفردات عملية، وتدريب محادثة مباشر في كل لقاء.',
      topics: ['التعارف والتحيات', 'في الشارع والمواصلات', 'في العمل والمقابلات', 'في المطعم والسفر'],
      sessionsCount: 12, status: 'published', color: '#F59E0B',
    },
    {
      id: 'c_computer', committeeId: 'cm_train', title: 'أساسيات الحاسوب والإنترنت', field: 'حاسوب',
      description: 'مهارات الحاسوب الأساسية لأي وظيفة حديثة: نظام التشغيل، الملفات، الإنترنت الآمن، والبريد.',
      topics: ['مدخل لنظام التشغيل', 'الملفات والتنظيم', 'الإنترنت الآمن', 'البريد والتقويم'],
      sessionsCount: 8, status: 'published', color: '#3B82F6',
    },
    {
      id: 'c_excel', committeeId: 'cm_train', title: 'إكسل للمحاسبين', field: 'أعمال',
      description: 'احتراف إكسل للعمل المحاسبي: الجداول، المعادلات، التقارير المالية، واللوحات التحليلية.',
      topics: ['الجداول والتنسيق', 'المعادلات الأساسية', 'المعادلات المتقدمة', 'التقارير المالية', 'اللوحات التحليلية', 'مشروع ختامي'],
      sessionsCount: 6, status: 'published', color: '#EF4444',
    },
    {
      id: 'c_photo', committeeId: 'cm_train', title: 'التصوير الفوتوغرافي بالهاتف', field: 'تصوير',
      description: 'الإضاءة، الكادر، والمونتاج السريع بالهاتف.',
      topics: ['الإضاءة الطبيعية', 'قواعد الكادر', 'المونتاج بالهاتف'],
      sessionsCount: 6, status: 'draft', color: '#EC4899',
    },
  ];

  // ── المجموعات ──
  const batches: Batch[] = [
    { id: IDS.g1, courseId: 'c_design', branchId: IDS.b1, instructorId: IDS.sara, capacity: 25, schedule: { days: [6, 2], time: '18:00', durationMin: 120 }, startDate: now - 21 * DAY, room: 'قاعة 2 — الدور الأول', status: 'active', joinCode: 'MSR-G1-2026' },
    { id: IDS.g2, courseId: 'c_python', branchId: IDS.b1, instructorId: IDS.ahmed, capacity: 12, schedule: { days: [1, 3], time: '20:00', durationMin: 90 }, startDate: now - 12 * DAY, room: 'معمل 1', status: 'active', joinCode: 'MSR-G2-2026' },
    { id: IDS.g3, courseId: 'c_computer', branchId: IDS.b1, instructorId: IDS.sara, capacity: 20, schedule: { days: [0, 4], time: '17:00', durationMin: 120 }, startDate: now - 66 * DAY, room: 'قاعة 1', status: 'completed', joinCode: 'MSR-G3-2025' },
    { id: IDS.g4, courseId: 'c_excel', branchId: IDS.b1, instructorId: IDS.sara, capacity: 15, schedule: { days: [5], time: '12:00', durationMin: 180 }, startDate: now - 45 * DAY, room: 'معمل 2', status: 'completed', joinCode: 'MSR-G4-2026' },
  ];

  // ── الجلسات: G1 = 8 محاضرات (6 مغلقة + واحدة حية الآن + واحدة قادمة) ──
  const liveStart = now - 4 * 60_000; // بدأت قبل 4 دقائق
  const sessions: TrainingSession[] = [];
  const c1 = courses[0];
  for (let seq = 1; seq <= 8; seq++) {
    let startsAt: number;
    let status: TrainingSession['status'];
    if (seq <= 6) {
      startsAt = liveStart - Math.round((7 - seq) * 3.5 * DAY);
      status = 'closed';
    } else if (seq === 7) {
      startsAt = liveStart;
      status = 'live';
    } else {
      startsAt = liveStart + 3 * DAY;
      status = 'scheduled';
    }
    sessions.push({
      id: `s_g1_${seq}`, batchId: IDS.g1, seq, title: c1.topics[seq - 1],
      startsAt, durationMin: 120, status,
      startedAt: status === 'closed' ? startsAt : seq === 7 ? liveStart : undefined,
      closedAt: status === 'closed' ? startsAt + 2 * 3_600_000 : undefined,
      qrSeed: seq === 7 ? 'seed_g1_s7_x9f2' : undefined,
      report: status === 'closed' ? { done: `تغطية محور: ${c1.topics[seq - 1]}`, planned: 'متابعة المحور التالي', challenges: '', submittedAt: startsAt + 7_200_000 } : undefined,
    });
  }

  // G2: محاضرتان ماضيتان + واحدة قادمة
  const c2 = courses[1];
  const g2Sessions: TrainingSession[] = [
    { id: 's_g2_1', batchId: IDS.g2, seq: 1, title: c2.topics[0], startsAt: now - 4 * DAY, durationMin: 90, status: 'closed', startedAt: now - 4 * DAY, closedAt: now - 4 * DAY + 5_400_000, report: { done: 'التثبيت والمدخل', planned: 'المتغيرات', challenges: '', submittedAt: now - 4 * DAY + 7_200_000 } },
    { id: 's_g2_2', batchId: IDS.g2, seq: 2, title: c2.topics[1], startsAt: now - 1 * DAY, durationMin: 90, status: 'closed', startedAt: now - 1 * DAY, closedAt: now - 1 * DAY + 5_400_000, report: { done: 'المتغيرات والأنواع', planned: 'الشروط', challenges: 'قاعة ضيقة', submittedAt: now - 1 * DAY + 6_600_000 } },
    { id: 's_g2_3', batchId: IDS.g2, seq: 3, title: c2.topics[2], startsAt: now + 1 * DAY, durationMin: 90, status: 'scheduled' },
  ];
  sessions.push(...g2Sessions);

  // G3 (مكتمل — صدرت شهاداته): 8 محاضرات قبل أسابيع
  const c4 = courses[3];
  for (let seq = 1; seq <= 8; seq++) {
    const startsAt = now - 66 * DAY + (seq - 1) * Math.round(3.5 * DAY);
    sessions.push({
      id: `s_g3_${seq}`, batchId: IDS.g3, seq, title: c4.topics[(seq - 1) % c4.topics.length],
      startsAt, durationMin: 120, status: 'closed', startedAt: startsAt, closedAt: startsAt + 7_200_000,
      report: { done: `محور: ${c4.topics[(seq - 1) % c4.topics.length]}`, planned: '', challenges: '', submittedAt: startsAt + 7_200_000 },
    });
  }

  // G4 (مكتمل — لم تُصدر شهادته بعد): 6 محاضرات
  const c5 = courses[4];
  for (let seq = 1; seq <= 6; seq++) {
    const startsAt = now - 45 * DAY + (seq - 1) * 7 * DAY;
    sessions.push({
      id: `s_g4_${seq}`, batchId: IDS.g4, seq, title: c5.topics[seq - 1],
      startsAt, durationMin: 180, status: 'closed', startedAt: startsAt, closedAt: startsAt + 10_800_000,
      report: { done: `محور: ${c5.topics[seq - 1]}`, planned: '', challenges: '', submittedAt: startsAt + 10_800_000 },
    });
  }

  // ── الانضمامات ──
  const g1Students = studentDefs.map(([id]) => id); // الكل 19 → باقي 6 مقاعد
  const g2Students = studentDefs.slice(1, 13).map(([id]) => id); // 12/12 ممتلئة
  const g3Students = studentDefs.slice(0, 9).map(([id]) => id);
  const g4Students = studentDefs.slice(4, 12).map(([id]) => id);

  const enrollments: Enrollment[] = [];
  const enroll = (userId: string, batchId: string, joinedAt: number, status: Enrollment['status'] = 'active') =>
    enrollments.push({ userId, batchId, status, joinedAt });
  g1Students.forEach((u, i) => enroll(u, IDS.g1, now - (21 - i * 0.3) * DAY));
  g2Students.forEach((u, i) => enroll(u, IDS.g2, now - (12 - i * 0.2) * DAY));
  g3Students.forEach((u, i) => enroll(u, IDS.g3, now - (66 - i * 0.2) * DAY));
  g4Students.forEach((u, i) => enroll(u, IDS.g4, now - (45 - i * 0.2) * DAY));

  // ── الحضور ──
  const attendance: Attendance[] = [];

  // G1 — المحاضرات الست المغلقة
  const g1Closed = sessions.filter((s) => s.batchId === IDS.g1 && s.status === 'closed');
  g1Students.forEach(userId => {
    const idx = studentDefs.findIndex(([id]) => id === userId);
    g1Closed.forEach((sess, sIdx) => {
      const seq = sIdx + 1;
      let status: Attendance['status'];
      let checkedInAt: number | undefined;
      let method: Attendance['method'] = 'qr';
      if (userId === 'u_omar') {
        // عمر: P P L P P P — وكلها مبكرة دقيقتين (قصة «الطائر المبكر»)
        const lateOne = seq === 3;
        status = lateOne ? 'late' : 'present';
        checkedInAt = sess.startsAt + (lateOne ? 18 : -2) * 60_000;
      } else if (userId === 'u_mariam' && seq === 6) {
        status = 'absent'; // عذرها معلق عند سارة
      } else {
        const r = (idx * 7 + seq * 13) % 20;
        if (r < 15) { status = 'present'; checkedInAt = sess.startsAt - (r % 5) * 60_000; }
        else if (r < 18) { status = 'late'; checkedInAt = sess.startsAt + (16 + (r % 10)) * 60_000; }
        else { status = 'absent'; }
      }
      attendance.push({ sessionId: sess.id, userId, status, checkedInAt, method: status === 'absent' ? undefined : method });
    });
  });
  // G1 — الجلسة الحية: 10 طلاب سجّلوا بالفعل (العداد يبدأ 10 من 19)
  const liveSess = sessions.find((s) => s.id === 's_g1_7')!;
  g1Students.filter((u) => u !== 'u_omar').slice(0, 10).forEach((userId, i) => {
    attendance.push({ sessionId: liveSess.id, userId, status: 'present', checkedInAt: liveStart + (i * 23_000), method: 'qr' });
  });

  // G2 — محاضرتان
  ['s_g2_1', 's_g2_2'].forEach((sid, si) => {
    const sess = sessions.find((s) => s.id === sid)!;
    g2Students.forEach((userId, i) => {
      const r = (i * 5 + si * 11) % 10;
      const status: Attendance['status'] = r < 8 ? 'present' : r < 9 ? 'late' : 'absent';
      attendance.push({ sessionId: sid, userId, status, checkedInAt: status === 'absent' ? undefined : sess.startsAt + (r < 8 ? -3 : 19) * 60_000, method: 'qr' });
    });
  });

  // G3 — عمر 7/8 (غاب الخامسة) والبقية متفاوتون
  const g3Sess = sessions.filter((s) => s.batchId === IDS.g3);
  g3Students.forEach((userId, i) => {
    g3Sess.forEach((sess, sIdx) => {
      const seq = sIdx + 1;
      let missing = false;
      if (userId === 'u_omar') missing = seq === 5;
      else missing = (i * 3 + seq * 7) % 11 > 8;
      const late = !missing && (i + seq) % 6 === 0;
      attendance.push({
        sessionId: sess.id, userId,
        status: missing ? 'absent' : late ? 'late' : 'present',
        checkedInAt: missing ? undefined : sess.startsAt + (late ? 17 : -4) * 60_000,
        method: missing ? undefined : 'qr',
      });
    });
  });

  // G4 — عدد محاضرات مشرف عليها يدويًا: [6,5,6,5,6,4,3,2] → 5 مستحقين
  const g4Honor = [6, 5, 6, 5, 6, 4, 3, 2];
  const g4Sess = sessions.filter((s) => s.batchId === IDS.g4);
  g4Students.forEach((userId, i) => {
    g4Sess.forEach((sess, sIdx) => {
      const honored = sIdx < g4Honor[i];
      const late = honored && (sIdx === g4Honor[i] - 1) && i % 2 === 0;
      attendance.push({
        sessionId: sess.id, userId,
        status: honored ? (late ? 'late' : 'present') : 'absent',
        checkedInAt: honored ? sess.startsAt + (late ? 20 : -2) * 60_000 : undefined,
        method: honored ? 'qr' : undefined,
      });
    });
  });

  // ── دفتر النقاط (مشتق من الحضور + أحداث إضافية) ──
  const pointEvents: PointEvent[] = [];
  const pushPoints = (userId: string, points: number, reasonCode: PointEvent['reasonCode'], createdAt: number, refType: PointEvent['refType'], refId: string, awardedBy: string | null = null) => {
    pointEvents.push({
      id: `pe_${pointEvents.length + 1}`, userId, points, reasonCode, refType, refId,
      awardedBy, idempotencyKey: `${reasonCode}:${refType}:${refId}:${userId}`, createdAt,
    });
  };
  attendance.forEach((a) => {
    if (a.status !== 'present' && a.status !== 'late') return;
    const pts = a.status === 'present' ? 10 : 7;
    pushPoints(a.userId, pts, `attendance.${a.status}` as PointEvent['reasonCode'], a.checkedInAt!, 'session', a.sessionId);
  });
  // بونص الشهر الكامل لعمر (لو التزم بكل جلسات شهر الجلسة الأخيرة)
  const omarRows = attendance.filter((a) => a.userId === 'u_omar');
  const lastClosed = g1Closed[g1Closed.length - 1];
  const mKey = monthKeyOf(lastClosed.startsAt);
  const monthRows = omarRows.filter((a) => {
    const s = sessions.find((x) => x.id === a.sessionId);
    return s && monthKeyOf(s.startsAt) === mKey && s.status === 'closed';
  });
  if (monthRows.length > 0 && monthRows.every((r) => r.status !== 'absent')) {
    pushPoints('u_omar', 50, 'month.bonus', lastClosed.startsAt + 7_200_000, 'admin', `month:${mKey}`);
  }
  // +100 إتمام G3 لكل من صدرت له شهادة (نضيفه مع الشهادات أدناه)
  // تقييمات سابقة
  const ratings: CourseRating[] = [
    { userId: 'u_karim', courseId: 'c_computer', stars: 5, comment: 'كورس ممتاز ومنظم', createdAt: now - 30 * DAY },
    { userId: 'u_nour', courseId: 'c_computer', stars: 5, createdAt: now - 29 * DAY },
    { userId: 'u_mariam', courseId: 'c_computer', stars: 4, createdAt: now - 29 * DAY },
    { userId: 'u_youssef', courseId: 'c_design', stars: 5, comment: 'سارة دكتورة رائعة', createdAt: now - 3 * DAY },
    { userId: 'u_omarf', courseId: 'c_design', stars: 4, comment: 'مستوى عالٍ من التنظيم', createdAt: now - 2 * DAY },
  ];
  ratings.forEach((r) => pushPoints(r.userId, 5, 'rating', r.createdAt, 'course', r.courseId));
  // تقديرات مدرب سابقة (لإظهار كوتا الاستهلاك)
  pushPoints('u_omar', 15, 'kudos', now - 2 * DAY, 'batch', IDS.g1, IDS.sara);
  pushPoints('u_nour', 10, 'kudos', now - 6 * DAY, 'batch', IDS.g1, IDS.sara);

  // ── الشهادات: G3 ──
  const certificates: Certificate[] = [];
  let certSeq = 141;
  const g3Eligible = g3Students.filter((userId) => {
    const rows = attendance.filter((a) => a.userId === userId && a.sessionId.startsWith('s_g3_'));
    const honored = rows.filter((a) => a.status !== 'absent').length;
    return rows.length > 0 && honored / rows.length >= 0.75;
  });
  g3Eligible.forEach((userId, i) => {
    certSeq += 1;
    certificates.push({
      id: `cert_g3_${userId}`, userId, batchId: IDS.g3,
      serial: `MSR-2026-${String(certSeq).padStart(6, '0')}`,
      issuedAt: now - (31 - i * 0.1) * DAY,
      status: 'active', reissueCount: 0,
    });
    pushPoints(userId, 100, 'course.complete', now - 31 * DAY, 'batch', IDS.g3);
  });

  // ── الاستريك: رول-أب أسبوعي عام ──
  const streakWeeks: StreakWeek[] = [];
  const gamification: GamificationProfile[] = [];
  const curWeekStart = weekStartOf(now);
  studentDefs.forEach(([userId]) => {
    const myBatchIds = enrollments.filter((e) => e.userId === userId && e.status === 'active').map((e) => e.batchId);
    const closed = sessions.filter((s) => myBatchIds.includes(s.batchId) && s.status === 'closed');
    const byWeek = new Map<number, TrainingSession[]>();
    closed.forEach((s) => {
      const wk = weekStartOf(s.startsAt);
      if (!byWeek.has(wk)) byWeek.set(wk, []);
      byWeek.get(wk)!.push(s);
    });
    const weekKeys = [...byWeek.keys()].filter((w) => w < curWeekStart).sort((a, b) => a - b);
    let currentRun = 0;
    let longest = 0;
    let freezes = 1; // كل طالب يبدأ بمُجمّد مجاني
    weekKeys.forEach((wk) => {
      const wkSess = byWeek.get(wk)!;
      const rows = wkSess.map((s) => attendance.find((a) => a.sessionId === s.id && a.userId === userId));
      const total = rows.length;
      const honored = rows.filter((r) => r && r.status !== 'absent').length;
      let status: StreakWeek['status'];
      let freezeUsed = false;
      if (honored === total) {
        status = 'kept';
        currentRun += 1;
        if (currentRun % 4 === 0 && freezes < 2) freezes += 1; // 4 أسابيع التزام = مُجمّد جديد
      } else if (userId === 'u_karim' && freezes > 0) {
        status = 'frozen';
        freezeUsed = true;
        freezes -= 1;
      } else {
        status = 'broken';
        currentRun = 0;
      }
      longest = Math.max(longest, currentRun);
      streakWeeks.push({ userId, weekStart: wk, status, sessionsTotal: total, sessionsHonored: honored, freezeUsed });
    });
    // الأسبوع الجاري تحت التتبع
    const wkNow = byWeek.get(curWeekStart) ?? [];
    const nowRows = wkNow.map((s) => attendance.find((a) => a.sessionId === s.id && a.userId === userId));
    streakWeeks.push({
      userId, weekStart: curWeekStart, status: 'tracking',
      sessionsTotal: wkNow.length,
      sessionsHonored: nowRows.filter((r) => r && r.status !== 'absent').length,
      freezeUsed: false,
    });
    // عمر قصة محكمة: سلسلة 3 أسابيع، أطول سلسلة 5
    if (userId === 'u_omar') { currentRun = 3; longest = 5; }
    // نور: انكسرت مؤخرًا
    if (userId === 'u_nour') { currentRun = 0; longest = 4; }
    const tiers: GamificationProfile['leagueTier'][] = ['bronze', 'silver', 'bronze', 'bronze', 'gold', 'silver', 'bronze', 'bronze', 'silver', 'bronze', 'bronze', 'gold', 'bronze', 'bronze', 'silver', 'bronze', 'bronze', 'gold', 'bronze'];
    const tierIdx = userId === 'u_omar' ? 1 /* silver */ : studentDefs.findIndex(([id]) => id === userId);
    gamification.push({
      userId,
      currentStreakWeeks: currentRun,
      longestStreakWeeks: Math.max(longest, currentRun),
      freezesHeld: userId === 'u_karim' ? 0 : freezes,
      leagueTier: tiers[tierIdx % tiers.length],
    });
  });

  // ── الشارات ──
  const badges: Badge[] = [
    { code: 'first_step', nameAr: 'البداية الصح', nameEn: 'Right Start', descAr: 'أول حضور في تاريخك على مسار', descEn: 'Your first ever attendance', rarity: 'common', icon: 'footsteps', active: true },
    { code: 'consistent', nameAr: 'المواظب', nameEn: 'Consistent', descAr: '4 محاضرات متتالية في كورس واحد', descEn: '4 consecutive sessions in one course', rarity: 'common', icon: 'calendar', active: true },
    { code: 'early_bird', nameAr: 'الطائر المبكر', nameEn: 'Early Bird', descAr: '10 حضورات قبل بدء الجلسة', descEn: '10 check-ins before session start', rarity: 'rare', icon: 'sunny', active: true },
    { code: 'perfection', nameAr: 'الكمال', nameEn: 'Perfection', descAr: 'شهر ميلادي حضور 100% بلا غياب', descEn: 'A calendar month at 100% attendance', rarity: 'epic', icon: 'diamond', active: true },
    { code: 'super_streak', nameAr: 'السوبر ستريك', nameEn: 'Super Streak', descAr: '8 أسابيع التزام متتالية', descEn: '8 consecutive committed weeks', rarity: 'epic', icon: 'flame', active: true },
    { code: 'month_star', nameAr: 'نجم الشهر', nameEn: 'Star of the Month', descAr: 'أعلى نقاط شهر على مستوى فرعك', descEn: 'Top monthly points in your branch', rarity: 'epic', icon: 'star', active: true },
    { code: 'top_scorer', nameAr: 'المتصدر', nameEn: 'Top Scorer', descAr: 'صدارة الدوري الأسبوعي في أي مرة', descEn: 'Topping a weekly league any time', rarity: 'common', icon: 'trophy', active: true },
    { code: 'climber', nameAr: 'الصاعد', nameEn: 'Climber', descAr: 'الصعود لفئة دوري أعلى', descEn: 'Promoting to a higher league tier', rarity: 'rare', icon: 'trending-up', active: true },
    { code: 'cert_hunter', nameAr: 'صائد الشهادات', nameEn: 'Certificate Hunter', descAr: 'أول شهادة مصدرة لك', descEn: 'Your first issued certificate', rarity: 'rare', icon: 'ribbon', active: true },
    { code: 'pro_expert', nameAr: 'الخبير المحترف', nameEn: 'Pro Expert', descAr: '3 شهادات مكتملة', descEn: '3 completed certificates', rarity: 'epic', icon: 'medal', active: true },
    { code: 'honest_reviewer', nameAr: 'المقيّم الأمين', nameEn: 'Honest Reviewer', descAr: 'تقييم 3 كورسات بعد إتمامها', descEn: 'Rating 3 completed courses', rarity: 'common', icon: 'chatbubble-ellipses', active: true },
    { code: 'season_legend', nameAr: 'أسطورة الموسم', nameEn: 'Season Legend', descAr: 'إنهاء موسم (6 أشهر) بأعلى نقاط الفرع', descEn: 'Top branch points across a 6-month season', rarity: 'legendary', icon: 'crown', active: true },
  ];

  const userBadges = [
    { userId: 'u_omar', badgeCode: 'first_step', awardedAt: g1Closed[0].startsAt },
    { userId: 'u_omar', badgeCode: 'consistent', awardedAt: g1Closed[3].startsAt },
    { userId: 'u_omar', badgeCode: 'cert_hunter', awardedAt: now - 31 * DAY },
    { userId: 'u_karim', badgeCode: 'first_step', awardedAt: g1Closed[0].startsAt },
    { userId: 'u_nour', badgeCode: 'first_step', awardedAt: g1Closed[0].startsAt },
    { userId: 'u_nour', badgeCode: 'consistent', awardedAt: g1Closed[3].startsAt },
    { userId: 'u_youssef', badgeCode: 'first_step', awardedAt: g1Closed[0].startsAt },
  ];

  // ── الدوري: صفوف الأسابيع السابقة (تاريخ) ──
  const leagueWeeks = [
    { userId: 'u_omar', weekStart: weekStartOf(now - 7 * DAY), tier: 'bronze' as const, xpWeek: 132, finalRank: 2, outcome: 'promoted' as const },
    { userId: 'u_nour', weekStart: weekStartOf(now - 7 * DAY), tier: 'silver' as const, xpWeek: 88, finalRank: 6, outcome: 'stayed' as const },
  ];

  // ── الأعذار ──
  const excuses: Excuse[] = [
    { id: 'ex_1', userId: 'u_mariam', sessionId: 's_g1_6', reason: 'موعد طبي طارئ — أرفقت كشف المستشفى', attachment: 'تقرير طبي', status: 'pending', createdAt: now - 1 * DAY },
    { id: 'ex_2', userId: 'u_karim', sessionId: 's_g1_4', reason: 'ظرف عائلي', status: 'accepted', note: 'عذر مقبول — بالسلامة', reviewedBy: IDS.sara, createdAt: now - 9 * DAY },
    { id: 'ex_3', userId: 'u_youssef', sessionId: 's_g1_2', reason: 'سفر قصير', status: 'rejected', note: 'السفر المخطط له مسبقًا لا يُقبل كعذر طارئ', reviewedBy: IDS.sara, createdAt: now - 16 * DAY },
  ];

  // ── الإشعارات ──
  const notifications: AppNotification[] = [
    { id: 'n_1', userId: 'u_omar', title: 'محاضرتك اليوم 💪', body: 'مشروع تطبيقي — الجزء الأول · الساعة 6:00م · قاعة 2', type: 'session', read: false, createdAt: now - 55 * 60_000 },
    { id: 'n_2', userId: 'u_omar', title: 'شارة جديدة: صائد الشهادات 🔵', body: 'أول شهادة مصدرة لك — مبروك!', type: 'badge', read: true, createdAt: now - 31 * DAY },
    { id: 'n_3', userId: 'u_omar', title: 'صعدت للدوري الفضي ⚪', body: 'أسبوع مذهل — استمر!', type: 'league', read: true, createdAt: now - 7 * DAY },
    { id: 'n_4', userId: IDS.sara, title: 'عذر جديد بانتظار مراجعتك', body: 'مريم سمير — محاضرة: الهوية البصرية والشعارات', type: 'excuse', read: false, createdAt: now - 1 * DAY },
    { id: 'n_5', userId: IDS.mahmoud, title: 'تم تعيينك مشرفًا 🎉', body: 'فرع القاهرة — مدينة نصر تحت إدارتك الآن.', type: 'system', read: true, createdAt: now - 60 * DAY },
  ];

  const db: Db = {
    profiles, branches, committees, courses, batches, enrollments,
    sessions, attendance, pointEvents, streakWeeks, gamification,
    badges, userBadges, leagueWeeks, certificates, excuses, ratings,
    rules: defaultRules(),
    audit: [
      { id: 'au_1', actorId: IDS.mahmoud, action: 'admin_update_rule', target: 'certificate.min_attendance_pct', payload: { from: 80, to: 75 }, createdAt: now - 5 * DAY },
      { id: 'au_2', actorId: IDS.sara, action: 'award_kudos', target: 'u_omar', payload: { points: 15, reason: 'مشروع مميز في محور الهوية' }, createdAt: now - 2 * DAY },
    ],
    kudosQuotas: [{ instructorId: IDS.sara, month: monthKeyOf(now), spent: 25 }],
    notifications,
    privateNotes: [{ instructorId: IDS.sara, userId: 'u_omar', note: 'مهتم ومتفاعل — رشّحه لمشروع المعرض', updatedAt: now - 2 * DAY }],
    certSeq,
    seedVersion: SEED_VERSION,
  };
  return db;
}
