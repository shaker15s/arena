# 🦅 مسار — برومبت المتبقي (نسخة محدَّثة · 29 سبتمبر 2026)

> **كيف تستخدم هذا الملف:** انسخه كما هو إلى أي وكيل/مهندس (أو استخدمه كمرجع جلسة) ليكمل ما تبقّى من
> `MASAR_MASTER_PLAN_2026-09-28.md`. كل بند هنا **مبني على قياس فعلي في المستودع**، ومعه: الحالة بدليل،
> المطلوب بدقة، معيار القبول، وأمر التحقق. لا بند بلا دليل، ولا رقم بلا مصدر.
>
> **الفرع:** `arena/01a0e854-arena` · **الحزمة:** Masar 3.2.0 · **آخر كوميت مُدفوع:** `0c24be7`
> **معاينة حيّة:** `node scripts/serve-dist.js 8081` (0.0.0.0) · **الخطة الأم:** `MASAR_MASTER_PLAN_2026-09-28.md`
> **سجل ما نُفِّذ:** `docs/EXECUTION_LOG.md` (أقسام 7–10 آخر تحديث).

---

## 0) المهمة في سطرين

وصلنا المنتج إلى **إمكانية وصول WCAG 2.2 AA على المسارات الذهبية + فانكشناليتي FUNC-01→20 مغلقة وظيفيًا
على الخادم والواجهة (عدا بنود مذكورة) + أداء مقيس مُحسَّن** — والمتبقي هو: **استكمال الأداء والبصريات
والأصول وRBAC/الأوفلاين/Dynamic Type/التقسيم والمراقبة وبوابات الإصدار** حتى تصبح G-1…G-8 كلها خضراء.

**تعريف «منجَز»:** البند الذي له (1) كود مدمج، (2) أمر تحقق مُشغَّل يظهر ناتجه، (3) رقم/دليل مقيس،
(4) تحديث `docs/EXECUTION_LOG.md`. ما لا يُقاس (VoiceOver/TalkBack/جهاز حقيقي/مشروع Supabase) يُكتب
صراحةً «لم يُقَس هنا» مع خطوات التحقق اليدوي — **ممنوع ادعاء الإنجاز**.

---

## 1) حالة البداية المقيسة (لا تعتمد إلا عليها)

| المقياس | القيمة الحالية | أمر إعادة التوليد |
| --- | --- | --- |
| runtime مجدول | Masar 3.2.0 (RN 0.86 · Expo SDK 57 · React 19 · TS strict) | `package.json` |
| حزمة الويب | **3.7MB / 29 ملفًا** · الحزمة الأساسية **2,225,772B خام = 588KB gzip** (+chunk ثانٍ 45KB) · **JS كلي ≈ 603KB gzip** (الميزانية 300KB) · خطوط **1.26MB/5** (4 أوزان عربي 907KB + Ionicons 381KB) | `npm run export:web && find dist -type f \| wc -l` · `gzip -c dist/_expo/static/js/web/index-*.js \| wc -c` |
| خزائن النصوص | **1147 مفتاحًا** (عربي/إنجليزي متطابقان) | `npm run parity` |
| عربي مضمّن في الكود | **104 نصًا في 22 ملفًا** (سقف متدرّج يمنع أي زيادة) | `npm run i18n:lint` |
| بوابات ثابتة | typecheck · **a11y: 52 عنصر ضغط · 192 `<Icon>` · 40/40 عنوان h1 · 0/0** · **hooks: 188 مكوّنًا · 0 مخالفة** · contrast **51×3** · rpc:check **65 نداء عميل عبر 114 دالة خادم** · rpc:types **84** · sql:check **0 نحوي / 0 بنيوي / 0 بلا تحكم وصول** · pentest **143/150 نسبة heuristic** | `npm run test:all` |
| اختبارات | engine 68 · search 32 · calendar 27 · rls · perf · pentest · load · **e2e 62/62** | `npm run test:all` |
| شاشات h1 | **40/40** · أيقونات موحّدة: **192 <Icon>** · عناصر ضغط مفحوصة: 52 · مكوّنات مفحوصة: 188 | `npm run a11y` |
| سجل Faten | **65 عبارة محوّلة إلى i18n** (`mascot.p.*`) + نصوص المحرّك (`mascot.*`) | `npm run parity` |

**أُغلق فعليًا ولا يُعاد فتحه:** FUNC-01 (Apple) · 03 (ICS) · 05 (نزاع الحضور) · 06 (كشك) · 07 (بحث عربي) ·
09 (لوحة «يحتاج تدخلك») · 10 (إعدادات) · 11 (Quiet hours) · 12 (تقرير أسبوعي) · 15 (مرجع العطل) ·
16/20 (توقيت ومنطقة) · 17 (تدقيق التلاعب) · 02/04 (خادميًا مع تحفظ موثّق) + تقوية **46 دالة** بلا GRANT حادث.

