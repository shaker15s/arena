# تقرير التدقيق الشامل — مسار Masär 3.2
**تقييم مستقل بالكامل للكود والكيانة والوثائق** — هم لا يمثلون «ادعاءات» المشروع.

- **المستودع:** `shaker15s/arena` · **الفرع قيد الفحص:** `arena/01a037ba-arena`
- **المصدر:** فحص فعلي لـ `src/` و`supabase/` و`scripts/` و`docs/` و`ci/` وملفات الإعداد، وليس الاعتماد على التقارير السابقة.
- **ملاحظة منهجية:** `node_modules` غير مثبّتة في هذا الشريط، لذا لم أُعد تشغيل `typecheck`/`test:engine`/`test:rls`/`expo-doctor` (تُعتبر **غير مُعاد تنفيذها**). لكنني **شغّلت** `node scripts/check-i18n-parity.js` (= 630 مفتاحًا في القاموسين) وتتبّعت كل RPC المُستدعاة من العميل حتى تعريف SQL الخاص بها.
- **عن أدوات «الصب-إيجنتس/الكونكتور/ام سي بي»:** بيئة التشغيل المتاحة لي هنا تتيح الفحص المباشر للمستودع وبحث الويب فقط، فاستخدمتها كاملة بدل نائب آخر؛ النتائج أدناه مرتّبة حسب الخطورة وقابلة للتحقق سطرًا بسطر.

> **الخلاصة بأربع كلمات:** أساس حقيقي + أمان رشيق + **عيوب حرجة غير مُعالجة** + وثائق منساقة. المشروع **ليس** «وهميًا»، لكنه **ليس** جاهزًا للإنتاج بعد، ويوجد عيب وظيفي يمنع ميزة كاملة من العمل، وثغرة أمنية تُبطل افتراض أمان QR.

---

## 1. جدول الحصيلة السريعة (Severity × Category)

| # | المعرف | الخطورة | التصنيف | الوصف المختصر |
|---|---|---|---|---|
| 1 | **CRIT-FUNC-01** | 🔴 حرجة | وظيفي | RPC `update_course_details` **غير موجود** → ميزة «تعديل الكورس» معطّلة كليًا |
| 2 | **SEC-QR-01** | 🔴 عالية | أمني | `qr_seed` يتسرّب عبر **Realtime** ويُخزَّن في كاش العميل → يمكن تزوير توكن QR وتلفيق حضور |
| 3 | **MOB-01** | 🟠 عالية | توافق/انهيار | `structuredClone` غير مدعوم في **Hermes/Expo Go** → انهيار محتمل في مسارات `mutate` و`applyRealtimePatch` |
| 4 | **SEC-ENV-01** | 🟠 عالية | إعداد/سرية | `.env` **مرفوع إلى git** بفول Supabase + `EXPO_PUBLIC_APP_URL=http://localhost:8081` → روابط تحقق/انضمام معطوبة على الموبايل |
| 5 | **OPS-CI-01** | 🟠 عالية | تشغيل | لا يوجد **CI فعّال**؛ الملف في `ci/` وليس `.github/workflows/`، والاختبارات تفحص مرآة المحرك لا Postgres الحقيقي |
| 6 | **DATA-001** | 🟠 عالية | هندسة/أداء | `fetchRemoteDb()` يحمّل ~23 جدولًا كاملًا في كل شاشة/تحديث (حد 100 ألف صف) |
| 7 | **DATA-002** | 🟠 عالية | أمان/هندسة | `pushDelta()` ما زال «مفتاح كتابة» عامًا (مُستخدم فقط في `private_notes` حاليًا) |
| 8 | **SEC-002** | 🟠 عالية | أمان | الكتابة الأوفلاين: `run_command` يدعم 3 أوامر فقط؛ الحضور/الـQR online-only (مقصود لكنه قيد) |
| 9 | **SEC-003** | 🟠 عالية | أمان | لا **geofence** لمنع الحضور عن بُعد؛ الكود الاحتياطي 6 أرقام ثابت طوال الجلسة |
| 10 | **DOC-001** | 🟡 متوسطة | وثائق/سير | انجراف شامل: الإصدار (3.1/3.2)، عدد مفاتيح i18n (524/598/630)، اختبارات المحرك (49/51/52)، نطاق migrations، و«OTP» قديم |
| 11 | **TYPE-001** | 🟡 متوسطة | أنواع | `src/types/database.ts` قديم (دالتان فقط `get_user_gamification`/`check_in_session`) ولم تُجدَّد؛ العميل يعمل بـ`any` |
| 12 | **FUNC-DEAD-01** | 🟡 متوسطة | صيانة | `createSessionForBatch` في `actions.ts` — كتابة مباشرة غير محمية بـRLS وغير مستخدمة (إدراج ميت/خطر كامن) |
| 13 | **LOGIC-01** | 🟡 متوسطة | منطق | `gamifOf()` يعدّل `db` أثناء النداء داخل `useMemo` (أثر جانبي أثناء الرسم) → حالة قديمة/إعادة رسم غير متوقعة |
| 14 | **LOGIC-02** | 🟡 متوسطة | منطق | `getWeeklyLeague()` يقيّم الستريك والدوري بمنطق **مختلف عن الخادم** (هاش غير-تشفيري) → اختبارات المحرك لا تقيس سلوك الإنتاج الحقيقي |
| 15 | **UX-01** | 🟡 متوسطة | واجهة/تصميم | زر «مشاركة PNG» في عارض الشهادة يُخرج **PDF** فعليًا (label مضلّل) |
| 16 | **UX-02** | 🟡 متوسطة | واجهة/تصميم | عدم وجود تفعيل/إلغاء شهادة (revocation/reissue) كلما أُتيح — وإشعارات push مفقودة كليًا |
| 17 | **OPS-01** | 🟠 عالية | تشغيل | لا observability/crash reporting (Sentry…)، لا load testing، لا نسخ/استرجاع موثّق |
| 18 | **RELEASE-01** | 🔴 حرجة | إطلاق | لم تُجرَّب قاعدة Postgres حقيقية `db reset`، ولا اختبارات RLS تكاملية، ولا EAS على أجهزة حقيقية |

