# 🏁 MASAR EXECUTION PLAN — 2026-10-01
### الخطة التنفيذية المتكاملة (من الأداء إلى التصميم إلى البوابات النهائية)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (fresh implementer per task + task review) or `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax. **Each task = one commit, isolated file ownership, independent acceptance gate.**

**Goal:** تحويل مسار من «يعمل لكنه متناقض» إلى نظام إنتاجي: إصلاح الأدوار (PGRST203-legacy)، طبقة بيانات مقتصدة، محرك مطابق للـSQL، Design System بمبدأ content/glass layering، شاشات بهيكلية صارمة، تقوية DB، وبوابات إصدار كاملة — **كله بمرجعين ملزمين**: `MAJOR_FIX_PLAN_2026-10-01.md` (تشخيصات مقاسة) + `DESIGN_ARCHITECTURE_DIRECTIVE_2026-10-01.md` (15 قرارا ملزمة).

**Architecture:** Masar = Expo SDK 57 (RN + Web) + Supabase (Postgres/RPCs/Realtime/RLS). كود عربي-RTL، TypeScript strict، تصميم Apple Liquid Glass **كطبقة وظيفية فقط** (content بلا blur). التنفيذ متسلسل حسب الـdependencies مع امتلاك واضح للملفات يمنع تعارض التنفيذ.

**Tech Stack:** Expo 57 · React Native 0.86 / RN-Web · Supabase (Postgres + RPC + Realtime + RLS + pg_cron) · TypeScript 6 strict · Vercel (web: project `arena` → `arena-rho-seven.vercel.app`)

---

## Global Constraints (تنطبق على كل مهمة)

1. **لغة الكود:** identifiers بالإنجليزية، comments ممكن عربية (منطق الريبو)، نصوص المستخدم عبر i18n فقط (`src/i18n/ar.ts` + `en.ts` — بوابة `parity` 1158 مفتاح).
2. **الكتابة على Supabase** عبر RPCs فقط. **ممنوع أي كتابة على الـlive DB** (migrations/SQL) من غير sign-off صريح — المهام المعلّمة `LIVE-OPS` (T7) موقوفة حتى المراجعة.
3. **Git:** commit صريح بالملفات (`git add <paths>`) — **ممنوع `git add -A`** (خطر parallel-session autocommit موثق في `.superpowers/sdd/progress.md`). commit واحد للمهمة + message بالقالب `<type>(scope): <description>`.
4. **البوابات لكل commit:**
   ```
   npm run typecheck && npm run parity && npm run rpc:check && npm run sql:check \
    && npm run hooks:check && npm run a11y && npm run contrast && npm run test:engine && npm run test:rls
   ```
   حالة معروفة قبل البدء: `test:engine` **67/68** (الفشل الواحد = T3 في هذه الخطة — أي أن T3 هو اللي بيعيدها 68/68).
5. **ممنوع** تعديل ملفات Boosthis (`lib/boosthis-*`, `boosthis`, `boosthis.config.json`) — kit محمي بتامبر-manifest.
6. **التصميم:** كل مسافة/نصف قطر/ظل/لون من `src/design/tokens.ts` + `theme.tsx` — **لا hardcoded** (بوابة جديدة `design:check` في T5). القرار الملزم: **blur ممنوع في content layer** (التوجيه §2/§4/§27).
7. **تبعيات جديدة:** ممنوع إضافة npm جديدة خارج المخطط (Reanimated 4 في التوجيه = تغيير انتقائي *لاحق* — خارج هذه الخطة؛ لا يُنفذ إلا بموافقة).
8. **أدلة التنفيذ:** كل مهمة تبدأ بـ **Preflight verification** (أمر فحص + شرط استمرار) — لو الشرط محقق مسبقًا (session سبقتك) سجل في الـledger «already done + الدليل» وامشي.

**ترتيب التنفيذ والاعتمادات:**
```
T0 preflight → T1 (roles) ──┐
            → T2 (data)  ───┼→ T5 (design tokens/surfaces) → T6 (shell+screens) → T8 (a11y/release)
            → T3 (engine) ──┘        │
                                     ├→ T9 (render pass — بعد T3: نفس ملف engine.ts)
                                     └→ T7 (DB hardening — LIVE-OPS موقوفة بالموافقة)
```
- T1/T2/T3 **ملفات غير متقاطعة** (متوازنة آمنة) — SDD عادي ينفذها متسلسلًا: T1→T2→T3.
- T5 قبل T6 (primitives قبل الشاشات — قاعدة التوجيه Wave 3→4).
- T4 = **audit inventory فقط** (read-only) — يُشغَّل في الخلفية مع T1.

---

## Task 0: Preflight (قراءة فقط، لا كتابة)

- [ ] **Step 1: حالة الغابة**
  Run: `git status --short` + `git log --oneline -5` في `C:\Users\HP\arena`
  Expected: branch `arena/01a0e854-arena`، آخر commit = `f71ce8d` (feat(boosthis)) أو أعلى. worktree نظيف من تعديلات src/.
- [ ] **Step 2: البوابات**
  Run: بند 4 من Global Constraints (أوامر البوابات كلها).
  Expected: أخضر ما عدا `test:engine` 67/68 (الفشل = «بونص الشهر: عمر وحبيبة نعم، مريم (غياب) لا» — موثق في T3).
- [ ] **Step 3: التحقق من حالة T1**
  Run: `git log --oneline | grep -i role-access` + `grep -n "p_clear_branch" src/data/actions.ts`
  Expected: لا شيء ⇒ T1 لم يُنفذ ⇒ نفذه. لو موجود ⇒ سجله وابدأ من T2.
- [ ] **Step 4: تهيئة الـledger** (إن لم يكن): `.superpowers/sdd/progress.md` — كل مهمة مكتملة بسطر: `Task N: complete (commit <sha7>, review clean)`.

---

## Task 1 (T1): إصلاح الأدوار — null-safe `admin_update_user_access` (P0)

**ملخص الجذر (مؤكد):** live DB نقي من الـoverloads (probe 2026-10-01: `42501` وليس PGRST203). المتبقي = (1) العميل بيبعت `null` للدور/الحالة الناقصين، والدالة الصلبة `0030` بتعمل `IF p_role NOT IN (...)` من غير NULL-handling → أي تعديل جزئي ينفجر أو يكتب NULL؛ (2) `p_clear_branch` عمرها ما اتبعتت → «فرّغ الفرع» مستحيل؛ (3) CI guards عمياء عن overload duplication.

