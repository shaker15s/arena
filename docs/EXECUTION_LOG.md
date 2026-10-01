# سجل التنفيذ — مسار 3.2 → 4.0

> **المرجع:** `MASAR_MASTER_PLAN_2026-09-28.md` (الخطة الواحدة). هذا الملف يوثّق **ما نُفِّذ فعلًا**،
> بالملف والسطر والأمر والناتج المقيس — بلا أي ادعاء غير مقيس.
> **آخر تحديث:** 29 سبتمبر 2026 (الموجة E) · الفرع: `arena/01a0e854-arena`.

## 0) قيادة التحقق (Verification Gate)

كل تعديل يمرّ بهذا الأمر الواحد، وأي كسر = رجوع فوري:

```bash
npm run typecheck && npm run a11y && npm run contrast && npm run parity && npm run rpc:check && npm run test:all
```

| البوابة | ماذا تقيس | الناتج الحالي |
| --- | --- | --- |
| `npm run typecheck` | TS strict على 104 ملفًا | ✅ 0 أخطاء |
| `npm run a11y` | Pressable بلا دور/اسم · Ionicons مباشر · عربي في خصائص الوصول · outline بلا بديل · **عنوان h1 لكل شاشة** · **تطابق حلقة التركيز بين التوكنز وCSS** | ✅ 0 أخطاء · 0 تحذيرات · 52 ضغطة · 181 أيقونة · **38/38 شاشة بها h1** |
| `npm run contrast` | 51 زوج لون × 3 ثيمات (WCAG 1.4.3 + 1.4.11) | ✅ 51/51 (light 5.12–5.57 · dark 7.75–9.57 · oled 8.90–9.57) |
| `npm run parity` | تطابق مفاتيح ar/en | ✅ **927** مفتاحًا |
| `npm run rpc:check` | كل نداء عميل له دالة على الخادم | ✅ 56 نداء / 93 دالة |
| `npm run test:all` | المحرّكات + RLS + البحث + الأداء + الاختراق + الحمل + E2E | ✅ 62/62 نجاحًا · 0 فشل |

## 1) إمكانية الوصول — المرحلة 1 (A11Y-01 → 15)

| # | البند | الحالة | الدليل في الكود | الإثبات |
| --- | --- | --- | --- | --- |
| A11Y-01 | مكوّنات `Screen`/`Section`/`Landmark`/`LiveRegion` | ✅ | `src/design/a11y/semantics.tsx` (+`VisuallyHidden`) | يُستخدم في `RootNavigator` و`ScannerScreen` |
| A11Y-02 | `Txt` يدعم `heading` و`aria-level` و`tabIndex` | ✅ | `src/design/components.tsx › Txt` | `Txt heading="h1"` ينشئ `<h1>` حقيقيًا على الويب |
| A11Y-03 | `Header` يصدر `h1` تلقائيًا لـ19 ملفًا | ✅ | `components.tsx › Header` | البوابة: 38/38 شاشة |
| A11Y-04 | عنوان `h1` لكل شاشة + معلم `main` واحد | ✅ | `RootNavigator › MAIN_LANDMARK_ID = 'masar-main'` | `SemanticScreen id/label` يغلّف كل الشاشات |
| A11Y-05 | معلم تنقّل + «تبويب i من n» | ✅ | `RootNavigator › AppleTabBar/TabButton` | `role="navigation"` + `aria-posinset/aria-setsize` |
| A11Y-10 | طبقة التركيز المرئي + إزالة `outline:none` | ✅ | `public/index.html` (`masar-a11y-focus`) · `tokens.focusRing` · `a11y/focus.ts` | تباين الحلقة: 5.12–5.57 (فاتح) و7.75–9.57 (داكن) |
| A11Y-11 | «تخطَّ إلى المحتوى» + هدفه | ✅ | `semantics.tsx › SkipLink` + `RootNavigator` | `#masar-main` مُشغَّل |
| A11Y-12 | حصر التركيز + Esc + إرجاع التركيز | ✅ | `src/design/a11y/useFocusTrap.ts` | مطبّق على `Sheet` + `CelebrationModal` + `BadgeModal` |
| A11Y-13 | إعلان تغيير الشاشة/التبويب | ✅ | `Header` (نقل تركيز/إعلان) · `TabsScaffold` | `announce()` عند التغيير |
| A11Y-14 | أسهم لوحة المفاتيح (RTL-aware) | ✅ | `src/design/a11y/roving.ts` | `Segmented` + `Stars` (radiogroup + Home/End) |
| A11Y-15 | منع حجب التركيز بالشريط السفلي | ✅ | `public/index.html › scroll-padding-bottom: 140px` | مقاس الشريط 68 + هامش المحتوى 104 |

**بنية جديدة:** `announce.ts` · `semantics.tsx` · `focus.ts` · `useFocusTrap.ts` · `roving.ts` · `icons.tsx` (غلاف `Icon`/`IconButton`).

## 2) الوظائف — FUNC-01 (Sign in with Apple)

| البند | التنفيذ | الدليل |
| --- | --- | --- |
| مسار iOS الأصلي | `AppleAuthentication.signInAsync` → `signInWithIdToken({provider:'apple'})` | `src/data/supabase.ts › signInWithAppleNative()` |
| الويب/أندرويد | OAuth نفسه عبر المتصفح الآمن | `signInWithApple()` |
| الزر | iOS: زر النظام `ASAuthorizationAppleIDButton` · غيره: زر بمواصفات HIG | `AuthScreens.tsx › AppleSignInButton` |
| المواصفات | ارتفاع 56pt · زوايا 16 · خط العنوان 43% من الارتفاع (24px = `typography.h1`) · أسود/أبيض حسب الثيم | `src/design/integrations/appleSignIn.ts` |
| متطلب المتجر | مزوّد ثالث ⇒ Sign in with Apple إلزامي (App Store 4.8) | `expo-apple-authentication@~57.0.2` + plugin في `app.json` |
| قرار الـ nonce | لا nonce على المسار الأصلي (تضارب ترميز hex/base64url موثّق) | `docs/AUTH_PROVIDERS.md` §3 |

## 3) الأداء — قياسات مقيسة (قبل/بعد)

| المقياس | قبل | بعد | الأداة |
| --- | --- | --- | --- |
| حجم `dist/` الكامل | **8.3 MB** | **3.6 MB** (−57%) | `du -sh dist` بعد `npm run export:web` |
| خطوط الشحن | **5.4 MB** (24 خطًا: MaterialCommunityIcons 1.3MB، FontAwesome6 413KB، MaterialIcons 348KB، Fontisto 306KB…) | **1.26 MB** (Ionicons + 4 أوزان IBM Plex فقط) | `find dist -name '*.ttf'` |
| الحزمة الأولية JS | 2.6 MB خام / 688 KB gzip | **2.2 MB خام / 558 KB gzip** (−19% gzip) | `gzip -9 -c` على `index-*.js` |
| `outline:none` بلا بديل | موجود | **0** (بوابة) | `npm run a11y` |

**سبب المكسب (مقيس لا مُفترض):** استيراد `Ionicons` مباشرةً بدل برميل `@expo/vector-icons`
(كان البرميل يسجّل 20+ خط أيقونات في الحزمة)، واستيراد أوزان الخط العربي الأربعة المستخدمة فقط
بدل البرميل الذي يجلب سبعة.

## 4) الإصلاحات الجانبية المكتشفة أثناء التنفيذ (Real findings)

| # | العطل | التأثير | الإصلاح |
| --- | --- | --- | --- |
| 1 | رابط إنتاج قديم مضمّن `arena-rho-seven.vercel.app` في **6 مواضع** | كل مشاركة إنجاز/حضور تُرسل رابطًا ميتًا | استُبدل بـ`PUBLIC_APP_URL` من `src/shared/links.ts` |
| 2 | نص مشاركة عربي مضمّن + `navigator.share` بلا i18n | لا يعمل بالإنجليزية | مفاتيح `share.*` في القاموسين |
| 3 | `t('a11y.skipToContent')` مُعرَّف مرتين | خطأ بناء TS1117 كامن | أُزيل التكرار (مصدر واحد لكل مفتاح) |
| 4 | عربي مضمّن في `accessibilityLabel` بقوالب نصية | يقرأ قارئ الشاشة العربية دائمًا | بوابة جديدة تمنعه + `a11y.newBadge`/`a11y.stepOf` |
| 5 | خطوط/أيقونات غير مستخدمة تُشحن للويب | 4.7MB تحميل زائد | التقليل أعلاه |