---

## 2) القواعد الصارمة (خرق أي بند = رفض العمل)

1. **ممنوع أي برميل (barrel)**: `@expo/vector-icons` أو `@expo-google-fonts/*` تُستورد **من مسارها المباشر**؛
   أي استيراد برمي أعاد 4MB للـdist سابقًا.
2. **ممنوع أي قيمة تصميم** (لون/مسافة/زاوية/ظل/سماكة) خارج `src/design/tokens.ts`.
3. **أي مفتاح i18n جديد** يُضاف للقاموسين قبل تنفيذ كود يستخدمه (وإلا يفشل `typecheck` بـTS1117/TS2322)،
   ولا مفتاح مكرر (grep قبل الإدراج)، ولا apostrophe مفتوحة داخل اقتباسات مفردة.
4. **ممنوع hook بعد إرجاع مبكر** — بوابة `npm run hooks:check` تفشل.
5. **ممنوع `SECURITY DEFINER` بلا `SET search_path`**، وكل دالة جديدة بـ`REVOKE/GRANT` صريح
   (بوابة `npm run sql:check`).
6. **كل RPC جديد** يدخل `scripts/check-rpc-contract.js` + يُولَّد نوعه (`npm run rpc:types`) + اختبار عقد.
7. **لا `selectAll` جديد** لأي جدول نامٍ (معيار DATA-13) — القراءة عبر RPC/View بترقيم Cursor.
8. **لا نص عربي مضمّن جديد**: بوابة `i18n:lint` تفشل لو زاد سقف أي ملف.
9. **لا ادعاء بلا قياس**: كل رقم يُذكر يُرفَق به الأمر وناتجه، وما يحتاج جهازًا/مشروعًا يُكتب «لم يُقَس».
10. **الرد بالعربية (مصري)** وأسماء الكود بالإنجليزية، وكل دفعة تنتهي بـ (تعديل ⇒ أمر ⇒ ناتج ⇒ سجل).

**أخطاء سابقة لا تُعاد:** كتلة `import {}` فارغة بعد استبدال نصي · عدد حروف عربية داخل تعليقات JSX
(البوابة تُنقّي التعليقات) · إعادة تعريف دالة في نفس الملف بلا تعليق مبرِّر · `NULLS NOT DISTINCT`
(لا يدعمها المحلّل — البوابة تُعيِّره قبل التحليل).

---

## 3) أوامر التحقق (البوابة الكاملة)

```bash
npm run typecheck && npm run a11y && npm run hooks:check && npm run contrast && npm run i18n:lint \
&& npm run parity && npm run rpc:check && npm run sql:check && npm run rpc:types \
&& npm run test:engine && npm run test:rls && npm run test:search && npm run test:calendar \
&& npm run test:perf && npm run test:pentest && npm run test:load && npm run test:e2e
```
`npm run test:all` يقوم بكل ما سبق. ويُضاف عند تغيير الحزم: `npm run export:web`.
**ملاحظة بيئة:** `node_modules` قد يُمحى بين الجلسات — `npm install --ignore-scripts --no-audit` يعيده في ~16s.

---

## 4) المتبقي — برنامج إمكانية الوصول (A11Y)