**Files:**
- Create: `supabase/migrations/0035_role_update_null_safe.sql` · `src/data/accessPayload.ts` · `scripts/role-access.test.ts`
- Modify: `src/data/actions.ts` (`updateUserAccess` — حاليًا `:159-169`) · `src/features/org/UsersScreen.tsx` (`changeAccess` — `:43-47`) · `scripts/check-rpc-contract.js` · `src/i18n/{ar,en}.ts` · `package.json` (script `test:roles` + ضمّه في `test:all`)

**Interfaces:**
- Consumes: `updateUserAccess(profileId, patch)` الحالية، `changeAccess`، i18n keys `users.*`.
- Produces: `updateUserAccess(profileId, { role?, status?, branchId?, clearBranch? })` + payload **5 مفاتيح دائمًا** (`p_clear_branch` صريح). بعد المهمة لا ينفع أي caller ينداء الدالة بأول payload.

- [ ] **Step 1: TDD — اختبارات فاشلة أول**
  أنشئ `scripts/role-access.test.ts` (نفس نمط `scripts/rls.test.ts` — افحص كيف `test:rls`/`test:engine` شغّالة: `tsc -p tsconfig.test.json && node .test-build/scripts/<name>.test.js`):
  ```ts
  import assert from 'node:assert';
  import { buildAccessPayload } from '../src/data/accessPayload';

  // 1) p_clear_branch مبيجيش null/missing أبدًا
  const p1 = buildAccessPayload('pid', { role: 'volunteer' });
  assert.equal(p1.p_clear_branch, false);
  assert.equal(p1.p_role, 'volunteer');
  assert.equal(p1.p_status, null); // nullable = «اتركه» (0035 COALESCE)

  const p2 = buildAccessPayload('pid', { branchId: null, clearBranch: true });
  assert.equal(p2.p_clear_branch, true);
  ```
  Run: `tsc -p tsconfig.test.json && node .test-build/scripts/role-access.test.js`
  Expected: **FAIL** (`buildAccessPayload` غير موجود) — RED.
- [ ] **Step 2: migration `0035` (قبل التنفيذ)**
  `supabase/migrations/0035_role_update_null_safe.sql` — **نفس بصمة 0030 حرفيًا** (لا تغيير arity/ترتيب args)، `CREATE OR REPLACE` للbody مع:
  - `v_role := coalesce(p_role, v_rec.role); v_status := coalesce(p_status, v_rec.status);`
  - validation **لقيم non-null فقط** (roles: `student|volunteer|instructor|supervisor|admin` — الأسماء الموجودة في `0030`؛ statuses: `active|disabled`)، مع نفس رسائل الـRAISE في `0030`.
  - **كل guards من `0030:25-86` تبقى حرفيًا**: `is_admin()` + حماية self-disable + `last_admin` + `FOR UPDATE` + insert الـaudit (نفس shape مع `clear_branch` key). **لا تبتكر شروطًا جديدة** — انسخ من 0030.
  - branch logic نفس `0030:59-62`: `IF p_clear_branch THEN ... branch_id = NULL ELSIF p_branch_id IS NOT NULL THEN ...`.
  - خاتمة: `REVOKE ALL ... FROM PUBLIC, anon; GRANT EXECUTE ... TO authenticated;` (نفس `0033:23-24`).
  - لا تطبيق على الـlive (LIVE-OPS — موافقة، وداخل سلسلة `0032→0033→0034→0035` بالترتيب).
  - Run: `npm run sql:check && npm run rpc:check` → أخضر. `npm run rpc:types` → commit فرق `src/types/database.ts` لو ظهرت (لا المفروض).
- [ ] **Step 3: client — دالة نقية + hook**
  `src/data/accessPayload.ts`:
  ```ts
  import type { Role } from './types';
  export type AccessPatch = { role?: Role; status?: 'active' | 'disabled'; branchId?: string | null; clearBranch?: boolean };
  /** 5 مفاتيح دائمًا — p_clear_branch صريح (يلغي غموض أي overload قادمة). */
  export function buildAccessPayload(profileId: string, patch: AccessPatch) {
    return {
      p_profile_id: profileId,
      p_role: patch.role ?? null,
      p_status: patch.status ?? null,
      p_branch_id: patch.branchId !== undefined ? patch.branchId : null,
      p_clear_branch: patch.clearBranch ?? false,
    };
  }
  ```
  عدّل `updateUserAccess` في `actions.ts:159-169` لاستيراد `AccessPatch` و`buildAccessPayload` (body النداء = `rpc('admin_update_user_access', buildAccessPayload(profileId, patch))`).
- [ ] **Step 4: UI — «فرّغ الفرع»**
  في `UsersScreen.tsx` (الـrole editor `:120-140`): chip/زر «فرّغ الفرع» يظهر فقط لما `user.branchId` موجودة → `changeAccess(id, { branchId: null, clearBranch: true })` + toast `users.branchUpdated` (موجود). i18n: `users.clearBranch` في `ar.ts` + `en.ts` (parity تلزم الاثنان).
- [ ] **Step 5: تقوية CI guards (كانوا العمياء عن سبب PGRST203)**
  `scripts/check-rpc-contract.js` (حاليًا `:30-36` يطابق الاسم فقط): أضف detector لـ**overload duplication** عبر كل `supabase/**/*.sql`:
  ```js
  // انماط: CREATE [OR REPLACE] FUNCTION <name>(<args>) — parse arg list (الأنواع فقط).
  // group by (name)؛ FAIL لو أي اسم فيه > 1 بصمة (name+arity+types).
  // استخدام pgsql-ast-parser (في devDeps) أو regex صريح + normalize (UUID→uuid, TEXT→text, DEFAULT stripping).
  ```
  + اختبار سالب: fixture SQL (داخل test) بدالتين نفس الاسم بصمتين مختلفتين → detector يكشف؛ الريبو نفسه = 0 مخالفات.
- [ ] **Step 6: GREEN + gates + commit**
  Run: `node .test-build/scripts/role-access.test.js` → PASS + كل بوابات بند 4.
  ```
  git add supabase/migrations/0035_role_update_null_safe.sql src/data/actions.ts src/data/accessPayload.ts src/features/org/UsersScreen.tsx src/i18n/ar.ts src/i18n/en.ts scripts/check-rpc-contract.js scripts/role-access.test.ts package.json
  git commit -m "feat(role-access): null-safe admin_update_user_access (0035) + clear-branch UI + overload-dup guard"
  ```
  **Acceptance:** 7 تحويلات (student→volunteer/instructor/supervisor/admin · disable · branch clear · role-only) بـpayload 5-مفاتيح · detector يفشل على fixture · (بعد موافقة T7 على الـlive) التحويل الفعلي ينجح.

---

## Task 2 (T2): طبقة الداتا — scoped refresh + chunked paging + realtime filters + sync gate