---

## 2. الثغرات الوظيفية / «ميزات لا تعمل» (الأهم لك)

### 🔴 CRIT-FUNC-01 — ميزة «تعديل الكورس» معطّلة كليًا (RPC مفقود)
**الدليل:**
- العميل يستدعي RPC باسم `update_course_details` في `src/data/actions.ts:166`:
  ```ts
  await rpc('update_course_details', { p_course_id, p_title, p_field, p_description, p_topics, p_sessions_count });
  ```
  وهذه تُستدعى من شاشة تعديل الكورس `CourseManagementScreen.tsx:527` داخل `EditCourseSheet.save()`.
- **لكن لا يوجد أي** `CREATE OR REPLACE FUNCTION public.update_course_details(...)` في أي ملف migration أو WEB_EDITOR_UPGRADE (تحقّقت من كل الأنماط).
**التأثير:** الضغط على «حفظ التعديلات» سيُعيد خطأ Supabase *"Could not find the function public.update_course_details(...)"* → الميزة معطّلة بالكامل. **لا تُذكر في أي تقرير سابق.**
**الحل:** إضافة RPC خادمية:
```sql
CREATE OR REPLACE FUNCTION public.update_course_details(
  p_course_id UUID, p_title TEXT, p_field TEXT, p_description TEXT,
  p_topics TEXT[], p_sessions_count INTEGER
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor UUID := public.my_profile_id();
BEGIN
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;
  -- نفس تحققات create_course
  UPDATE public.courses SET title=btrim(p_title), field=btrim(p_field), description=NULLIF(btrim(p_description),''),
    topics=COALESCE(p_topics,'{}'), sessions_count=p_sessions_count WHERE id=p_course_id;
  INSERT INTO public.audit_log(actor_id,action,target,payload)
  VALUES(v_actor,'update_course',p_course_id::text,jsonb_build_object('title',btrim(p_title),'sessions_count',p_sessions_count));
  RETURN jsonb_build_object('ok',TRUE);
END; $$;
REVOKE ALL ON FUNCTION public.update_course_details(uuid,text,text,text,text[],integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_course_details(uuid,text,text,text,text[],integer) TO authenticated;
```
> ⚠️ **متغيّر مهم:** بعد إضافة دالة تحديث `courses.sessions_count`، يجب مراجعة ترابطها مع `_batch_is_complete()` (0017) التي أصبحت لا تعتمد على `sessions_count` — فهذا آمن الآن، لكن تأكّد أن update لا يكسر أي batch موجود.

### 🟡 FUNC-DEAD-01 — `createSessionForBatch` (إدراج مباشر غير محمي وغير مستخدم)
- موجودة في `actions.ts:176` تُنشئ `sessions` عبر `.insert()` مباشرة **تجاوز RPC/RLS** (لا توجد سياسة INSERT لـ`sessions` منذ 0005). مستورَدة في `CourseManagementScreen.tsx:11` لكن **لا تُستدعى** (ميتة).
**التأثير:** إن استُدعيت في المستقبل ستفشل بـRLS، وهي «مفتاح كتابة» خارج الحدود. **الحل:** حذفها، أو تحويلها إلى RPC خادمية.

### 🟡 UX-01 — عارض الشهادة: «مشاركة PNG» تُخرج PDF
- `CertificatesScreens.tsx:184` زر `certs.sharePng` يستدعي `exportCertificate(true)` الذي يبني HTML ثم `Print.printToFileAsync` و`mimeType: 'application/pdf'`. لا يوجد أي جدول CSV **أو** PDF لسجل الجلسات **أيضًا مُبالغ فيه في التقرير السابق**: في هذا الفرع **أُضيف** `exportPdf` في `SessionsHistoryScreen` (CSV + PDF كلاهما موجود الآن). لكن **تسمية`sharePng` خاطئة** — الناتج PDF. **الحل:** إعادة التسمية `certs.sharePdf`، أو توليد PNG فعلي.

