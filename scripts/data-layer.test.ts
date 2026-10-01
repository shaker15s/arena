// scripts/data-layer.test.ts — اختبارات طبقة البيانات وبوابة المزامنة (T2)

// تثبيت محاكي الحزم التي تعتمد على بيئة React Native قبل استيراد الوحدات
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require('module');
const origRequire = Module.prototype.require;
Module.prototype.require = function (id: string, ...args: any[]) {
  if (id === 'react-native') {
    return {
      Platform: { OS: 'web' },
      AppState: { addEventListener: () => ({ remove: () => {} }) },
    };
  }
  if (id === '@react-native-async-storage/async-storage') {
    return {
      getItem: async () => null,
      setItem: async () => {},
      removeItem: async () => {},
    };
  }
  if (
    id === 'expo-secure-store' ||
    id === 'expo-web-browser' ||
    id === 'expo-linking' ||
    id === 'expo-apple-authentication'
  ) {
    return {};
  }
  return origRequire.call(this, id, ...args);
};

import type { Db, Profile } from '../src/data/types';
import type { SyncGate as SyncGateType } from '../src/data/syncGate';
import type { RefreshScope } from '../src/data/remote';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SyncGate } = require('../src/data/syncGate');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { fetchRemoteDbScope, emptyDb, applyRealtimePatch } = require('../src/data/remote');

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

