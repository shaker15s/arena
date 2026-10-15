/**
 * scripts/screen-smoke-run.js — تشغيل «دخان الشاشات»: يصيّر مكوّنات حقيقية من
 * `src/` عبر React DOM (نسخة الويب) ويتحقّق من مخرَجها نصيًا.
 *
 * هذا هو الفرق الجوهري عن البوابات الساكنة: لو أن مكوّنًا ينفجر وقت التنفيذ
 * (prop ناقص، حقل غير موجود، حلقة استيراد، قسمة على صفر) فإن هذا السكربت يفشل —
 * أي أننا نكتشف العطب قبل المستخدم.
 *
 * التشغيل:
 *   npx tsc -p tsconfig.smoke.json && node scripts/screen-smoke-run.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const Module = require('module');

// ميناء صغير لتتبّع من يستورد `react-native` الأصلي (يفيد في تشخيص الأعطال)
if (process.env.SMOKE_TRACE === '1') {
  const traceResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request === 'react-native' && parent && !/react-native-web/.test(parent.filename)) {
      console.log('• react-native ←', parent.filename.replace(root, '.'));
    }
    return traceResolve.call(this, request, parent, isMain, options);
  };
}

const root = path.resolve(__dirname, '..');
const build = path.join(root, '.smoke-build');
const resolveFilename = Module._resolveFilename;

const NOOP_SHIMS = new Set([
  'expo-haptics',
  'expo-linear-gradient',
  'expo-clipboard',
  'expo-sharing',
  'expo-print',
  'expo-keep-awake',
  'expo-image-picker',
  'expo-web-browser',
  'expo-font',
  'expo-file-system',
  'expo-camera',
  'expo-blur',
  'expo-linking',
  'expo-status-bar',
  'expo-secure-store',
  '@react-native-async-storage/async-storage',
  'react-native-safe-area-context',
  'react-native-qrcode-svg',
  '@expo/vector-icons',
  '@expo/vector-icons/Ionicons',
  // مكتبات ملاحة: نستبدلها لأن المكوّنات المعروضة هنا لا تحتاج تنقّلًا حقيقيًا
  '@react-navigation/native',
  '@react-navigation/native-stack',
  '@react-navigation/bottom-tabs',
]);

Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'react-native') {
    return path.join(root, 'node_modules', 'react-native-web', 'dist', 'cjs', 'index.js');
  }
  if (request === 'react-native-svg') {
    return path.join(root, 'node_modules', 'react-native-svg', 'lib', 'commonjs', 'ReactNativeSVG.web.js');
  }
  if (request.startsWith('react-native/')) {
    return path.join(__dirname, 'faten-ssr-shims.js');
  }
  // react-native-qrcode-svg يستورد `react-native` الأصلي؛ البديل يتكفّل به.
  if (request === '@expo/vector-icons' || request.startsWith('@expo/vector-icons/')) {
    return path.join(__dirname, 'screen-smoke-shims.js');
  }
  if (NOOP_SHIMS.has(request)) {
    return path.join(__dirname, 'screen-smoke-shims.js');
  }
  const resolved = resolveFilename.call(this, request, parent, isMain, options);
  if (process.env.SMOKE_TRACE === '1') console.log('·', request, '<-', parent && parent.filename.replace(root, '.'));
  if (resolved.includes(`${path.sep}react-native-svg${path.sep}`) && resolved.endsWith('.js')) {
    const webVariant = resolved.replace(/\.js$/, '.web.js');
    if (fs.existsSync(webVariant)) return webVariant;
  }
  return resolved;
};

process.env.NODE_ENV = 'development';

// ── 0) ساعة مثبّتة ──────────────────────────────────────────────────────────
// نفس ساعة اختبارات المحرك (`Date.UTC(2026,8,30,16,0,0)`) ليكون مخرَج التصيير
// ولقطات `docs/design/smoke/*.html` **حتمية**: قبل ذلك كانت كل تشغيلة تُغيّر
// أوقات الكروت (11:29 ص ← 11:50 ص) فتظهر فروق وهمية في Git عند كل تحقق.
// التثبيت قبل بناء البذرة عمدًا حتى تُبنى الجلسات والمواعيد على نفس الساعة.
const FIXED_NOW = Date.UTC(2026, 8, 30, 16, 0, 0);
Date.now = () => FIXED_NOW;

// ── 1) ذاكرة بذرة حقيقية + متجر مُستبدل ──
const seed = require(path.join(build, 'scripts', 'fixtures', 'seed.js'));
const db = seed.buildSeedDb();
const admin = db.profiles.find((p) => p.id === seed.IDS.admin);
const student = db.profiles.find((p) => p.id === 'u_karim');

const currentUser = { current: student };
// حالات فطن الـ14 للتصيير الشامل (تُقرأ من نوع الحالات نفسه)
db.__mascotStates = ['idle', 'welcome', 'ready', 'attention', 'working', 'success', 'achievement', 'streak_fire', 'alert', 'recovery', 'offline', 'quiet', 'level_up', 'nudge'];
const toasts = [];
const fakeStore = {
  __esModule: true,
  AppProvider: ({ children }) => children,
  useApp: () => ({
    db,
    user: currentUser.current,
    ready: true,
    loading: false,
    syncing: false,
    online: true,
    lastSyncAt: Date.now(),
    syncError: null,
    authError: null,
    pendingQueueCount: 0,
    toasts,
    refresh: async () => {},
    signInWithGoogle: async () => {},
    signOut: async () => {},
    toast: (message, kind) => toasts.push({ message, kind }),
    retrySync: async () => {},
  }),
};

const storePath = path.join(build, 'src', 'data', 'store.js');
require.cache[storePath] = {
  id: storePath, filename: storePath, loaded: true, children: [], paths: [],
  exports: fakeStore,
};

// `src/data/actions` يستدعي Supabase؛ نستبدله ببديل يسجّل النداءات (لا شبكة في Node).
const actionsPath = path.join(build, 'src', 'data', 'actions.js');
const actionCalls = [];
const stubActions = new Proxy({ __esModule: true }, {
  get: (target, prop) => {
    if (prop === '__esModule') return true;
    if (prop === 'getCourseReport') return async () => ({ course: { id: 'x', title: 'x', field: '', status: 'active', sessions_count: 0 } });
    return async (...args) => {
      actionCalls.push({ fn: String(prop), args });
      return { ok: true, id: 'stub-report-id', published: false, notified: 0, detached_sessions: 0, moved: true };
    };
  },
});
require.cache[actionsPath] = {
  id: actionsPath, filename: actionsPath, loaded: true, children: [], paths: [],
  exports: stubActions,
};

// ── 2) ترتيب: نصيّر كل مكوّن في مزوّدات التطبيق ──
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { ThemeProvider } = require(path.join(build, 'src', 'design', 'theme.js'));
const i18n = require(path.join(build, 'src', 'i18n', 'index.js'));
const { StreakHero } = require(path.join(build, 'src', 'features', 'gamification', 'StreakHero.js'));
const { CourseOutline } = require(path.join(build, 'src', 'features', 'journey', 'CourseOutline.js'));
const { CourseFeedbackTab } = require(path.join(build, 'src', 'features', 'courses', 'management', 'CourseFeedbackTab.js'));
const { CourseReportTab } = require(path.join(build, 'src', 'features', 'courses', 'management', 'CourseReportTab.js'));
const { CourseBuildTab } = require(path.join(build, 'src', 'features', 'courses', 'management', 'CourseBuildTab.js'));
const mascot = require(path.join(build, 'src', 'design', 'mascot', 'index.js'));
const dayCards = require(path.join(build, 'src', 'features', 'today', 'DayCards.js'));
const orgDash = require(path.join(build, 'src', 'features', 'org', 'DashboardScreen.js'));
const gamScreens = require(path.join(build, 'src', 'features', 'gamification', 'GamificationScreens.js'));
const todayScreen = require(path.join(build, 'src', 'features', 'today', 'TodayScreen.js'));
const volunteerScreens = require(path.join(build, 'src', 'features', 'volunteer', 'VolunteerScreens.js'));

/** مُترجم بسيط للاستخدام خارج شجرة React (بطاقة لوحة المنظّم تطلب `t` كخاصية). */
const i18nT = (key, params) => {
  const dict = require(path.join(build, 'src', 'i18n', 'ar.js')).ar;
  let text = dict[key] ?? String(key);
  if (params) for (const [k, v] of Object.entries(params)) text = text.split(`{${k}}`).join(String(v));
  return text;
};