| # | الحالة الآن (بدليل) | المطلوب بدقة | معيار القبول | التحقق |
| --- | --- | --- | --- | --- |
| **A11Y-03/05** معالم الشاشة | `SemanticScreen` مستعملة في **ملف واحد** (`RootNavigator.tsx`) — تغلّف المحتوى الرئيسي فقط | تغليف جذر **40 شاشة** بـ`<Screen label={...}>` + `<Section title>` للأقسام + `banner` لرأس الشاشة + `navigation` للتبويبات | لكل شاشة: `main` واحد + تسلسل h1→h2→h3 بلا تخطٍّ | سكربت جديد في `check-a11y.js`: يفحص وجود `<Screen` في كل `export function *Screen` |
| **A11Y-12** التركيز غير محجوب | على الويب: `scroll-padding-bottom:140px` موجودة. على native: **لا شيء** | على الجوال: إخفاء/تحريك FAB عندما يكون العنصر المُركَّز قريبًا من الحد السفلي (أو `contentContainerStyle` بذيل يساوي height الشريط+FAB) | اختبار آلي: `Tab` عبر الشاشة ⇒ لا عنصر مُركَّز مغطّى (`elementFromPoint`) | Playwright script جديد + قياس ذيل السكرول لكل شاشة |
| **A11Y-13/14/15** التركيز والمودالات | `useFocusTrap` مستخدم في **4 مواضع**: `components.tsx` (Sheet) · `celebrations.tsx` (×2) · `SessionCompleteCelebration.tsx` | جرد كل نافذة/ودجة (Sheet/Modal/Confirmation) والتأكد أن كل واحدة: trap + Escape + إرجاع تركيز + `aria-modal` | لا مودال بلا trap | سكربت: كل `<Sheet`/`Modal` يقابلها `useFocusTrap` في نفس الملف |
| **A11Y-30→35** قارئ الشاشة | `Icon` موحّد (192 استخدامًا) و`decorative ?? !label` ✅ · `announce.ts` موجود | (أ) سياسة `aria-live` معلنة: عدّاد الجلسة الحية `polite` · أخطاء الحفظ `assertive` · (ب) إعلان تغيّر الفلاتر/نتائج البحث بعدّاد | كل تغيّر مهم يُعلَن مرة واحدة بلا إغراق | اختبار RNTL + مراجعة `announce.ts` مع كل شاشة حيّة |
| **A11Y-40→42** اللمس والسحب | `SwipeRow` **غير مستخدم إطلاقًا** (`<SwipeRow` = 0) — فلا خطر 2.5.7 حاليًا | قرار: (أ) حذف المكوّن غير المستخدم، أو (ب) إن تبنّيناه: زر «…» يفتح Action Sheet بنفس الإجراءات + أزرار ± للمنزلقات/النجوم | 0 هدف لمس < 24px · كل سحب له بديل ضغط | Playwright: قياس `getBoundingClientRect` لكل عنصر تفاعلي على 3 مقاسات |
| **A11Y-45→48** النماذج | **0 autoComplete/textContentType** في المستودع | إضافة `autoComplete` على كل حقل (`tel`/`email`/`name`/`one-time-code`) + `aria-invalid` + `aria-errormessage` + عدم حجب اللصق + وضوح رسائل الخطأ كإرشاد | حقول المصادقة والملف الشخصي كاملة | فحص ثابت في `check-a11y.js` (حقل بلا autoComplete في نماذج المصادقة = خطأ) |
| **A11Y-50→53** الحركة | تقليل الحركة صار **إعدادًا مركزيًا** (`design/preferences` + `setReducedMotion`) والتميمة تحترم `isReducedMotion` في 4 مواضع | (أ) إيقاف كامل لـ`AmbientOrb` في reduce-motion وعلى الأجهزة الضعيفة · (ب) إطار ساكن للتميمة بدل الأنيميشن · (ج) تحقق 2.2.2 (لا محتوى متحرك > 5s بلا إيقاف) | مسار Playwright بـ`reducedMotion:'reduce'` ⇒ لا حركة دائمة | Playwright + `grep AmbientOrb` |
| **A11Y-60→66** النص العربي | `maxFontSizeMultiplier=1.4` في **ملفين فقط** (`Odometer`, `glass.tsx`) | Dynamic Type حتى 200% بلا قصّ · منع `letterSpacing` على نص عربي · `formatNumber` موحّد للأرقام · FSI/PDI (U+2068…U+2069) لأي نص يخلط سكود/سيريال بأرقام · `lang="en"` للنصوص الإنجليزية المضمّنة | لا نص مقصوص على 7 مقاسات | سكربت grep (letterSpacing عربي) + screenshots 7 مقاسات |
| **A11Y-70** الأجهزة الحقيقية | لم يُقَس | 3 مسارات ذهبية: iPhone/VoiceOver · Android/TalkBack (+وضع الطيران) · ويب NVDA — مكتوبة في ملحق G | تقرير موثّق بالفيديو + تصنيف شدة | يدوي — خارج هذه البيئة |
| **بوابات A11Y** | `check-a11y` ثابت (7 فحوص) + `check-contrast` | إضافة: `axe-core` على 12 مسارًا · `eslint-plugin-react-native-a11y` · `@testing-library/react-native` (+`jest-axe`) | axe: 0 critical/0 serious | CI (Job 3) |

---

## 5) المتبقي — صقر فطن 3.0 (MASCOT)

| # | الحالة الآن | المطلوب | معيار القبول |
| --- | --- | --- | --- |
| **M1** i18n | ✅ **منجز**: 65 عبارة `mascot.p.{state}.{i}` + 27 نص محرّك (`mascot.*`) + `tStatic/getLang` بلا react-native | — | parity 1147 ✅ |
| **M2** مثيل واحد | مستخدَم في عدة شاشات بلا مزوّد مركزي | `MascotProvider` + `MascotStage` (مثيل واحد فقط على الشاشة) + إيقاف النسخ المتعددة | لا انحدار بصري · زمن إقلاع ≤ 50ms · `grep -c "<MasarMascot"` = موضع واحد |
| **M3** fallback ثابت | SVG/Animated متعدد | `MascotSvgFallback` محسّن + إطارات ساكنة لكل حالة (12) في reduce-motion + بديل نصي لقارئ الشاشة | 12/12 حالة لها إطار ثابت |
| **M4/M5/M6** Rive | **لا Rive/Lottie في التبعيات** | تعاقد فنان حسب §4.5 ⇒ `faten_v1.riv` خلف **Feature Flag** بإطلاق 10→50→100% ⇒ حذف القديم | 60fps · ≤200KB للأصل · صفر أعطال جديدة · rollback موثّق |

