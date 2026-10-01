# 🩹 MASAR MAJOR FIX PLAN — 2026-10-01
### مسار 3.2 → إصلاح شامل: PGRST203 (الأدوار) · طبقة الداتا والأداء · الـrender · توحيد الـdesign system · تقوية الباك اند · بوابات القبول

> **الحالة:** خطة فقط — **لم ينفَّذ أي سطر كود في هذه الجلسة** (طلب صريح من Shaker).
> **الملف المرجعي السابق:** `MASAR_MASTER_PLAN_2026-09-28.md` (Single Source of Truth) — هذه الخطة **مكمّلة له وليست تكراراً**: مركّزة على الأعطال المقاسة اليوم 2026-10-01 من 3 subagent-audits + توثيق الأدوار، وتبني على مخرجاته.
> **الإصدار الحالي:** 3.2.0 · **الفرع المحلي:** `arena/01a0e854-arena` (unpushed — waves a–e) · **النشر:** `c-ruby.vercel.app`

---

## §0 المنهجية وأدلة التشخيص

كل بند أدناه مصنّف:
- ✅ **مؤكد بالكود اليوم** — قُرِئ من الملفات المرفقة بـ`file:line`.
- ⚠️ **يتطلب تحققاً على الـlive** — مكتوب كـ«مهمة تحقق» لا كحقيقة.

مصادر الأدلة:
1. **Audit A (data-flow):** مسح `src/data/*` + الشاشات + `store.tsx` + `sw.js` + `vercel.json`.
2. **Audit B (backend):** مسح `supabase/migrations/*` + `supabase/functions/*` + scripts الفحص.
3. **Audit C (UI/design-system):** مسح `src/design/*` + 37 شاشة.
4. **توثيق مسار الأدوار (يدوي):** `actions.ts` + `UsersScreen.tsx` + migrations 0005/0023/0030/0033 + ملاحظات `docs/UPGRADE_PLAN_2026-09-29.md` و`EXECUTION_LOG.md`.

**أعراض Shaker ← الجذور (كل عرض أُسند لجذر مقاس):**

| العرض | الجذر | الدليل |
|---|---|---|
| تغيير أي دور/حالة (متطوع/أدمن/مشرف) ينفجر PGRST203 | Overloads قديمة لـ`admin_update_user_access` حية على الـlive (3-arg/4-arg + 5-arg) — نداء العميل بـ4 مفاتيح يطابق أكثر من مرشح | سكرينشوت 2026-10-01 + `0033:19-20` + `actions.ts:163-168` |
| «كل refresh بيحمل كل الـqueries» | `fetchRemoteDb()` = ~24 قراءة بـ`Promise.all` تنفذ على **كل** `refresh()`؛ ولا cache/TTL/dedup | `remote.ts:99-125` + `store.tsx:181-220` |
| «بتعلق وبتهنج» | حسابات O(N×M) في render + كل `setDb` يعيد render كل التابات + حوّل الـforeground storm 2–3 syncات | `engine.ts:1064-1096` + `store.tsx:618-629` + `store.tsx:408-477` |
| «الرجوع للصفحة = يحمل من الأول» (مش بطء نت) | Storm: `onReconnect→refresh` + AppState>60s `refresh` + web `online→refresh` — يحدوث 2–3 full-syncs معاً عند العودة؛ `sw.js` بريء (يُستثنى Supabase) | `store.tsx:408,414,432,477` + `public/sw.js:44-95` |
| DB «مليانة وحجمها كبير» | جداول uncapped (enrollments/batches/…) تُسحب كاملة حتى 100K صف؛ retention job مكتوب **ومجدول أبداً**؛ 24-source payload على كل sync | `remote.ts:44-57` + `0032:912-948` |
| spacing وحش/حروف مقصوصة/C عمودي | الشاشات تتجاوز الـtokens (قيم hardcoded) + `overflow:hidden` + `numberOfLines=1` | خريطة Audit C كاملة (§P4) |
| محتوى فوق/تحت الناف بار | safe-area double-reserve (top) + bottom-padding مفقود في stack screens / زايد في tab screens | `RootNavigator.tsx:470` + `Header:974` + قائمة P4 |
| مفيش empty/skeleton زي التطبيقات الكبيرة | `RefreshControl`-only في 6 شاشات + `EmptyStateIllustration` **dead asset** مفيش حد يستورده + `ActivityIndicator` خام في 4 أماكن | Audit C §5 |