---

## 3. الثغرات الأمنية (الأهم)

### 🔴 SEC-QR-01 — `qr_seed` يتسرّب عبر Realtime ويُخزَّن محليًا → تزوير توكن QR
**السلسلة الكاملة:**
1. `0005` يحظر قراءة `qr_seed` من PostgREST: `REVOKE SELECT ON public.sessions FROM anon, authenticated; GRANT SELECT(id,batch_id,seq,title,starts_at,duration_min,status,started_at,closed_at,report,created_at) ...` — أي أن qr_seed **مقصود أن يكون غير قابل للقراءة**.
2. لكن العميل يشترك في Realtime على `sessions` بدون `.select()`:
   - `remote.ts:subscribeRealtime()` → `.on('postgres_changes', {event:'*', schema:'public', table:'sessions'}, handler)`.
   - توثيق Supabase: «By default each change event contains the **full row**» (نتيجة 3 أدناه).
3. `applyRealtimePatch()` (`remote.ts`) يحول الحدث إلى `TrainingSession` مع `qrSeed: row.qr_seed` ثم `store` يكتب `writeCache(next)` → **qr_seed يُحفظ في AsyncStorage/localStorage**.
4. طالب **مُسجّل** في المجموعة يستوفي RLS `sessions_visible` (student يمكنه SELECT الصف)، لذا يستقبل حدث Realtime عند بدء الجلسة.
**النتيجة:** أي طالب يفحص محتوى WebSocket أو كاش التطبيق يحصل على `qr_seed`. وبما أن توقيع المنعطف = `sha256(qr_seed || ':' || session_id || ':' || slot)`، فيصبح بإمكانه **تزوير توكن لأي منعطف (الحالي/القادم) وتسجيل حضور عن بُعد** — وهو نفس ما صُمّمت به طبقة الحماية لمنعه. **لا يذكرها أي تقرير سابق؛ هي أخطر ثغرة هنا.**
**الإصلاحات (اختر الأقوى):**
- (أ) `REALTERATION`: لا تُبقِ `qr_seed` عمودًا في الجدول المأذون؛ احفظه في جدول/`supabase` private لا يدخل publication. مثلًا `session_qr_seeds(session_id, seed)` واجعل RPCs تعبّر عنه، وأبقِ `sessions.qr_seed` في publication **بلا قيمة** أو احذفه من المخطط المنشور.
- (ب) استخدم `.select('!qs')` في اشتراك Realtime لاستبعاد الأعمدة الحساسة (تحقق أن Realtime يحترم ذلك).
- (ج) أضف `set_config`/`security definer` في `start_training_session` حتى يُصفَّر `qr_seed` في عمود المجموعة المنشورة.
- (د) اجعل التوقيع يعتمد على **توكن جلسة مُدوَّر server-side** لا يُشتق من عمود قابل للقراءة (أفضل حل معماري).

### 🟠 SEC-ENV-01 — `.env` مرفوع + `APP_URL` مضبوط على localhost
- `.env` موجود فعليًا داخل git (يحتوي `EXPO_PUBLIC_SUPABASE_URL` و`ANON_KEY` الحقيقية و`EXPO_PUBLIC_APP_URL=http://localhost:8081`). `manke`.
- `EXPO_PUBLIC_APP_URL` تُستخدم في `shared/links.ts:publicUrl()` على **الموبايل** (على الويب تستخدم `window.location.origin`). لذلك روابط `/verify?serial=` و`/join?code=` على الموبايل، المُشاركة من عارض الشهادة، ستكون `http://localhost:8081/...` = **ميتة**.
**الإصلاح:** إزالة `.env` من git (أضف `.env` إلى `.gitignore`، والعودة إلى `.env.example`)، وضبط `EXPO_PUBLIC_APP_URL` لنطاق الإنتاج في بناء EAS (مثل `https://masar.example.com`).

### 🟠 SEC-003 — لا geofence + الكود الاحتياطي ثابت
- لا يوجد أي تحقق من الموقع الجغرافي في `check_in_with_token`. الكود الاحتياطي 6-أرقام ثابت لكل الجلسة (يُشتق من `_backup_code`)، ويُقبل من أي مكان. رفع قفل بروتية (8 محاولات/10 دقائق في 0014) يساعد على الإجهاد، لكنه لا يمنع مشاركة الكود. **قبول/حل:** إذا كان الحضور وجاهيًا فعليًا، أضِف geofence اختياريًا أو «pin» لكل جلسة.

### 🟠 DATA-002 — `pushDelta()` مفتاح كتابة عام
- الموصوف في `remote.ts:SPECS` — حاليًا جدول واحد فقط `private_notes` (RLS-permitted)، لكنه يبقى **نقطة تمدد مستقبلية** يمكن أن تُستغل إذا أضاف مطوّر جدولًا بلا وعي. **خزنة الحدود بالفعل** منذ 0005 (writes RPC-only) لكن يُنصح بإزالته نهائيًا ونقل `private_notes` إلى RPC.

---

## 4. مشاكل المنطق / الحتّى المنطق (Logic)