**الجذر:** كل pull-to-refresh (12 شاشة) + push + `online` = `refresh()` = `fetchRemoteDb()` = ~24 قراءة، و`selectAll` serial 500/صفحة حتى 100K → N round-trips للجداول الـuncapped. realtime bindings غير مفلترة (`attendance`/`excuses`/`enrollments` — `remote.ts:308,310,311`) → fanout global.
**الحالة بعد waves E/F/g (لا تعيد عملها):** boot غير حاجز (identity-first) ✓ · AppState-gate 60s ✓ · realtime shallow-patch ✓ · في `store.tsx:430-432` التأكيد stale>60s.
**الملفات (امتلاك حصري):** `src/data/remote.ts` · `src/data/store.tsx` · الـ`onRefresh` في 12 شاشة · `src/features/today/TodayScreen.tsx:61-62` · `src/features/courses/CourseManagementScreen.tsx:76-89` · `src/features/explore/ExploreScreens.tsx:368-371` · Test جديد `scripts/data-layer.test.ts`.

- [ ] **Step 0 (Preflight):** الأرقام أعلاه من pre-merge — grep `fetchRemoteDb`/`RefreshControl` للتأكيد. **لو scoped refresh موجود بالفعل** (grep `scope` في `store.tsx`) → سجل skip + الدليل في الـledger.
- [ ] **Step 1: TDD — SyncGate**
  أنشئ `src/data/syncGate.ts`:
  ```ts
  /** بوابة مزامنة واحدة: أي trigger (reconnect/online/push) ينداء request() —
      لا refreshين في نافذة 1.5s (dedup الـforeground storm). */
  export class SyncGate {
    private lastAt = 0; private deferred = false;
    private readonly subs = new Set<() => void>();
    constructor(private readonly windowMs = 1500) {}
    request(): void {
      const now = Date.now();
      if (now - this.lastAt < this.windowMs) { this.deferred = true; return; }
      this.lastAt = now;
      const run = [...this.subs]; this.subs.clear();
      if (this.deferred) { this.deferred = false; setTimeout(run, 0); } else run.forEach((f) => f());
    }
    onChanged(f: () => void): () => void { this.subs.add(f); return () => { this.subs.delete(f); }; }
  }
  ```
  Test (`scripts/sync-gate.test.ts` أو ضمه لـ`data-layer.test.ts`): `request×3 خلال ثانية ⇒ fire مرة واحدة + deferred مرة` — RUN RED/GREEN.
- [ ] **Step 2: scoped refresh**
  `remote.ts` — أنشئ:
  ```ts
  export type RefreshScope = 'today' | 'org' | 'full';
  export async function fetchRemoteDbScope(scope: RefreshScope): Promise<{ scope: RefreshScope; db: Partial<Db> }>
  ```
  - `'today'` = `selectSessionWindow()` + `attendance recent` + `notifications` + `point_events recent` + `excuses recent`
  - `'org'` = `branches/courses/batches/batchStats/enrollments/committees/gamification_rules/badges/user_badges/league_weeks/certificates/course_ratings/course_roles/kudos_quotas/gamification`
  - `'full'` = كل الـ24 (boot/reconnect/offline-flush فقط).
  `store.tsx:181` — `refresh(scope: RefreshScope = 'full')`: يدمج الـpartial على `dbRef.current` (merge لكل مصفوفة في الـscope) بدل `setDb(fresh)` الكامل. لا تلمس `refreshInFlight`/`writeCache`/stale-gate.
  جدول الشاشات الـ12 → scope: `Today→'today'` · `Dashboard/Users/Batches/Hub→'org'` · `CourseMgmt→'org'` · `Volunteer/Live→'today'` · `Gamification/Journey/Profile/Explore/Notifications→'today'` · **سجل الفرق في التقرير لو غيّر أي واحد**.
- [ ] **Step 3: chunked paging (لـuncapped)**
  `remote.ts:44-57` `selectAll` — حوّل serial loop لـbatches متوازية **بحد concurrency=4** (500/صفحة = 2000/دفعة) مع `Promise.all` على الدفعة بس. **قرار موثق:** `enrollments`/`batches` — paging على `updated_at` آخر 90 يوم (القديم عبر `id` تحت)؛ مفيش جهاز يحتاج 100K كاملة.
- [ ] **Step 4: realtime filters**
  `remote.ts:305-312` — **افحص أولًا** `src/types/database.ts` لعمود scoping لكل جدول:
  - `attendance` (عمود `session_id` موثّق): filter `session_id=in.(ourSessionIds)` — `ourSessionIds` من الـ`sessions` window الحالي (يدّي filter عند subscribe + re-subscribe عند تغيير الـwindow). **لو الـfilter الديناميكي مش ممكن (Supabase filters ثابتة per binding)** → fallback موثق: فلتر `user_id=eq.` للموظف + `session_id` للـstaff (سجّل القيد).
  - `excuses`: `user_id=eq.` (نفس نمط `notifications :301-304`).
  - `enrollments`: `batch_id=in.(ourBatchIds)` (من `db.batches` الفرع/المؤسسة — verify عمود `branch_id` على batches).
  - **لا تضيف** bindings لجداول غير مشتركة (`profiles/branches/courses/batches`) — scope `'org'` يغطيها؛ وأي binding جديد يلزم تعديلات `applyRealtimePatch` (fallback null → full refresh، `remote.ts:528`).
- [ ] **Step 5: dedup triggers**
  `store.tsx`: `subscribeToPush.onReceived` (`:464`) → `void refresh('today')` (إشعار = بيانات user) · `window 'online'` (`:477`) → `syncGate.request()` (refresh واحد كحد أقصى) + stale-gate قائم · `onReconnect` (`:414`) عبر الـSyncGate نفسه.
- [ ] **Step 6: شيل الـwasted RPCs**
  `TodayScreen.tsx:61-62` (احذف `getToday()+getMyCourses()` المهدرة — verify existence أول) · `CourseManagementScreen.tsx:76-89` + `ExploreScreens.tsx:368-371` (احذف `getCourseOverview` fire-and-forget).
- [ ] **Step 7: GREEN + commit**
  Run: `scripts/data-layer.test.ts` + كل بوابات بند 4.
  ```
  git commit -m "perf(data): scoped refresh, chunked paging, realtime filters, sync gate"
  ```
  **Acceptance:** pull في `Today` = قراءات today-scope فقط (network log) · foreground return = refresh واحد كحد أقصى · مفيش global fanout لـ`attendance`/`excuses`/`enrollments` writes.

---

## Task 3 (T3): انحراف المحرك — bonus شهري (يرجّع test:engine 67→68)