### ⚠️ تنبيه حرج — تعارض حالة الـlive DB (يجب حلّه قبل أي شيء)

**Memory 2026-09-29** تقول إن PGRST203 أُصلِح على الـlive (raw SQL: حذف 3-arg/4-arg، بقي 5-arg فقط، project ref `udqgaudtclkbaygftndx`). لكن **سكرينشوت اليوم (2026-10-01) من `c-ruby.vercel.app`** يظهر أن الـ4-arg والـ5-arg **مازلان حيين** → أحد 3 فرضيات:

| # | الفرضية | كيف نثبتها |
|---|---|---|
| F1 | الـdeploy (`.env.production`) يشير لـSupabase project **آخر** مش `udqgaudt` | قارن `SUPABASE_URL` في build/الـenv مقابل project ref الحالي |
| F2 | `supabase/WEB_EDITOR_UPGRADE.sql` (سكربت **يدوي untracked**) أُعيد تطبيقه على الـlive → أعاد الـ4-arg overload | `pg_proc`: `select proname, pg_get_function_identity_arguments(oid) from pg_proc where proname='admin_update_user_access'` على الـproject الحقيقي |
| F3 | fix 09-29 طُبّق على local branch DB مش live | نفياً بـF2: لو على live `pg_proc=1` فقط → المنفذ بيعمل على مشروع غير الـlive |

**القرار المؤقت في الخطة:** نفّذ P0 كـ«تأكيد + مصادقة» قبل P1. ومهما كانت النتيجة، **`0033` هو fix القابل للتكرار** (يدخل في سلسلة migrations وتعمل على أي نسخة من الـDB) — والـraw SQL السابق كان fix مؤقت لا يُسجَّل.

---

## §1 خارطة التنفيذ (6 مراحل + بوابة نهائية)

```
P0 تحقق الـlive + مصادقة الحالة  ──►  P1 إصلاح الأدوار (PGRST203)  ──►  P2 طبقة الداتا  ──►  P3 الـrender
                                                                                     │
        P5 تقوية الباك اند + indexes + retention  ◄───────────────────────────────────┘
        P6 بوابة القبول النهائية (gates)  ◄──── كل المرحلة تفضي إليها
```

**قاعدة الترتيب:** P0→P1 معاً (لا معنى لإصلاح العميل قبل مصادقة الـlive). P2→P3 متوازيتان. P4 (ديزاين) مستقلة ويمكن شخنها متوازية. P5 بعد P2 (تشبيث الـqueries). P6 أخيرة.

---

## §P0 — مصادقة حالة الـlive (قبل أي كود)

### Task 0.1 · تحديد الـSupabase project الحقيقي للنشر
- اقرأ `SUPABASE_URL` من build/الـenv في مشروع `c-ruby` (Vercel env + `.env.example` مقابل القيم الفعلية).
- ⚠️ لو `URL ≠ udqgaudt…` → **F1 صحيحة** وكل ما تم على `udqgaudt` يجب إعادته على المشروع الصحيح (PGRST203 fix + wave-c).

### Task 0.2 · عدّ الـoverloads الحيّ
```sql
select oid, pg_get_function_identity_arguments(oid)
from pg_proc where proname = 'admin_update_user_access';
-- المتوقع بعد الإصلاح: صف واحد فقط = (UUID, TEXT, TEXT, UUID, BOOLEAN)
```
- أي عدد > 1 → نفّذ `0033` على الـproject الحقيقي (هو `DROP` لـ3-arg/4-arg فقط + إعادة GRANT الـ5-arg — آمن وقابل للتكرار).

### Task 0.3 · توحيد سلسلة migrations
- تأكد أن `0032_wave_c` (committed محلياً، **غير مطبّق على الـlive** حسب memory) طُبّق **قبل** `0033` (0033 يعتمد على تعريف 0030، و0032 يحوي read-model RPCs + MVs).
- **⚠️ خطر parallel-session autocommit:** جلسة Claude ثانية تحمي `git add -A; git commit` على نفس الـworktree — افحص `git log -3` + `git status` قبل أي commit (memory 09-29).

