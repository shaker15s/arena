# Design Freeze Inventory (Wave 0 Audit) — 2026-10-01

مستند جرد وتجميد عناصر التصميم والطبقات البصرية لمسار وفقًا لقرارات التوجيه المعماري للتصميم (`DESIGN_ARCHITECTURE_DIRECTIVE_2026-10-01.md` §27 و§10 و§12 و§15 و§35).

---

## 1. استخدامات الـ Blur والزجاج (`BlurView` / `backdropFilter`)

| الملف:السطر | المكوّن | النوع | القرار المقترح | السبب والمرجع بالتوجيه |
|---|---|---|---|---|
| `src/app/RootNavigator.tsx:310` | TabBar background | `BlurView` (intensity 55/80) | **keep** | عنصر FunctionalGlass عائم مسموح به (§4/§27). سيُلف لاحقاً بـ `FunctionalGlass` نوع `tabBar`. |
| `src/design/components.tsx:172` | Modal / Sheet backdrop | `BlurView` (intensity 25) | **keep** | خلفية Modal معتمة عائمة مسموح بها ضمن `FunctionalGlass` نوع `sheet` (§27). |
| `src/design/components.tsx:1189` | ActionSheet backdrop | `BlurView` (intensity 12/20) | **keep** | نافذة منبثقة عائمة، مسموح بها ضمن FunctionalGlass (§27). |
| `src/design/glass.tsx:41` | `GlassSurface` | `BlurView` | **refactor** | الحاوية الأساسية للزجاج؛ يجب حصر استخدام `intensity > 0` على `FunctionalGlass` فقط وفرض `intensity = 0` لطبقة المحتوى `Surface` لمنع تشويش النصوص (§2/§4). |
| `src/features/auth/AuthScreens.tsx:22` | شاشة الدخول | `BlurView` import | **delete** | استيراد مهمل غير مستخدم في جسم الملف (§27). |

---

## 2. ألوان `rgba` غير المقيدة في طبقة الميزات (`src/features`)

| الملف:السطر | المكوّن | القيمة | القرار المقترح | السبب والمرجع بالتوجيه |
|---|---|---|---|---|
| `src/features/attendance/ScannerScreen.tsx:376,574,576,648,666,679,697,699,705,712,713` | كاميرا الماسح والأطر | `rgba(15,23,42,...)` و `rgba(56,189,248,...)` | **keep (whitelisted)** | شاشة الماسح استثناء وظيفي بصري محدد في التوجيه (`FunctionalGlass` kind scanner) مع توحيدها إلى توكنات السطح لاحقاً (§4/§27). |
| `src/features/attendance/SessionCompleteCelebration.tsx:130-154` | بطاقة احتفال الإقفال | `rgba(245, 158, 11, ...)` | **refactor** | استبدالها بـ `theme.goldSoft` و `theme.surfaceGold` والاعتماد على توكنات الثيم الرسمية بدلاً من hardcoded rgba (§11). |
| `src/features/auth/AuthScreens.tsx:709,714` | نموذج الدخول | `rgba(255,255,255,...)` | **refactor** | استبدالها بـ `theme.card` و `theme.fillBorder` لمنع تباين عشوائي بين الثيمات (§11). |
| `src/features/explore/ExploreScreens.tsx:221-267,440-466` | بطاقات المساقات والتفاصيل | `rgba(255,255,255,...)` و `rgba(0,0,0,...)` | **refactor** | تحويل الشارات والبطاقات لتوكنات `theme.badgeText` و `theme.fill` و `tokens.surfaces` (§10/§27). |
| `src/features/gamification/GamificationScreens.tsx:82-85` | محفظة النقاط | `rgba(255,255,255,0.18)` | **refactor** | استبدالها بـ `theme.brandSoft` أو توكن الشارة (§11). |
| `src/features/today/TodayScreen.tsx:257-281,317-376,442-518` | بطاقة الجلسة الحية والستريك | تدرجات `rgba` ذهبية وخضراء | **refactor** | توحيدها داخل `Surface` بـ `emphasis="hero"` وبألوان Semantic (`actionSuccess` / `warning`) بدون ألوان يدوية (§10/§11). |
| `src/features/volunteer/LiveSessionScreen.tsx:309-414,654` | بطاقات التحكم المباشر والعداد | ألوان زجاجية `rgba(...)` مكررة | **refactor** | استبدال الحاويات بـ `Surface` عادية ونقل الخلفيات العائمة إلى `FunctionalGlass` مع ربطها بـ `theme.fill` (§27). |
| `src/features/volunteer/VolunteerScreens.tsx:105` | شارة الكورس في الجلسة | `rgba(255,255,255,0.85)` | **refactor** | توحيد إلى `theme.textSecondary` (§10). |

---

## 3. الحركات اللانهائية والمؤقتات (`Animated.loop` / `setInterval`)

