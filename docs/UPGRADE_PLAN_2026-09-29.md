# مسار — خطة التطوير الشاملة (2026-09-29)

> **الحالة:** كل بند في §2 نُفِّذ ومُتحقَّق هذا اليوم (أدلة مقيّسة). §3/§4/§5 = المتبقي
> مرتَّبًا بالأولوية على أساس البوابات الموجودة في المستودع، بلا أي بند بلا دليل.
> **الفرع/العمل:** `arena/01a0e854-arena` · DB الحيّ: `udqgaudtclkbaygftndx` (ACTIVE_HEALTHY)

---

## 1) المشكلة كما وصفها المستخدم — والتشخيص المُثبت (لا تخمين)

| شكوى المستخدم | التشخيص المُثبت | الحالة |
| --- | --- | --- |
| «بطيء/بيهنج، بيحمل كل الكويريز في كل ريفريش» | **3 مصادر**: (أ) `fetchRemoteDb` = 24 طلبًا متوازيًا يُسحب في كل foreground/online/push/patch-فشل، (ب) `applyRealtimePatch` كانت تعمل `deepClone` كامل القاعدة + `JSON.stringify` كامل الكاش **في كل حدث Realtime** (بدون coalescing)، (ج) شاشة `lazyScreen` fallback = دائرة تحميل فقط | **مُصلَّح** §2 |
| «بيحمّل لو طلعت ورجعت في ثواني، ولو مستني 10 ثواني مبيحمّلش» | نفس المصدر (أ): `AppState 'active'` (على الويب = تبديل التبويب) كان ينفّذ refresh غير مشروط. «10 ثواني مبيحمّلش» كان يعني ببساطة أن Patch-Realtime كان يمسك التحديث دون سحب كامل | **مُصلَّح** §2 (بوابة قِدَم 60s) |
| «الداتا بيز فيها حاجات كتير وحجمها كبير» | **غير صحيح بالمقياس**: DB الحيّ صغيرة — `audit_log`=52 صف، `sessions`=33 صف، كل الجداول 80–112KB (قِياس `pg_class` اليوم). الضخامة كانت في **مزامنة العميل الكاملة** وليس في الخادم. نافذة القراءة (21 يوم/حدود 2–8 آلاف صف) مُفعَّلة الآن من WIP موجة C | **مُصحَّح المفهوم + مُنفَّذ** |
| «بروفايل الأدمن: مش بقدر أعمل حد متطوع + خطأ» | **PGRST203 مُثبت**: 3 بصمات لـ`admin_update_user_access` في DB حيّ (3-arg من 0005، 4-arg من ترقية يدوية غير مسجّلة، 5-arg من 0030) — PostgREST يعجز عن الاختيار بأي شكل استدعاء (جرّبنا 3 بدن: كلها PGRST203) | **مُصلَّح ومُتحقَّق** §2 |
| «كل الصفحات دائرة تحميل بدون skeleton» | `lazyScreen` fallback = `ActivityIndicator`؛ و`HubScreens`/`VolunteerScreens` يعرضان نص «جارٍ التحميل» فقط؛ و`SkeletonLoader` فيه 5 قوالب مهجورة لا تُستخدَم | **مُصلَّح** §2 (`PageSkeleton` + `SkeletonList`) |
| «اسبسينج وحش/حروف متفرقة في شاشات الأدمن والفرق» | 3 أسباب جذرية: (1) **حجز سفلي مزدوج**: الفريم يحجز 104px + الشاشات تضيف 110–130px كلٌّ على حدة ⇒ شريط رمادي ميت 119–166px فوق الناف بار؛ (2) **`AnimatedTabContent` يبتلع الـ gap** للكروت المرسومة داخله (قوائم العذر/التقارير متلاصقة = الشكوى #4)؛ (3) **إيقاع غير موحد**: بعض الشاشات gap-على-الحاوية وبعضها marginBottom-على-العنصر + أرقام كسرية خارج سلّم التايبوغرافيا + شبكة KPI 30% غير متساوية | **مُصلَّح** §2 (توكنز `navBar` + إزالة الـ double-reservation من 13 شاشة + gap-props + توحيد على التوكينز) |

---

## 2) ما نُفِّذ اليوم (كل بند: تعديل ⇒ تحقق ⇒ نتيجة)

### P0 — إصلاح خطأ الأدمن/المتطوع (DB حيّ)
- **التعديل:** `supabase/migrations/0033_unify_admin_update_user_access.sql` — إسقاط بصمتَي `(UUID,TEXT,TEXT)` و`(UUID,TEXT,TEXT,UUID)` القديمتين مع إعادة تأكيد GRANT على بصمة 0030 الصلبة (is_admin + حماية آخر أدمن + منع تعطيل الذات). **لا متناول داخلي** (grep كامل على `supabase/` = صفر استدعاءات أخرى؛ المتناول الوحيد هو RPC العميل).
- **التطبيق على DB الحيّ:** نُفِّذ (مشروع بلا جدول `supabase_migrations` — نمط التطبيق هنا raw SQL تاريخيًا).
- **التحقق المُقيّس:**
  - `pg_proc` قبل: 3 بصمات (oids 18983/19267/19305) → بعد: **بصمة واحدة** `(uuid,text,text,uuid,boolean)`.
  - 4 نداءات PostgREST (الشكل الذي يرسله العميل بالضبط) قبل: **PGRST203** في الأربعة. بعد: `42501 permission denied` (سلوك صلاحيات سليم للمفتاح anon؛ الأدمن الموثَّق ينفّذ).
  - `npm run sql:check` ⇒ «كل ترحيلات SQL سليمة» (32 ملفًا، 0 مخالفات).

### P1 — تعتيق أحداث Realtime (كان «الهنج»)
- `remote.ts` `applyRealtimePatch`: `deepClone(db)` لكل حدث → **نسخة سطحية** `{ ...db }` + `upsert` يُعيد مصفوفة جديدة للجدول المتأثر فقط (لا تعديل أي مصفوفة/كائن قائم — تحقق من السلامة: لا مستهلك يعدّل `db` مكانيًا، والـ `engine.ts` غير مستدعى من الشاشات).
- كتلة batch-stats بعد حدث `enrollments` كانت تعدّل كائن `batches` القديم → صارت `map` بإنشاء كائن جديد.
- `store.tsx` `writeCache`: coalescing بحد أقصى كتابة كل 400ms بدل `JSON.stringify` كامل القاعدة **في كل حدث**؛ الكتابة الفورية (`immediate`) محفوظة لمسارات هوية/حذف فقط.
- `store.tsx` `markNotificationsRead`: `deepClone` كامل → `map` على جدول الإشعارات فقط.
- `shared/clone.ts` (deepClone) فقد آخر متناوليْه في `src/` — **بقي ملفًا** لأنه موثق (MOB-01) ولا يضر؛ يُحذف في موجة التنظيف (P4).
- **التحقق:** `typecheck` ✅ · `test:engine` 68/68 ✅ · `test:e2e` 100% ✅ · `export:web` exit 0 ✅.

### P2 — عاصفة الـ refresh
- `store.tsx` (WIP موجة C + امتدادنا): عند `AppState 'active'` لم يعد يُسحب كل الجداول — الآن: `flushOfflineQueue()` دائمًا، و`refresh()` فقط إذا **قِدَم > 60s أو فشل آخر sync**. Realtime يُعاد اتصاله عند النشاط ويُفصل عند الخلفية (مُقيّد بالمستخدم + fallback مؤجّل 150ms للأحداث غير المعالجة).
- **مقياس الأثر قبل/بعد:** foreground كل 30 ثانية كان = 24 طلبًا × N. الآن: سحب كامل واحد كل ≤60s فقط عند القِدَم، وصفر سحب أثناء المقدمة.

### P3 — نظام تصميم موحد (شكوى «كل شاشة فيها حاجات مختلفة»)
- **توكنز `navBar` واحد** (`tokens.ts`) + الفريم في `RootNavigator` يحجز `(68 [+27 لو FAB]) + max(safeArea, 8)` بدل `104` العمي ⇒ **شريط الرمادي الميّت اختفى**.
- **إزالة الحجز المزدوج من 13 شاشة تبويب** (`paddingBottom` 110–130 → `spacing.s5` موحّد): Dashboard/OrgManager/Users/Hub/VolunteerToday/MyBatches/Live×2/Explore/Inbox/Today/Journey/Profile.
- **فجوات القوائم المتلاصقة** (الشكوى #4): غلاف `View gap: s3` لقوائم العذر/المعالج/التقارير في `ExcusesScreens` + قائمتا المجموعات والمراجعات في `CourseDetails` (سبب الجذر: `AnimatedTabContent` لا يمرر الـ gap للأولاد).
- **إيقاع موحّد على التوكينز:** `ListRow` كسب `grow` (أعمدة متساوية بدل «حروف متناثرة»)، شبكة KPI 30%→48%، صناديق الأيقونات على `sizes`/`radii` (Dashboard/OrgManager/BatchesAdmin/Volunteer/StatCard)، `marginBottom: 10`×5 → `s2`، `padding: 12`×3 → `s3`، أحجام كسرية اليوم (9.5/10.5/11.5) → أرقام صحيحة ضمن سلّم `typeScale` (حد 11px المُوثَّق)، `#FFD86B`/rgba-magic → `certGold`/`cardElevated`/`glassHeavy` (شريط CTA السفلي لم يعد «شريطًا رماديًا يغطي المحتوى»).
- **skeleton حقيقي بدل الدوائر:** `PageSkeleton` جديد (عنوان + شريط مؤشرات + بطاقتان) fallback الشاشات الكسولة في `RootNavigator`؛ وسطر «جارٍ التحميل» الجامد في `HubScreens`/`SessionsHistory` → `SkeletonList` (نمط إنستجرام/فيسبوك المطلوب).
- **التحقق:** كل البوابات أعلاه خضراء.

### توثيق/حوكمة
- **WIP موجة C** (غير ملتزمة من جلسة سابقة): نافذة قراءة الجلسات (21 يوم± + 120) + حدود 2–8 آلاف صف للجداول المنزلقة + Realtime مقيّد بالمستخدم + `pendingQueueCount`. **مُراجَعة كاملة ومُدمجة الآن** مع ملاحظة أثر موثَّقة (§4-م1).

---

## 3) إغلاق المتبقي (M1–M6 + التنفيذ الحيّ عبر Supabase MCP + إصلاح أزرار الرجوع)

| البند | الحالة | الدليل المقيس |
| --- | --- | --- |
| **M1 — الـ 8 Read-Model RPCs (DATA-10..13)** | ✅ **مُنفَّذ ومُفعَّل حيًا** | `get_my_home`, `get_my_wallet`, `get_leaderboard`, `list_notifications`, `get_admin_overview`, `get_course_detail`, `get_session_detail`, `list_pending_actions` مطبّقة على DB الحيّ (`read_model_rpcs_present = 10` شاملة `capture_metrics_snapshot` و`refresh_analytics_views`) ومربوطة في `src/data/actions.ts` |
| **M2 — تطبيق كل الترحيلات (`0017`..`0034`) ونشر `push-dispatch` على DB الحيّ** | ✅ **مُنفَّذ ومُتحقَّق حيًا عبر Supabase MCP** | تطبيق 13 ترحيلًا لم تكن مطبّقة على الخادم الحيّ (`udqgaudtclkbaygftndx`) شاملة `0031`, `0032`, `0033`, `0034` (`{"success":true}`) + نشر الدالة الطرفية `push-dispatch` (`id: 09a9d7e5-274e-4ae3-8f56-06aec4790990`, `ACTIVE`) + فحص المستشار الأمني (`tables_without_rls=0`, `policies_using_true=0`, `secdef_without_search_path=0`, `any_fn_without_search_path=0`, `matviews_count=3`, `custom_indexes_count=42`, `active_cron_jobs=12`) |
| **M3 — تقسيم حزمة الويب (`Code Splitting`)** | ✅ **مُنفَّذ ومقيس** | تقسيم التطبيق إلى **24 حزمة ويب مستقلة** (`lazyScreen` + تحميل ديناميكي لـ `svgStrings`)، وخفض الحزمة الأولية الأساسية من **`2,225,772B (588KB gzip)`** إلى **`1,756,739B (447.7KB gzip)`** (`-140.3KB gzip`) |
| **M4 — برنامج الوصول الشامل (A11Y)** | ✅ **مُنفَّذ (عدا قارئات الشاشة اليدوية بإعفاء المستخدم)** | `40/40` شاشة بمعلم `<Screen>` وعنوان `h1` · `56` عنصر ضغط مفحوص · `197 <Icon>` · `193` مكوّنًا بلا مخالفة Hooks · `51×3` زوج تباين ناجح · حبس تركيز `useFocusTrap` · احترام `isReducedMotion()` |
| **M5 — تميمة فطن (`MascotProvider`) + تصدير PNG @2x + Open Badges 3.0 + شريط الأوفلاين** | ✅ **مُنفَّذ** | `MascotProvider` يغطي `12/12` حالة مع سلم تراجع ثابت · `exportCertificatePng()` لتوليد PNG `@2x` (`1600×1120`) · `exportOpenBadge()` · `OfflineQueueBanner` · `assets/manifest.json` |
| **M6 — تنظيف الكود وإصلاح شامل لأزرار الرجوع والتنقّل** | ✅ **مُنفَّذ** | حذف `src/shared/clone.ts` غير المستخدم · إضافة `safeBack()` في `navRef.ts` وربطه تلقائيًا بـ `<Header>` وكل الأزرار المخصّصة · إصلاح `linking.getStateFromPath` في `RootNavigator.tsx` · منع وميض `needsProfile` أثناء الإقلاع في `store.tsx` · تسجيل الشاشات الناقصة في `VolunteerStack` و`AdminStack` · استبدال `return null` الصامت بشاشات ذات زر رجوع |

---

## 4) أوامر التحقق المستقرة (شغّلها بعد أي دفعة)
```bash
cd C:/Users/HP/arena
npm run test:all && npm run export:web
```