### Task 0.4 · حصر `WEB_EDITOR_UPGRADE*.sql` (مصدر الانحراف)
- السكربتات اليدوية غير المسجّلة في `supabase/` (0033 header اعترف بأن الـ4-arg دخل الـlive منها) هي **جذر أي PGRST203 متكرر**.
- القرار: أرشفها في `supabase/legacy/` + أضفها لـ`check-sql.js` (انظر P1.3) + قرار مؤسسي: **كل SQL مستقبلي يمر عبر `migrations/` فقط** (قاعدة جديدة في CLAUDE.md §3/§5).

**Acceptance P0:** `pg_proc` = صف واحد على project النشر · سلسلة 0032→0033→(0034) مرتبة · لا سكربت يدوي حي.
**Rollback P0:** `0033` هو DROP فقط — التراجع = إعادة `CREATE` لـ3-arg/4-arg من `0005`/`WEB_EDITOR_UPGRADE.sql` (لن نقترحها).

---

## §P1 — إصلاح الأدوار والمتطوع (P0-Priority)

### Task 1.1 · إصلاح semantics العميل/السيرفر (regression مؤكد)
**الجذر:** العميل (`actions.ts:159-169`) يبني payload بـ`null` للحقول الغائبة:
```ts
p_role: patch.role ?? null,        // null تعني «دوري الحالي؟» — الدالة ما بقتهاش كده
p_status: patch.status ?? null,
p_branch_id: patch.branchId !== undefined ? patch.branchId : null,
// p_clear_branch مبيتبعتش ابداً → «فرغ الفرع» مستحيل من الـUI
```
المرجع الصافي (0005:268-278) كان `COALESCE(p_role, old)` — و0030 شال الـCOALESCE (hardening صح، بس client **لم يُحدَّث**).

**الحل (اختياران — القرار 1 + 2 معاً):**
1. **Client-side:** قبل النداء، اقرأ الدور/الحالة/الفرع الحاليين من `db.profiles` (موجود محلياً) وابنِ payload **كامل غير-null** دائمًا، وأضف `p_clear_branch` من `UsersScreen` (زر «فرّغ الفرع»).
2. **Server-side (migration `0035` جديد):** ارجع `COALESCE(p_role, v_old.role)` + `COALESCE(p_status, v_old.status)` مع **إبقاء كل guards من 0030** (is_admin + last_admin + self-disable + `FOR UPDATE`) — أي الـhardening تفضل والـNULL-safe يرجع.

**ملفات:** `src/data/actions.ts:159-169` · `src/features/org/UsersScreen.tsx:43-47` · migration جديد `0035_role_update_null_safe.sql` (بصمة الدالة **لا تتغير** — نفس الـ5 args؛ تغيير داخلي فقط، فلا PGRST203 جديد).

### Task 1.2 · UI: زر «فرّغ الفرع» + رسائل دقيقة
`UsersScreen.tsx:43` — الحالة `clearBranch` + تمريرها في `updateUserAccess` patch. Toast موجودة (`users.branchUpdated`).

### Task 1.3 · تقوية CI guards (كانوا عمياناً عن هذا الطراز من الـbug)
- `scripts/check-rpc-contract.js:30-36`: يطابق **اسم الدالة فقط** → اجعله يطابق **name + arity + arg-types**.
- `scripts/check-sql.js:186-200`: فحص الـdups **per-file فقط** + يقفز على `CREATE FUNCTION` bodies → اعمل فحص عبر **كل** `supabase/**` (بما فيها `WEB_EDITOR*` لو ما أُرشفَت) يكشف الـoverload collisions.
- `scripts/gen-rpc-types.js:69` «آخر تعريف يفوز» → أضف failure لو لقي overloadين لنفس الاسم.

### Task 1.4 · Regression tests (TDD — قبل أي fix)
- e2e: student→volunteer / student→supervisor / student→admin / status disable / branch clear / last-admin guard / self-disable block — **الـtests 7 ينجحوا على الـlive بعد P0+1.1+1.2**.

**Acceptance P1:** سكرين المتطوع/تغيير الأدوار يعمل على **الـنشر** · `check-rpc-contract` + `check-sql` يرفضان أي overload مستقبلي · tests 7 خضراء.

---

## §P2 — طبقة الداتا والأداء (جذر «كل refresh بيحمل كل حاجة»)