const withProviders = (node) => renderToStaticMarkup(
  React.createElement(i18n.I18nProvider, null,
    React.createElement(ThemeProvider, null, node)),
);

const courseId = db.batches.find((b) => b.id === seed.IDS.g2).courseId;
const course = db.courses.find((c) => c.id === courseId);

const cases = [
  {
    name: 'StreakHero (بطاقة السلسلة الأسبوعية)',
    user: seed.IDS.omar,
    node: React.createElement(StreakHero, { compact: true, onProtect: () => {} }),
    expect: ['سلسلتك الأسبوعية', 'هدف الأسبوع', 'باقي'],
  },
  {
    name: 'StreakHero — النسخة الكاملة',
    user: seed.IDS.omar,
    node: React.createElement(StreakHero, { onProtect: () => {} }),
    expect: ['سلسلتك الأسبوعية', 'دروع التجميد'],
  },
  {
    name: 'CourseOutline (مخطط الكورس بالوحدات)',
    node: React.createElement(CourseOutline, { batchId: seed.IDS.g2, onScan: () => {}, onExcuse: () => {} }),
    expect: ['محاضرات'],
  },
  {
    name: 'CourseFeedbackTab (تغذية الكورس للمنظّم)',
    node: React.createElement(CourseFeedbackTab, { db, courseId }),
    expect: ['الفهم'],
  },
  {
    name: 'CourseReportTab (كتابة تقرير الكورس)',
    node: React.createElement(CourseReportTab, { course, canEdit: true, batches: db.batches.filter((b) => b.courseId === courseId).map((b) => ({ id: b.id, room: b.room })) }),
    expect: ['الملخص'],
  },
  {
    name: 'CourseBuildTab (بناء الكورس)',
    node: React.createElement(CourseBuildTab, { db, course, sessions: db.sessions.filter((s) => s.batchId === seed.IDS.g2), canEdit: true }),
    expect: ['وحدة'],
  },
  {
    name: 'DaySummaryCard (ملخص النهاردة — كروت الطالب)',
    node: React.createElement(dayCards.DaySummaryCard, { db, userId: seed.IDS.omar, now: FIXED_NOW }),
    expect: ['ملخص النهاردة'],
  },
  {
    name: 'NearestBadgeCard (أقرب شارة للكسب)',
    node: React.createElement(dayCards.NearestBadgeCard, { db, userId: seed.IDS.omar }),
    expect: ['أقرب شارة للكسب'],
  },
  {
    // انحدار مباشر على شكوى المستخدم: «عندي محاضرة بعد ١٠ دقايق ويقولي القادمة بعد ٣ أيام»
    name: 'DaySummaryCard — الحقيقة الزمنية (بعد 3 أيام ليست النهاردة)',
    node: (() => {
      const probe = { ...db, sessions: [] };
      const batch = db.batches.find((b) => db.enrollments.some((e) => e.batchId === b.id && e.userId === seed.IDS.omar && e.status === 'active'));
      const farStart = Date.now() + 3 * 24 * 60 * 60_000;
      probe.sessions = [
        { ...db.sessions.find((x) => x.batchId === batch.id), id: 'smoke-far', startsAt: farStart, status: 'scheduled' },
      ];
      return React.createElement(dayCards.DaySummaryCard, { db: probe, userId: seed.IDS.omar, now: Date.now() });
    })(),
    expect: ['مفيش محاضرات النهاردة', 'بعد 3 أيام'],
  },
  {
    name: 'NextSessionCard (الجلسة القادمة للمنظّم)',
    node: React.createElement(orgDash.NextSessionCard, {
      db, userId: db.batches.find((b) => b.instructorId) ? db.batches.find((b) => b.instructorId).instructorId : seed.IDS.ahmed,
      t: (k, p) => i18nT(k, p), navigation: { navigate: () => {} },
    }),
    expect: ['الجاية'],
  },
  {
    // التقدّم في قاعة الإنجازات لازم يكون عدّادًا حقيقيًا («2 من 4 محاضرات»)
    name: 'AchievementsScreen (قاعة الإنجازات — تقدّم الشارات)',
    user: seed.IDS.omar,
    node: React.createElement(gamScreens.AchievementsScreen, { navigation: { goBack: () => {}, navigate: () => {} } }),
    expect: ['قاعة الإنجازات', 'من', 'محاضرات'],
  },
  {
    // الشاشة الرئيسية كاملة: أي انفجار في ترتيب الكروت أو الحسابات يظهر هنا
    name: 'TodayScreen (اليوم — الشاشة كاملة)',
    node: React.createElement(todayScreen.TodayScreen, {}),
    expect: ['ملخص النهاردة', 'اليوم'],
  },
  {
    name: 'VolunteerTodayScreen (يوم المدرّب — الشاشة كاملة)',
    user: seed.IDS.sara,
    node: React.createElement(volunteerScreens.VolunteerTodayScreen, { navigation: { navigate: () => {} } }),
    expect: ['ملخص النهاردة', 'لمحة سريعة'],
  },
  {
    // بلاغ المستخدم: شاشة المنظّم ما كانش فيها بطاقة «الجلسة القادمة» أصلًا
    name: 'NextSessionCard — المنظّم يدير كورسًا (عرض حقيقي)',
    user: seed.IDS.mahmoud,
    node: React.createElement(orgDash.NextSessionCard, {
      db, userId: seed.IDS.mahmoud, t: i18nT, navigation: { navigate: () => {} },
    }),
    expect: ['كورساتك'],
  },
  {
    name: 'DashboardScreen (لوحة المنظّم — الشاشة كاملة)',
    user: seed.IDS.mahmoud,
    node: React.createElement(orgDash.DashboardScreen, { navigation: { navigate: () => {}, goBack: () => {} } }),
    expect: ['لوحة'],
  },
  {
    name: 'MasarMascot — كل الحالات (14)',
    node: React.createElement(React.Fragment, null,
      ...db.__mascotStates.map((state, i) => React.createElement(mascot.MasarMascot, { key: i, behavior: state, size: 90, hideFloatingBubble: true }))),
    expect: ['<svg', 'viewBox'],
  },
];