**ميزانيات §4.6:** حجم أصل ≤ 200KB · ذاكرة ≤ 12MB · زمن تبديل حالة ≤ 16ms · لا يعمل خارج الشاشة.
**§4.7 وصول:** التميمة `aria-hidden` زخرفيًا مع بديل نصي دلالي · لا تسرق التركيز · تُسكَت في reduce-motion.

---

## 6) المتبقي — الديزاين (DESIGN)

| المجال | الحالة | المطلوب |
| --- | --- | --- |
| **DESIGN-01→08** توكنز v2 | موجود: `focusRing` · `touchTarget 44` · `ctaButton 52` · `timeField` · `uiScale` · `radii` · `spacing` · `springs` | إضافة: `minTarget:24` · `iconButton:44` · `elevation.0→4` · `zIndex` سلّم معلن · `glass.levels{thin,regular,thick}+fallback` · `motion.duration/easing` · `typeScale` · `tabularNums` |
| **DESIGN-10→15** تايبوغرافي | 4 أوزان IBM Plex Sans Arabic مباشرة (1.26MB) · `scaleType` يحترم حجم المستخدم | subset `woff2` عربي/لاتيني + `font-display: swap` + `preload` للوزن الأول (+`size-adjust` لتقليل CLS) · `tabular-nums` على كل رقم متغيّر · حالات 320px/768px+ · منع `uppercase/justify` |
| **DESIGN-20→24** تخطيط | نقطتا كسر 780/940/1120 في التبويبات | معالجة 320–359 (نص 14) · Sidebar للمنظمة ≥768 · حاوية `max-width:1120` + شبكة 12 عمودًا + **جداول حقيقية** ≥1024 بدل الكروت الممدودة · `KeyboardAvoidingView`/`adjustResize` |
| **DESIGN-30→40** مكوّنات | 31 + 5 + 6 موجودة | ناقص: `Screen`(دلالي) · `Section` · `DataTable` · `EmptyState` موحّد · `ErrorState` (سبب+إجراء+**رمز مرجعي**) · `OfflineBanner` موحّد · `UndoToast` (6 ثوانٍ) · `ActionSheet` · `FocusTrap`+`SkipLink` (موجودان) · `Announce` · `Stepper` · `Tooltip` · + **State Coverage**: loading/empty/error/offline/partial لكل شاشة |
| **DESIGN-45→50** تنقّل ومعلومات | SPA بلا مسارات · `document.title` **غير مضبوط في أي مكان** | مسارات قابلة للمشاركة (`/today`, `/course/:id`, `/certificate/:serial`, `/verify/:serial`, `/admin/*`) عبر ADR-01 (WEB-11) · `document.title` لكل شاشة من i18n · `meta description` + `og:*` لصفحة التحقق · deep links `masar://` + Universal/App Links |
| **5.7 حِرفة بصرية** | — | سقف **2 BlurView** لكل شاشة · `AmbientOrb` ≤2 وتُعطَّل على الأجهزة الضعيفة · تدقيق شبكة 4pt لكل شاشة · أيقونات 24px بسماكة 2px متساوية · OLED: لا ظلال (حدود `rgba(255,255,255,.08)`) · تحسين أول 3 ثوانٍ (Onboarding) |

---

## 7) المتبقي — الفانكشناليتي (FUNC)

