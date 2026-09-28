# سجل التنفيذ — مسار 3.2 → 4.0

> **المرجع:** `MASAR_MASTER_PLAN_2026-09-28.md` (الخطة الواحدة). هذا الملف يوثّق **ما نُفِّذ فعلًا**،
> بالملف والسطر والأمر والناتج المقيس — بلا أي ادعاء غير مقيس.
> **آخر تحديث:** 28 سبتمبر 2026 · الفرع: `arena/01a0e854-arena`.

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
