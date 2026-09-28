# خطة تطوير مسار (Masar) الشاملة — إمكانية الوصول، التصميم، الحركة، الأسيتس، والسيستم

> **المرجع:** `https://github.com/shaker15s/arena` — الفرع `main` (آخر كوميت `ea3219b`)
> **الموقع المباشر:** `https://rtcc-ruby.vercel.app/`
> **تاريخ التحليل:** 28 سبتمبر 2026
> **المنهجية:** فحص كود فعلي (104 ملف في `src/`) + فحص الموقع المباشر (Lighthouse + DevTools) + ريسرش مباشر في الصناعة — **لا تخمين**.

---

## 0. ملخص النتائج (Executive Summary)

التطبيق **قوي برمجيًا بشكل غير اعتيادي** للغة عربية (Supabase RPCs، RLS، Idempotency، طابور أوفلاين). لكن المشكلة التي وصفها المستخدم دقيقة تمامًا: **الواجهة فخمة بصريًا، لكن إمكانية الوصول بها ثغرات هيكلية خطيرة**، و**بعض التفاصيل الاحترافية مبنية على حلول يدوية قابلة للاستبدال بأسيتس جاهزة**.

### النقاط الإيجابية المكتشفة (لا يجب كسرها)

| المجال | الدليل |
|---|---|
| الأمان | كل الكتابات عبر RPCs `SECURITY DEFINER`؛ لا يوجد مسار كتابة مباشر من العميل (تأكد بالكود: `remote.ts` للقراءة فقط) |
| RTL | `htmlDir: "rtl"` و `lang: "ar"` على الموقع المباشر ✓، `I18nManager` في الملاحة |
| Reduce Motion | نظام كامل في `design/motion.ts` (`observeReducedMotion`, `isReducedMotion`, `reducedMs`) — نادر في تطبيقات عربية |
| الخط العربي | `@expo-google-fonts/ibm-plex-sans-arabic` + `includeFontPadding:false` + `maxFontSizeMultiplier={2}` — معالجة احترافية |
| اللمس | `sizes.touchTarget: 44` و `ctaButton: 52` في التوكنز؛ `hitSlop` على الأزرار |
| الثيم | نظام توكنز دلالي (`actionPrimary` لا `blue500`) + Dark/OLED |
| الاختبارات | 8 ملفات E2E + اختبارات RLS/الأداء/الاختراق + CI |

### الثغرات الرئيسية (مرتبة حسب الخطورة)

| # | الثغرة | الخطورة | الدليل |
|---|---|---|---|
| 1 | **لا توجد عناوين للشاشات** — صفر `header`/`h1`/`h2`، وصفر `role="header"` في كل الكود | 🔴 حرجة | فحص مباشر: `headings: []`، `accessibilityRole="header": 0` |
| 2 | **لا توجد معالم (Landmarks)** — صفر `main`/`nav`/`header` على الموقع المباشر | 🔴 حرجة | فحص مباشر: `landmarks: 0` |
| 3 | **إزالة مؤشر الكيبورد** — كل أنماط `focus` في التطبيق هي `outline: none` بدون بديل | 🔴 حرجة | 3 مواضع فقط، كلها `outlineStyle: 'none'` (انتهاك WCAG 2.4.7) |
| 4 | **175+ أيقونة مزعجة** — 179 استخدام `<Ionicons>`، فقط 3 `accessible={false}` | 🔴 حرجة | قارئ الشاشة يقرأ كل أيقونة زخرفية |
| 5 | **إعلانات الحالة ناقصة** — `accessibilityLiveRegion` مرة واحدة فقط (Toast) | 🟠 عالية | Toast وحده معلن؛ الأخطاء والنجاح في الشاشات صامتون |
| 6 | **تباين ألوان حرج** — `textMuted #8E8E93` على أبيض = 3.1:1 (الحد الأدنى 4.5) | 🟠 عالية | `color={theme.textMuted}` في 157 موضع |
| 7 | **الماسكات "فطن" بسيطة ومكلفة** — 30KB SVG مكتوب يدويًا | 🟡 متوسطة | `MasarMascot.tsx` — قابل للاستبدال بـ Lottie جاهز |
| 8 | **الأنيميشن على JS thread** — `Animated` القديم، `useNativeDriver` غير مستخدم في كل مكان | 🟡 متوسطة | لا يوجد `react-native-reanimated` في `package.json` |
| 9 | **رزمة ويب ضخمة** — 692KB JavaScript ملف واحد لصفحة الأونبوردينج | 🟡 متوسطة | فحص مباشر: `jsBytes: 708144` |