**Root cause (مؤكد 2026-10-01):** `rpcCloseSession` في `src/data/engine.ts:377-392` يوزع `month.bonus` **في نص الشهر** (عند قفل أي جلسة، لو ما ظهرش غياب لسه) — بينما الـSQL الرسمي بيقدمه **نهاية الشهر فقط** عبر cron `settle_previous_month_bonus` (`supabase/migrations/0006_automation_jobs.sql:202-272`) اللي شغال على **الشهر السابق** وفاحص كل غيابات الشهر. النتيجة: طالب اتغاب من بعده **مستني bonus غلط** + **drift engine≠SQL** (والمحرك «مرآة حتمية» حسب CLAUDE.md).

**Files:** `src/data/engine.ts:377-392` (حذف توزيع نص-الشهر) + `settlePreviousMonthBonus` mirror (جدد) · `scripts/engine.test.ts:109-114` (إعادة تأكيد).

- [ ] **Step 1: TDD — أعد كتابة التأكيد (RED)**
  استبدل `scripts/engine.test.ts:109-114` بـ:
  ```ts
  // بونص الشهر: التوزيع الرسمي = نهاية الشهر بس (mirror لـsettle_previous_month_bonus في 0006) —
  // قفل أي جلسة في نص الشهر **مايقدمش** bonus.
  const bonusOmar = db.pointEvents.some((e) => e.idempotencyKey === `month.bonus:${IDS.omar}:${mKey}`);
  const bonusHabiba = db.pointEvents.some((e) => e.idempotencyKey === `month.bonus:u_habiba:${mKey}`);
  const bonusMariam = db.pointEvents.some((e) => e.idempotencyKey === `month.bonus:u_mariam:${mKey}`);
  ok(!bonusOmar && !bonusHabiba && !bonusMariam, 'بونص الشهر: مفيش توزيع في نص الشهر (نهاية الشهر فقط — موافق 0006)');
  ```
  Run: `npm run test:engine` → **FAIL** (المحرك لسه قاعد يوزع في نص الشهر).
- [ ] **Step 2: fix**
  احذف block البونص في `engine.ts:377-392` (الـ`monthSessions`/`rows.every`/`grantPoints month.bonus`) — **حافظ على** `evaluateBadges(db, st.id)` في نفس الـforEach (`:391`) — الحذف = grant البونص فقط.
- [ ] **Step 3: mirror settle**
  أضف في `src/data/engine.ts` (قرب `weekStartOf`/`monthKeyOf`):
  ```ts
  /** Mirror لـsettle_previous_month_bonus (0006:202-272): الشهر السابق، جلسات closed،
      استبعاد أي absent/null في الشهر، idempotency month.bonus:<user>:<YYYY-MM>. */
  export function settlePreviousMonthBonus(db: Db, prevMonth: string): number {
    // iterate active enrollments × closed sessions of prevMonth (نفس منطق 0006 SQL)؛
    // absent = row exists && status==='absent' || no row for a closed session (نفس FILTER في SQL:213).
    // grantPoints({ reason:'month.bonus', refType:'admin', refId:`month:${prevMonth}`,
    //   idempotencyKey:`month.bonus:${userId}:${prevMonth}`, points: ruleValue(db,'points.month_bonus') })
    // أعد count (للمطابقة مع RETURN v_count في SQL).
  }
  ```
  + Test في `engine.test.ts`: بعد settle، `bonusOmar=true` و`bonusMariam=false` (غياب) و`bonusMariam` idempotent (نفس الشهر مبياتوزعش مرتين).
- [ ] **Step 4: GREEN + commit**
  `test:engine` **68/68** (يحل المعطلة المسجلة) + كل البوابات.
  ```
  git commit -m "fix(engine): monthly bonus only at month-end (mirror of 0006 settle), drop mid-month grant"
  ```
  **Acceptance:** `test:engine` 68/68 · مفيش أي `month.bonus` في `pointEvents` بعد `rpcCloseSession` · settle idempotent.

---

## Task 4 (T4): Design freeze inventory (Wave 0 — read-only + ملف واحد)

- [ ] **Step 1: الشباك** (grep read-only):
  ```
  grep -rn "BlurView\|backdropFilter\|rgba(" src/design src/features src/app
  grep -rn "Animated.loop\|setInterval" src/design src/features src/app
  grep -rn "LinearGradient" src/features
  ```
- [ ] **Step 2:** اكتب `docs/DESIGN_FREEZE_INVENTORY_2026-10-01.md`: جدول لكل match (ملف:سطر:نوع:قرار-مقترح) — القرار-المقترح من قرارات التوجيه §27 (مثال: BorderBeam في غير-events = delete/relocate؛ orbs>2 per screen = cut). **commit doc فقط:**
  ```
  git commit -m "docs: design freeze inventory (Wave 0 audit)"
  ```
  **Acceptance:** جداول اكتملت + كل صف فيه تصنيف (keep/relocate/delete + السبب).

## Task 5 (T5): Design Foundation — Surface/Glass system + unifying tokens (توجيه §1–§15, §21, §34, §35)

**الهدف:** فصل رسمي content عن glass، 4 أسطح فقط، tokens بلا ازدواجية، primitives اسمها يحدد وظيفتها، lint يمنع التراجع.
**Files (امتلاك حصري):** `src/design/tokens.ts` · `src/design/theme.tsx` (إضافات) · Create `src/design/surfaces.tsx` · `src/design/components/LiquidGlassCard.tsx` (ترحيل) · `src/design/components/GlassBtn.tsx` · `src/design/glass.tsx` · `scripts/check-tokens.js` (جديد) · `scripts/check-glass.js` + `scripts/check-motion.js` (جدد) · كل consumers الذين يلمسونهم (تقرير = قائمة).

- [ ] **Step 0 (Preflight):** grep لعدد الـ`glassLevels.*` و`elevation.*` و`glassEffects.*` و`<LiquidGlassCard` و`<GlassBtn` في `src/` — اكتب الأرقام في الـledger (baseline).
- [ ] **Step 1: إزالة ازدواجية tokens (توجيه §10)**
  في `tokens.ts`:
  - `glassLevels` (الآن 5 درجات = 3 قيمة فعلية: thin==subtle, thick==heavy) → استبدله بمصفوفة **واحدة** بلا تكرار:
    ```ts
    export const glass = {
      clear:    { intensity: 20, opacityLight: 0.55, opacityDark: 0.58 }, // = thin/subtle
      regular:  { intensity: 40, opacityLight: 0.72, opacityDark: 0.72 },
      floating: { intensity: 64, opacityLight: 0.88, opacityDark: 0.88 }, // = thick/heavy
      sheet:    { intensity: 0,  opacityLight: 0.94, opacityDark: 0.94 }, // = fallback
    } as const;
    ```
    و**احذف** `glassLevels` + أعد توجيه كل consumers (grep `glassLevels\.` → `glass.`).
  - `elevation` (الآن 0/1/2/3/4 **و** none/sm/md/lg/modal لنفس القيم) → احذف الأسماء المكررة، ابقِ `0..4` فقط + أعد توجيه.
  - `glassEffects` (قيم مكررة لـcard/elevated) → احذف إلا ما لا يوجد له مصدر (tabBar → `glass.sheet` + `shadows.control`؛ card/elevated → `shadows.card`/`shadows.bubble` + `radii`). أعد توجيه كل consumers.
  - **Acceptance:** `grep -c "glassLevels\|glassEffects"` في src = 0؛ البوابات خضراء.