### Task 2.1 · Scoped refresh
- `store.tsx:181-220` — `refresh()` اليوم = `fetchRemoteDb()` كامل. اقسمه: `refresh(scoped?: {tables?, recentOnly?})` — الـ`RefreshControl` في **12 موضع** (`Today:216 Dashboard:140 CourseMgmt:225 Volunteer:69/248 Gamification×3 Journey×3 Profile Explore:83 Users:64 Notifications:316`) يعمل scoped حسب جداول شاشته.
- **Acceptance:** pull في `Today` = قراءتا `attendance`/`sessions` window فقط، مش 24-source.

### Task 2.2 · Boot من الـcache + TTL
- `masar.cache.v2` (`store.tsx:25,88-111`) متاح local؛ **الـboot دايمه re-fetch كامل** (`applySession`, `boot:330-387`).
- اعمل boot من الـcache أولاً (render فوري) + staleness-check بـ15s (أقل من الـ60s الحالي) + **`offline.ts:26-131` (write-only)** → اجعله يخدم الـreads أيضاً عند عدم الاتصال.

### Task 2.3 · Realtime: فلتر + ربطات ناقصة
`remote.ts:275-325`:
- `attendance`/`excuses`/`enrollments` **unfiltered** (كل كتابة في أي org تبث لكل العملاء) → filtr by `org_id`/`branch` (sessions بالفعل column-filtered `:295-298` — النمط الموجود).
- بلا bindings لـ`profiles/branches/courses/batches` → أي تغيير فيها = full `fetchRemoteDb` (`remote.ts:528-529` يعيد `null`). أضف bindings.
- **Acceptance:** log events per-org (مش global) · مفيش full-reload عند تغيير batch.

### Task 2.4 · الـforeground storm (جذر «بطل شغال ورجعت = راح كل حاجة»)
- 3 triggers تصطدم: `onReconnect→refresh` (`store.tsx:414`) + AppState>60s (`:430-432`) + web `online` (`:477`) → **2–3 full-syncs** في ثواني.
- الحل: **single event-bus** بـdebounce 1.5s — أي trigger يحدّث `lastSync` فقط، والـrefresh واحد.

### Task 2.5 · pagination للجداول الـuncapped
`remote.ts:44-57`: `enrollments/batches/courses/committees/course_roles` تُسحب كاملة حتى `MAX_READ_ROWS=100_000` **سلسلياً 500/loop** (N round-trips).
- اعمل `range` متوازٍ (chunks 1000) + **`enrollments/batches` paging على `updated_at`** (تاريخ) — مفيش جهاز يحتاج 100K enrollments.
- **Acceptance:** حجم الـpayload + زمن الـboot يُقاس بـ`performance.now`/network log.

### Task 2.6 · شيل الـwasted RPCs
- `TodayScreen.tsx:61-62`: `getToday()+getMyCourses()` **النتيجة بتترمى** (`.catch` بدون setState) — **احذفها** (مش لازم تعوضها).
- `CourseManagementScreen.tsx:76-89` + `ExploreScreens.tsx:368-371`: `getCourseOverview(courseId)` **unused** — احذف.

### Task 2.7 · خفّف الـglobal scans بالـMVs الموجودة
`0032` فيه `mv_admin_overview` (871-881) و`mv_leaderboard_week` (855-869) **موجودة ومش مستخدمة** — `get_admin_overview`/`get_leaderboard` يديرو 8 COUNTs + partition scans على **كل** الـDB في كل فتح.
- وجّه القراءات للـMVs + **refresh بالـcron** (pg_cron) مش per-request.
- **⚠️ يعتمد على P0.3:** الـMVs موصلين على `0032_wave_c` اللي **لسه غير مطبّق على الـlive** — لا تعمل كده قبل ما 0032 ينزل.

**Acceptance P2 (كلها):** refresh واحد = scoped queries · عودة الـforeground = **refresh واحد كحد أقصى** · dashboard تحت ثانيتين 4G · حجم الـpayload من `network` log أقل 50%+ (يُقاس قبل/بعد).

---

## §P3 — الـrender والأداء المحسوس

### Task 3.1 · memoize خارج الـrender path
`engine.ts:1064-1096` (`dashboardStats`): `att.filter` + `sessions.find` **في كل render** + 6-week trend يمسح `att`×`sessions.find` → precompute الـ`session→attendance` map مرة (useMemo على `db.attendance`).
نفس الشيء `seatCounts:126-135`, `attendancePct:805-814`, `issuanceTable:820-830`, `getWeeklyLeague:637-668`.