| # | الحالة (بدليل) | المطلوب | معيار القبول |
| --- | --- | --- | --- |
| **FUNC-13** PNG | الشهادات تستخدم `expo-print` (`printAsync`) ⇒ تُخرج PDF لا PNG | تصدير PNG حقيقي للشهادة/الإنجاز (مقاسات @1x/@2x/@3x) على الويب (`canvas.toBlob`) وnative (`react-native-view-shot` أو بديل) | الملف الناتج `.png` فعليًا وبالجودة — يفتح كصورة |
| **FUNC-04** PDF/QR/Open-Badges واجهيًا | الخادم جاهز (`public_badge_assertion`)؛ الشاشة لا تعرضه | قالب PDF عربي بجودة طباعة (A4، هوامش، خط مُدمج) + **QR بموضع ثابت** لا يتحرك مع الطول + زر «شهادة Open Badges» يشارك JSON قابل للتحقق | تحقق خارجي: `verify_badge_assertion` = valid + PDF عربي بلا قطع حروف |
| **FUNC-15** رمز العطل واجهيًا | الخادم يعيد `MSR-XXXXXX`؛ `SupportScreen` لا يعرضه | شاشة الدعم: (أ) نموذج بلاغ يعرض المرجع بعد الإرسال، (ب) للمشرف: `get_error_by_ref` + ربط التذاكر `support_requests` بـ`client_errors` | المستخدم يقتبس رمزًا يجده الفريق |
| **FUNC-08** الأوفلاين | طابور + كاش موجودان (`shared/offline.ts`, `command_queue`) · **واجهة موحّدة غائبة** | واجهة لكل أمر: «قيد الإرسال/فشل/أُعيد الإرسال» + سقف عمر 7 أيام + إعادة بتراجع أسّي + سياسة تعارض معلنة (الكتابات الحسّاسة خادمية فقط) + اختبار وضع الطيران بلا تكرار | سيناريو E2E: طيران ⇒ حضور ⇒ عودة ⇒ لا تكرار |
| **FUNC-18** كود الانضمام | إدخال نصي عادي | إدخال أرقام كبير + لصق ذكي + `one-time-code` + تحقق فوري | ينضم في ≤ 10 ثوانٍ |
| **FUNC-19** صلاحيات الواجهة | مراجعة غير مكتملة | جرد كل عنصر UI مقابل الدور: لا زر بلا صلاحية (إخفاء لا تعطيل للعناصر غير المتاحة أصلًا) | مصفوفة دور×عنصر موثّقة |
| **FUNC-02** النشر | الدالة موجودة، **غير منشورة**؛ كل شيء جاهز + cron موثّق في الترويسة | نشر `push-dispatch` + السر + جدولة كل دقيقة + اختبار جهاز حقيقي + تجميع digest الفعلي (عمود `digest_enabled` موجود بلا مهمة) | إشعار يصل جهازًا ويُسجَّل `settle_push_batch` |
| **FUNC-03** توسيع ICS | زر «أضف للتقويم» للجلسة القادمة فقط | تصدير **جدول المجموعة كاملًا** (كل الجلسات المتبقية) + زر في خريطة الرحلة | ملف ICS واحد بكل الجلسات يظهر في Google Calendar |
| **FUNC-10/16** بقايا | الشاشة كاملة | قراءة المنطقة الزمنية الحالية من الملف عند الفتح (لا تبدأ دائمًا على Cairo) + توحيد `formatNumber` بين الشاشتين | لا تاريخ يختلف بين شاشتين |

---

## 8) المتبقي — الداتا والخادم (DATA) 🔴 الأولوية القصوى أمنيًا