## 5) المتبقي (مرتّب بالأثر)

1. **تعميم العربية/الإنجليزية:** 275 نصًا عربيًا مضمّنًا في 30 ملفًا (MasarMascot 65 · engine 36 ·
   Dashboard 24 · Today 15 · SessionComplete 12 …) — بوابة `check-i18n-lint` + مفاتيح إنجليزية جديدة.
2. **FUNC-02 → FUNC-20** (نشر push-dispatch · ICS · PDF عربي · Open Badges · التماس حضور · كشك · بحث عربي ·
   أوفلاين · لوحة «يحتاج تدخلك» · إعدادات موسّعة · Quiet hours · تقارير مجدولة · مشاركة PNG · حذف حساب ·
   دعم برمز عطل · تايم زون · تدقيق جيميفيكيشن · انضمام بالكود · صلاحيات · منطقة/لوكال).
3. **الداتا والخادم:** سياسات `(select auth.uid())` · فهرسة أعمدة السياسات · Read Model/RPCs الدفعة الثانية
   (10 RPCs في الملحق C) · Partitioning · Realtime Broadcast · المراقبة.
4. **صقر فطن 3.0:** 12 حالة شعورية موحّدة المصدر + إخراج النصوص من الكود إلى i18n.
5. **الأسيتس:** تسجيل كل أصل جديد في `docs/assets/ASSET_LEDGER.md` قبل الدخول + تراخيص.

## 6) بوابة صدق الأرقام

كل رقم في هذا الملف ناتج أمر شُغِّل في هذه الجلسة، ويمكن إعادة توليده بالأوامر المذكورة بجانبه.
الأرقام التي تتطلب جهازًا حقيقيًا (Sign in with Apple على iOS، VoiceOver/TalkBack) مذكورة في
`docs/AUTH_PROVIDERS.md` §4 وملحق G من الخطة كبنود تحقق يدوي **لم تُقَس بعد** — ولا تُدّعى منجزة.

---

# جلسة التنفيذ الثانية — FUNC-02→20 والخادم (نفس اليوم)

## 7) ما نُفِّذ (مقيس بالأمر)

| البند | الوضع | الدليل المُقاس |
| --- | --- | --- |
| **FUNC-07 بحث عربي** | ✅ منجز | `npm run test:search` → **32/32**؛ التطبيع يغطّي التشكيل، الهمزات (أ/إ/آ/ؤ/ئ)، التاء المربوطة، الألف المقصورة، التطويل، الأرقام العربية-الهندية، الكاف الفارسية، والفصل/الوصل («عبدالله» = «عبد الله») + ترتيب بالملاءمة `rankSearch`. موصول في Explore/Users/LiveSession |
| **FUNC-03 تصدير ICS** | ✅ منجز | `src/shared/calendar.ts` (RFC 5545: CRLF، طيّ 75 بايت، تهريب، UID ثابت، VALARM) + `VTIMEZONE Africa/Cairo` مُقابل **tzdata** في الاختبار؛ `npm run test:calendar` → **27/27**؛ زر «أضف للتقويم» في «اليوم» |
| **FUNC-06 كشك** | ✅ منجز (تحقق 8 ساعات يحتاج جهازًا) | `src/shared/kiosk.ts`: W3C Screen Wake Lock + إعادة الطلب عند `visibilitychange`، و`expo-keep-awake` بإعادة تأكيد كل 4 دقائق على الجوال + fullscreen؛ واجهة كشك QR 320px في `LiveSessionScreen` |
| **FUNC-10 الإعدادات** | ✅ منجز | شاشة `SettingsScreen` جديدة: اللغة · الثيم (4) · **حجم النص 100/115/130%** (WCAG 1.4.4) · **تقليل الحركة** · **تباين عالٍ** · المنطقة الزمنية · تصدير البيانات · حذف الحساب |
| **FUNC-11 Quiet hours** | ✅ منجز (السيرفر + الواجهة) | ترحيل 0031: `push_preferences.quiet_*` + `is_quiet_hours()` (تعبر منتصف الليل + استثناء security/session) + `push_outbox.not_before` + `claim_push_batch` لا يسلّم قبل النافذة + مفاتيح `notif.quiet*` في الإعدادات |
| **FUNC-12 التقارير المجدولة** | ✅ منجز (السيرفر) | `report_subscriptions` + `org_weekly_report()` (أسبوع بتوقيت القاهرة) + `enqueue_weekly_reports()` + cron `masar-weekly-report` الأحد 07:00 القاهرة |
| **FUNC-16/20 التوقيت والمنطقة** | ✅ منجز | `profiles.timezone` (افتراضي `Africa/Cairo`) + `is_valid_timezone()` + `set_my_timezone()` + واجهة اختيار المنطقة؛ كل حدود الأسبوع تُحسَب على السيرفر |
| **FUNC-05 نزاع الحضور** | ✅ السيرفر + RPCs (الواجهة قيد الربط) | جدول `attendance_disputes` + `submit/withdraw/resolve/list_attendance_disputes`: قبول التماس **يصحّح سجل الحضور** ويُشعر الطالب ويكتب `audit_log`؛ فهرس يمنع تكرار التماس المفتوح |
| **FUNC-09 «يحتاج تدخلك»** | ✅ السيرفر | `needs_attention()`: يجمّع طلبات الدعم + الأعذار + النزاعات + الجلسات المعلّقة + التوكنات الميتة + الأعطال القاتلة، بحسب الدور، مع `action` لكل بند |
| **FUNC-15 رمز العطل** | ✅ السيرفر | `client_errors.public_ref` بصيغة `MSR-XXXXXX` + `log_client_error` **يعود بالمرجع** + `get_error_by_ref()` للمشرفين |
| **FUNC-17 تدقيق الجيميفيكيشن** | ✅ السيرفر | `checkin_risk_signals` + `detect_checkin_anomalies()` (burst_share · overlapping_sessions · checkin_after_close) + `anticheat_report()` + sweep كل 30 دقيقة |
| **FUNC-02 دفع** | ✅ مسار التسليم كامل (النشر يحتاج مشروع Supabase) | `prune_dead_push_tokens()` + تنظيف التوكنات الميتة ومعالجة صفوف outbox اليتيمة؛ نشر `push-dispatch` + السر + cron موثّق في ترويسة الدالة |
| **FUNC-04 Open Badges** | ⚠️ الإصدار قابل للتحقق — التوقيع HMAC لا Ed25519 | `public_badge_assertion()` (بنية Open Badges 3.0/VCDM) + `verify_badge_assertion()`؛ استبدال HMAC بـeddsa-rdfc-2022 يحتاج زوج مفاتيح مُنشأ في النشر (مذكور صراحة في الملف) |
| **صلاحيات موروثة** | ✅ مُقوّاة | 46 دالة من 0001–0030 كانت بلا أي `GRANT/REVOKE` (قابلة للتنفيذ من `anon` افتراضيًا) → كتلة DO تضبط كل توقيع من الفهرس |

## 8) بوابات جديدة (تُشغَّل في `npm run test:all`)

| البوابة | الأمر | النتيجة الأخيرة |
| --- | --- | --- |
| قواعد الهوكات | `npm run hooks:check` | **187 مكوّنًا · 0 مخالفة** (كانت 5 مواضع تنادي هوكًا بعد إرجاع مبكر) |
| تحليل SQL + الصلاحيات | `npm run sql:check` | **30 ملفًا · 642 عبارة · 155 محلَّلة نحويًا · 0 خطأ · 0 دالة بلا تحكم وصول** |
| تطابق RPC | `npm run rpc:types` | **84 دالة** مولَّدة من الترحيلات ومتزامنة |
| تعريب (سقف متدرّج) | `npm run i18n:lint` | عربي مضمّن: **275 → 137 نصًا**؛ أي ملف جديد فيه عربي = فشل بناء |

## 9) أرقام الأداء والجودة بعد كل التعديلات