### Task 3.2 · حوّل واحد + اعمل التابات الـhidden تعمل
`LiveSessionScreen:64` `setInterval(500)` + `TodayScreen:56` `useNow(1000)` → **single ticker context** موزّع على الشاشات. `RootNavigator.tsx:472-486` — `visitedTabs` بيفضلو **mounted بـ`display:none`** وكل `setDb` يعيد renderهم كلهم → **`<KeepAlive visible>`** أو unmount عند الاختفاء.

### Task 3.3 · skeleton-first + empty states
- 6 شاشات (Today/Explore/Journey/Excuses/Courses/Dashboard) = `RefreshControl`-only عند أول تحميل → **flash فاضي**. حطّ `Skeleton/PageSkeleton` في أول paint.
- **`EmptyStateIllustration.tsx` dead asset** — مفيش شاشة تستورده (كل الـempty states = emoji فقط). فعّله في `Empty` component (`components.tsx`).
- شيل `ActivityIndicator` الخام من: `Scanner:419`, `Profile:367`, `Auth:485,516,721,842` → `Spinner`/`Skeleton`.

**Acceptance P3:** لا 1-second jank في الـLive screen على جهاز ضعيف (60fps) · كل شاشة = skeleton→empty→data · مفيش spinner خام.

---

## §P4 — توحيد الـDesign System (جذر «كل شاشة شكل مختلف + C عمودي + محتوى فوق الناف بار»)

**المبدأ:** الـtokens سليمة (`s1..s12`, `micro11/17…h220/29`, radii `sm12..xxl32`) — **المشكلة إن الشاشات تتجاوزها**. الحل = توحيد + **lint يمنع hardcoded جديد**.

### Task 4.1 · `Card` واحد (4 variants دلوقتي)
`Card xl24/pad16` · `LiquidGlassCard xxl32` · `GlassCard xl24` · `Skeleton lg16` · `Hero xl24/pad24` → **وحّد `Card` على `xl/16`** (والـ`LiquidGlass`/`Hero` يستندلها).

### Task 4.2 · شيل hardcoded values (قائمة كاملة — كل قيمة ← توكن)
| المكان | القيمة | المفروض |
|---|---|---|
| `RootNavigator.tsx:242` badge | `fontSize:9/lh:11` | `micro 11/17` |
| `RootNavigator.tsx:246,347` tab labels | `fontSize:10/lh:13` + `numberOfLines=1` | `micro` + حذف `numberOfLines` |
| `components.tsx:263-265` Btn | `padV 14/11/8`, `minH 52/44/38` | `sm→44` (touch target) |
| `components.tsx:310,317,357,364` | `Text` خام بدل `Txt` | `Txt` (بيأخذ `1.35x` calibration + shrink) |
| `components.tsx:1359` OfflineBanner / `TodayScreen:207` / `Explore:67` | `padding:8` | `spacing.s2` |
| `components.tsx:1099` Sheet | `web:28` | `spacing.s7` |
| `SkeletonLoader.tsx:56-57,218,222` | `baseBg #E2E8F0` + `pad20/radius lg` | `theme.fill` + `spacing` + `radii.xl` |
| `LiquidGlassCard.tsx:31,44,55` | `intensity38/xxl/shadow .45` | `blurIntensity.surface40/web20` + `shadows.card` |
| `GlassBtn.tsx:50,246,253` | `h38 + border 1.2` | `44/52` + `thin` |
| `HeroCard.tsx:121` | `pad s6` | `s4` |
| `Toast.tsx:158-164` | `top40 left20 right20` | `insets.top` + `s5` |
| `XPBar.tsx:83,90-91` | `margin s1+2 / pad 8/2` | `spacing` |
| `ExcusesScreens.tsx:176,283` + `CourseMgmtSheets.tsx:330,515` | `padding 10/12` | `s4=16` |

**+ lint:** سكربت جديد `check-tokens` يمنع أي `fontSize/padding/radius/color` hardcoded خارج `src/design/*` (يفشل build).