- [ ] **Step 2: Surface primitives جدد (`src/design/surfaces.tsx`)**
  ```tsx
  import { radii, spacing, shadows } from './tokens';
  import type { ViewStyle } from 'react-native';
  import { GlassSurface } from './glass';

  /** content layer — لا blur أبدًا (توجيه §2/§4/§27). */
  export function Surface({ children, style, emphasis, accessibilityLabel, accessibilityHint }: {
    children: React.ReactNode; style?: ViewStyle; emphasis?: 'default' | 'hero';
    accessibilityLabel?: string; accessibilityHint?: string;
  }) {
    const { theme, isDark } = useTheme();
    const pad = emphasis === 'hero' ? spacing.s6 : spacing.s4;
    const radius = emphasis === 'hero' ? radii.xl : radii.xl;
    return (
      <GlassSurface
        // content: opacity من theme.card (لا blur) — على الويب backdrop-filter ممنوع هنا (check-glass سيؤمّن)
        intensity={0}
        radius={radius}
        tintColor={isDark ? theme.card : theme.card}
        accessibilityRole="region" accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint}
        style={{ padding: pad, ...shadows[emphasis === 'hero' ? 'card' : 'card'], ...style }}
      >
        {children}
      </GlassSurface>
    );
  }
  /** elevated — shadow أقوى (elevation 2..3)، بلا blur. */
  export function ElevatedSurface({ children, style, radius = radii.xl }: { children: React.ReactNode; style?: ViewStyle; radius?: number }) { /* GlassSurface intensity=0 + shadows.card elevation+2 */ }
  /** functional glass فقط — النافيجيشن/shets/popover/controls العائمة. المكون الوحيد المسموح فيه blur (check-glass whitelist). */
  export function FunctionalGlass({ children, style, kind }: { children: React.ReactNode; style?: ViewStyle; kind: 'tabBar' | 'toolbar' | 'sheet' | 'popover' | 'scanner' | 'control' }) {
    const level = kind === 'scanner' || kind === 'sheet' ? glass.sheet : glass.floating;
    return <GlassSurface intensity={level.intensity} tintColor={(kind === 'sheet' || kind === 'popover') ? theme.backdropBlur : theme.surfaceGlass} radius={kind === 'control' ? radii.md : radii.xl} style={style}>{children}</GlassSurface>;
  }
  ```
  (أكمل الأنواع/التفصيلات عند التنفيذ — الـinterface أعلاه هو العقد.** كل شيء يتجاوز `Surfaces` يرفضه الـreview.**)
- [ ] **Step 3: Button system (توجيه §5/§9) — 4 أنواع فقط**
  في `components.tsx` (`Btn :221` + `GlassBtn.tsx:33`):
  - عرّف `type BtnKind = 'primary' | 'secondary' | 'tertiary' | 'glass'`.
  - `primary`: **solid** `theme.actionPrimary` → `onBrand` (ممنوع blur) · `secondary`: `fill` + `fillBorder` · `tertiary`: نص/icon على `fill` (low emphasis) · `glass`: **فوق FunctionalGlass فقط** (الcheck-glass يتأكد من nesting context).
  - **hit area:** كل الـ`sm` variant = **44×44** (النص/الأيقونة 32–38، الصناديق 44). احذف أي 38. (`GlassBtn.tsx:50` h38 → 44؛ `Btn` sm → `sizes.touchTarget`.)
  - أعد توجيه كل `<Btn` و`<GlassBtn` في الشاشات للـkind الجديد (تقرير = قائمة كاملة بالملفات).
- [ ] **Step 4: `LiquidGlassCard` → DEPRECATED (توجيه §7)**
  - غيّر `LiquidGlassCard.tsx` ليُعيد `<ElevatedSurface emphasis="hero" />` (wrapper مش component)، + `console.warn` dev عند الاستخدام المباشر.
  - أعد توجيه كل `<LiquidGlassCard` (grep) → `ElevatedSurface`.
- [ ] **Step 5: Lint gates جد (توجيه §35)** — أنشئ/عدّل:
  - `scripts/check-glass.js`: scan `src/**` لـ`<BlurView` و`backdropFilter` و`intensity` غير صفر — **مسموح فقط** في: `FunctionalGlass` (whitelist file) + `ScannerScreen` (kind scanner). **نست glass = FAIL** (FunctionalGlass داخل FunctionalGlass). **hardcoded rgba** في `src/features` = FAIL (لازم theme).
  - `scripts/check-motion.js`: scan `Animated.loop` / `setInterval` / `infinite` بدون `observeReducedMotion`/`isReducedMotion` guard في نفس الملف = FAIL.
  - `scripts/check-tokens.js`: scan hardcoded `padding*/margin*` numeric خارج `spacing.*` و`fontSize:` خارج `typography.*` في `src/features` = FAIL (whitelist `src/design/*`).
  - أضف الثلاثة في `package.json` scripts + سلسلة `test:all` (باسم `design:check` جمعي).
- [ ] **Step 6: GREEN + commit**
  Run: `npm run typecheck && parity && a11y && contrast && hooks:check && test:engine && test:rls` + الـlints الجديد + **`export:web`** (يتأكد إن مفيش كسر في bundling).
  ```
  git commit -m "feat(design): surface/glass layering system, dedup tokens, 4-kind buttons, glass/motion/token lint gates"
  ```
  **Acceptance:** مفيش blur في أي content card · كل button ≥44 · `glassLevels`/`elevation-names`/`glassEffects` = 0 استخدامات · الـ3 lints خضراء · مفيش glass-nesting.

---

## Task 6 (T6): App Shell + Safe-Area + unifying screens (توجيه §28, §31, §40, §5 + MAJOR P4)

**Files:** `src/app/RootNavigator.tsx` · `Header` في `src/design/components.tsx:974` · شاشات التابات (7) وstack (6) حسب القوائم أدناه · `src/design/components/Toast.tsx` · `EmptyStateIllustration` (dead asset).