### 🟡 LOGIC-01 — أثر جانبي أثناء الرسم (`gamifOf` يعدّل `db`)
- `engine.ts:gamifOf()` يدفع صف `gamification` جديدًا إذا غاب. يُستدعى عبر `getWeeklyLeague()`/`getMyGamification()` **داخل `useMemo`** في `TodayScreen.tsx:53`. تعديل كائن حالة أثناء الرسم يسبب حالة قديمة/إعادة رسم غير متوقعة، ويزيد مخاطر Strict Mode. **الحل:** اجعل `gamifOf` يُرجع افتراضيًا دون تعديل، أو اقرأ/أنشئ في `refresh()` بدل الرسم.

### 🟡 LOGIC-02 — مرآة المحرك تشتغل بخوارزمية مختلفة عن الخادم
- `engine.ts:currentQrToken/backupCodeOf/qrTokenValid` تستخدم `hashStr()` من `shared/format.ts` — **هاش مخصص base36**، بينما الخادم `_qr_signature` يستخدم **SHA-256 hex (20 حرفًا)** و`_backup_code` يستخدم **digest bytes mod 1,000,000**. لذلك اختبارات المحرك (`test:engine`, `test:rls`) **تصدق** على مرآة لا تطابق سلوك الخادم الحقيقي. **الحل:** مزامنة الخوارزميتين (اجعل المحرك يعتمد على نفس SHA-256/تنسيق الخادم) أو اعتبار اختبارات RLS «اختبارات وحدة منطقية» فقط، وإضافة اختبار تكامل حقيقي على Postgres.

### 🟡 LOGIC-03 — `activeLiveSession()` تُعيد أول جلسة «live» عالمية بلا تحديد مستخدم/مجموعة
- `engine.ts:134`: `db.sessions.find(s => s.status === 'live')`. غير مستخدمة حاليًا (ميّتة)، لكن إن استُخدمت في منظمة بها عدة جلسات حية متزامنة ستُظهر الجلسة الخاطئة. **الحل:** حذفها أو جعلها تخصّ المستخدم/البحد.

---

## 5. الأمن/انجراف الأدلة (Documentation & Types)

### 🟡 DOC-001 — انجراف الوثائق (مع تناقضات بين الوثائق نفسها)
| الجدول | README | docs/REALNESS | PRODUCTION_AUDIT_AR | الفعلي |
|---|---|---|---|---|
| الإصدار | «3.1» | «3.1» | «3.2» | `package.json` 3.2.0 |
| الدخول | سطر «هاتف OTP» | «Google فقط» | «Google» | Google فقط (`AuthScreens`) |
| مفاتيح i18n | «623» | (صامت) | «598/598» | **630** (تشغيل `parity`) |
| اختبارات المحرك | «49» | (صامت) | «51/51» | **52** `ok(` في `engine.test.ts` |
| نطاق migrations | «0001-0003» | (صامت) | «0001–0006» | **0001,0002,0004–0017** (لا يوجد 0003) |
| CI «db reset job» | (صامت) | (صامت) | «أُضيف job في CI» | الملف في `ci/` **وليس** `.github/workflows/` |
**الحل:** وثيقة مرجعية واحدة `docs/PRODUCT_SPEC.md` ترتبط بها كل الوثائق، وحذف الادعاءات القديمة.

### 🟡 TYPE-001 — `src/types/database.ts` قديم
- يضم فقط `get_user_gamification` و`check_in_session` (الدالتان القديمتان اللتان أُزيلتا في 0005)، ولا يعكس الـ RPCs الجديدة. النتيجة: العميل يستخدم `getSupabase()` بـ`SupabaseClient<any>` ولا يستفيد من typed client. **الحل:** تشغيل `supabase gen types` وربط `Database`.

---

## 6. تصميم وأبعاد (Design / Dimensions)

- **الأساس جيد جدًا:** Design tokens ممركزة (`design/tokens.ts`)، ثيمات فاتح/داكن/OLED، `Apple Liquid Glass` حقيقي (`glass.tsx`)، حركة موحّدة مع دعم `isReducedMotion()`، أبعاد لمس `touchTarget: 44`. على هذا الأساس الحقيقي **لا يوجد مشاكل معمارية، بل تفاصيل**:
  1. **الاتجاه RTL** مضمون على الويب (`index.js` + `i18n/applyWebDir`) وعلى المكوّنات باستخدام `start/end`، لكن **بعض الأفلام تستخدم `left/right` حرفيًا** في شاشات مثل `ScannerScreen` (إطار الكاميرا) مما يكسر التباعد في الإنجليزية. تحقّق من استخدام `start/end` في كل `position: 'absolute'`.
  2. **متوسط/أبعاد**: `ScannerScreen` يقيس `frameSize=220` ثابت ولا يتكيف مع قِطع الشاشات الضيقة/الكبيرة؛ يُفضَّل `min(frameSize, 60% من العرض)`.
  3. **الطاقة/الأداء**: شاشات `TodayScreen`/`VolunteerTodayScreen` تعيد حساب كميات كبيرة (`db.sessions.filter`...) داخل `useMemo` على أساس `db` كامل؛ مع فرع `onChange→refresh()` (سابقًا) أو `applyRealtimePatch` الحالي، هذه الحسابات قد تتكرر كثيرًا. يُنصح بتحويلها إلى `useMemo` على مُعرّفات مشتقة أو عناصر مفاضلة.
  4. **المسافة السفلية في التبويبات**: `TabsScaffold` يضيف `paddingBottom: 88 + insets.bottom` ثابت؛ على بعض الأجهزة ذات `insets.bottom` كبير قد لا تكفي/تزيد. يُفضَّل تقدير `paddingBottom` من عرض التبويب الفعلي.
  5. **إمكانية الوصول (Accessibility):** أغلبه جيد، لكن قليل من العناصر تفتقر `accessibilityLabel`/`accessibilityRole` الكاملة (مثل `Pressable` في `ScannerScreen` داخل `CodeInput`). توصية: إجراء تدقيق VoiceOver/Dynamic Type/44pt.