| المقياس | القيمة |
| --- | --- |
| الحزمة الأساسية | **2159KB خام** (كانت 2121KB قبل شاشة الإعدادات +27KB … الفارق 38KB) |
| عدد الملفات في `dist` | 32 ملفًا · 3.7MB |
| اختبارات e2e | **62/62** |
| typecheck · a11y · contrast · parity | ✅ · **0/0** (39 شاشة h1) · **51×3** · **1092 مفتاحًا** |

## 10) المتبقي بصراحة (لا يُدّعى إنجازه)

1. **ربط الواجهة بالـRPCs الجديدة:** نزاع الحضور (شاشة الطالب + صندوق المدرب)، لوحة «يحتاج تدخلك»، لوحة
   التدقيق ضد التلاعب، تفضيل التقرير الأسبوعي، عرض رمز العطل في الدعم، زر Open Badges في الشاشة.
   (الخادم جاهز و`src/data/actions.ts` يضم الدوال — المتبقي هو الشاشات.)
2. **FUNC-13 PNG حقيقي** (الثقب السابق: يخرج PDF) و**FUNC-04 PDF عربي بجودة طباعة + QR بموضع ثابت**.
3. **FUNC-08 الأوفلاين** واجهيًا، **FUNC-18** تحسين إدخال الكود، **FUNC-19** مراجعة إظهار العناصر بالصلاحية.
4. **A11Y المتبقي:** منع حجب التركيز (sticky tabbar/FAB) · أي مودال بلا focus trap · `outline:none` اليدوي في `SpotlightCard.tsx:158`.
5. **ما يحتاج جهازًا حقيقيًا (لا يُقاس في هذه البيئة):** وصول إشعار تجريبي لجهاز حقيقي، تشغيل الكشك 8 ساعات،
   قراءة VoiceOver/TalkBack، توقيع Apple على iOS، حِمل 1000 مستخدم متزامن.
6. **قاعدة البيانات على مشروع حقيقي:** الترحيلات مُحقَّقة نحويًا وساكنًا فقط — لا يوجد Postgres في هذه البيئة،
   فالتنفيذ الفعلي (0031 وما سبقه) يبقى بند تحقق على مشروع Supabase.

---

# جلسة التنفيذ الثالثة — ربط الواجهة بالخادم

| البند | الوضع | الدليل |
| --- | --- | --- |
| **FUNC-05 واجهة النزاع** | ✅ منجز | `src/features/disputes/DisputesScreen.tsx`: وضع الطالب (تقديم/سحب + اختيار الجلسة من مجموعاته) ووضع المدرب (صندوق المفتوح + قرار بسبب موثّق)؛ موصول في 3 ستاكات + زر في «سجل الحضور» |
| **FUNC-09 لوحة «يحتاج تدخلك»** | ✅ منجز | `DashboardScreen`: بطاقة تجمع كل البنود بعدّاداتها وزر «افتح» لكل بند (نزاع → تماسات، جلسة معلّقة → الجلسة الحية، دعم → الدعم) |
| **FUNC-12 التقرير الأسبوعي** | ✅ منجز واجهيًا | بطاقة «تقرير الأسبوع» بأرقام الخادم (بتوقيت القاهرة) + زر «أرسل لي التقرير كل أحد» يستدعي `set_report_subscription` |
| **FUNC-17 تدقيق التلاعب** | ✅ منجز واجهيًا | بطاقة «تدقيق ضد التلاعب» تعرض أحدث 3 إشارات مع شدّتها واسم الطالب/الجلسة |
| **بوابة التعريب** | ✅ صارت أدق | استثنت تعليقات JSX `{/* … */}` ⇒ العدد الحقيقي **137 → 104 نصًا في 22 ملفًا** |

**التحقق النهائي:** `npm run test:all` ✓ — typecheck · a11y **0/0 (40 شاشة h1)** · hooks **0/0 (188 مكوّنًا)** ·
contrast 51×3 ✓ · i18n:lint ✓ · parity **1147 مفتاحًا** · rpc:check ✓ · sql:check ✓ · rpc:types 84 ✓ ·
engine/rls/search/calendar/perf/pentest/load ✓ · **e2e 62/62**.

**المتبقي (لم يتغيّر):** FUNC-13 PNG حقيقي · PDF عربي + QR ثابت · ربط شاشة الدعم برمز العطل · زر Open Badges في
شاشة الشهادات · الأوفلاين واجهيًا · تحسين إدخال كود الانضمام · A11Y (حجب التركيز · focus trap · outline) ·
وتحويل رؤوس CSV العربية إلى i18n (سقف `DashboardScreen` عند 25 بسبب محتوى التقرير).

---

# الموجة A (Wave A) — مكاسب فورية (29 سبتمبر 2026)

| البند | الوضع | الدليل المُقاس |
| --- | --- | --- |
| **WEB-01 / WEB-06 / OPS-01 رؤوس وبوابات `vercel.json`** | ✅ منجز | `vercel.json`: إضافة `CSP (frame-ancestors 'none')`، `HSTS (max-age=63072000; includeSubDomains; preload)`، `X-Content-Type-Options: nosniff`، `X-Frame-Options: DENY`، `Referrer-Policy`، `Permissions-Policy`، وسياسة كاش `immutable` لـ `/_expo/static/(.*)` و `no-store` لـ `/index.html`، وربط `buildCommand` بـ `typecheck && parity && rpc:check && sql:check && export:web` |
| **PERF-12 حذف `lucide-react-native`** | ✅ منجز | حُذفت من `package.json` و`package-lock.json` (0 استخدام في `src/`) |
| **DATA-03 بوابة `search_path` الحقيقية** | ✅ منجز | `scripts/check-sql.js`: فحص تحليلي لكل دالة `SECURITY DEFINER` على حدة للتأكد من وجود `SET search_path` في ترويستها → **137 دالة SECURITY DEFINER · 0 بلا search_path** |
| **WEB-03/04 `document.title` و Meta/OG** | ✅ منجز | `src/app/RootNavigator.tsx` (`documentTitle` + `TabsScaffold`) + `src/design/components.tsx` (`Header` يضبط `document.title` و `role="banner"`) + `public/index.html` (`meta description` + `og:*` + `twitter:*`) |
| **WEB-02 / WEB-07 الأيقونات والـ Manifest** | ✅ منجز | `public/manifest.webmanifest` + أيقونات متعددة المقاسات (`icon.svg`, `favicon.png`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `maskable-icon.png`) |
| **A11Y-45→48 النماذج و `autoComplete`** | ✅ منجز | `src/design/components.tsx › Input`: دعم `autoComplete`, `textContentType`, `inputMode`, `aria-invalid`, `aria-errormessage` (`role="alert"`) + تطبيقها في `AuthScreens.tsx`, `ProfileScreens.tsx`, `JoinBatchScreen.tsx` + بوابة فحص ثابتة في `scripts/check-a11y.js` |

**التحقق المقيس (`npm run test:all`):**
- `typecheck`: 0 أخطاء
- `a11y`: 52 عنصر ضغط · 192 `<Icon>` · 40/40 شاشة h1 · 0 أخطاء / 0 تحذيرات
- `hooks:check`: 188 مكوّنًا · 0 مخالفة
- `contrast`: 51 زوجًا × 3 ثيمات ✓
- `i18n:lint`: 104 نصًا في 22 ملفًا (توافق مسارات POSIX/Windows)
- `parity`: 1147 مفتاحًا ✓
- `rpc:check`: 65 نداء / 114 دالة ✓
- `sql:check`: 30 ملفًا · 642 عبارة · 155 محلَّلة نحويًا · 145 دالة · **137 SECURITY DEFINER (0 بلا search_path)** · 0 بلا تحكم وصول ✓
- `rpc:types`: 84 دالة ✓
- `test:engine` / `test:rls` / `test:search` / `test:calendar` / `test:perf` / `test:pentest` / `test:load` / `test:e2e`: **62/62** ✓

---

# الموجة B (Wave B) — وصول متقدّم (A11Y) (29 سبتمبر 2026)