### Task 4.3 · SafeArea (المحتوى فوق الناف بار + الفجوات)
- **double top:** `Header:974` بيعمل `insets.top+s3` **والـTodayScreen:212 / LiveSession:290 بيقيدو ده تاني** → شيل الـduplicate.
- **tab screens:** 7 شاشات بتزوّد `paddingBottom s5` وهي محجوزة أصلاً (`RootNavigator.tsx:470` = `navBar68+fab27+insets.bottom`) → شيلها.
- **stack screens:** 6 شاشات مفيش عندهم `insets.bottom` → المحتوى **لازق في gesture bar**: `Excuses:91 JoinBatch:46 CourseMgmt:224(=80) Volunteer:473(=40) Certificates:341(=40) StudentRecord:662(=60)`. النمط الصح (`Disputes:139`, `Requests:132`, `Settings:142`) = `insets.bottom + N`.
- **CTAs absolute فوق الناف بار:** `Explore:775` + `Wizard:306` فوق `TabsScaffold` → حط `paddingBottom` = ناف بار + **`KeyboardAvoiding`**.
- **`Toast:158`:** `top:40` بيعدي على notch → `insets.top`.

### Task 4.4 · قص العربي + الحروف العمودية (C)
- `Card:166 GlassCard:162 GlassSurface:34 Hero:106` = `overflow:hidden` → الليبل العربي **يقص بدل ما يلف**. شيله أو خلي `Txt` يعمل shrink.
- `StatBubble glass.tsx:212,228` = `numberOfLines=1 + flex:1` على عرض 110px → «نسبة الحضور» 11px **يقص/يتمركز عمودي**. احذف `numberOfLines` + اجعل الـbubble يتوسع.
- `TodayScreen:242` name `maxWidth:180` بلا shrink صريح. `BentoGrid:83` `minWidth:280` + `flexBasis 48%` على 360pt = **عمود واحد مضغوط**. `LiveSession:307,379` `minWidth:290/280` = overflow أفقي. `Explore:254` `maxWidth:160`.
- **`minWidth:0`** لكل نص جنب أيقونة/رسم (`Journey:79-108` — عنوان كورس طويل بيزق الأيقونة بره).

### Task 4.5 · RTL + A11y
- **physical ← logical:** `Input:623 paddingRight` · `Excuses:129 textAlign:right` · `interactive:532` · `Toast:159 left/right` · `GlassBtn: badge right:-2` · `XPBar:110 endCapGlow right:0` → `end`/`inset` values.
- **touch <44:** `Btn sm 38` · `GlassBtn sm 38` · `Stars hitSlop=4` · `Tab badge 18×18` → `44`/`hitSlop 8`.
- **contrast:** `Today:451-453` white `0.65/0.85 alpha` على gradient ≈ **2.5:1** → ارفعه. `StatBubble` label `textMuted` على glass فوق orbs < 4.5.

**Acceptance P4:** `check-tokens` أخضر · 37 شاشة مرونين نفس الـ`Card/typo/spacing` · `npm run a11y && contrast` أخضر · على Android: لا قَص عربي ولا حروف عمودية ولا زر <44 · مفيش محتوى فوق الناف بار ولا لازق في gesture bar.

---

## §P5 — تقوية الباك اند + indexes + retention (جذر «الـDB تقيلة وبتكبر»)

### Task 5.1 · جدولة الـretention (مكتوب ومجدول أبداً)
`prune_retention_tables()` (`0032:912-948`) **REVOKE'd من كل الـroles ومفيش `cron.schedule()` لها** → `point_events/attendance/audit_log/notifications` بتكبر للأبد.
- جدولاها بـpg_cron (يومي) + **batched DELETEs بـLIMIT + VACUUM** (statement واحد على جدول كبير = lock + bloat). + retention لـ`metrics_snapshot` (append-only دلوقتي).

### Task 5.2 · indexes ناقصة (FK بدون فهرس = seq-scan على join/delete)
أضف في migration `0036_missing_fk_indexes.sql`:
```sql
create index idx_audit_actor_action on audit_log(actor_id, action);
create index idx_excuses_user      on excuses(user_id);
create index idx_certs_batch       on certificates(batch_id);
create index idx_course_roles      on course_roles(course_id, user_id);
create index idx_private_notes     on private_notes(instructor_id, user_id);
create index idx_push_tokens_user  on push_tokens(user_id);
create index idx_att_disputes      on attendance_disputes(session_id, status);
create index idx_domain_events     on domain_events(actor_id);
create index idx_report_subs       on report_subscriptions(user_id);
```