let failures = 0;
console.log('\n══ دخان الشاشات: تصيير React حقيقي لمكوّنات مسار ══\n');
for (const testCase of cases) {
  let html = '';
  // بعض الحالات تحتاج مستخدمًا مختلفًا (مدرّب/منظّم) — نبدّله حول التصيير فقط.
  const previousUser = currentUser.current;
  if (testCase.user) currentUser.current = db.profiles.find((p2) => p2.id === testCase.user) ?? previousUser;
  try {
    html = withProviders(testCase.node);
  } catch (error) {
    failures++;
    console.log(`❌ ${testCase.name}: انفجار — ${error.message.split('\n')[0]}`);
    if (process.env.SMOKE_STACK === '1') console.log(String(error.stack).split('\n').slice(0, 8).join('\n'));
    currentUser.current = previousUser;
    continue;
  }
  currentUser.current = previousUser;
  // لقطات HTML دائمة (لمكوّنات الواجهة، لا الرسم الكبير) لمراجعة بشرية سريعة
  // اسم اللقطة = الجزء قبل الأقواس + تمييز الحالات الخاصة، حتى لا تلغي لقطةٌ لقطةً
  // أخرى (كانت حالتان بنفس الكلمة الأولى تُنتجان ملفًا واحدًا).
  const snapshotBase = testCase.name.split('(')[0].trim().replace(/\s+/g, '_');
  const snapshotVariant = testCase.name.includes('(')
    ? testCase.name.slice(testCase.name.indexOf('(') + 1, testCase.name.lastIndexOf(')')).replace(/\s+/g, '_')
    : '';
  const snapshotName = snapshotBase === 'DaySummaryCard' && snapshotVariant.includes('الحقيقة')
    ? `${snapshotBase}__${snapshotVariant}`
    : snapshotBase;
  if (!testCase.name.includes('MasarMascot')) {
    fs.mkdirSync(path.join(root, 'docs', 'design', 'smoke'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'design', 'smoke', `${snapshotName}.html`), html, 'utf8');
  }
  if (process.env.SMOKE_DUMP === '1') {
    fs.mkdirSync('/tmp/smoke', { recursive: true });
    fs.writeFileSync(`/tmp/smoke/${testCase.name.replace(/[^\w\u0600-\u06FF]+/g, '_')}.html`, html, 'utf8');
  }
  const problems = [];
  if (html.trim().length < 60) problems.push('المخرَج شبه فارغ');
  for (const needle of testCase.expect) if (!html.includes(needle)) problems.push(`نص مفقود: «${needle}»`);
  if (html.includes('NaN')) problems.push('يوجد NaN في المخرَج (حساب فاسد)');
  if (html.includes('undefined')) problems.push('يوجد undefined مطبوع في المخرَج');
  if (problems.length > 0) {
    failures += problems.length;
    console.log(`❌ ${testCase.name}: ${problems.join(' · ')}`);
  } else {
    console.log(`✅ ${testCase.name}: ${(html.length / 1024).toFixed(1)}KB سليم`);
  }
}

// فحص أمني: تبويب التقرير يجب أن يمنع غير المنظّم
const denied = withProviders(React.createElement(CourseReportTab, { course, canEdit: false, batches: [] }));
if (denied.includes('report-title-input') || denied.includes('creport.summaryLabel')) {
  failures++;
  console.log('❌ صلاحيات: تبويب التقرير ظهر لمن لا يملك تعديل الكورس');
} else {
  console.log('✅ صلاحيات: تبويب التقرير محجوب عن غير المنظّم');
}

// فحص المتجر: تسجيل النداءات البديلة يعمل (نتأكد أن الاستيراد لا يفشل)
if (actionCalls.length === 0 && typeof stubActions.saveCourseReport !== 'function') {
  failures++;
  console.log('❌ البديل (stub) لإجراءات الكتابة غير مهيّأ');
}

console.log(`\n${failures === 0 ? '✅ كل الشاشات صيّرت بنجاح' : `❌ ${failures} مشكلة`}\n`);
process.exit(failures === 0 ? 0 : 1);