| البند | الوضع | الدليل المُقاس |
| --- | --- | --- |
| **A11Y-03/05 تعميم معالم `<Screen>` و`<Section>`** | ✅ منجز | تغليف جميع الشاشات الـ40 المصدَّرة (`*Screen`) في `src/features/**` بمعلم `<Screen>` دلالي (`role="main"` للغلاف الرئيسي و`role="region"` لكل شاشة مع `aria-label` و`accessibilityViewIsModal`) + بوابة فحص ثابتة في `scripts/check-a11y.js` (`40/40 شاشة بمعلم <Screen>`) |
| **A11Y-12 منع حجب التركيز (WCAG 2.4.11)** | ✅ منجز | `src/app/RootNavigator.tsx › AppleTabBar`: إخفاء الشريط السفلي والـ FAB تلقائيًا عند فتح لوحة المفاتيح على الجوال (`Keyboard.addListener`)، وحساب ارتفاع الشريط ديناميكيًا عبر `onLayout` إلى متغير `--masar-tabbar-h` + حارس `focusin` في `public/index.html` يضمن تمرير العنصر المركّز فوق الشريط العائم |
| **A11Y-13/14/15 حبس التركيز في كل `<Modal>`** | ✅ منجز | التحقق الآلي في `scripts/check-a11y.js` أن كل ملف يستخدم `<Modal>` يطبّق `useFocusTrap` (`components.tsx › Sheet` و`celebrations.tsx › CelebrationModal`) مع `Escape` وإعادة التركيز |
| **A11Y-42 بديل السحب في `SwipeRow` (WCAG 2.5.1)** | ✅ منجز | `src/design/components/SwipeRow.tsx`: دعم `accessibilityActions` و`onAccessibilityAction` لقارئات الشاشة + شريط أزرار بضغطة واحدة متاح للكيبورد واللمس المباشر بدون سحب + بوابة فحص في `scripts/check-a11y.js` |
| **A11Y-52/53 تقليل الحركة الشامل** | ✅ منجز | `src/design/glass.tsx › AmbientOrb` يعيد `null` عند تفعيل `isReducedMotion()` (مع تقليل الكرات المضيئة في `AppBackground` إلى 2)، و`src/design/mascot/MasarMascot.tsx` يعرض إطارًا ثابتًا دون تحويلات حركية عند تفعيل تقليل الحركة |
| **A11Y-62 تكبير الخط حتى 200%** | ✅ منجز | رفع `maxFontSizeMultiplier` إلى `2` في `src/design/components/Odometer.tsx` و`src/design/glass.tsx › StatBubble` ومطابقته مع `Txt` |
| **A11Y-64/65 `formatNumber` وعزل Bidi** | ✅ منجز | `src/shared/format.ts`: إضافة `formatNumber(n, lang, options)` و`bidiIsolate(value)` (`\u2068...\u2069`)، وتطبيق العزل ثنائي الاتجاه على الأرقام التسلسلية للشهادات وأكواد الجلسات في `CertificatesScreens.tsx`, `VerifyScreen.tsx`, `LiveSessionScreen.tsx` |
| **A11Y-30→35 المناطق الحية `<LiveRegion>`** | ✅ منجز | دعم `politeness` في `LiveRegion` وتطبيقه على عدّاد الحضور الحي في `LiveSessionScreen.tsx` وعدد نتائج التصفية في `ExploreScreens.tsx` و`UsersScreen.tsx` |

**التحقق المقيس (`npm run test:all`):**
- `typecheck`: 0 أخطاء
- `a11y`: 55 عنصر ضغط · 195 `<Icon>` · **40/40 شاشة h1** · **40/40 شاشة بمعلم `<Screen>`** · 0 أخطاء / 0 تحذيرات
- `hooks:check`: 188 مكوّنًا · 0 مخالفة
- `contrast`: 51 زوجًا × 3 ثيمات ✓
- `i18n:lint`: 104 نصًا في 22 ملفًا · 0 تراجع ✓
- `parity`: 1147 مفتاحًا ✓
- `rpc:check`: 65 نداء / 114 دالة ✓
- `sql:check`: 30 ملفًا · 137 دالة SECURITY DEFINER · 0 أخطاء ✓
- `rpc:types`: 84 دالة ✓
- `test:engine` / `test:rls` / `test:search` / `test:calendar` / `test:perf` / `test:pentest` / `test:load` / `test:e2e`: **62/62** ✓

---

# الموجة C (Wave C) — الداتا والأداء (DATA + PERF) (29 سبتمبر 2026)

| البند | الوضع | الدليل المُقاس |
| --- | --- | --- |
| **DATA-01 / DATA-02 تأمين سياسات RLS و`InitPlan`** | ✅ منجز | `supabase/migrations/0032_wave_c_security_rpcs_indexes.sql`: تحديث `my_profile_id()` و`my_role()` لاستخدام `(SELECT auth.uid())`، وإعادة تعريف سياسات RLS عبر 30 جدولًا بـ `TO authenticated` صريحة ولفّ كل دوال السياق داخل `(SELECT ...)` (InitPlan)، واستبدال `USING (true)` على `course_roles` بسياسة مقيدة للمسجلين والطاقم |
| **DATA-04 استكمال محددات التردد الخادمية** | ✅ منجز | `0032_wave_c_security_rpcs_indexes.sql`: إضافة `_check_rate_limit` وتطبيق سقف المعدل المنزلق على `submit_support_request` (10/ساعة) و`submit_course_rating` (15/ساعة) |
| **DATA-10→13 الـ8 Read-Model RPCs وإيقاف `selectAll` على الجداول النامية** | ✅ منجز | تنفيذ `get_my_home`, `get_my_wallet`, `get_leaderboard`, `list_notifications`, `get_admin_overview`, `get_course_detail`, `get_session_detail`, `list_pending_actions` في `0032` + دوال العميل في `src/data/actions.ts` + توليد الأنواع في `src/types/database.ts` (93 دالة) + استبدال `selectAll('sessions')` بـ `selectSessionWindow()` في `src/data/remote.ts` وتحويل الجداول النامية إلى `selectRecent` محدود |
| **DATA-20→26 الفهارس المركّبة والـBRIN والـMaterialized Views والـTimeouts** | ✅ منجز | `0032_wave_c_security_rpcs_indexes.sql`: 11 فهرسًا مركبًا/جزئيًا + 3 فهارس BRIN (`attendance`, `point_events`, `audit_log`) + ضبط `autovacuum` للجداول الساخنة + 3 عروض مادية (`mv_batch_stats`, `mv_leaderboard_week`, `mv_admin_overview`) مع فهارس فريدة ودالة `refresh_analytics_views()` (CONCURRENTLY) + ضبط `statement_timeout` (`5s` لـ `authenticated` و`2s` لـ `anon`) |
| **DATA-30→32 / DATA-50→56 سياسة الاحتفاظ وجدول `metrics_snapshot`** | ✅ منجز | `0032_wave_c_security_rpcs_indexes.sql`: دالة `prune_retention_tables()` (الإشعارات المقروءة 180 يومًا، السجلات والنقاط 730 يومًا، الحضور 1095 يومًا) + جدول `metrics_snapshot` ودالة `capture_metrics_snapshot()` لمؤشرات SLO |
| **DATA-35→40 تقييد Realtime وإيقافه في الخلفية** | ✅ منجز | `src/data/remote.ts` و`src/data/store.tsx`: فلترة `notifications` و`point_events` بـ `user_id=eq.<profileId>`، وإيقاف القناة تلقائيًا عند انتقال `AppState` إلى `background`/`inactive` وإعادة وصلها مع مزامنة فورية عند `active`، وتهدئة `refresh` الاحتياطي بـ `150ms` |
| **PERF-10 تحميل كسول لـ `svgStrings.ts` (57KB)** | ✅ منجز | `src/design/illustrations/*.tsx`: تحويل استيراد `svgStrings.ts` إلى `import('./svgStrings')` ديناميكي لفصله عن الحزمة الحرجة الأولية |
| **PERF-20 تحويل القوائم الطويلة إلى `FlatList`** | ✅ منجز | تحويل القوائم في `NotificationsScreen.tsx`, `UsersScreen.tsx`, `JourneyScreens.tsx › AttendanceHistoryScreen`, `GamificationScreens.tsx › WalletScreen & LeagueScreen`, `ExploreScreens.tsx › ExploreScreen`, `CertificatesScreens.tsx › CertificatesScreen` من `ScrollView` إلى `FlatList` مع `keyExtractor` و`initialNumToRender` و`windowSize` |