| # | الحالة الآن (بدليل) | المطلوب | معيار القبول |
| --- | --- | --- | --- |
| **DATA-01** | **16 موضعًا** بـ`auth.uid()` غير ملفوفة، و**0** موضع بـ`(SELECT auth.uid())` | لفّها + `TO authenticated`/`anon` صريحة على كل سياسة | `EXPLAIN` يظهر InitPlan · `supabase db lint` نظيف |
| **DATA-02** | `USING (TRUE)` على: `profiles, point_events, streak_weeks, gamification, user_badges, league_weeks, certificates, courses/enrollments(0004 مصفوفات) …` (10+ سياسات) | إلغاؤها والمرور عبر RPC/View مخصّص؛ `certificates` تبقى للطالب/الطاقم والتحقق عبر `verify_certificate` | اختبار RLS: مستخدم عادي **لا** يقرأ بيانات غيره |
| **DATA-03** | ✅ تحليل فعلي: **0** دالة `SECURITY DEFINER` بلا `search_path` (مُقاس بمحلّل حقيقي على 31 ملف ترحيل) — لكن بوابة `security-pentest.ts` تقيس **نسبة عدّ نصي** (`search_path = public, pg_temp` = 143 مقابل `SECURITY DEFINER` = 150 ≥ 90%) وهي heuristic قد تمرّ مع مخالفة حقيقية | **إضافة البوابة** إلى `check-sql.js` بتحليل حقيقي (0 مخالفة) وإبقاء نسبة pentest كخط ثانٍ | السكربت يفشل عند إدخال دالة مخالفة عمدًا |
| **DATA-04** | `0025_rpc_rate_limits` + `_rate_limit_exceeded` موجودان | تغطية كل RPC كتابة (`check_in`, `join_batch`, `award_kudos`, `create_certificate`, `run_command`) + استجابة 429 واضحة | اختبار حمل: لا تجاوز |
| **DATA-10→13** | **8 RPCs غائبة كليًا**: `get_my_wallet` · `get_leaderboard` · `list_notifications` · `get_admin_overview` · `get_course_detail` · `get_session_detail` · `list_pending_actions` · `get_my_home` — و`fetchRemoteDb` ما زال يجلب ~24 مصدرًا (منها `sessions` بحدّ 4000 صفّ و`notifications` 500) | تنفيذها بـCursor + أعمدة آمنة + matview للمتصدرين · استبدال `fetchRemoteDb` في 3 مسارات (اليوم/الشهادات/المحفظة) · **قاعدة CI**: أي `selectAll('attendance'\|'point_events'\|'notifications'\|…)` جديد = فشل | p95 ≤ 250ms على 100k صف · لا `selectAll` في المسارات المستهدفة |
| **DATA-20→26** | لا فهارس RLS/BRIN جديدة · لا matviews · لا `statement_timeout` معلن | فهارس: `attendance(user_id, created_at DESC)`, `attendance(session_id,status)`, `point_events(user_id, created_at DESC)`, `notifications(user_id) WHERE read_at IS NULL`, `sessions(batch_id, starts_at DESC)`, `enrollments(batch_id,user_id)` + BRIN على `created_at` + matviews `mv_leaderboard_week/mv_admin_overview/mv_batch_stats` + `REFRESH CONCURRENTLY` (pg_cron) + `statement_timeout` 5s/RPC و2s للقراءة العامة + ضبط VACUUM للجداول الساخنة | كل مهمة معها ناتج `EXPLAIN (ANALYZE, BUFFERS)` قبل/بعد |
| **DATA-30→32** | لا تقسيم إطلاقًا | قرار موثّق: تقسيم شهري عند تخطي 5–10M صف، وإلا احتفاظ (attendance 3 سنوات · point_events سنتان · audit_log 12–24 شهرًا · notifications 6 أشهر) + إعلان سياسة الاحتفاظ | كرون احتفاظ يعمل + سياسة منشورة |
| **DATA-35→40** | قناة واحدة `masar-live` بلا فلترة تُراقب 4–5 جداول (`remote.ts:280`) | Broadcast لعدّاد الجلسة الحيّة على `session:{id}` · Postgres Changes بفلترة `user_id=eq.<uid>` للإشعارات · Polling 30–60s للوحات · إعادة اشتراك عند `AppState=active` · سقف رسائل | لا رسائل زائدة · زمن ≤ 300ms · إغلاق القناة عند الخروج |
| **DATA-50→56** | لا `metrics_snapshot` ولا SLOs ولا تنبيهات | SLOs (99.5% · p95≤250ms · نجاح حضور ≥99%) + جدول `metrics_snapshot` + تنبيهات (`cron.job_run_details` · عمق outbox · `client_errors` · مساحة) + `correlation_id` من العميل لكل RPC + PITR + بيئة Staging بمفاتيح منفصلة + `supabase db lint`/`plpgsql_check` في CI | تنبيه تجريبي يصل + لوحة أرقام |

---

## 9) المتبقي — الأداء (PERF)

| # | الحالة (بدليل) | المطلوب | معيار القبول |
| --- | --- | --- | --- |
| **PERF-00** قياس | لا `web-vitals` ولا Flashlight ولا `metrics_snapshot` | `web-vitals → telemetry` (LCP/INP/CLS/TTFB مع release+route) · Hermes/Flashlight للإقلاع وFPS · `pg_stat_statements` أسبوعيًا · بوابة PR: +20KB JS أو استعلام > 250ms = رفض | لوحة أرقام أسبوعية |
| **PERF-10** | `svgStrings.ts` = **57,338 بايت** في المسار الحرج | إخراج الرسوم إلى ملفات `.svg` (transformer) أو تحميل كسول حسب الشاشة | −60KB من الحزمة الأساسية |
| **PERF-11** | التميمة داخل الحزمة الأساسية | تحميل كسول عند أول ظهور | −35KB من المسار الحرج |
| **PERF-12** | `lucide-react-native` في التبعيات و**0 استخدام** في الكود | حذفها من `package.json` | `grep lucide src/` = 0 والحزمة أنظف |
| **PERF-13/15** | خط Ionicons + 4 أوزان IBM Plex (1.26MB) | منع تحميل خط الأيقونات قبل الحاجة + subset عربي `woff2` + `font-display` + preload | LCP −200…500ms |
| **PERF-14/17** | 6 حزم (أساسية 2159KB) | تقسيم أدق + خارج المسار الحرج (احتفالات/لوحات/رسوم) | JS أولي ≤ 300KB gzip (الميزانية في §8.1) |
| **PERF-16** | لا `expo-image` | `expo-image` + WebP/AVIF + `srcset` + أبعاد صريحة | CLS ≈ 0 |
| **PERF-18** | أصول مكرّرة (svg في `assets/illustrations` ونصوص مضمّنة) | مصدر واحد | −55KB |
| **PERF-20** | **0 FlashList/FlatList** — كل القوائم `ScrollView` | FlashList/FlatList في 6 قوائم طويلة (اليوم · الاستكشاف · الشهادات · سجل الحضور · المستخدمون · الإشعارات) بـ`keyExtractor` ثابت + `estimatedItemSize` | FPS ≥ 58 على جهاز متوسط |
| **PERF-21** | لا reanimated | Reanimated **انتقائي** للتفاعلات الحرجة فقط (السحب/الفتح) — القياس أثبت أن Reanimated ليس أسرع تلقائيًا (JS 61.9% CPU مقابل 33.5% في مرجع 2026) | لا إطارات ساقطة في 60 ثانية |
| **PERF-22** | سياق `store.tsx` واحد (539 سطرًا) | تفكيك إلى `AuthContext` + `DataContext` + selectors | انخفاض إعادات الرندر ≥ 50% بقياس |
| **PERF-23→27** | — | `memo` انتقائي · إزالة `Math.random` من الرندر · تدقيق كل مؤقت (`cleanup` + توقف في الخلفية) · سقف 2 BlurView · `useDeferredValue` (مطبَّق في البحث ✅) | 0 تسريب في اختبار 10 دقائق |
| **PERF-30→33** | Skeletons جزئية | Skeletons مطابقة للتخطيط · Optimistic UI للآمن فقط (لا للحضور/الشهادات) · Prefetch بحاجز 150ms · Degradation طبقي | قياس «قفزات» = 0 |
| **PERF-40→44** | RPC 84 دالة · بلا قياس منطقة | RPC واحد لكل شاشة (1–3 نداءات) · matviews · اختيار منطقة أقرب لمصر بقياس RTT حقيقي · Supavisor | p95 ≤ 250ms موثّق |