---

## 1. إمكانية الوصول (Accessibility) — الأولوية القصوى

### 1.1 العناوين والمعالم (Headings & Landmarks) — 🔴 P0

**المشكلة:** التطبيق كله يبني الشاشات من `<View>` و `<Txt>` بدون أي تسلسل عناوين أو معالم. مستخدم قارئ الشاشة **لا يستطيع التنقل داخل الشاشة** (لا "العنوان التالي"، لا "القائمة الرئيسية").

**الإصلاح:**
```tsx
// design/components.tsx — Txt تكتسب دعم العناوين
export function Txt({ ..., heading }: { heading?: 'h1' | 'h2' | 'h3' }) {
  return <Text
    accessibilityRole={heading ? 'header' : undefined}
    accessibilityLevel={heading}
    ...
  />
}

// كل شاشة: عنوان رئيسي واحد + معلم
<View accessibilityRole="main" style={{flex: 1}}>
  <Txt variant="h1" heading="h1">{t('today.title')}</Txt>
  ...
</View>
```

**الملفات المستهدفة:** `design/components.tsx` (Txt, Header)، ثم 28 شاشة في `features/`.

### 1.2 مؤشر الكيبورد (Focus Visible) — 🔴 P0

**المشكلة:** `Input` يستخدم `outlineStyle: 'none'` على الويب بدون بديل. مستخدم الكيبورد **لا يرى أين يوجد**.

**الإصلاح (CSS injection للويب يغطي كل العناصر التفاعلية دفعة واحدة — 285 زر):**
```css
/* web-focus.css — تُحقن في index.html */
[role="button"]:focus-visible, [role="tab"]:focus-visible, input:focus-visible {
  outline: 3px solid #007AFF;
  outline-offset: 2px;
  border-radius: 8px;
}
```

### 1.3 الأيقونات الزخرفية — 🔴 P0

**المشكلة:** 179 أيقونة `<Ionicons>`، فقط 3 منها معلَّمة كزخرفية. الباقي يُقرأ كـ "button" أو نص فارغ مزعج.

**الإصلاح — مكوّن أيقونة موحد:**
```tsx
// design/components/Icon.tsx
export function Icon({ name, size, color, decorative = true }: {...}) {
  return <Ionicons
    name={name} size={size} color={color}
    accessible={decorative ? false : undefined}
    aria-hidden={decorative ? true : undefined}
  />
}
```
القاعدة: **الأيقونة الزخرفية = صامتة، أيقونة تحمل معلومة = `accessibilityLabel`**.

### 1.4 إعلانات الحالة (Live Regions) — 🟠 P1

**المشكلة:** Toast وحده معلن. نتيجة "تم تسجيل حضورك" أو "فشل التحقق" **لا تُعلن لمستخدم قارئ الشاشة**.

**الإصلاح:**
- `accessibilityLiveRegion="polite"` على كل عناصر النتائج (نجاح/خطأ التحقق، الحضور، الكودوس).
- `AccessibilityInfo.announceForAccessibility()` للحالات الحرجة (خطأ شبكة، انتهاء صلاحية QR).
- في `ScannerScreen`: إعلان فوري عند `scanned=true`.

### 1.5 تباين الألوان — 🟠 P1

| اللون | الاستخدام | التباين الحالي | الحل |
|---|---|---|---|
| `textMuted #8E8E93` | 157 موضع | **3.1:1** ❌ | غمِّق إلى `#6E6E73` (4.6:1) في Light |
| `accent #F59E0B` | Amber الثانوي | 2.7:1 ❌ | للخلفيات فقط، أو `#B45309` للنصوص |
| `brand #007AFF` | النصوص الزرقاء | 4.0:1 ⚠️ | للوضع المتناقض: `#0040A8` |
| `success #34C759` | نص "ناجح" | 3.2:1 ❌ | `#248A3D` |