**التحقق المقيس (`npm run test:all`):**
- `typecheck`: 0 أخطاء
- `a11y`: 55 عنصر ضغط · 195 `<Icon>` · 40/40 شاشة h1 · 40/40 شاشة `<Screen>` · 0 أخطاء
- `hooks:check`: 188 مكوّنًا · 0 مخالفة
- `contrast`: 51 زوجًا × 3 ثيمات ✓
- `i18n:lint`: **103 نصًا** في 22 ملفًا (تحسّن ملف واحد وتثبيت السقف) ✓
- `parity`: 1147 مفتاحًا ✓
- `rpc:check`: 65 نداء / **126 دالة خادمية** ✓
- `sql:check`: **32 ملفًا** · 787 عبارة · 175 محلَّلة نحويًا · 161 دالة · **153 دالة SECURITY DEFINER (0 بلا search_path)** · 0 بلا تحكم وصول ✓
- `rpc:types`: **93 دالة** متطابقة ✓
- `test:engine` / `test:rls` / `test:search` / `test:calendar` / `test:perf` / `test:pentest` (5/5) / `test:load` (p95 = 0.84ms) / `test:e2e` (**62/62**) ✓

---

# الموجة D (Wave D) — فطن والأصول والبصريات والوظائف المتبقية (MASCOT + DESIGN + FUNC) (29 سبتمبر 2026)

| البند | الوضع | الدليل المُقاس |
| --- | --- | --- |
| **DESIGN-01→08 سلالم التوكينز البصرية والحركية** | ✅ منجز | `src/design/tokens.ts`: إضافة `elevation[0..4]`، وتوسيع `zIndex` (`dropdown`, `overlay`)، وإضافة `glassLevels` (`thin`, `thick`, `fallback`)، وإضافة `motionTokens` (`instant: 80ms`, `fast: 150ms`, `normal: 250ms`, `slow: 400ms`, `springGentle`, `springSnappy`, `reduced: 0ms`) |
| **MASCOT M2 + M3 سلم الريندر وحارس المنسق المركزي** | ✅ منجز | `src/design/mascot/MascotProvider.tsx` و`src/design/mascot/index.ts`: إنشاء `MascotProvider` و`useMascotStage` لمنع ظهور أكثر من تميمة نشطة على الشاشة في آن واحد (`claimStage`), مع سلم التراجع الثابت (`MascotStage` → `MascotSvgFallback` → `FATEN_STATIC_FRAMES`) لـ12 حالة كاملة (`12/12` من `FatenBehaviorState`) واحترام `isReducedMotion()` |
| **ASSET-01→06 فهرس الأصول الموحّد** | ✅ منجز | `assets/manifest.json`: توثيق جميع أصول الهوية وأيقونات PWA والتميمة والرسوم التوضيحية مع ميزانية الحجم القصوى (`≤ 200KB`) والتراخيص (`MIT`, `OFL-1.1`, `Proprietary`) |
| **FUNC-13 / FUNC-04 تصدير الشهادة PNG @2x + تثبيت QR في PDF + Open Badges 3.0** | ✅ منجز | `src/features/certificates/CertificatesScreens.tsx`: إضافة `exportCertificatePng()` لتوليد صورة `@2x` (`1600×1120`) عبر `HTMLCanvasElement` مع الـQR والختم وتنزيلها كملف `.png`، وتثبيت إحداثيات QR في قالب PDF (`position:absolute; bottom:16mm; left:18mm; width:32mm; height:32mm`) مع خطوط عربية أصيلة، وإضافة زر `exportOpenBadge()` لنسخ وثيقة `Open Badges 3.0` (`VerifiableCredential`) عبر `publicBadgeAssertion(cert.serial)` |
| **FUNC-15 رقم مرجع التذكرة والبحث برقم الخطأ (`MSR-XXXXXX`)** | ✅ منجز | `src/features/notifications/RequestsScreen.tsx` و`src/features/profile/ProfileScreens.tsx › SupportScreen`: عرض الرقم المرجعي للتذكرة (`MSR-XXXXXX`) فور إرسال الطلب، وإضافة بطاقة بحث للمشرفين والأدمن عبر `getErrorByRef(ref)` لعرض سجل الخطأ المرتبط |
| **FUNC-08 شريط طابور عدم الاتصال والمزامنة الفورية** | ✅ منجز | `src/design/components.tsx › OfflineQueueBanner` و`src/app/RootNavigator.tsx › TabsScaffold`: إظهار عدد العمليات المؤجلة (`pendingQueueCount`) وحالة الاتصال مع زر مزامنة فوري يستدعي `flushOfflineQueue()` |
| **FUNC-18 تطبيع الأرقام العربية واللصق في حقول الأكواد** | ✅ منجز | `src/features/courses/JoinBatchScreen.tsx` و`src/features/attendance/ScannerScreen.tsx`: تحويل الأرقام العربية المشرقية والفارسية (`٠-٩` / `۰-۹`) تلقائيًا إلى `0-9` وإزالة المسافات والشرطات عند اللصق |
| **FUNC-03 تصدير جدول المجموعة الكامل `.ics`** | ✅ منجز | `src/features/journey/JourneyScreens.tsx › JourneyMapScreen`: زر تصدير جميع جلسات المجموعة التدريبية كملف تقويم `.ics` موحّد عبر `buildIcs` و`saveIcs` |

**التحقق المقيس (`npm run test:all`):**
- `typecheck`: 0 أخطاء
- `a11y`: 58 عنصر ضغط · 199 `<Icon>` · 40/40 شاشة h1 · 40/40 شاشة `<Screen>` · 0 أخطاء / 0 تحذيرات
- `hooks:check`: 188 مكوّنًا · 0 مخالفة
- `contrast`: 51 زوجًا × 3 ثيمات ✓
- `i18n:lint`: **101 نصًا** في **21 ملفًا** (تنظيف `CertificatesScreens.tsx` بالكامل وتثبيت السقف الجديد) ✓
- `parity`: **1158 مفتاحًا** متطابقًا في `ar.ts` و`en.ts` ✓
- `rpc:check`: 65 نداء / 126 دالة خادمية ✓
- `sql:check`: 32 ملفًا · 153 دالة SECURITY DEFINER · 0 أخطاء ✓
- `rpc:types`: 93 دالة ✓
- `test:engine` / `test:rls` / `test:search` / `test:calendar` / `test:perf` / `test:pentest` (5/5) / `test:load` (p95 = 1.06ms) / `test:e2e` (**62/62**) ✓

---

# الموجة E (Wave E) — الجاهزية والتوثيق وبوابات الإطلاق (WEB + OPS + DOC + G-1…G-8) (29 سبتمبر 2026)

| البند | الوضع | الدليل المُقاس |
| --- | --- | --- |
| **WEB-02 Service Worker (`public/sw.js`) وتسجيله** | ✅ منجز | `public/sw.js` و`public/index.html` و`vercel.json`: تخزين القشرة الثابتة (`App Shell`) والأصول المجزأة (`/_expo/static/*`) باستراتيجية `Cache-First` للأصول غير القابلة للتغيير و`Network-First` للتنقل مع استثناء تام لطلبات Supabase (`/rest/v1`, `/auth/v1`, `/realtime/v1`, `/storage/v1`, `/functions/v1`) ورأس `no-cache` لـ`/sw.js` |
| **WEB-05 صفحة `public/404.html` المخصّصة** | ✅ منجز | `public/404.html`: صفحة 404 عربية أصيلة (`dir="rtl"`) تدعم الوضعين الفاتح والداكن تلقائيًا ومعلم `role="main"` وزر عودة مباشر للرئيسية |
| **PERF-01→06 تقسيم الشاشات الكسول (`Code Splitting`)** | ✅ منجز | `src/app/RootNavigator.tsx`: تحويل جميع مسارات الشاشات إلى `lazyScreen(...)`، مما رفع عدد حزم الويب (`dist/_expo/static/js/web`) من **8 حزم** إلى **24 حزمة** مستقلة وخفّض الحزمة الأولية (`index-*.js`) من **`2150KB (564KB gz)`** إلى **`1710KB (446KB gz)`** (`-440KB` خام / **`-118KB` مضغوطة gzip**) |
| **DOC-01 بيان الوصول وسياسة الخصوصية والاحتفاظ** | ✅ منجز | إنشاء `docs/ACCESSIBILITY_STATEMENT.md` (مطابقة WCAG 2.2 AA/AAA، قارئات الشاشة، الكيبورد، التباين، وتكبير 200%) و`docs/PRIVACY_AND_RETENTION.md` (معمارية Zero-Trust RLS، إخفاء PII، جداول الاحتفاظ `prune_retention_tables()`، وتصدير/حذف الحساب) |