- [ ] **Step 0 (Preflight):** grep لـ`insets.bottom` و`paddingBottom` في كل شاشة — قارن بالقوائم (أرقام السطور من pre-merge؛ استخدم أسماء الشاشات مش السطور).
- [ ] **Step 1: Safe-area — شاشات التابات (سحب padding سفلي مزدوج)**
  الشاشات: `Today:212 Volunteer:65,244 Explore:79 Journey:51 Dashboard:136 Users:60 Hub:42` → **لا تسحب** `insets.bottom` إضافي — الحجز المركزي في `RootNavigator:470` (`navBar.height + fabPoke + max(insets.bottom, 8)`) هو المصدر الوحيد (توجيه: مصدر واحد للحقيقة).
- [ ] **Step 2: Safe-area — شاشات stack (الإضافة الناقصة)**
  الشاشات: `Excuses:91 JoinBatch:46 CourseMgmt:224(=80) Volunteer:473(=40) Certificates:341(=40) StudentRecord:662(=60)` → النمط الصحيح (موجود في `Disputes:139 Requests:132 Settings:142 ExploreDetails:437`): `paddingBottom: insets.bottom + N` (N حسب الـchrome). **الآخر عنصر لازم يكون فوق الـgesture bar.**
- [ ] **Step 3: CTA سفلي absolute + Toast فوق notch**
  - `Explore:775` و`Wizard:306` (CTA `absolute bottom:0` فوق التابات) → `paddingBottom: max(insets.bottom, navBar.height)` + **`KeyboardAvoidingView`** (توجيه: مايبقاش تحت الكيبورد).
  - `Toast:158-164` (`top:40`) → `insets.top` (مايقطعش الـnotch) + `s5` للمسايرة.
  - **Header double-top:** `Header:974` بيحط `insets.top + s3` **والشاشات** (Today:212 / LiveSession:290) حطوا نفس الحاجة → شفة الـdouble. قاعدة: **المكوّن الذي يرسم الهيدر يحجز top** — الشاشة تحط content بس.
- [ ] **Step 4: BorderBeam من decoration لـevent (توجيه §10)**
  grep `BorderBeam` في `src/` → يبقى **فقط** في: certificate unlocked / attendance verified / major achievement / live event. أي استخدام في success-card عادي = **حذف** (تقرير = قائمة).
- [ ] **Step 5: Skeleton/Empty everywhere (توجيه §31)**
  - `EmptyStateIllustration.tsx` dead asset → استورده في `<Empty>` (`components.tsx:854`) بدل الإيموجي (الـemoji يبقى fallback لو illo مش موجود).
  - `ActivityIndicator` الخام (Scanner:419, Profile:367, Auth:485/516/721/842) → `Spinner`/`Skeleton` من `design/components/SkeletonLoader.tsx`.
  - الشاشات الستة اللي `RefreshControl`-only (Today/Explore/Journey/Excuses/Courses/Dashboard) → أول render = `PageSkeleton`/`TodayCardSkeleton` (موجود في `SkeletonLoader.tsx:194`).
  - **القاعدة:** كل شاشة = skeleton → empty (illustration + CTA) → data (توجيه §31).
- [ ] **Step 6: RTL logical (MAJOR P4)**
  `Input:623 paddingRight` → `paddingEnd` · `Excuses:129 textAlign:right` → `align` من RTL · `interactive:532` · `Toast:159 left/right` → `inset` · `GlassBtn badge right:-2` → `end` · `XPBar:110 endCapGlow right:0` → `end` (توجيه: الفلوق في الجهة الغلط عربيًا).
- [ ] **Step 7: GREEN + commit**
  ```
  git commit -m "fix(ui): single-source safe-area, CTA/keyboard, toast notch, beam-as-event, skeleton-first, RTL logical"
  ```
  **Acceptance:** مفيش محتوى فوق الناف بار ولا لازق في gesture bar (كل شاشات القائمة) · Toast مايقطعش notch · مفيش RTL-physical · كل شاشة عندها skeleton+empty · مفيش BorderBeam خارج الـevents.

---

## Task 6bis (T6b): إضافات ت6 — توازن الألوان + orbs + توحيد Toast + scroll behavior (توجيه §11, §12, §33, §40)

**Files:** `src/design/glass.tsx` (AppBackground orbs) · `src/design/components/Toast.tsx` + `src/app/App.tsx` (ToastHost) · `RootNavigator.tsx` + الشاشات (scroll) · Test: visual (screenshot matrix T8).

- [ ] **Step 1: orbs (توجيه §12)**
  `AppBackground` (glass.tsx) — حالياً 3 orbs متحركة (orbPrimary/Secondary/Tertiary). **قلها لشكل ambient واحد** (orb واحد static أو subtle drift)، وخلي الحركة **قصيرة/هادفة** (لا infinite إلا على واحد كحد أقصى + reduced-motion guard). قاعدة الشاشة: مفيش شاشة = orb+beam+shimmer+mascot+progress+card في نفس الوقت (§12).
- [ ] **Step 2: توازن الألوان (توجيه §11)**
  عند لمس أي شاشة في T6: توزيع = **Neutral 70–80% · Brand 10–15% · Semantic 5–10% · Delight لحظات فقط**؛ **الـgold** مقصور على certificate/achievement/streak/rank (مش لون عام). (قاعدة مراجعة بصرية مش كود — في الـrelease gate T8.)
- [ ] **Step 3: توحيد Toast (توجيه §33)**
  عندك **منهجين**: `ToastHost`/`ToastItem` في `App.tsx` + مكوّن `design/components/Toast.tsx`. **وحدهم في ToastManager واحد** (`ToastManager → ToastHost → ToastSurface`) بنوعين 4 (success/warning/error/info) — واحد من الاثنين يتبطل (احذف أو خليه re-export). **اختيار: `components/Toast.tsx` هو الـsurface الرسمي** (فيه logic موجود) و`App.tsx` بيفضل host بس.
- [ ] **Step 4: scroll behavior (توجيه §40) — feature واضحة الحدود**
  على الشاشات اللي عندها toolbar/CTA فوق: **scroll down → الـtoolbar يتقلص خفيف + tab bar footprint يتقلص** · **scroll up → بيجوا يارجعوا** — **من غير animation استعراضي** (transform/opacity فقط، interruptible، reduced-motion = off). **scroll-edge fade** تحت الـglass (gradient خفيف) عشان المحتوى اللي بيعدي تحت الـchrome يقرا. **التنفيذ:** listener `onScroll` على الـScrollView في الـscreen (مش global) + state محلي.