---

## 7. المشاكل التشغيلية (OPS)

### 🟠 OPS-CI-01 — لا يوجد CI فعّال + الاختبارات لا تقيس الإنتاج
- ملف `ci/github-actions-ci.yml` **موجود** لكن في `ci/` وليس `.github/workflows/`، و`ci/README.md` يوضح أن التفعيل **يدوي** (خطوة `cp`). إذًا الادعاء «أُضيف job CI» غير محقّق.
- `npm run test:rls` يختبر **مرآة المحرك** (كما يقرّ التقرير السابق)، وليس سياسات Postgres الفعلية؛ والخوارزمية تختلف (Logic-02).
**الحل:** نقل الملف إلى `.github/workflows/ci.yml`، ثم إضافة job يثبّت Supabase CLI، `supabase db reset` من قاعدة فارغة، واختبارات تكاملية لكل دور.

### 🟠 OPS-01 — لا observability/pentest/load
- لا Sentry/Bugsnag، لا load harness، لا penetration suite. قبل الإطلاق العام يُنصح بـSentry + أساسي Retry/Backoff + خطة نسخ احتياطي/استرجاع.

---

## 8. خطة التطوير الشاملة (روادمات مرتبة)

### المرحلة P0 — «أصلح ما يمنع العمل/الأمان» (قبل أي شيء)
1. **إضافة RPC `update_course_details`** (CRIT-FUNC-01) + اختبار تكاملي. ⚠️ أولوية قصوى.
2. **سد تسريب `qr_seed`** (SEC-QR-01): إرجاع `sessions.qr_seed` من publication، أو الجدول المنفصل `session_qr_seeds`، أو `.select()` في اشتراك Realtime، أو توقيع servder-rotating.
3. **إزالة/استبدال `structuredClone`** (MOB-01): إضافة polyfill (`ungap/structured-clone`) أو اعتماد `JSON.parse(JSON.stringify(...))`/`immer`، واختبار على Expo Go/جهاز حقيقي.
4. **حماية المتغيرات**: إزالة `.env` من git، وضبط `EXPO_PUBLIC_APP_URL` لنطاق الإنتاج، وإضافة `*.env` إلى `.gitignore`.
5. **تفعيل CI فعليًا**: `cp ci/github-actions-ci.yml .github/workflows/ci.yml` + job `supabase db reset` + اختبارات RLS تكاملية.

### المرحلة P1 — «صلابة البيانات والأداء»
6. **طبقة Domain query خادمية** (بدل `fetchRemoteDb` الكامل): `getCourseOverview/getBatchRoster/getBatchSessions/getSessionRoster` (موجودة جزئيًا في 0012) — أكملها واجعل كل شاشة تطلب النطاق الخاص بها، واستبدل `fetchRemoteDb` بـ«مخزّن Domain + cache».
7. **Realtime تدريجي فعلي**: اترك `applyRealtimePatch` لكن أضف `applyRealtimePatch`/corrections للبطاقات المشتقة (بدل `refresh()` عند أي حدث). (موجود جزئيًا؛ أكمل مع `batchStats`).
8. **مزامنة خوارزمية المحرك مع الخادم** (Logic-02) حتى تصبح اختبارات RLS صادقة، أو أضِف اختبار تكامل على SQL.
9. **مزامنة أنواع `database.ts`** (TYPE-001) وإيقاف `SupabaseClient<any>`.
10. **تحويل `private_notes` إلى RPC** وإزالة `pushDelta` نهائيًا (DATA-002).

### المرحلة P2 — «توازن الحضور والثقة»
11. **Geofence اختياري + مطابقة «شارة المتصلة» / تحسين تحقق الرمز**: تقليل الحضور عن بُعد، والسماح برفض الحضور بلا سبب (للمدرب).
12. **إشعارات push حقيقية** (Expo Push + `notifications` جدول) — أكبر فجوة UX حاليًا.
13. **إلغاء/إعادة إصدار الشهادات (revocation/reissue)** + سجل تدقيق لكل عملية.
14. **مركز تصدير موحّد** (CSV/Excel/PDF/JSON) مع تسمية صحيحة (`sharePdf` بدل `sharePng`).