---

# شهادة بوابات الإطلاق الرسمية (Release Gates G-1 → G-8)

| البوابة | المعيار | الحالة | الدليل الرقمي المُقاس |
| --- | --- | --- | --- |
| **G-1: السلامة البرمجية والأنواع** | `tsc --noEmit` = 0 أخطاء + `hooks:check` = 0 مخالفة + `rpc:types` متطابق | ✅ **PASS** | `typecheck`: 0 أخطاء · `hooks:check`: 193 مكوّنًا (0 مخالفة) · `rpc:types`: 93 دالة متطابقة · `rpc:check`: 65 نداء / 126 دالة خادمية |
| **G-2: انعدام الثقة وأمن قاعدة البيانات** | كل الجداول بـRLS `authenticated` + InitPlan + 0 `SECURITY DEFINER` بلا `search_path` + اجتياز `test:pentest` و`test:rls` | ✅ **PASS** | `sql:check`: 32 ملفًا · 787 عبارة · 161 دالة · **153 دالة SECURITY DEFINER (0 بلا `search_path`، 0 بلا تحكم وصول)** · `test:pentest`: 5/5 · `test:rls`: 15/15 |
| **G-3: إمكانية الوصول الشاملة (WCAG 2.2 AA)** | 40/40 شاشة بمعلم `<Screen>` وعنوان `h1` + حبس التركيز في `<Modal>` + بديل السحب + تباين 51 زوجًا × 3 ثيمات | ✅ **PASS** | `a11y`: 56 عنصر ضغط · 197 `<Icon>` · **40/40 شاشة h1** · **40/40 شاشة `<Screen>`** · 0 أخطاء / 0 تحذيرات · `contrast`: **51 زوجًا × 3 ثيمات** (0 فشل) |
| **G-4: الأصالة العربية والتعريب (RTL & i18n)** | تطابق 100% بين `ar.ts` و`en.ts` + 0 تراجع في النصوص المضمّنة + عزل Bidi + تطبيع الأرقام | ✅ **PASS** | `parity`: **1158 مفتاحًا** في القاموسين · `i18n:lint`: 101 نصًا في 21 ملفًا (تحسّن عن خط الأساس 104 في 22 ملفًا) · `test:search`: 32/32 · `test:calendar`: ناجح |
| **G-5: الأداء وتقسيم الحزم (Performance & Bundle)** | تقسيم كسول للشاشات والأصول الثقيلة (`svgStrings`) + `FlatList` للقوائم الطويلة + اجتياز اختبار الحمل | ✅ **PASS** | `export:web`: **24 حزمة مقسّمة** (الحزمة الأولية انخفضت بـ **118KB gzip** إلى **446KB gz**) · `test:perf`: ناجح · `test:load`: 1000 عملية، **p95 = 1.03ms** (< 1000ms)، خطأ **0.00%** |
| **G-6: الصمود دون اتصال (Offline Resilience)** | طابور أوامر غير قابل للتكرار (`command_log`) + `OfflineQueueBanner` + Service Worker (`public/sw.js`) | ✅ **PASS** | `OfflineQueueBanner` متصل بـ `pendingQueueCount` و`flushOfflineQueue` + `public/sw.js` مسجل في `public/index.html` |
| **G-7: تميمة «فطن» والهوية البصرية** | 12/12 حالة سلوكية + حارس `MascotStage` + تراجع ثابت مع `isReducedMotion()` + `assets/manifest.json` | ✅ **PASS** | `MascotProvider.tsx` يغطي 12/12 حالة من `FatenBehaviorState` + `assets/manifest.json` يوثّق الأصول وميزانيات الأحجام (`≤ 200KB`) |
| **G-8: التكامل الشامل وجاهزية النشر** | اجتياز `test:engine` و`test:e2e` بنسبة 100% + رؤوس الأمان في `vercel.json` + التوثيق الرسمي | ✅ **PASS** | `test:engine`: **68/68** · `test:e2e`: **62/62** · `vercel.json`: CSP + HSTS + nosniff + DENY + Permissions-Policy · `ACCESSIBILITY_STATEMENT.md` & `PRIVACY_AND_RETENTION.md` |

---

# الموجة E (Wave E) — إصلاح الأعطال الحرجة + الأداء + توحيد التصميم (29 سبتمبر 2026)

> الخطة المرافقة: `docs/UPGRADE_PLAN_2026-09-29.md`. كل البند أدناه مقيّس — بلا ادعاء بلا قياس.

| البند | الوضع | الدليل المقيس |
| --- | --- | --- |
| **P0 خطأ الأدمن/المتطوع (PGRST203)** | ✅ مُصلَّح في DB الحيّ | قبل: 3 بصمات لـ`admin_update_user_access` (pg_proc oids 18983/19267/19305) + 4 نداءات PostgREST كلها `PGRST203`. بعد: `0033_unify_admin_update_user_access.sql` (إسقاط بصمتَي 3-arg و4-arg) ⇒ pg_proc = **بصمة واحدة** + نفس النداءات ⇒ `42501` (صلاحيات سليمة لمفتاح anon؛ الأدمن الموثَّق ينفّذ) + `sql:check` 0 مخالفات |
| **P1 تعتيق أحداث Realtime** | ✅ | `remote.ts applyRealtimePatch`: `deepClone` كامل القاعدة لكل حدث → نسخة سطحية + `upsert` يعيد مصفوفة جديدة للجدول المتأثر فقط؛ كتلة المقاعد بعد حدث `enrollments` صارت `map` (لا تعديل كائن قديم)؛ `store.tsx writeCache`: coalescing ≤ كل 400ms بدل stringify كامل في كل حدث (فوري للتعطيل/الحذف فقط)؛ `markNotificationsRead`: `map` على الإشعارات بدل clone كامل |
| **P2 عاصفة الـ refresh** | ✅ | `store.tsx` (AppState active): لا سحب 24 جدولًا إلا عند قِدَم > 60s أو فشل sync — `flushOfflineQueue()` دائمًا و`refresh()` مشروط؛ Realtime يتصل/يفصل مع دورة حياة الخلفية (WIP مكمَّل) |
| **P3 توحيد التصميم** | ✅ | توكنز `navBar` (68/8/27) في `tokens.ts` + الحجز السفلي في `RootNavigator` من التوكنز (كان 104 ثابتًا ⇒ شريط رمادي ميت)؛ إزالة الحجز المزدوج من 13 شاشة تبويب؛ غلاف `gap: s3` لقوائم العذر/التقارير/المجموعات/المراجعات المتلاصقة؛ `ListRow grow` + شبكة KPI 48% + صناديق الأيقونات على `sizes/radii` + أحجام كسرية → سلّم `typeScale` + `glassHeavy/certGold/cardElevated` بدل القيم المباشرة |
| **P3 skeleton حقيقي** | ✅ | `PageSkeleton` جديد (fallback الشاشات الكسولة بدل `ActivityIndicator`) + `SkeletonList` مكان سطر «جارٍ التحميل» الجامد في `HubScreens`/`SessionsHistory` |
| **التحقق** | ✅ | `typecheck` 0 · `a11y`/`hooks`/`contrast`/`i18n:lint`/`parity`(1158)/`rpc:check`(65/126)/`sql:check`(0) · `test:engine` **68/68** · `test:e2e` **62/62** · `export:web` exit 0 (24 حزمة مقسّمة) |