**الإصلاح بدون كسر التصميم:** أضف طبقة `theme.textHighContrast` اختيارية + خيار في الإعدادات (مثل تطبيقات آبل).

### 1.6 التنقل بالكيبورد — 🟠 P1

**المشكلة:** صفر `onKeyDown`. التبويبات تعمل باللمس فقط.

**الإصلاح:** RNWeb يحول `Pressable` إلى `role="button"` قابل للتركيز — لكن **التبويبات تحتاج `tabIndex` صريح وترتيب منطقي**. أضف دعم الأسهم في `Segmented` و `Stars`.

---

## 2. التصميم والثيم (Design System)

### 2.1 نقاط القوة الحالية
- توكنز دلالية كاملة (`theme.glassBorder`, `theme.fillStrong`...).
- نظام حركة موثَّق (`motion.ts`): مدد قصيرة + Easing تفاحي + `staggerDelay` محدود.
- مكوّنات موحدة: 31 في `components.tsx` + 5 في `interactive.tsx` + 6 في `glass.tsx`.

### 2.2 التحسينات المطلوبة

| المجال | الوضع الحالي | المطلوب |
|---|---|---|
| **الحاويات الزجاجية** | 16 استخدام `BlurView` + `backdrop-filter` | أضف **عدسة انكسار SVG `feDisplacementMap`** على الويب (الطريقة المعتمدة 2026) |
| **التباين فوق الزجاج** | النص فوق `BlurView` مباشرة | طبقة `isolation: isolate` + خلفية شبه شفافة عالية التباين |
| **الأيقونات** | `Ionicons` (179 استخدام) | ابقَ عليها — متسقة. **لكن وحِّد المكوّن** كما في 1.3 |

### 2.3 الحاجات "اللي مالهاش لازمة"
- **`svgStrings.ts` (56KB)** — رسوم unDraw **مضمنة كنصوص SVG**. تُحمَّل كلها مع الأونبوردينج.
  - **الحل:** ملفات `.svg` منفصلة + `react-native-svg-transformer`، أو رسوم Storyset/Lottie JSON (تُحمَّل عند الطلب).
- **`MasarMascot.tsx` (30KB)** — الماسكات **مرسوم يدويًا بالكامل** (Path/Ellipse/Polygon).
  - **الحل:** استبدلها برسوم Lottie جاهزة (قسم 4).
- **`CloudMascot.tsx`** — سحابة ثانية غير مستخدمة تقريبًا (9 إشارات كلها ذاتية).
- **`lucide-react-native`** — موجود في `package.json` لكن **0 استخدام** في الكود — أزِله.

---

## 3. الحركة والأنيميشن (Motion)

### 3.1 الوضع الحالي
- `Animated` API (القديم) — **يعمل على JS thread**.
- `useNativeDriver: true` في معظم الأماكن لكن **ليس كلها** (`ProgressBar`, `StatRing` تستخدم `false`).
- لا يوجد `react-native-reanimated` ولا `moti` ولا `lottie` في `package.json`.

### 3.2 الترقية الموصى بها (من الريسرش المباشر)

**التسلسل الأمثل حسب PkgPulse 2026:**
```
طبقة التطبيق:  Moti ← تصريحي (from/animate) للانتقالات والSkeletons
    └── Reanimated v3 ← الأساس (worklets على UI thread)
طبقة الرسوم:    React Native Skia ← للانكسارات والمرشحات (اختياري)
```

| المكتبة | الحجم المضاف | متى نستخدمها |
|---|---|---|
| **Reanimated v3** | ~1-2 MB | التفاعلات اللمسية (SwipeRow, Scanner) — بديل `Animated` |
| **Moti** | ~30 KB | انتقالات الظهور/الاختفاء، `AnimatePresence` للمودلات، Skeletons |
| **Skia** | ~4-6 MB | **فقط** للانكسار الزجاجي الحقيقي على الموبايل — وإلا `backdrop-filter` على الويب يكفي |