- [ ] **Step 5: GREEN + commit**
  ```
  git commit -m "feat(ui): color/orbs restraint, unified toast system, scroll-edge chrome behavior"
  ```
  **Acceptance:** مفيش 2 toast system في src · orb واحد · toolbar/tab bar بيتقلصوا مع scroll (ويعمل على light/dark) · مفيش infinite animation زيادة عن الحد (check-motion).

---

## Task 7 (T7): تقوية الباك-اند + indexes + retention (LIVE-OPS — موافقة مطلوبة قبل التطبيق على الـlive)

> **قاعدة:** كل SQL هنا **يكتب + يتّست محليًا** (sql:check + rpc:check) — **لكن تطبيقه على الـlive (udqgaudt) يستاهل sign-off صريح من Shaker** (بند 2 Global Constraints).

- [ ] **Step 0 (Preflight):** تحقق من حالة الـlive الحالية (memory 09-29/10-01): `0032_wave_c` **لسه مش مطبق على الـlive** + `0033` مطبق (PGRST203 fix) + `0034` hardening. **ترتيب التطبيق على الـlive:** `0032 → 0035 → 0036` (0032 فيه MVs لازم تكون قبل ما أي RPC يقرأها؛ 0035/0036 مستقلين لكن بالترتيب ده). **افحص أول** `supabase/migrations` ليه أي رقم جديد (تأكد إن 0035/0036 free).
- [ ] **Step 1: 7 FK indexes ناقصين** (backend-audit §4)
  أنشئ `supabase/migrations/0036_missing_fk_indexes.sql`:
  ```sql
  create index idx_audit_actor_action on audit_log(actor_id, action);
  create index idx_excuses_user     on excuses(user_id);
  create index idx_certs_batch      on certificates(batch_id);
  create index idx_course_roles     on course_roles(course_id, user_id);
  create index idx_private_notes    on private_notes(instructor_id, user_id);
  create index idx_push_tokens_user  on push_tokens(user_id);
  create index idx_att_disputes     on attendance_disputes(session_id, status);
  create index idx_domain_events    on domain_events(actor_id);
  create index idx_report_subs      on report_subscriptions(user_id);
  ```
  (افحص أول أيه موجود — backend قال «42 index موجودة»؛ لو أي ده موجود احذفه من القائمة. **لا تكرر index موجود.**)