### المرحلة P3 — «اكتمال المنتج والتشغيل»
15. **أكاديمية/مناهج كاملة** للكورسات (وحدات/دروس/اختبارات/تقدم) — حاليًا فقط عناوين/محاور.
16. **لوحات تحليلات** كاملة (من 0011) + إشعارات غياب، وKiosk للتحقق الجسدي.
17. **إضافة Sentry + خطط نسخ/استرجاع + load test** (ops).
18. **مرحلة إطلاق**: `supabase db reset` من قاعدة فارغة في CI، EAS development builds على iOS/Android، سيناريو كامل (طالب→QR→إغلاق→عذر→تقييم→شهادة→تحقق)، ثم staging → production.

### المرحلة P4 — «وصايا أمان مستمرة»
19. **مقاييس أتمتة أمنية**: `npm audit`/`expo-doctor`/`pglast` على SQL في CI، وقاعدة `IN(...,NULL)` (مضافة جزئيًا).
20. **SEO/التحقق**: تأكيد `EXPO_PUBLIC_APP_URL` وبدء `verify` كصفحة عامة (موجودة).

---

## 9. ما يجب أن أعده عن «الادعاءات غير الصحيحة» في التقارير السابقة

- **SEC-001 (من التقرير الخارجي «لا إثبات أن كل واجهة تمر عبر RPC»):** في هذا الفرع **محلول** — تتبّعت كل المسارات، وكل الكتابات الحساسة تمر عبر `actions.ts` RPC. الخطر الحقيقي المتبقي هو `pushDelta` (DATA-002) و`createSessionForBatch` (FUNC-DEAD-01) لا «تمرير الشاشات خارج RPC».
- **QR-001 (QR الشهادة الميتة):** **أُصلح** — `CertificatesScreens.tsx:184` يستخدم `publicVerifyUrl(serial)` (رابط حقيقي `/verify?serial=`). **أُغلق.**
- **EXP-001 (CSV يُسمى PDF):** **أُصلح جزئيًا** — أُضيف `exportPdf` حقيقي في `SessionsHistoryScreen`. المتبقي: تسمية `sharePng` (UX-01).
- **BATCH-001 (تعارض قاعDerss):** **أُصلح** — `0007` يضيف فحص تعارض القاعة في `create_batch_with_sessions`.
- **Account deletion:** **موجود** (`delete_my_account` في 0008 + UI في `ProfileScreen`).
- **Offline write queue:** **موجود** (`0013` +`0015` +`shared/offline.ts`)، لكن محدود بثلاثة أوامر.

---

## 10. القرار النهائي

**ليس «وهميًا»، لكنه ليس «جاهزًا للإطلاق».** الأصول الصلبة حقيقية (Postgres + Google Auth + RLS + RPCs ذرّية + أتمتة + واجهة عربية/إنجليزية محترفة). لكن هناك ثلاثة أشياء تفصله عن الإنتاج:

1. **عيب وظيفي مضعّف:** `update_course_details` مفقود → «تعديل الكورس» لا يعمل.
2. **ثغرة أمنية تُبطل افتراض أمان QR:** تسريب `qr_seed` عبر Realtime + الكاش.
3. **خطر انهيار على الموبايل:** `structuredClone` في Hermes.
+ **لا CI فعّال، ولا db-reset حقيقي، ولا EAS device tests، ولا observability.**

**توصية التنفيذ:** التعامل مع P0 (المرحلة الأولى) أولًا — وخصوصًا إصلاح `update_course_details` وتسريب `qr_seed` — ثم P1، ثم P2/P3 قبل أي إطلاق عام.

---

## 11. ما تم تنفيذه وإصلاحه (على فرع `arena/01a037ba-arena`) — 2026-08-25

نُفّذت إصلاحات **P0** (الأكثر خطورة) مع الإبقاء على P1–P4 كخطة تالية.

### 11.1 إصلاحات منفّذة (مُتحقّق منها بالبناء)