**التوصية:** ابدأ بـ **Moti + Reanimated**. أجِّل Skia — رزمة كبيرة لمنفذة واحدة.

### 3.3 احترام Reduce Motion (موجود — يجب التوسيع)
`isReducedMotion()` يُستخدم 8 مرات. **يجب أن يغطي:**
- ✅ `ConfettiExplosion` (موجود)
- ✅ `Flame` pulse (موجود)
- ✅ انتقالات التبويبات (`screenOpts.animationDuration`) ✓
- ❌ `AmbientOrb` drift — يحتاج تحقق
- ❌ أي حركة Lottie جديدة — اعرض إطارًا ثابتًا بدل التشغيل

---

## 4. الأسيتس الجاهزة (Ready-Made Assets) — طلب المستخدم الصريح

> المستخدم: *"عايز أسيتس جاهزة مش كل حاجة بالكود — الماسكات بسيطة، الأيقونات، الأنيميشنز"*

### 4.1 الماسكات "فطن" (الأولوية القصوى للأصول)

**المشكلة الحالية:** 30KB SVG مكتوب يدويًا، 12 حالة شعورية مطلوبة، صعوبة الصيانة.

**الحل الموصى به: Lottie JSON جاهز**

| المصدر | الترخيص | الميزات |
|---|---|---|
| **[LottieFiles](https://lottiefiles.com/)** | مجاني للفرد | آلاف الشخصيات المتحركة، محرر بصري، تحكم كامل في الحالات |
| **[Rive](https://rive.app/)** | مجاني + Pro | **أنيميشن تفاعلي بحالات** (state machine) — الأنسب لـ 12 حالة شعورية |
| **مصمم مستقل (Fiverr/Upwork)** | مدفوع | شخصية "صقر مسار" أصلية بـ 12 تعبير |

**التقنية:**
```bash
npx expo install lottie-react-native
```
```tsx
// design/mascot/MascotLottie.tsx
import LottieView from 'lottie-react-native';
export function MascotLottie({ mood, size }: { mood: MascotMode; size: number }) {
  const source = MOOD_TO_FILE[mood]; // 12 ملف JSON منفصل
  return <LottieView
    source={source}
    autoPlay loop={mood === 'idle'}
    style={{width: size, height: size}}
    accessibilityLabel={moodLabel(mood)}
  />;
}
```

**ملاحظة Lottie + Reduce Motion:** اعرض إطارًا ثابتًا (`progress` ثابت) عند `isReducedMotion()` بدل التشغيل التلقائي.

### 4.2 رسوم الأونبوردينج والحالات الفارغة

**المشكلة:** 56KB نصوص SVG داخل `svgStrings.ts` (unDraw).

**الحل:** [**Storyset**](https://storyset.com/) أو [**LottieFiles Illustrations**](https://lottiefiles.com/illustrations):
- ملفات JSON منفصلة (تُحمَّل عند الطلب، تخفض الرزمة).
- قابلة لتغيير الألوان (تتطابق مع `theme.brand`).
- تراخيص مجانية للاستخدام التجاري مع الإسناد.

**التركيب:** انقل ملفات `.json` إلى `assets/lottie/` واستخدم `require()` — Metro يحزمها بشكل منفصل عن JS.

### 4.3 الأيقونات

**التوصية: ابقَ على Ionicons** — متسق بصريًا، 179 استخدام.
- **لكن:** غلِّفها في `Icon` موحد (قسم 1.3) للتحكم في `aria-hidden` مركزيًا.
- **`lucide-react-native` موجود في `package.json` لكنه غير مستخدم إطلاقًا** (0 إشارة) — إما أزِله أو استبدل Ionicons به تدريجيًا (1,700+ أيقونة، tree-shaking أفضل، يتطابق مع Figma).

### 4.4 الأنيميشنز الاحترافية الجاهزة

| الأنيميشن | الحل الجاهز |
|---|---|
| **Confetti** | `react-native-confetti` أو Lottie جاهز بدل `ConfettiExplosion.tsx` (4KB + Math.random في الرندر) |
| **Skeleton** | `moti/skeleton` (مدمج، 0 تكلفة إضافية) بدل `SkeletonLoader.tsx` اليدوي |
| **الاحتفال بالشهادة** | Lottie "certificate success" جاهز |
| **SVG Path Morphing** | Rive (للأشكال المتحركة كالستريك) |

---

## 5. السيستم والفانكشناليتي (System & Backend)

### 5.1 نقاط القوة (مؤكدة بالكود)
- **30 ميجريشن** متسلسل (266KB SQL)، 62 policy RLS، 80+ function.
- **كل الكتابة عبر RPCs** — لا يوجد `.from().insert/update` من العميل (تأكد بالكود).
- **Idempotency** + قيود فريدة + `SELECT ... FOR UPDATE` في `join_batch`، `awardKudos`.
- **طابور أوفلاين** (`offline.ts` + `run_command` RPC) + كاش مربوط بهوية المستخدم.
- **QR أمان**: `qr_seed` غير قابل للـ SELECT، توقيع خادمي، انتهاء صلاحية.

### 5.2 الثغرات المكتشفة

| # | الثغرة | الخطورة | الدليل |
|---|---|---|---|
| 1 | **القراءة الجشعة** — `fetchRemoteDb` يجلب 24 جدولًا دفعة واحدة | 🟠 عالية | `remote.ts`: 24 `Promise.all` |
| 2 | **Realtime قد يعيد التحميل الكامل** — أي حدث قد يُفرغ الـDB ويعيد ملئه | 🟠 عالية | `applyRealtimePatch` موجود لكن `fetchRemoteDb` هو المسار الأساسي |
| 3 | **حد 100 ألف صف** — `MAX_READ_ROWS` كحد أمان بدون pagination للمستخدم | 🟡 متوسطة | `remote.ts` |
| 4 | **`Math.random` في الرندر** — Confetti وCelebrations يعيدون الحساب كل رندر | 🟡 متوسطة | 15 موضع |
| 5 | **20 مؤقت `setTimeout/setInterval`** — احتمال تسرب | 🟡 متوسطة | التأكد من cleanup |
| 6 | **`certPct: 75` كقيمة افتراضية صارمة** — نسبة الشهادة محددة سلفًا | 🟡 منخفضة | `TodayScreen.tsx` |

### 5.3 إصلاحات مقترحة

**5.3.1 قراءة مُجزَّأة حسب النطاق:**
```ts
// بدل fetchRemoteDb واحد:
getToday()          // جدولان فقط
getMyCourses()      // enrollments + batches
getSession(id)      // session + attendance
getLeaderboard(week)
```
(يتوافق مع `get_today` و `list_visible_profiles` الموجودة فعلًا — وسِّع النمط).

**5.3.2 Realtime انتقائي:**
```ts
// بدل إعادة تحميل الكل:
subscribeRealtime('attendance', (row) => updateAttendanceOnly(row));
```

---

## 6. تجربة الهاتف والتنقل (Mobile & Navigation)

### 6.1 الهيكل الحالي
3 أنظمة تبويبات (Student: 4، Volunteer: 5، Admin: 5) + ستاكات منفصلة + **FAB وسطي للماسح**.

### 6.2 التحسينات

| المجال | الوضع | المطلوب |
|---|---|---|
| **عدد التبويبات** | Volunteer و Admin = 5 | ضمن الحد المعقول (آبل ≤6) ✓ |
| **زر FAB** | مُزخرف فقط للطلاب | أضف `accessibilityHint` ("افتح الماسح لتسجيل الحضور") |
| **التنقل بالكيبورد (ويب)** | غير موجود | أضف `tabIndex` للتبويبات |
| **الاختبار على 320px** | غير مؤكد | أضف اختبار E2E على مقاسات 320/375/412 |

---

## 7. الأداء (Performance)

### 7.1 القياسات الفعلية (الموقع المباشر)

| المؤشر | القيمة | التقييم |
|---|---|---|
| DOMContentLoaded | 1,468ms | ⚠️ |
| Load | 1,498ms | ⚠️ |
| حجم JS | **692KB** (ملف واحد) | 🔴 |
| إجمالي الطلبات | 7 | ✅ |
| Lighthouse Accessibility | **100** (الأونبوردينج) | ⚠️ مضلِّل |
| Lighthouse Best Practices | 100 | ✅ |

> **ملاحظة مهمة:** نتيجة 100 **مضلِّلة** — Lighthouse يفحص DOM فقط، ولا يرى غياب العناوين والمعالم لأن React Native Web لا يولِّدها. الثغرات الحقيقية (أقسام 1.1-1.5) لن تظهر في Lighthouse أبدًا.

### 7.2 تحسين الرزمة
- **`svgStrings.ts` (56KB)** → ملفات منفصلة أو Lottie.
- **`MasarMascot.tsx` (30KB)** → Lottie.
- **`lucide-react-native` غير المستخدم** → أزِله.
- **تقسيم الشاشات** — `lazyScreen` موجود لـ 17 شاشة، لكن `svgStrings` و`mascot` **ليست lazy** (تُستورد في `TodayScreen` مباشرة).

---

## 8. خطة التنفيذ (Roadmap)

### المرحلة 1 — أساسيات الوصول (أسبوع 1-2) 🔴
**الهدف: اجتياز فحص قارئ الشاشة على المسارات الأساسية.**

- [ ] **P0-1:** أضف `accessibilityRole="header"` + `accessibilityLevel` لـ `Txt` و`Header` (ملف واحد).
- [ ] **P0-2:** أضف `accessibilityRole="main"` لكل شاشات `features/`.
- [ ] **P0-3:** أنشئ `web-focus.css` بحلقة `:focus-visible` + حقنها في `index.js` (يحل 285 زر دفعة واحدة).
- [ ] **P0-4:** أنشئ مكوّن `Icon` موحد بـ `aria-hidden` افتراضي، واستبدل 179 أيقونة.
- [ ] **P0-5:** أضف `accessibilityHint` للـ FAB وللتبويبات.
- [ ] **تحقق:** فحص VoiceOver/TalkBack على 3 مسارات (دخول → تسجيل حضور → الشهادة).

### المرحلة 2 — الأسيتس الجاهزة (أسبوع 3) 🎨
- [ ] **P1-1:** ثبَّت `lottie-react-native` + استبدل `MasarMascot` (30KB) بملفات Lottie.
- [ ] **P1-2:** استبدل `svgStrings.ts` (56KB) برسوم Storyset/Lottie منفصلة.
- [ ] **P1-3:** ثبَّت `moti` + استبدل `FadeIn`/`StaggeredList`/`SkeletonLoader` بالتدفقات التصريحية.
- [ ] **P1-4:** احذف `lucide-react-native` غير المستخدم (أو استخدمه).
- [ ] **تحقق:** حجم الرزمة < 500KB + Lighthouse ≥ 95.

### المرحلة 3 — الوصول المتقدم (أسبوع 4) 🟠
- [ ] **P1-5:** أضف `accessibilityLiveRegion` لكل نتائج العمليات (تحقق، حضور، أخطاء).
- [ ] **P1-6:** صحِّح تباين `textMuted` و`accent` (أضف طبقة high-contrast).
- [ ] **P1-7:** أضف التنقل بالكيبورد لـ `Segmented` و`Stars` و`TabButton`.
- [ ] **P1-8:** أضف `aria-hidden` للأنيميشنات الزخرفية + احترام Reduce Motion في `AmbientOrb`.
- [ ] **تحقق:** WCAG 2.2 AA على المسارات الأساسية (4.5:1 + 24px target + focus).

### المرحلة 4 — السيستم (أسبوع 5-6) 🔧
- [ ] **P2-1:** جزِّئ القراءة: `getMyCertificates`، `getSessionDetails`... (نفس نمط `get_today`).
- [ ] **P2-2:** Realtime انتقائي بدل إعادة التحميل الكامل.
- [ ] **P2-3:** أصلح `Math.random` في الرندر (استخدم `useMemo`).
- [ ] **P2-4:** راجع 20 مؤقت `setTimeout` للتسرب.
- [ ] **تحقق:** اختبار الأداء على 5000+ سجل (موجود).

### المرحلة 5 — اللمسات الاحترافية (أسبوع 7+) ✨
- [ ] **P3-1:** أضف انكسار `feDisplacementMap` للزجاج السائل على الويب (اختياري).
- [ ] **P3-2:** أضف Rive state machine للماسكات (12 حالة تفاعلية).
- [ ] **P3-3:** Confetti عبر Lottie جاهز.
- [ ] **P3-4:** اختبارات E2E على مقاسات 320/375/412 + كيبورد.

---

## 9. معايير القبول (Release Gate)

| المعيار | الهدف | أداة القياس |
|---|---|---|
| **قارئ الشاشة** | VoiceOver + TalkBack يجتازان 3 مسارات | يدوي على جهاز |
| **التباين** | 4.5:1 لكل النصوص | أداة آلية |
| **الكيبورد** | كل الأزرار قابلة للوصول + focus مرئي | فحص يدوي |
| **Reduce Motion** | كل الأنيميشن تحترم الإعداد | فحص يدوي |
| **حجم الرزمة** | < 500KB | Vercel build |
| **الأهداف اللمسية** | ≥ 44pt | فحص يدوي |
| **Lighthouse** | ≥ 95 في كل الصفحات | آلي |
| **RTL** | محاذاة + أيقونات + قراءة | E2E موجود |

---

## 10. مصادر الريسرش (Research Sources)

| الموضوع | المصدر | الرابط |
|---|---|---|
| **الزجاج السائل** | DEV.to — شرح SDF + feDisplacementMap | [dev.to/childrentime](https://dev.to/childrentime/decoding-apples-latest-liquid-glass-effect-how-to-recreate-ios-design-systems-visual-magic-with-kaj) |
| **الزجاج السائل (الكود)** | GitHub — childrentime/liquid-glass | [github.com/childrentime/liquid-glass](https://github.com/childrentime/liquid-glass) |
| **مرشحات الزجاج** | FreeFrontend — 10+ أمثلة + INP | [freefrontend.com/css-liquid-glass](https://freefrontend.com/css-liquid-glass/) |
| **أنيميشن RN** | PkgPulse — Reanimated vs Moti vs Skia 2026 | [pkgpulse.com](https://www.pkgpulse.com/guides/react-native-reanimated-vs-moti-vs-skia-animation-2026) |
| **مكتبات الأيقونات** | OpenReplay — مقارنة 6 مكتبات | [blog.openreplay.com](https://blog.openreplay.com/) |
| **الأيقونات (القائمة)** | Design Sweets — أفضل 9 لـ React | [designsweets.co](https://designsweets.co/) |
| **Lottie** | LottieFiles الرسمي | [lottiefiles.com](https://lottiefiles.com/) |
| **Rive** | Rive الرسمي | [rive.app](https://rive.app/) |
| **WCAG 2.2** | W3C الرسمي | [w3.org/TR/WCAG22](https://www.w3.org/TR/WCAG22/) |

---

## 11. ملخص نهائي

**التطبيق الحالي:** أساس برمجي ممتاز + تصميم بصري قوي + **ثغرات وصول هيكلية** + **أسيتس مكتوبة يدويًا بدلًا من جاهزة**.

**بعد الخطة:** تطبيق عربي **يستطيع كل المستخدمين استخدامه** (بما فيهم مستخدمو قارئ الشاشة والكيبورد)، **بأسيتس احترافية جاهزة** (Lottie/Rive)، **وأداء أعلى** (رزمة أصغر + حركة على UI thread).

**القاعدة الذهبية لهذا المشروع (كما في مواصفاتك الأصلية):**
> عند التعارض بين **الأنيميشن** و**إمكانية الوصول** — اختر **إمكانية الوصول**.

---

*أُعدِّت هذه الخطة بناءً على فحص فعلي للكود (104 ملف) + اختبار الموقع المباشر + ريسرش مباشر في الصناعة. كل رقم في هذا الملف موثَّق بأداة فحص أو بقراءة كود.*