**بوابات الأداء:** Gate-P1 JS ≤ 300KB + LCP ≤ 2.0s · Gate-P2 لا ScrollView لقائمة >20 + FPS ≥ 58 · Gate-P3 p95 موثّق ولا استعلام > 500ms.

---

## 10) المتبقي — الويب والمتجر والأصول والتشغيل (WEB · OPS · ASSET)

| # | الحالة (بدليل) | المطلوب |
| --- | --- | --- |
| **WEB-01** | `vercel.json` = `{buildCommand: export:web, rewrites…}` **بلا رؤوس أمنية** | إضافة `headers`: CSP (`frame-ancestors 'none'`)، HSTS، `nosniff`، `Referrer-Policy`، `Permissions-Policy`، `X-Frame-Options: DENY` + فحص A على securityheaders |
| **WEB-02** | لا `manifest.webmanifest` ولا Service Worker | PWA: manifest (192/512/maskable/theme-color/`display:standalone`) + SW (قشرة أوفلاين + stale-while-revalidate) — **مع خطة كسر الكاش** عند التحديث |
| **WEB-03/04** | **0 `document.title`** · sitemap/robots بهما دومين ثابت | عنوان لكل شاشة من i18n + `meta description` + `og/twitter` لصفحة التحقق + sitemap ديناميكي بدومين من متغير بيئة |
| **WEB-05/06/07** | لا صفحة 404/500 ويب ولا أيقونات متعددة المقاسات | صفحة 404 + صفحة عطل مستقلة · `immutable` للأصول (hashed) و`no-store` لـ`index.html` · favicon متعدد + apple-touch-icon + splash |
| **WEB-08/09/10** | لا تحليلات ولا hreflang | تحليلات خفيفة بلا كوكيز + `web-vitals` → telemetry · `hreflang` عند إضافة الإنجليزية · دومين مخصص + بريد `support@` |
| **WEB-11** | SPA بلا مسارات | ADR-01: نقل المسارات العامة إلى **Expo Router** (`/verify`, `/certificate/:serial`, `/course/:id`) أولًا + بوابة قرار بعد قياس LCP والزيارات العضوية |
| **OPS-01** | `ci/github-actions-ci.yml` موجود · `.github/workflows` **مستثنى من Git** · بوابة Vercel لا تشغّل أي فحص | (أ) تعديل `buildCommand` إلى `npm run typecheck && npm run parity && npm run rpc:check && npm run sql:check && npm run export:web` — فوري بلا انتظار؛ (ب) رفع `ci.yml` إلى `.github/workflows/` من المستخدم/App بصلاحية workflows ⇒ 7 وظائف |
| **OPS-07/08** | `eas.json` موجود | EAS (dev/preview/prod) + هوية المتجر + الإصدار **4.0.0** + Feature Flags/Kill switches |
| **OPS-05** | كل اختبارات RLS/Load محلية أو محاكاة | مشروع **Staging** بنفس إصدار Postgres ⇒ تشغيل `scripts/rls.test.ts` و`load-test` عليه |
| **OPS-10/11/12** | pentest/load محليان | اختبار اختراق ضد Staging (لا مرآة) · حمل حقيقي k6/Artillery ≥ 99% تحت 200 مستخدم · E2E موسّع (كيبورد/أوفلاين/مقاسات/لغة) ⇒ **100 فحص** |
| **ASSET-01→06** | `docs/assets/ASSET_LEDGER.md` موجود · **لا `assets/manifest.json`** · لا Lottie/Rive/أصوات | مجموعة أيقونات نهائية (Ionicons MIT ✅) · 5 رسوم حالات فارغة بأسلوب موحّد ≤15KB · ميكرو-أنيميشنز ≤20KB (Lottie Simple License من فلتر Free فقط) · 3 أصوات CC0 تُسكَت مع النظام · `manifest.json` + إثباتات ترخيص · خط عناوين اختياري (ADR) |
| **خط الإنتاج** | غير موجود | `assets/src → assets/dist` (SVGO/oxipng/dotLottie/fonttools) + بوابات: لا ملف >200KB · لا أصل بلا سجل · لا أصل يتيم · الإجمالي ≤ 3MB |
| **DOC-01** | `EXECUTION_LOG` و`AUTH_PROVIDERS` محدثان | بيان وصول عام (Accessibility Statement) + سياسة خصوصية (تشمل الاحتفاظ) + Release Notes + README محدَّث |