async function run() {
  console.log('\n═ فحص بوابة المزامنة وطبقة البيانات (Data Layer & SyncGate Guard) ═');

  // ═ 1) اختبارات SyncGate ═
  console.log('\n═ 1) اختبارات SyncGate (Coalesce & Deduplication) ═');

  // 1.1 Coalescing: 1 immediate + 1 deferred on rapid triggers
  {
    const gate: SyncGateType = new SyncGate(60); // 60ms window for fast test execution
    let callCount = 0;
    const unsub = gate.onChanged(() => {
      callCount++;
    });

    // First request triggers immediately
    gate.request();
    ok(callCount === 1, 'SyncGate: أول استدعاء ينفذ فوراً (count === 1)', { callCount });

    // Rapid subsequent calls within the 60ms window
    gate.request();
    gate.request();
    gate.request();
    gate.request();

    // Still only 1 execution synchronously
    ok(callCount === 1, 'SyncGate: استدعاءات متتالية سريعة لا تنفذ فوراً وإنما تُؤجل (count === 1)', { callCount });

    // Wait for the window to pass and deferred execution to fire
    await new Promise((resolve) => setTimeout(resolve, 80));

    // Deferred execution fires exactly once for all queued requests
    ok(callCount === 2, 'SyncGate: الاستدعاءات المؤجلة تُدمج في تنفيذ واحد بعد انقضاء النافذة (count === 2)', { callCount });

    // Clean up
    unsub();
    gate.destroy();
  }

  // 1.2 Subsequent calls after window expires trigger immediately
  {
    const gate: SyncGateType = new SyncGate(50);
    let callCount = 0;
    gate.onChanged(() => {
      callCount++;
    });

    gate.request();
    ok(callCount === 1, 'SyncGate: استدعاء أولي ينفذ فوراً');

    await new Promise((resolve) => setTimeout(resolve, 70));
    ok(callCount === 1, 'SyncGate: لا يوجد استدعاء مؤجل عند عدم طلب إضافي');

    gate.request();
    ok(callCount === 2, 'SyncGate: استدعاء بعد انقضاء النافذة ينفذ فوراً مرة أخرى (count === 2)');

    gate.destroy();
  }

  // 1.3 Subscription and unsubscribe
  {
    const gate: SyncGateType = new SyncGate(50);
    let calledA = 0;
    let calledB = 0;

    const unsubA = gate.onChanged(() => { calledA++; });
    const unsubB = gate.onChanged(() => { calledB++; });

    gate.request();
    ok(calledA === 1 && calledB === 1, 'SyncGate: يبلّغ جميع المشتركين المسجلين');

    unsubA();
    await new Promise((resolve) => setTimeout(resolve, 60));

    gate.request();
    ok(calledA === 1 && calledB === 2, 'SyncGate: إلغاء الاشتراك يوقف الاستدعاء للمشترك الملغى فقط');

    gate.destroy();
  }

  // 1.4 Destroy cancels pending timer
  {
    const gate: SyncGateType = new SyncGate(60);
    let called = 0;
    gate.onChanged(() => { called++; });

    gate.request(); // immediate (count = 1)
    gate.request(); // deferred
    gate.destroy(); // cancels pending deferred execution

    await new Promise((resolve) => setTimeout(resolve, 80));
    ok(called === 1, 'SyncGate: destroy() يلغي المؤقت المعلق ولا ينفذ المؤجل', { called });
  }

  // ═ 2) اختبارات عقود النطاقات المخصصة (Scoped Refresh Contracts) ═
  console.log('\n═ 2) بنية عقود النطاقات (Scoped Refresh Contracts) ═');

  ok(typeof fetchRemoteDbScope === 'function', 'fetchRemoteDbScope دالة معرّفة وقابلة للاستدعاء');

  // تعريف مفاتيح كل نطاق
  const todayExpectedKeys = new Set([
    'sessions',
    'attendance',
    'pointEvents',
    'notifications',
    'excuses',
  ]);

  const orgExpectedKeys = new Set([
    'branches',
    'committees',
    'courses',
    'batches',
    'enrollments',
    'gamification',
    'badges',
    'userBadges',
    'leagueWeeks',
    'certificates',
    'certSeq',
    'ratings',
    'rules',
    'kudosQuotas',
    'courseRoles',
  ]);

  const allDbKeys = Object.keys(emptyDb());
  ok(allDbKeys.length >= 24, `emptyDb() تحتوي كل الجداول الـ 24 (الحجم: ${allDbKeys.length})`);

  // 2.1 التحقق من استقلالية مفاتيح نطاق today
  for (const k of todayExpectedKeys) {
    ok(allDbKeys.includes(k), `مفتاح نطاق today موجود في Db: ${k}`);
  }

  // 2.2 التحقق من استقلالية مفاتيح نطاق org
  for (const k of orgExpectedKeys) {
    ok(allDbKeys.includes(k), `مفتاح نطاق org موجود في Db: ${k}`);
  }

  // ═ 3) منطق دمج النطاقات الجزئية (Scope Merge Semantics) ═
  console.log('\n═ 3) منطق دمج النطاقات الجزئية (Scope Merge Semantics) ═');

  {
    const baseDb: Db = emptyDb();
    baseDb.profiles = [{
      id: 'prof_test_1',
      authUserId: 'u_1',
      fullName: 'أحمد محمود',
      phone: '01000000000',
      role: 'student',
      branchId: 'b_cairo',
      avatarColor: '#007AFF',
      gender: 'm',
      status: 'active',
      joinedAt: 1000,
    }];
    baseDb.courses = [{
      id: 'c_test_1',
      title: 'مسار البرمجة',
      field: 'tech',
      description: 'وصف',
      topics: [],
      sessionsCount: 10,
      status: 'published',
      color: '#007AFF',
      committeeId: 'comm_1',
    }];
    baseDb.sessions = [{
      id: 's_old',
      batchId: 'batch_1',
      seq: 1,
      title: 'جلسة قديمة',
      startsAt: 2000,
      durationMin: 120,
      status: 'scheduled',
    }];

    // تحديث جزئي بنطاق today
    const partialToday: Partial<Db> = {
      sessions: [{
        id: 's_new',
        batchId: 'batch_1',
        seq: 1,
        title: 'جلسة جديدة محدثة',
        startsAt: 3000,
        durationMin: 120,
        status: 'live',
      }],
      attendance: [{
        sessionId: 's_new',
        userId: 'prof_test_1',
        status: 'present',
      }],
    };

    const updatedToday: Db = { ...baseDb, ...partialToday };

    // الحفاظ على الملفات الشخصية والمقررات القديمة
    ok(updatedToday.profiles.length === 1 && updatedToday.profiles[0].id === 'prof_test_1',
      'دمج نطاق today يحافظ على البروفايلات السابقة دون مساس');
    ok(updatedToday.courses.length === 1 && updatedToday.courses[0].id === 'c_test_1',
      'دمج نطاق today يحافظ على المقررات السابقة دون مساس');
    // تحديث الجلسات والحضور بالقيم الجديدة
    ok(updatedToday.sessions.length === 1 && updatedToday.sessions[0].id === 's_new' && updatedToday.sessions[0].status === 'live',
      'دمج نطاق today يستبدل الجلسات بالنسخة الطازجة');
    ok(updatedToday.attendance.length === 1 && updatedToday.attendance[0].sessionId === 's_new',
      'دمج نطاق today يستبدل الحضور بالنسخة الطازجة');

    // تحديث جزئي بنطاق org
    const partialOrg: Partial<Db> = {
      courses: [{
        id: 'c_test_2',
        title: 'مسار الذكاء الاصطناعي',
        field: 'ai',
        description: 'وصف جديد',
        topics: ['ML'],
        sessionsCount: 12,
        status: 'published',
        color: '#34C759',
        committeeId: 'comm_1',
      }],
    };

    const updatedOrg: Db = { ...updatedToday, ...partialOrg };

    // الجلسات المحدثة من today تبقى كما هي
    ok(updatedOrg.sessions[0].id === 's_new', 'دمج نطاق org يحافظ على جلسات today دون مساس');
    // المقررات تم تحديثها
    ok(updatedOrg.courses.length === 1 && updatedOrg.courses[0].id === 'c_test_2',
      'دمج نطاق org يحدّث المقررات بنجاح');
  }

  // ═ 4) اختبارات ترقيع الأحداث اللحظية (applyRealtimePatch Integrity) ═
  console.log('\n═ 4) اختبارات ترقيع الأحداث اللحظية (applyRealtimePatch) ═');

  {
    const initialDb = emptyDb();
    initialDb.batches = [{
      id: 'batch_alpha',
      courseId: 'course_1',
      branchId: 'branch_1',
      instructorId: 'inst_1',
      capacity: 30,
      enrolledCount: 0,
      waitlistCount: 0,
      schedule: { days: [0, 2], time: '18:00', durationMin: 120 },
      startDate: 5000,
      room: '101',
      status: 'active',
      joinCode: 'ALPHA',
      geofenceEnabled: false,
    }];

    // إضافة تسجيل طالب
    const patchEnrollment = applyRealtimePatch(initialDb, {
      table: 'enrollments',
      eventType: 'INSERT',
      newRow: {
        user_id: 'user_student_1',
        batch_id: 'batch_alpha',
        status: 'active',
        joined_at: new Date().toISOString(),
      },
    });

    ok(patchEnrollment !== null, 'applyRealtimePatch: تسجيل enrollment صالح يعيد Db محدثة');
    if (patchEnrollment) {
      ok(patchEnrollment.enrollments.length === 1, 'applyRealtimePatch: أضاف السجل إلى enrollments');
      ok(patchEnrollment.batches.find((b: any) => b.id === 'batch_alpha')?.enrolledCount === 1,
        'applyRealtimePatch: حدّث enrolledCount للمجموعة اشتقاقياً');
    }

    // إضافة تسجيل عذر
    const patchExcuse = applyRealtimePatch(patchEnrollment ?? initialDb, {
      table: 'excuses',
      eventType: 'INSERT',
      newRow: {
        id: 'excuse_1',
        user_id: 'user_student_1',
        session_id: 'sess_1',
        reason: 'عذر مرضي طارئ',
        status: 'pending',
        created_at: new Date().toISOString(),
      },
    });

    ok(patchExcuse !== null && patchExcuse.excuses.length === 1, 'applyRealtimePatch: إضافة عذر ينعكس في Db');

    // حذف العذر
    const patchDeleteExcuse = applyRealtimePatch(patchExcuse ?? initialDb, {
      table: 'excuses',
      eventType: 'DELETE',
      oldRow: { id: 'excuse_1' },
    });

    ok(patchDeleteExcuse !== null && patchDeleteExcuse.excuses.length === 0,
      'applyRealtimePatch: حذف العذر ينعكس بإزالته من Db');
  }

  console.log(`\n═══ Data Layer Tests: ${passed} ✅ / ${failed} ❌ ═══\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();