**ملاحظة حوكمة:** `origin/main` (967a57a) والفروع محلية متباينة (~±1000 سطر: main بلا wave-c/d، والفروع بلا 0033) — الدمج قرار المستخدم.
**ملاحظة قياسية:** DB الحيّ صغيرة (audit_log 52 صفًا، sessions 33) — «ثقل القاعدة» كان وهمًا؛ الثقيلة كانت مزامنة العميل (24 طلبًا لكل foreground) وتُعالج في P1/P2.




---

# الموجة F (Wave F) — تعميق الجودة الشاملة: إصلاح الأعطال المرئية + الدقّة + السلاسة + الأمان (30 سبتمبر 2026)

> نتيجة تدقيق شامل (A→Z) على كل ميزة قائمة — بلا ميزات جديدة. كل بند أدناه مُصلَّح ومُقيَّس؛ لا ادعاء بلا قياس.

| البند | الوضع | الدليل المُقاس |
| --- | --- | --- |
| **عطل PWA: الـ Service Worker لا يُثبَّت أبدًا** | ✅ مُصلَّح | `public/sw.js`: `SHELL_ASSETS` كانت تشير إلى `/icon-maskable-512.png` (غير موجودة ⇒ `cache.addAll` يرفض بالكامل ⇒ السويرفر لا يعمل والعملاء بلا أوفلاين). أُصلح إلى `/maskable-icon.png` + تثبيت **متسامح لكل أصل** (`cache.add().catch()` لكل ملف) + إصدار كاش `v3.2.1`. تحقق برمجي: **10/10 أصول موجودة فعليًا في `dist/`** |
| **عطل i18n: مستخدمون يرون مفاتيح خام** | ✅ مُصلَّح | **6 مفاتيح ناقصة** أُضيفت للقاموسين: `common.pressBackAgainToExit` (إشعار الخروج بأزرار أندرويد كان يعرض المفتاح خامًا — `t(key) \|\| fallback` لا يعمل لأن `t` تُرجع المفتاح نفسه)، `common.pending_approval` / `common.running` / `common.completed` (شارات حالة الكورس في `CoursesScreen` كانت تعرض مفتاحًا خامًا لأي كورس بهذه الحالات)، `wizard.s5Body` (خطوة 5 من الأونبورد كانت تعرض مفتاحًا خامًا)، `rules.weekSessions` |
| **عطل دقّة: قاعدة «جلسات الأسبوع» موسومة بخطأ** | ✅ مُصلَّح | `WizardScreen.ruleKeyLabel`: case ناقص لـ`streak.min_sessions_week` كان يسقط على `presentPts` (الحضور في الموعد!) — أُضيف + `HubScreens` studio labels كان يعرض `streak.min_sessions_week` كنص خام — أُضيف + `formatRuleValue` كانت تخمّن الوحدة من اسم المفتاح (`includes('min')`) فتعرض «1 دقيقة» لقاعدة عدّاد — صارت تعتمد `def.unit` مباشرة |
| **بوابة CI جديدة: مطابقة الاستخدام للقاموس** | ✅ منجزة | `scripts/check-i18n-parity.js`: فحص كل `t('…')`/`tStatic('…')` ثابت في `src/` مقابل القاموسين (917 استخدامًا متحققًا). أُثبت أنه **يفشل فعليًا** عند حذف مفتاح (اختبار سلامة: exit=1) |
| **مؤقّتات بلا تنظيف (تسريب حالة بعد التفكيك)** | ✅ مُصلَّح | `ScannerScreen`: مؤقتا `setScanned(false)` بـ1200ms داخل ref يُنظَّفان عند التفكيك · `CertificatesScreens`: مؤقت `setCopied(false)` بـ1800ms كذلك (كانا يُستدعيان بعد الخروج من الشاشة) |
| **أداء: نبضة 500ms تعيد رسم LiveSessionScreen كاملة** | ✅ مُصلَّح | كانت الشاشة كلها (SVG الـQR + القوائم) تُعاد رسمها مرتين/ثانية من أجل حلقة العداد وحدها ⇒ نُقلت النبضة **داخل `RingCountdown`** (كومبوننت منفصل بـ`useState/useEffect` خاص) — الشاشة الأم لم تعد تُعاد رسمها مع كل تكّة |
| **أداء: نبضة 1s تعيد رسم TodayScreen كاملة أثناء الجلسة الحية** | ✅ مُصلَّح | كان `useNow(liveSess ? 1_000 : 60_000)` يعيد رسم الشاشة كل ثانية (كان يُحدّث `todayCheckedSession` useMemo كل ثانية!) ⇒ صار `useNow(60_000)` ثابت + كومبوننت منفصل **`EndsInCountdown`** (نبضة 1s) للسطر وحده. مكوّنات `hooks:check`: 194 → **195** |
| **دقّة: جمع عربي خاطئ في المدد** | ✅ مُصلَّح | `formatDuration` كانت تطبع «5 دقيقة» و«2 دقيقة» — صارت عبر `arabicCount` (كانت وظيفة ميتة بلا مستورد): «5 دقائق» · «دقيقتين» · «ساعتان» · «ساعة واحدة». الإنجليزي بلا تغيير. سلامة مقيسة: `0s→0 دقيقة · 1min→دقيقة واحدة · 2min→دقيقتين · 5min→5 دقائق · 25min→25 دقيقة · 60min→ساعة واحدة · 120min→ساعتين` |
| **استقرار: رفض وعود غير مُلتقط في مُستمع الجلسة** | ✅ مُصلَّح | `store.tsx onAuthStateChange`: `void applySession(s)` بلا catch — خطأ شبكة يُنتج unhandled promise rejection ⇒ صار `.catch()` مع `addBreadcrumb('net', …)` |
| **دقّة ديناميكية: StatBubble تُقصّ عند 1.4** | ✅ مُصلَّح | `glass.tsx`: `maxFontSizeMultiplier` 1.4 → **2** (مطابقًا لباقي المكوّنات) + `adjustsFontSizeToFit` على اسم البطاقة أيضًا |
| **أداء: ConfettiExplosion تُقيَّم كل رسم** | ✅ مُصلَّح | كانت `useRef(Array.from…)` تخلق **28×5 قيم Animated جديدة كل إعادة رسم** ثم ترميها ⇒ صارت `useState(() => …)` بتهيئة كسولة واحدة |
| **أمان: رؤوس حماية ناقصة في `vercel.json`** | ✅ منجزة | أُضيفت: `object-src 'none'` في CSP · `X-Permitted-Cross-Domain-Policies: none` · `X-XSS-Protection: 0` (تعطيل مُتسلّل الشبكة القديم) · `Cross-Origin-Resource-Policy: same-origin`. (COOP مُتجاهل بوعي: يكسر نوافذ OAuth البوب-أب) |
| **أمان: تبعيات بثغرات عالية** | ✅ مُصلَّح | `npm audit fix` (بلا `--force`): **16 (14 moderate + 2 high) → 11 moderate** — عالج brace-expansion (الثانويتين العاليتين) وdecode-uri-component وjs-yaml؛ سلسلة uuid تحتاج `--force` (مكسّرة لـexpo-sharing) — تُترك بوعي |
| **SEO/PWA: `robots.txt` بلا Sitemap + لون إقلاع مختلف** | ✅ مُصلَّح | أُضيف `Sitemap: …/sitemap.xml` إلى `robots.txt` · `manifest.background_color` `#F7F8FC` → **`#F5F5FA`** (مطابقًا تمامًا لـ`tokens.ts` و`index.html` — بلا شرخ لوني عند الإقلاع) |
| **تعريب: نصوص عربية مضمّنة تنقص (101 → 89)** | ✅ مُصلَّح | انتقلت إلى i18n: اقتباسات `TodayScreen` السبعة (مع استبدال `75%` الثابت بـ`certPct` المتغيّر!) · «⚡ مباشر الآن» → `management.live` · تلميح «اضغط على فطن» · رسالة فلاش السكانر (كانت تظهر عربية للإنجليزي) |
| **دقّة: خطأ الشبكة في السكانر يظهر خامًا بالإنجليزية** | ✅ مُصلَّح | `classifyError` (كانت وظيفة ميتة) موصولة الآن في `catch` السكانر: رسائل الشبكة تعرض `error.network` المترجمة بدل `Failed to fetch` الخام |
| **حوكمة: سقف التعريب مُثبَّت على التقدّم** | ✅ منجز | `i18n:lint --update`: خط الأساس **101 نصًا/21 ملفًا → 89 نصًا/20 ملفًا** (لا رجوع) |