---

## 11) الموجات المقترحة (نفّذ بالترتيب — لا تقفز)

**Wave A — مكاسب فورية (ساعات):** رؤوس الأمان في `vercel.json` + بوابات Vercel · حذف `lucide` (0 استخدام) ·
بوابة `search_path` في `check-sql.js` · `document.title` لكل شاشة · أيقونات/favicon متعددة ·
`autoComplete` على نماذج المصادقة.
**Wave B — وصول متقدّم:** A11Y-03/05 (Screen/Section لـ40 شاشة) · A11Y-12 · A11Y-45→48 · A11Y-50→53 ·
A11Y-60→66 · ثم `axe` على 12 مسارًا + eslint-a11y.
**Wave C — داتا وأداء:** DATA-01→04 · DATA-10→13 (8 RPCs + إيقاف `selectAll`) · DATA-20→26 · PERF-10/11/12/16/20.
**Wave D — فطن والأصول والبصريات:** M2→M6 · ASSET-01→06 + pipeline · DESIGN توكنز/تايبوغرافي/جداول.
**Wave E — الجاهزية:** Staging (OPS-05) · WEB-02/03/04/06 · OPS-07/08 · OPS-10/11/12 · تقسيم/احتفاظ (DATA-30) ·
المراقبة (DATA-50) · DOC-01 ⇒ ثم تقييم G-1…G-8.

**خروج كل موجة:** `npm run test:all` أخضر + تحديث `docs/EXECUTION_LOG.md` + كوميت على `arena/01a0e854-arena`.

---

## 12) ما لا يمكن قياسه في هذه البيئة (يُسلَّم كخطوات تحقق يدوي)

1. **VoiceOver/TalkBack/NVDA** — 3 مسارات ذهبية (ملحق G) مع تصنيف شدة؛ Blocker/Major = لا إصدار.
2. **دفع حقيقي** — نشر `push-dispatch` + جهاز حقيقي (FUNC-02).
3. **كشك 8 ساعات** — جهاز حقيقي مربوط بالشاحن (FUNC-06).
4. **EAS Build** على iOS/أندرويد + شهادة توقيع (OPS-07) + Sign in with Apple على iOS (FUNC-01).
5. **تنفيذ الترحيلات على مشروع Supabase حقيقي** — الفحص هنا نحوي/ساكن فقط (بوابة `sql:check` تعترف بحدودها).
6. **Lighthouse/Flashlight/pg_stat_statements** — تحتاج متصفح حقيقي/جهاز/قاعدة بيانات.
7. **il sag** اختبار الحمل الحقيقي 200 مستخدم متزامن.

---

## 13) Definition of Done لأي بند + قالب التقرير

**DoD:** كود مدمج ⇒ أمر تحقق ⇒ ناتج ظاهر ⇒ رقم مقيس ⇒ سطر في `EXECUTION_LOG` ⇒ لا انحدار في `test:all`.
**قالب التقرير:** (1) ما نُفِّذ ببند بند · (2) الأدلة (أوامر + نواتج) · (3) ما لم يُقَس ولماذا ·
(4) القرارات المعمارية الجديدة · (5) المتبقي المحدَّث.

**خطوط حمراء أخيرة:** لا زيادة تبويبات (>5) · لا dark patterns · لا مكتبة أيقونات ثانية · لا Skia/3D الآن ·
لا ميزة جديدة قبل إغلاق P0/P1 · لا دمج بلا بوابة خضراء · ولا رقم في تقرير بلا أمر يُنتجه.