### Task 5.3 · خفّف الـsynchronous work من request path
- `evaluate_user_badges()` **inline** في `submit_course_rating` (`0032:339`) + inside settlement loops (`0006:121,226`) → انقلها لـ**outbox/cron** (نفس نمط `push_outbox`).
- cron sweeps (`0006:286-290`: auto_close كل 15d + streak hourly + league كل 2h) → **batched LIMIT + concurrency** (مايقضوش population كاملة داخل transaction طويلة).
- push fanout trigger (`0026:89-123`) **جوه transaction الكاتب** → اعمل الـenqueue **خفيف** (insert outbox فقط، من غير join على push_tokens) والـjoin يبان في الـedge worker.

### Task 5.4 · statement timeouts بحذر
`0032:897-902` (authenticated 5s / anon 2s) → بعد P2.7+P5.3 (تخفيف الـglobal scans) يبقى محمي مش حاجظ. **قبل** تخفيف الـscans هيتحول الـ`get_admin_overview` القليل على P500s.

**Acceptance P5:** `pg_cron` جدول الـretention يظهر في `SELECT * FROM cron.job` · `EXPLAIN` على الـindexes الجديدة = index scan · طلب الـrating مايعملش badge eval inline · الـcron مايمدش lock لأكثر من ثانية.

---

## §P6 — بوابة القبول النهائية (قبل أي merge/push)

```bash
# في C:\Users\HP\arena
npm run typecheck && npm run a11y && npm run hooks:check && npm run contrast \
 && npm run i18n:lint && npm run parity && npm run rpc:check && npm run sql:check \
 && npm run test:engine && npm run test:rls && npm run test:search \
 && npm run test:calendar && npm run test:perf && npm run test:pentest \
 && npm run test:load && npm run test:e2e
npm run export:web   # التأكد إن الـbundle ماكبشرش بعد الـP2/P3
```
- **gates:** (1) `pg_proc` = 1 overload · (2) tests 7 خضراء · (3) `test:all` أخضر · (4) `export:web` ناجح · (5) PGRST203 ماظهرش في الـlogs أسبوع · (6) payload من network log أقل 50% · (7) `check-tokens` (جديد) أخضر · (8) لا قَص عربي على Android emulator.

**Rollback global:** كل المرحلة تمر في **migration** (0035/0036) أو **commit منفصل** (P2/P3/P4) — ماينفذوش مع بعض. أي rollback = revert الـcommit/الـmigration فقط.

---

## §2 المخاطر (مدرجة بترتيب الخطورة)

| # | الخطر | التقليل |
|---|---|---|
| 1 | **P0: parallel-session autocommit** — جلسة تانية تحط `git add -A` وبتظبط commits | افحص `git log -3` قبل أي commit · اعمل P1 في **worktree منفصل** |
| 2 | **P0: live-DB على project غلط** — كل P1/P5 على الـ`udqgaudt` لو مش هو | Task 0.1 يحسمه قبل أي حاجة |
| 3 | **P4: hardcoded values** — لو ما حطيناش `check-tokens` هيتكرر | السكربت إلزامي في CI (P4.2) |
| 4 | **P2: pagination/realtime** — لو كسّرنا offline، مش هيعرف يعمل flush | `test:e2e` يغطي flush + offline-read (Task 2.2) |

---

## §3 «ولا نفعلها دلوقتي» (انضباط MVP)

- ✗ **React-Query/SWR** — لازم نبدأ بـscoped refresh (P2.1) وشوفينا كفاية قبل ما نضيف dependency جديدة.
- ✗ **Service Workers / PWA upgrade** — `sw.js` الحالي كفاية.
- ✗ **Rive/Lottie للماسكوت** — لسه موجود في `MASAR_MASTER_PLAN §4`، منفصل.
- ✗ **Materialized view** بدل الـMVs في `0032` — هي كفاية، نحتاجها بس.

---

**القاعدة الذهبية:** لو أي بند ماقدمش «أسرع/أكثر موثوقية/أسهل/أخضر gates» → مش بيضيف. **لا تنفيذ بدون ما Shaker يوافق على أي مرحلة.**