- [ ] **Step 2: جدولة retention (كتبت ومجدولة أبدًا — `0032:912-948` REVOKE'd)**
  ```sql
  -- بعد 0032 (يعمل prune_retention_tables موجودة) — جدولة + batched:
  select cron.schedule('masar-retention-prune', '15 4 * * *', 'select public.prune_retention_tables()');
  ```
  + **عدّل** `prune_retention_tables` في `0032` (أو migration جديد) لـ**batched DELETEs بـLIMIT + VACUUM** (statement واحدة على جدول كبير = lock). `metrics_snapshot` (append-only) retention.
- [ ] **Step 3: async badge eval + cron batching (backend §3)**
  - `evaluate_user_badges()` الـinline في `submit_course_rating` (`0032:339`) + settlement loops (`0006:121,226`) → انقلها لـ**outbox** (نفس نمط `push_outbox`) — أو cron batch (حد أقل).
  - cron sweeps (`0006:286-290`) → **batched LIMIT + concurrency** (مليش full-scan في transaction طويلة).
  - push fanout trigger (`0026:89-123`) — خليه enqueue خفيف (من غير join على push_tokens)، والـjoin في الـedge worker.
- [ ] **Step 4: GREEN + LIVE-OPS gate**
  Run: `npm run sql:check && rpc:check` على كل migration جديد.
  **قبل أي تطبيق على الـlive: اطلب من Shaker approval صريح** (أرقام: 0035/0036 + retention cron) + سجل الحالة في الـledger + `docs/EXECUTION_LOG.md`.
  ```
  git commit -m "feat(db): 7 FK indexes, retention cron + batched deletes, async badge eval (LIVE-OPS pending)"
  ```
  **Acceptance:** `pg_cron` يظهروا job الـretention · `EXPLAIN` على الـindexes الجديدة = index scan · rating مايعملش badge eval inline · مفيش lock > 1s.

---

## Task 8 (T8): A11y + Motion + Performance + Visual QA (Release Gate)

**Files:** `src/design/a11y/*` · `src/design/motion.ts` · `public/index.html` (focus) · `scripts/check-a11y.js`/`check-contrast.js` (توسيع) · `docs/RELEASE_GATES.md`.

- [ ] **Step 1: A11y contract لكل interaction (توجيه §21–§25, §37)**
  - لكل `Pressable`/button: `accessibilityRole` + `accessibilityLabel` (+`accessibilityHint` للـactions). (check-a11y يلمس على النواقص.)
  - **Live regions** إلزامية لـ: Attendance confirmed / QR expired / Certificate issued / Course joined / Network unavailable / Action failed. (استخدم `accessibilityLiveRegion="polite"` + `announce` من `src/design/a11y/announce.ts`.)
  - **Web focus (WCAG 2.4.11 Not Obscured):** الاختبار = Tab/Shift+Tab/Enter/Space/Arrows/Escape على `arena-rho-seven.vercel.app` — element المركّز **مايتختفش** تحت floating tab bar/sheet (fix = `scrollIntoView` موجود في `index.html:220` — يتأكد إنه شغال على كل surfaces).
  - **Icon:** `<Icon decorative>` → `accessible=false` + `aria-hidden` (منع قارئ الشاشة يقرأ «calendar, sparkle, shield» منفصلة).
  - **Text scaling 200% web:** **لا تقص النصوص** — `numberOfLines=1` مش الحل؛ استخدم `flexShrink`/`minWidth:0`/wrap (توجيه §25).
  - **Composite glass contrast:** `check-contrast.js` يتوسع لـ`text-on-glass` (اللون + glass + ماوراه) — مش بس `text-on-white`.
- [ ] **Step 2: Motion budget + taxonomy (توجيه §15, §18, §19, §20)**
  - `motion.ts`: عرّف `M0..M4` (no/micro 80–140/interaction 160–300/transition 250–380/celebration 400–700) كـ**tokens** (مش numbers متناثرة). **interruptible** (مايتجبرش المستخدم يستنى).
  - **Blur budget:** iOS real / Android 12+ controlled / older translucent / Web backdrop-if-supported-else-solid. **≤2 heavy-blur surfaces + 0–2 continuous animations per screen** (check-motion يلمس).
  - **لا Reanimated دلوقتي** (توجيه §20 = انتقائي لاحق؛ بند 7 Global Constraints).
- [ ] **Step 3: Performance budget (توجيه §19, §30, §36)**
  - measure: startup / bundle / re-renders / re-runs on `export:web` (baseline: initial `447.7KB gzip` بعد PERF-01..06) — **لا تتقدمش إلا لو القياس تحسن.**
- [ ] **Step 4: Release Gate (توجيه §50) — اكتب `docs/RELEASE_GATES.md`:**
  ```
  [ ] typecheck · [ ] all tests · [ ] layout gate · [ ] contrast gate (incl. glass) ·
  [ ] a11y gate · [ ] i18n parity · [ ] E2E · [ ] real device (VoiceOver+TalkBack) ·
  [ ] keyboard · [ ] 200% web text · [ ] reduced motion · [ ] reduced transparency ·
  [ ] light/dark/OLED · [ ] 320–1024+ responsive · [ ] no unexpected glass nesting ·
  [ ] no uncontrolled infinite animation · [ ] no critical UI under floating chrome
  ```
  + `npm run export:web` (bundle ≤ baseline) + screenshot matrix (توجيه §36: 320/360/390/430/768/1024+ × light/dark/OLED/RTL/large-text/reduced-motion/offline/empty/error/success).
  ```
  git commit -m "chore(release): a11y contracts, motion budgets, release-gate matrix"
  ```
  **Acceptance:** كل سطر في Release Gate أخضر (أو معلنة كمعطلا موثق) + `test:all` أخضر + `export:web` ناجح.

---

## Task 9 (T9): Render pass — memoization + timers (P3 من MAJOR_FIX_PLAN)

**الجذر:** حسابات O(N×M) بترجع في كل render (`dashboardStats` في `engine.ts` — filter+find لكل صف) + الـ`setDb` بيعيد render **كل التابات المفتوحة** (`RootNavigator.tsx:472-486` — `visitedTabs` بـ`display:none` لسه mounted) + timers حارّة: `LiveSessionScreen:64` (500ms) + `TodayScreen:56` (`useNow` 1s) + `DynamicStreakFire`/`ShimmerProgressBar`/`glass.tsx` loops.

**Files:** `src/data/engine.ts` (المساعدات فقط — **تجنب Block الـbonus اللي T3 بيمسه**؛ اعمل T9 **بعد** T3) · `src/app/RootNavigator.tsx` (unmount التابات المخفية) · `src/features/volunteer/LiveSessionScreen.tsx` + `src/features/today/TodayScreen.tsx` (timers) · Test: استعراض `test:perf` موجود.

- [ ] **Step 0 (Preflight):** `git log --oneline | grep -i "engine.*bonus"` — T9 **مش مسموح** إلا بعد T3 (نفس ملف engine.ts — منع تعارض).
- [ ] **Step 1: Precompute maps**
  في `engine.ts`: `dashboardStats` (`:1064-1096`) → precompute `session→attendance` Map **مرة** (useMemo على `db.attendance`/`db.sessions` في الـcaller `DashboardScreen:75`)؛ نفس الأنماط في `seatCounts`/`attendancePct`/`issuanceTable`/`getWeeklyLeague` (`:637-668`). **القاعدة:** الـprecompute = مساعد pure في engine، والـmemoization في الـcaller (مش في المحرك).
- [ ] **Step 2: unmount التابات المخفية**
  `RootNavigator.tsx:472-486` — بدل `display:none` للتابات اللي مش active: **unmount** (نفس سلوك `visitedTabs` بس بـ`return null` للغير-active) — الـstate بيتحفظ في الـstore مش في الـtab (افحص إن مفيش tab state حرج local).
- [ ] **Step 3: timer واحد**
  `LiveSessionScreen:64` (500ms) + `TodayScreen:56` (1s) → **Ticker context واحد** (مصدر واحد، الشاشات تشترك بالinterval اللي تخدمها؛ لو مفيش live session يتوقف الـ1s). الـloops (`DynamicStreakFire` ×4 / `ShimmerProgressBar` / `glass.tsx` 12s / `CountUp`) → مسموح بس **≤2 continuous per screen** (بوابة check-motion في T5) + كل واحد عنده reduced-motion guard.
- [ ] **Step 4: GREEN + commit**
  ```
  git commit -m "perf(render): precomputed maps, unmount hidden tabs, single ticker, animation budgets"
  ```
  **Acceptance:** مفيش jank في Live screen على جهاز ضعيف (60fps) · re-render count (React DevTools/profile) = فقط الـtab النشط · الـperf test مبيرتجعتش (لوقدر).

---

## Execution Summary + Rollback + «ولا نفعلها»

| Task | Scope | Commit | Gate |
|---|---|---|---|
| T0 | Preflight (قراءة) | — | بوابات خضراء |
| T1 | roles 0035 + client + guards | 1 | 7 transitions + detector |
| T2 | data-layer (scoped/chunked/filters/gate) | 1 | network log + e2e |
| T3 | engine bonus drift | 1 | test:engine 68/68 |
| T4 | freeze inventory (doc) | 1 | جدول مكتمل |
| T5 | Surface/Glass + tokens + lint | 1 | 0 glass-content + buttons≥44 |
| T6 | shell/safe-area/skeletons/RTL | 1 | مفيش overlap + كل شاشة 3-state |
| T7 | DB indexes/retention/async (**LIVE-OPS موافقة**) | 1 | sql:check + pg_cron |
| T8 | a11y/motion/perf/release gate | 1 | Release Gate matrix |
| T9 | render pass (memo/timers — **بعد T3**: نفس ملف engine) | 1 | 60fps live + re-render = الـtab النشط فقط |
| T6b | orbs/ألوان/Toast/scroll (توجيه §11/12/33/40) | 1 | مفيش 2 toast system · orb واحد · scroll-edge |

**Rollback:** كل Task = commit واحد → `git revert <sha>` (T7 = revert migration + **LIVE** rollback needs approval). T5/T6 visual-only (safe). T2/T3 = data/logic (revert يسحب الـscoped refresh — **مفيش data loss** لأن الـcache بتاعنا).

**ولا نفعلها دلوقتي (انضباط):** React-Query/SWR (ابدأ بـscoped) · Service Worker upgrade · Rive/Lottie + Faten asset pipeline (مفصود في Master Plan §4/§32 — قرار منفصل + ميزانية) · Materialized views بدل MVs في 0032 · Reanimated 4 (انتقائي لاحق) · desktop 3-panel experience (توجيه §28/§29 = مرحلة ما بعد T6 — مفيش طلب حالي للتابلت).

**LIVE-OPS (تستاهل موافقة Shaker صريحة):** تطبيق `0035`/`0036`/`0032_wave_c` + retention cron على `udqgaudt` — **بالترتيب** `0032 → 0035 → 0036` (0033/0034 متطبقين حسب probe 10-01).