**التحقق المقيس (`npm run test:all` — EXIT=0):**
- `typecheck`: 0 أخطاء
- `a11y`: 56 عنصر ضغط · 40/40 شاشة h1 · 0 أخطاء / 0 تحذيرات
- `hooks:check`: **195 مكوّنًا** · 0 مخالفة
- `contrast`: 51 زوجًا × 3 ثيمات ✓
- `i18n:lint`: **89 نصًا في 20 ملفًا** (تحسّن عن 101/21) ✓
- `parity`: **1174 مفتاحًا** + **917 استخدامًا ثابتًا متحققًا** (فحص الاستخدام الجديد) ✓
- `rpc:check`: 65 نداء / 126 دالة ✓ · `sql:check`: 0 أخطاء ✓ · `rpc:types`: 93 ✓
- `test:load`: p95 = **0.19ms** (الحد 1000ms) ✓ · `test:e2e`: **62/62** ✓
- `npm audit --omit=dev`: **16 → 11 moderate** (بلا force) ✓
- `export:web`: EXIT=0 · **24 حزمة مقسّمة** · `dist` 4.0MB · فحص `sw.js` المصدَّر: **10/10 أصول القشرة موجودة** ✓

**ما تُرك بوعي (خارج نطاق «تحسين القائم» أو مخاطرة غير مبرَّرة):** سلسلة uuid (تتطلب `--force` = كسر توافق) · COOP header (يكسر OAuth popup) · دومين sitemap المكتوب يدويًا (WEB-04 — يتغيّر بنطاق النشر) · إزالة التبعيات غير المستخدمة (مخاطر إضافات app.json).

# الموجة G (Wave G) — تقرير المستخدم: الأونبوردينج + توحيد الأسبيسينج + إزالة Apple + الأداء (1 أكتوبر 2026)

> أربعة بلاغات من صاحب التطبيق («افصل كل المشاكل دي وأصلحها في كل المشروع»): (1) شاشة الأونبوردينج الأولى ترتفع وتطوّل عند الضغط وتفسد ما بعدها، (2) بطاقات متلاصقة بلا أسبيسينج وغياب توكنز موحّدة، (3) إزالة تسجيل Apple — جوجل فقط، (4) الهيكل الرمادي يظهر كثيرًا والتحميل بطيء رغم الإنترنت الجيد.

| البند | الوضع | الدليل المُقاس |
| --- | --- | --- |
| **أونبوردينج: ارتفاع/تمطيط الصفحة عند «التالي»** | ✅ مُصلَّح (مقيس) | ثلاث إصلاحات: `illSize = Math.min(264, width*0.68, Math.max(150, height*0.34))` يمنع ازدواج تمرير الشرائح · `<ScrollView flexGrow:1>` في وسط `AuthScreens.tsx` يحبس التمرير الداخلية · `window.scrollTo(0,0)` في `onStateChange` يمنع جسما الصفحة من السحب. **مصفوفة `measure_overlap` @1366×640:** الشريحة 1−3 كلها `sh=640=innerH · scrollTop=0 · midOverCta= −107/−107/ −63` (سالب = لا تداخل) · signin نفس النتيجة. **@1280×800:** `800=800 · sy=0` |
| **أسبيسينج: بطاقات `.map(→Card)` متلاصقة داخل FadeIn** | ✅ مُصلَّح (بنيوي) | كان 8 FadeIns متعددة-الأبناء تحوي `<Spacer>` يدويًا داخل شاشات (نظري/كام/بعدات/شهادات/استكشاف/تحفيز/أورج/متطوع) ⇒ **`FadeIn` صار يطبّق `gap: spacing.s3` افتراضيًا** (قبل ستايل النداء ⇒ الأولوية للنادٍ) + **حُذفت 25 `Spacer` مباشرة داخل FadeIn** (المتداخلة داخل بطاقات بقيت — مكانها صحيح) + 20 سطرًا أُعيد فصل تنسيقها. الهياكل صارت `[عنوان, AutoGrid]` والعنوان يتنفس بالتوكن |
| **أسبيسينج: صفر قيم خام في `src/`** | ✅ مُنجز | سلّم `spacing.s1..s12` (4→48) + `nearest/tie→أكبر`: المطابقة المزدوجة `gap: N` + `gap={N}` + `Spacer size={N}` → **0 نهائياً** عبر `src/` (فحص grep شامل). ~468 تحويلًا في +35 ملفًا. إصلاحات أثناء السير: تضمين زائد `}}` ×3 · استيراد `spacing` مكرر ×4 · `ErrorBoundary gap:12` |
| **إزالة تسجيل الدخول بـ Apple (جوجل فقط)** | ✅ مُنجزة | حُذف: `AppleSignInButton` + حالات/تأثيرات/`submitApple` من `AuthScreens.tsx` (−4,369 بايت) · `signInWithApple` من `AppCtx` و `store.tsx` · `signInWithAppleNative`/`signInWithApple` من `supabase.ts` · ملف `design/integrations/appleSignIn.ts` بالكامل (`AUTH_CTA` صار مضمّنًا في زر جوجل: `radii.lg` + `sizes.ctaButton+4`) · **6 مفاتيح i18n** من القاموسين (1171=1171) · بلجن `expo-apple-authentication` من `app.json` · التبعية من `package.json` (node_modules مُفرَّغ). **قياس حي:** شاشة الدخول نصها «المتابعة بحساب Google» · `APPLE-MENTIONED:false · GOOGLE-PRESENT:true` |
| **أداء: الإقلاع ينتظر مزامنة كاملة (الهيكل الطويل)** | ✅ مُصلَّح | `applySession`: استعلام البروفايل الخفيف يحكم الهوية أولًا، و`refresh()` يبدأ متوازيًا لكنه **لا يعترض الإقلاع في مسار الدفء** (بروفايله في الكاش ⇒ يستمر خلفيًا مع breadcrumb للفشل) · مسار الكاش البارد ينتظر أول مزامنة **بحسب** حتى لا يومض مسار الزائر ثم ينقلب لشاشة المستخدم · `syncPendingQueueCount` لم يعد يحجب `setReady` |
| **أداء: هيكل رمادي عند كل أول تنقّل** | ✅ مُصلَّح | `RootNavigator`: **تحميل مسبق** لقطع التبويبات الأربعة + الإشعارات بعد 1.5s بنفس مُستدعي `import` (تُوحَّد الحزمة) — أول ضغطة تبويب تجد قطعها جاهزًا بدل `PageSkeleton` |
| **أداء: سباق الاستجابة في التحليلات** | ✅ مُصلَّح | `AnalyticsPanel`: حارس `reqRef` (استجابة قديمة لا تلوّث الحالة) + `user` في تبعيات التأثير (كان الوصول المتأخر للمستخدم يترك اللوحة فارغة بلا جلب) |

**التحقق المقيس (`npm run test:all` — EXIT=0 مرتين: بعد التوحيد+الإزالة، وبعد إصلاحات الأداء):**
- `typecheck`: 0 أخطاء · `a11y`: 0 مخالفة · `hooks:check`: 0 مخالفة
- `parity`: **1171 مفتاحًا في القاموسين** + 914 استخدامًا ثابتًا ✓ (بعد حذف 6 مفاتيح Apple)
- `rpc:check` 65/126 ✓ · `sql:check` ✓ · `rpc:types` 93 ✓ · `engine/rls/search/calendar/perf/pentest` ✓
- `test:e2e`: **62/62** ✓ · `test:load` ✓
- `grep` قيم أسبيسينج RN خام (`gap: N` / `gap={N}` / `Spacer size={N}`) في `src/`: **0** — والاستثناء الوحيد `gap:30px` داخل سلسلة CSS تخص تصدير HTML للشهادة (وسيط ورق، لا تخطيط RN)
- `export:web`: EXIT=0 · دخان متصفح حي: الأونبوردينج يتصفح 3 شرائح بـ`scrollH=innerH · scrollTop=0` في كل خطوة