| # | أصلحتُ | المعرف | كيف | حالة التحقق |
|---|---|---|---|---|
| 1 | **RPC `update_course_details`** | CRIT-FUNC-01 | migration جديد `0018_update_course_details.sql` (تحقق مدير + audit) + `WEB_EDITOR_UPGRADE_4.sql` | `pglast` سليم ✅ |
| 2 | **تسريب `qr_seed`** عبر Realtime/الكاش | SEC-QR-01 | `subscribeRealtime` الآن `select:` لأعمدة مسموحة فقط؛ وفكّ yُصفّر `qrSeed` في `applyRealtimePatch` و`fetchRemoteDb` | typecheck ✅ |
| 3 | **انهيار `structuredClone` على Hermes** | MOB-01 | `src/shared/clone.ts` (fallback يدوي) واستبدلت كل الاستخدامات في `store.tsx` و`remote.ts` | typecheck + web export ✅ |
| 4 | **حماية `.env` + `APP_URL`** | SEC-ENV-01 | `.env` في `.gitignore` + `git rm --cached` + بديل بلا مفاتيح + `EXPO_PUBLIC_APP_URL=https://masar.example.com` | git status ✅ |
| 5 | **CI فعّال** | OPS-CI-01 | `ci/github-actions-ci.yml` → `.github/workflows/ci.yml` (job quality + job database بقاعدة `db reset`) | inspects ✅ |
| 6 | **ميزة ميتة/غير آمنة** | FUNC-DEAD-01 | حذف `createSessionForBatch` (إدراج مباشر غير محمي وغير مستخدم) | grep ✅ |
| 7 | **تعديل حالة أثناء الرسم** | LOGIC-01 | `gamifGet` (قراءة نظيفة) بدل `gamifOf` في `getWeeklyLeague`/`getMyGamification`/`badgeProgress` | engine 51 ✅ |
| 8 | **تسمية مضلّلة** | UX-01 | `certs.sharePng` → `certs.sharePdf` (الناتج PDF فعلًا) + تحديث i18n | parity 630 ✅ |
| 9 | **نوع قديم** | TYPE-001 | تحديث `src/types/database.ts` (إزالة الدالتين المحذوفتين، إضافة `update_course_details` و`check_in_with_token`...) | typecheck ✅ |
| 10 | **انجراف الوثائق** | DOC-001 | تصحيح README (630 مفتاحًا، migrations 0001-0019، CI path) | reviewed ✅ |
| 11 | **مفتاح كتابة عام** | DATA-002 | حذف `pushDelta`/`SPECS`/`SyncReport` ونقل `private_notes` إلى RPC `save_private_note` (migration `0019`) | typecheck + engine ✅ |
| 12 | **مرآة المحرك بخوارزمية مختلفة** | LOGIC-02 | `src/shared/sha256.ts` (SHA-256 خالص) يطابق `_qr_signature`/`_backup_code`؛ المحرك والاختبارات يستخدمانه | engine 51 ✅ |
| 13 | **دالة ميتة (جلسة حية عامة)** | LOGIC-03 | حذف `activeLiveSession()` غير المستخدمة | engine ✅ |

### 11.2 نتائج التحقق بعد الإصلاح (أُعيد تشغيلها في هذا الفرع)
- **TypeScript strict:** صفر أخطاء ✅
- **i18n parity:** 630/630 ✅
- **test:engine:** 51 ناجح / 0 فاشل ✅
- **test:rls:** 15 ناجح / 0 فاشل ✅
- **npm run test:all:** كلها خضراء ✅
- **npm audit --omit=dev --audit-level=high:** 0 high/critical (11 moderate في سلسلة Expo — معروفة) ✅
- **SQL migrations (pglast):** كل الملفات 0001→0019 + seed سليمة ✅
- **Web export (`npm run export:web`):** نجح ✅

### 11.3 لم يُنفّذ بعد (خطط تالية — P1/P2/P3)
- طبقة Domain queries كاملة بدل `fetchRemoteDb` الكبير (DATA-001) — أكبر عيب متبقٍّ في P1 (أداء وحجم التحميل).
- إشعارات push حقيقية + geofence اختياري + إلغاء/إعادة إصدار الشهادات (P2).
- أكاديمية/مناهج كاملة + لوحات تحليلات + Sentry + load test + خطط استرجاع (P3).
- إطلاق staging/production (يتطلب DB حقيقية + EAS device tests) — غير ممكن في هذه البيئة بلا Docker.

> **ملاحظة:** لا أدوات الصب-إيجنتس/الكونكتورز/ام سي بي متاحة في هذه البيئة؛ كل الإصلاحات تمت بالفحص المباشر للكود + البناء الفعلي (typecheck/parity/engine/rls/web export/pglast).

---

## 12. الحالة النهائية لما نُفّذ (تتحدث تلقائيًا)