| الملف:السطر | المكوّن | النوع | القرار المقترح | السبب والمرجع بالتوجيه |
|---|---|---|---|---|
| `src/design/animations/DynamicStreakFire.tsx:54,72,90,108` | شعلة الستريك (4 حلقات) | `Animated.loop` ×4 | **refactor** | دمج الحلقات الأربع في حركة مركبة واحدة وحمايتها بـ `isReducedMotion` (ميزانية الحركة: ≤2 continuous per screen) (§15/§18/§20). |
| `src/design/animations/ShimmerProgressBar.tsx:30` | شريط التقدم اللامع | `Animated.loop` | **keep** | إضافة `isReducedMotion` guard لتعطيل اللمعان اللانهائي عند تفعيل تقليل الحركة (§18). |
| `src/design/components/AnimatedShinyText.tsx:62` | نص لامع | `Animated.loop` | **keep** | حماية بـ `isReducedMotion` (§18). |
| `src/design/components/BorderBeam.tsx:86` | إطار مشع | `Animated.loop` | **relocate/restrict** | مقصور فقط على أحداث الإنجاز الكبرى (شهادة/حضور/ترقية) وممنوع في البطاقات الدائمة (§10/§27). |
| `src/design/components/HeroCard.tsx:42` | بطاقة البطل | `Animated.loop` | **delete** | إيقاف التوهج اللانهائي في البطاقات الثابتة، واستبداله بتفاعل ضغط فقط (§15). |
| `src/design/components/NotificationBell.tsx:48` | جرس الإشعارات | `Animated.loop` (pulse) | **refactor** | تشغيل النبض لعدد محدد من المرات (3 مرات) عند وصول إشعار جديد بدلاً من حلقة لا نهائية (§15). |
| `src/design/components/SkeletonLoader.tsx:43` | وميض التحميل | `Animated.loop` | **keep** | مؤقت هيكلي مؤقت يتوقف فور تحميل البيانات (§31). |
| `src/design/mascot/MasarMascot.tsx:239,264,296,315,370` | تميمة فاتن (طفو، إمالة، احتفال، شعلة) | `Animated.loop` | **refactor** | حصر حركات الطفو في حركة ناعمة واحدة وتقييدها بـ `isReducedMotion` (§12/§18). |
| `src/design/mascot/MasarMascot.tsx:347` | طرف العين (رمش) | `setInterval` | **keep** | وميض طبيعي متباعد (كل 3-4 ثوان) خفيف التكلفة. |
| `src/features/attendance/ScannerScreen.tsx:122,135,148` | رادار الماسح الضوئي | `Animated.loop` | **keep** | مؤشر مسح تفاعلي ضروري أثناء نشاط الكاميرا فقط ويُلغى عند الإغلاق (§27). |
| `src/features/auth/AuthScreens.tsx:93` | خلفية الدخول المتحركة | `Animated.loop` | **refactor** | تقليص الحركة لأورب ثابت أو انزلاق بطيء أحادي (§12). |
| `src/features/notifications/NotificationsScreen.tsx:176` | تذكير معلق | `Animated.loop` | **refactor** | إيقاف التكرار اللانهائي وجعله نبضة واحدة عند الظهور (§15). |
| `src/features/volunteer/LiveSessionScreen.tsx:64` | مؤقت الجلسة الحية (500ms) | `setInterval` | **relocate (T9)** | نقل المؤقت إلى Ticker مركزي موحد (1000ms بدلاً من 500ms) لتقليل إجهاد المعالج (§30/T9). |

---

## 4. التدرجات اللونية في الميزات (`LinearGradient` في `src/features`)

| الملف:السطر | الشاشة / المكوّن | القرار المقترح | السبب والمرجع بالتوجيه |
|---|---|---|---|
| `src/features/auth/AuthScreens.tsx:226,600` | أزرار وخلفيات الدخول | **refactor** | استخدام أزرار `Btn` نوع `primary` ذات لون صلب موحد (`theme.actionPrimary`) بدون تدرج (§5/§9). |
| `src/features/explore/ExploreScreens.tsx:187,280` | بطاقة المقرر المميز | **refactor** | تحويلها إلى `Surface emphasis="hero"` وتجنب التدرجات الحادة فوق النصوص (§2/§10). |
| `src/features/gamification/GamificationScreens.tsx:75,93` | بطاقة رصيد المحفظة | **keep / consolidate** | تدرج وحيد خاص ببطاقة الإنجاز، مع نقل التدرج إلى توكن موحد في `tokens.ts` (§11). |
| `src/features/today/TodayScreen.tsx:267,280,413,466` | بطاقة اليوم والجلسة الحية | **refactor** | توحيد بطاقات اليوم تحت `Surface` / `ElevatedSurface` وإزالة التدرجات المزدوجة المتداخلة (§4/§10). |

---

## 5. مراجعة التوكنات والازدواجية (Wave 1 Blueprint)

1. **`glassLevels`**:
   - حاليًا: 5 مستويات تتكرر فيها القيم (`thin` == `subtle`, `thick` == `heavy`).
   - القرار المقترح في T5: استبدالها بـ 4 مستويات دقيقة بلا تكرار (`clear`, `regular`, `floating`, `sheet`).
2. **`elevation`**:
   - حاليًا: ازدواجية بين الأرقام `0..4` والأسماء `none, sm, md, lg, modal`.
   - القرار المقترح في T5: إبقاء الترقيم القياسي الموحد وحذف الأسماء المكررة.
3. **`LiquidGlassCard`**:
   - حاليًا: بطاقة استعراضية تحتوي على طبقات زجاجية غير وظيفية.
   - القرار المقترح في T5: وضع علامة `@deprecated` عليها وتحويلها كغلاف بسيط لـ `ElevatedSurface emphasis="hero"` ثم إحلال `ElevatedSurface` مكانها في كامل المستودع.
4. **أزرار `Btn` و `GlassBtn`**:
   - حاليًا: تشتت بين `Btn` و `GlassBtn` بمقاسات متفاوتة (`sm` = 38px أحياناً).
   - القرار المقترح في T5: توحيد نظام الأزرار إلى 4 أنواع حصرية (`primary`, `secondary`, `tertiary`, `glass`) وفرض حد أدنى لمنطقة اللمس 44×44px لجميع الأزرار بما فيها `sm` توافقاً مع WCAG 2.5.5.