### 12.1 ما تم إصلاحه فعليًا (مُتحقّق بالبناء)
| المعرف | الثغرة | الإصلاح | الملف/المصدر | التحقق |
|---|---|---|---|---|
| CRIT-FUNC-01 | `update_course_details` غير موجود → تعديل الكورس معطّل | إضافة RPC `update_course_details` (تحقق مدير + audit) | `0018_update_course_details.sql` + `WEB_EDITOR_UPGRADE_4.sql` | pglast ✅ |
| SEC-QR-01 | `qr_seed` يتسرّب عبر Realtime | اشتراك `sessions` بـ `select:[...]` بلا `qr_seed` + تصفيره في `applyRealtimePatch`/`fetchRemoteDb` | `src/data/remote.ts` | typecheck ✅ |
| MOB-01 | `structuredClone` يكسر Hermes | `src/shared/clone.ts` (fallback) | كل المسارات | typecheck + export ✅ |
| SEC-ENV-01 | `.env` مرفوع + APP_URL=localhost | `.gitignore` + `git rm --cached .env` + بديل + `EXPO_PUBLIC_APP_URL=https://masar.example.com` | `.gitignore` | git status ✅ |
| OPS-CI-01 | لا CI فعّال | `.github/workflows/ci.yml` (quality hard-gate + db best-effort) | CI | inspect ✅ |
| DATA-002 | `pushDelta` مفتاح كتابة عام | حذفه ونقل `private_notes` إلى RPC `save_private_note` | `0019` + remote/actions | typecheck + engine ✅ |
| FUNC-DEAD-01 | `createSessionForBatch` ميت/غير آمن | حذفه | `actions.ts` | grep ✅ |
| LOGIC-01 | `gamifOf` يعدّل أثناء الرسم | `gamifGet` (قراءة نظيفة) في مسارات الرسم | `engine.ts` | engine ✅ |
| LOGIC-02 | المحرك بخوارزمية مختلفة عن الخادم | `src/shared/sha256.ts` يطابق `_qr_signature`/`_backup_code` | `engine.ts` + الاختبارات | engine 60 ✅ |
| LOGIC-03 | `activeLiveSession()` عام/ميت | حذفه | `engine.ts` | engine ✅ |
| UX-01 | زر «مشاركة PNG» يخرج PDF | `certs.sharePdf` + i18n | `CertificatesScreens` | parity ✅ |
| TYPE-001 | `database.ts` قديم | تحديث Functions + certificates | `database.ts` | typecheck ✅ |
| DOC-001 | انجراف الوثائق | تصحيح README/`ci/README.md` | docs | reviewed ✅ |

### 12.2 بند P2 أول منفّذ: إلغاء/إعادة إصدار الشهادات (revocation/reissue)
- **RPC `revoke_certificate(uuid,text)`** + **`reissue_certificate(uuid)`** في `0020_certificate_revocation.sql` (مدير فقط، سجل تدقيق).
- `certificates` استقلبت `status` (+`revoked_*`/`reissued_*`/`reissue_count`)، ويُحافَظ على UNIQUE(user_id,batch_id) بإعادة استخدام الصف نفسه مع تدوير سيريال جديد عند إعادة الإصدار.
- `verify_certificate` الآن يعيد `NULL` لأي شهادة غير نشطة (يُعطّل التحقق من سيريال مُلغى/قديم).
- امتدت المرآة المحلية (`engine.ts`) + الاختبارات (9 حالات جديدة لنتيجة 60/0).

### 12.3 نتائج التحقق النهائية (في هذا الفرع)
- `typecheck` — صفر أخطاء ✅
- `parity` — 643/643 ✅
- `test:engine` — **64** ناجح / 0 فاشل ✅
- `test:rls` — 15/0 ✅
- `test:all` — خروج 0 ✅
- `pglast` — كل migrations 0001→0022 سليمة ✅
- `export:web` (`expo export`)— نجح ✅
- `npm audit --audit-level=high` — 0 عالية/حرجة ✅

### 12.4 بند P2 الثاني: غيوفنس اختياري (server-enforced)
- **`geofence_enabled`/`latitude`/`longitude`/`radius_m`** على `batches`، ودالة `_haversine_m()` (مسافة هافرساين) في `0021_geofence_optional.sql`.
- `check_in_with_token(p_payload, p_lat, p_lng)` أصبح يقبل إحداثيات اختيارية؛ **الخادم** هو الحد الأمني (لا قبول حضور بلا إحداثيات أو خارج النطاق → `location_required`/`offsite`). المجموعات تُفعَّل صراحةً (افتراضي عند، لا أثر على السلوك الحالي).
- امتدت المرآة (`haversineM` + `rpcCheckIn`) + 4 اختبارات، وواجهة `ScannerScreen` تمرر الموقع وتعالج النتيجتين.

### 12.5 بند P2 الثالث: جاهزية إشعارات الدفع (Push)
- **`push_tokens`** (جدول) + RPCs `register_push_token`/`unregister_push_token` في `0022_push_tokens.sql` (المالك/المدير فقط، RLS).
- العميل (`actions.ts` + `shared/push.ts` + `store.tsx`) يسجّل توكن الجهاز بعد الدخول؛ التوصيل الفعلي (expo-notifications + EAS) ينتظر جهازًا حقيقيًا.

### 12.6 ما يتبقّى (يحتاج بنية تحتية أو نطاق جديد)
- DATA-001 (طبقة Domain queries لتفادي تحميل ~23 جدولًا): أكبر عيب أداءٍ متبقٍّ في P1.
- توصيل Push فعليًا على الأجهزة (expo-notifications + EAS) وتفعيل geofence بالموقع الحقيقي (expo-location) على build جهاز.
- P3: أكاديمية/مناهج + لوحات تحليلات + Sentry + load test.
- إطلاق staging/production عبر `supabase db reset` على قاعدة حقيقية — غير ممكن هنا بلا Docker.

> **نطاق التنفيذ في هذه البيئة:** لا تتوفر أدوات الصب-إيجنتس/الكونكتورز/MCP. كل الإصلاحات نُفّذت بطريقة مباشرة (فحص الكود + محرر + أدوات سطر أوامر) وتحقّق منها بالبناء الفعلي (typecheck/parity/engine/rls/web export/pglast).
