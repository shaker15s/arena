# Masar 3.2 — Independent Forensic Feature Reality Audit

**Repository:** `shaker15s/arena`
**Branch inspected:** `main` (commit `017601c`)
**Audit date:** 24 August 2026
**Method:** Code-and-contract audit from the working checkout at `/home/user/arena`. Every verdict below is derived from reading the actual source, migrations, docs, and package scripts — not from the repository's own claims, and not from the supplied audit document (which I treated as a claim to verify).

> **Note on scope honesty.** `node_modules` is *not* installed in this checkout, so I could not execute the TypeScript build, the web export, the engine tests, or `npm audit`/`expo-doctor`. Where the docs claim those pass, I mark the claim as `CLAIMED, not re-executed`. Where behavior is observable purely from source (RLS policies, RPC grants, mutation wiring, SQL), I verified it directly.

---

## 1. Executive summary

**The pasted audit is substantially correct in its overall verdict but overstated the two most severe findings (SEC-001 and the "course creation PARTIAL" framing) and under-reported several real, concrete defects.**

My independent verdict: **REAL backend core + functional product + significant operational gaps + unverified E2E/race/device certification.** This matches the audit's "not fake, not production-certified." But three claims in the supplied audit need correction:

1. **SEC-001 ("no proof that every UI mutation bypasses client diff writes") is largely resolved in the current code.** I traced every mutation path. All sensitive mutations (auth, enrollment, session start/close/QR/check-in/manual, excuses, ratings, kudos, certificates, org creation, broadcasts, role changes, broadcasts, support requests) go **directly through `.rpc()` wrappers in `src/data/actions.ts`**, not through the client diff writer. The `mutate()`→`pushDelta()` path is used in the shipped app in exactly **two** non-critical places. The real lingering risk is not "screens bypass RPC" but that `pushDelta` **remains a live mutation primitive** (DATA-002) and that `fetchRemoteDb()` remains the only read model (DATA-001).

2. **The supplied audit put "PDF export = PARTIAL."** The correct finding is narrower and sharper: **session/batch roster export is labeled "PDF" but emits CSV**, and the actual PDF export exists **only for certificates**. There is no roster/report PDF.

3. **A concrete, hidden defect the supplied audit missed:** the certificate **on-screen verification QR encodes `MSRVERIFY:<serial>`**, which is not a URL and does not match the app's link config (`Verify: 'verify'`). A third party scanning the on-screen QR with a phone camera gets a dead token. The **PDF** certificate QR and the copy-link use the correct `/verify?serial=` URL, so only the on-screen QR is broken/decorative.

---

## 2. Confirming and correcting the documentation contradictions (DOC-001)

The supplied audit flagged one README contradiction (phone-OTP comment vs Google-only code). My inspection found the docs are **worse than a single stale line** — the top-level docs disagree with each other *and* with the code on four independent points.

| Contradiction | README.md | docs/REALNESS.md | PRODUCTION_AUDIT_AR.md | Actual code |
|---|---|---|---|---|
| Auth method | Feature tree line 63: `auth/ # دخول هاتف OTP` | "Google OAuth ... only" (Removed OTP) | Google + "Google OAuth" | Google-only. `AuthScreens.tsx` header: "لا OTP..."; `supabase.ts` uses `signInWithOAuth`. **README line 63 is stale.** |
| Version | Title "Masar 3.1" | "3.1" | "3.2" | `package.json` `version: 3.2.0`; `app.json` `version: 3.2.0`. **README/REALNESS title is stale.** |
| i18n keys | "524 مفتاحًا" | (silent) | "598/598" | `check-i18n-parity.js` reports **598 keys in both dictionaries**. **README (524) is stale; audit doc's 598 is correct.** |
| Engine tests | "49 اختبارًا" | (silent) | "51/51" | `scripts/engine.test.ts` contains **51 top-level `ok(...)` assertions** (custom harness, not Jest). Run by `npm run test:engine`. **README (49) and PRODUCTION_AUDIT (51) disagree with each other; actual ≈51.** |
| Migrations | line 72: `migrations مرقّمة (0001-0003)` | (silent) | "0001 ... 0006" | `supabase/migrations/` = `0001, 0002, 0004, 0005, 0006`. **There is no `0003`.** README's "0001-0003" is stale; PRODUCTION_AUDIT correctly lists 0001/0006. |
| CI "db reset job" | (silent) | (silent) | §8/§9: "أضيف job في CI يشغّل Supabase محليًا ثم `db reset`" | **No `.github/workflows` or any CI config exists in the repo.** The CI DB-reset job is described but not present in this snapshot. |

**Root cause of DOC-001:** there is no canonical product spec, and the docs drifted across three generations (rebuild plan → 3.1 → 3.2) without consolidation. The supplied audit's recommendation (establish `docs/product/` canonical specs and make every doc link to them) is the right fix and is **uncontroversially correct**.

---

## 3. Data-layer facts (the part every verdict depends on)

These are the load-bearing structures; they match the supplied audit's `DATA-001`/`DATA-002` and explain most verdicts.

### 3.1 Read model: one giant fetch (`DATA-001`)

`fetchRemoteDb()` (`src/data/remote.ts:82`) reads **~23 tables/views in parallel** and maps them into a single client-side `Db` object: `profiles, branches, committees, courses, batches, batchStats, enrollments, sessions, attendance, point_events, streak_weeks, gamification, badges, user_badges, league_weeks, certificates, excuses, ratings, rules, audit, kudos_quotas, notifications, private_notes`.

- Pagination is global: `READ_PAGE_SIZE = 500`, `MAX_READ_ROWS = 100_000` (`remote.ts:42`). It throws if a table hops 100k rows (`remote.ts:56`). This is a real scaling ceiling and a real data-exposure boundary (it pulls entire tables for the current user, filtered by RLS).
- There is **no per-screen domain query** (`getCourse(courseId)`, `getBatchRoster(...)`). The supplied audit's DATA-001 is accurate.

### 3.2 Write path: diff sync vs RPC (`DATA-002` / SEC-001)

Two write mechanisms exist in the client:

1. **RPC wrappers** in `src/data/actions.ts` — every sensitive operation. Confirmed RPCs called from screens:
   `complete_my_profile, update_my_profile, admin_update_user_access, join_batch, join_batch_by_code, start_training_session, get_session_qr_payload, check_in_with_token, manual_mark_attendance, close_training_session, create_branch, create_committee, create_course, create_batch_with_sessions, bootstrap_organization, update_gamification_rule, set_badge_active, submit_excuse, review_excuse, submit_course_rating, award_kudos, issue_batch_certificates, verify_certificate, submit_support_request, review_support_request, broadcast_notifications, fetch_support_requests`.

2. **`mutate()` → `pushDelta(before, after)`** — a generic before/after whole-`Db` diff that upserts/deletes per table (`remote.ts:414`, `SPECS` at `remote.ts:228`). In the shipped app this is called in **exactly two** places:
   - `src/data/store.tsx:347` — `markNotificationsRead` (marks own notifications read). RLS-consistent: `notifications_own_update` (`0005:1092`) allows updating own rows.
   - `src/features/volunteer/VolunteerScreens.tsx:375` — `saveNote` (instructor private note). RLS-consistent: `notes_owner` `FOR ALL` (`0005:1091`) allows the owner full access.

   All other feature screens call the RPC wrappers directly and then `refresh()`.

**Conclusion for SEC-001:** The audit's phrase "not every write path should automatically be assumed to be using the hardened RPC boundary" is technically true but, in the *current shipped code*, the answer is: **all sensitive mutations do use the RPC boundary.** The two `mutate()` paths are non-critical and RLS-permitted. The audit's framing ("must trace every mutation...") was the right instruction, and the trace resolves it in the product's favor — but it also exposes that `pushDelta` remains a **live, general-purpose mutation primitive** that a future screen could misuse. That is precisely why `0005` makes direct-table writes RPC-only (see §4) — the server is the backstop.

### 3.3 Realtime = full DB refresh (`SUBSCRIBE` concern)

`subscribeRealtime()` (`remote.ts:459`) subscribes to `sessions, attendance, notifications, excuses, enrollments, point_events` and calls `onChange`. In `store.tsx:199`, that `onChange` is `refresh()`, which calls the full `fetchRemoteDb()`. So **any single attendance/notification/session event triggers a reload of all ~23 tables** (with de-duplication via `refreshInFlight`, `store.tsx:106-146`). The supplied audit's "event → fetch entire Db" concern is **accurate and is the single biggest scale risk in the app.**

### 3.4 Offline = read-only cache (`OFFLINE`)

`readCache`/`writeCache` (`store.tsx`) persist the whole `Db` to `AsyncStorage`/`localStorage` (key `masar.cache.v1`) and show it on startup/outage. There is **no write queue, no command id, no idempotency** for offline writes, and scanning/check-in is gated on `online` (`ScannerScreen.tsx`). This matches the audit: offline reads GOOD, offline critical writes NOT READY.

---

## 4. Security boundary verification (RLS + RPC)

I verified the actual Postgres boundary in `supabase/migrations/0005_production_hardening.sql`.

- **Sensitive writes are RPC-only.** After `0005`, the old permissive INSERT/UPDATE/DELETE policies are dropped and replaced with **read-visibility policies only** for: `profiles, branches, committees, courses, batches, sessions, enrollments, attendance, point_events, streak_weeks, gamification, user_badges, league_weeks, certificates, excuses, course_ratings, gamification_rules, audit_log, kudos_quotas, notifications, support_requests`. The only remaining authenticated write policy is `notes_owner` (`0005:1091`).
- **`profiles` is not directly mutable.** `REVOKE UPDATE ON public.profiles FROM authenticated;` (`0005:1102`). Profile mutations go through `complete_my_profile` / `update_my_profile` / `admin_update_user_access`.
- **`qr_seed` is not downloadable.** `REVOKE SELECT ON public.sessions FROM anon, authenticated;` then `GRANT SELECT(id,batch_id,seq,title,starts_at,duration_min,status,started_at,closed_at,report,created_at)` (`0005:1104-1105`). The QR seed is never exposed; `get_session_qr_payload` returns a signed token + backup code only.
- **The old insecure `check_in_session(UUID,UUID,TEXT)`** (which accepted an arbitrary user id) is revoked (`0005:1109`).
- **Explicit RPC grants.** `0005:1149` grants `EXECUTE ... TO authenticated` on the full list of security-sensitive functions and `REVOKE`s them from `PUBLIC`/`anon`. `verify_certificate` is granted to `anon, authenticated` (`0005:1154`) — correct for public verification.
- **Internal helpers are not callable** by clients: `evaluate_user_badges`, `_qr_signature`, `_backup_code` are all `REVOKE` (later in `0005`).

### 4.1 Atomicity

- **Enrollment:** `join_batch` uses `SELECT * INTO v_batch ... FOR UPDATE` on the batch row, then counts active enrollments and writes `active` or `waitlist`. This serializes concurrent joins per batch → genuinely prevents overbooking *by design*. (`0005`, `join_batch`.) Marked **UNVERIFIED** because no concurrent integration test ships in the repo.
- **Batch publication:** `create_batch_with_sessions` validates session count == course `sessions_count`, checks intra-batch session overlap, checks instructor schedule conflicts, and inserts batch + all sessions in one transaction. **Concrete gap:** it validates **instructor** schedule conflicts but does **not** validate **room** collisions (`room` is not checked for overlap). So two batches can share the same room at the same time.
- **Kudos:** `award_kudos` locks the instructor's monthly `kudos_quotas` row, checks quota, uses an `idempotency_key`, and re-checks on conflict — atomic and idempotent.
- **Certificates:** `issue_batch_certificates` is idempotent (`ON CONFLICT(user_id,batch_id) DO NOTHING`) and server-authoritative on eligibility (≥ min_attendance_pct, batch completed, ≥1 student, all sessions closed).

### 4.2 First-admin bootstrap (`org bootstrap`)

`handle_new_user` (`0004:34`) uses `pg_advisory_xact_lock(hashtextextended('masar-first-admin', 0))` and only grants `admin` when `NEW.raw_app_meta_data->>'masar_bootstrap_admin'='true'` **and** no admin exists (`0004:46`). So the first visitor does **not** automatically become admin — good, and the supplied audit's "GOOD SECURITY DECISION" is correct. The operational bootstrap procedure is documented in `SUPABASE_SETUP.md` (I did not find a machine-enforced path in the repo beyond the trigger).

---

## 5. Feature-by-feature verdict matrix (independent)

Legend: **REAL** = persisted backend + authorization + usable UI; **PARTIAL** = real but missing a production-critical piece; **MOCKED** = local fixtures/simulation; **DECORATIVE** = UI communicates an effect it does not create; **MISSING** = no production implementation; **BLOCKED** = exists but cannot be certified without external config/device/infra.

| Feature | My verdict | Evidence / reasoning |
|---|---|---|
| Google authentication | **REAL / BLOCKED (E2E)** | `supabase.ts` PKCE + Google OAuth, `AuthScreens.tsx` calls `signInWithGoogle`, handles configure/unconfigure/loading/error/cancel. No OTP/phone/demo (`store.tsx:4`, `AuthScreens.tsx:3`). NOT verified on real iOS/Android device (no dev build in repo). |
| First-user onboarding | **REAL UI / PARTIAL flow** | 3-slide onboarding w/ Reduce Motion (`AuthScreens.tsx`). But the post-login activation state machine (new→profile→no-enrollment→enrolled) is not a modeled requirement; new user can reach a sparsely-populated Today. |
| Profile completion | **REAL** | `complete_my_profile`/`update_my_profile` RPCs validate name/phone(`^01[0-9]{9}$`)/branch/gender. Email is display-only (`lock` icon). Role and branch assignment are server-authorized; branch id not settable to an inactive branch. |
| Course discovery | **PARTIAL** | `ExploreScreen` filters `db.courses` client-side by field + branch + substring; no server search, no pagination for catalog, no "not eligible"/waitlist presentation beyond seats. |
| Course details | **REAL / PARTIAL (scale)** | `CourseManagementScreen` is real and reads live data; but it filters `db.batches` client-side and derives occupancy/attendance locally. No `getCourseOverview`/`getBatchRoster` domain query. |
| Course creation | **PARTIAL (authoring depth)** | `create_course` RPC is atomic + server-validated. But the model is `title/field/description/topics/sessions_count/status/color` — no Module/Lesson/Assessment curriculum tree. (Supplied audit's PRODUCT GAP framing is correct; not a bug.) |
| Batch creation | **REAL backend / PARTIAL validation** | `create_batch_with_sessions` atomic; detects instructor conflict. **No room-collision check** (only instructor). (See §4.1.) |
| Batch publishing | **REAL** | Atomic insert of batch + sessions, `status='scheduled'`, `join_code` generated. |
| Session generation | **REAL** | `generateSessionsForBatch` (engine) for preview; server generates from provided sessions array. |
| Enrollment | **REAL by design / UNVERIFIED** | `join_batch` row-locks; capacity→active else waitlist. No concurrent integration test in repo. |
| Enrollment race safety | **REAL by design / UNVERIFIED** | `SELECT ... FOR UPDATE` on batch serializes joins. |
| Join code | **REAL** | `join_batch_by_code` validates length 6–40, whitelists status, delegates to `join_batch`. |
| Join QR / link | **REAL by design / UNVERIFIED** | `publicJoinUrl(code)` → `/join?code=`; linking config `JoinBatch: 'join'` (`RootNavigator.tsx:54`). |
| Waitlist | **PARTIAL** | Insert sets `waitlist`; **no promotion automation** (no cron/RPC to promote from waitlist → active → notify). |
| Live session | **REAL** | `start_training_session` (instructor-only via `can_manage_batch`), `myLive` UI, `close_training_session` atomic. |
| Rotating QR attendance | **REAL by design / UNVERIFIED** | `get_session_qr_payload` returns signed `MSRQ:id:slot:sig`, rotates 25s (`QR_ROTATION_MS`), accepts current/prev slot only (`check_in_with_token`). Not device-tested. |
| Backup attendance code | **REAL by design / weak** | Static 6-digit `_backup_code(seed, session)` valid for the whole session; only checks enrollment. (SEC-004.) |
| Manual attendance | **REAL by design** | `manual_mark_attendance` requires live session + manager/instructor, reason 3–500 chars, idempotent, audits. |
| Attendance correction | **PARTIAL** | Manual marking exists but only `present|late`; **no explicit policy** for corrections: student cannot edit (good), instructor can mark but there's no "revert to absent / excused" correction flow; no supervisor-review-of-branch step. |
| Excuses | **REAL** | `submit_excuse` (absent-only, dedupe) + `review_excuse` (accept sets `excused`, notify, audit). Missing: attachment upload validation/MIME/size (attachment is a URL string only) & appeal/reopen & bulk review. |
| Realtime | **REAL architecture / UNVERIFIED / scale-risk** | Subscribed; but every event → full `fetchRemoteDb()`. |
| In-app notifications | **REAL** | RPCs insert notifications with `dedupe_key`; `notifications_own_read/update` RLS; `markNotificationsRead` mutate. |
| Push notifications | **MISSING** | No `expo-notifications`, no push-token table, no token refresh/cleanup. Confirmed by grep across `src/` and `package.json`. |
| Gamification points | **REAL** | `point_events` ledger is source of truth (balance = SUM), unique `idempotency_key`. |
| Streaks | **REAL** | `evaluateStreakWeek` + server cron `settle_previous_streak_week`. |
| Badges | **REAL** | `evaluate_user_badges` (SECURITY DEFINER, revoked), `set_badge_active`. `season_legend` disabled (active=false in `0001`). |
| League | **REAL / PARTIAL season model** | `close_previous_league_week` cron + tiers. Season domain intentionally disabled (`0001`). |
| Kudos | **REAL** | `award_kudos` quota-locked + idempotent. |
| Certificates | **REAL / PARTIAL ops** | Issuance atomic/idempotent; PDF export works. **No revocation, reissue, template management, branding, versioning.** |
| Public certificate verification | **REAL by design / QR nuance** | `verify_certificate` returns minimal projection; granted to `anon`. **On-screen QR broken** (see §6). |
| CSV export | **REAL (roster)** | `saveCsv`/`toCsv` (`shared/export.ts`) produce a real CSV (web download / native share). |
| PDF export | **PARTIAL** | Certificate PDF only. **Roster/report PDF missing.** Button labeled "PDF" but emits CSV (§6). |
| Excel export | **MISSING** | No xlsx. |
| JSON / API export | **MISSING** | No export API/job. |
| Session analytics | **MISSING / minimal** | Close summary returns present/late/absent/excused/total; no first-class session report workflow, no per-session export, no "notify absent" action. |
| Course / Branch analytics | **PARTIAL** | `dashboardStats` + `courseRatingStats` are local derived metrics; no server-side reporting views (`attendance_fact`, etc.). |
| Student risk analytics | **MISSING** | No predictive/risk model. |
| Search / advanced filtering | **PARTIAL** | Client-side substring filter over full `db.courses`/`db.profiles`; permission-aware via RLS, but no server search, no pagination. |
| Admin data grid | **PARTIAL** | `UsersScreen` lists profiles client-side with role filter + debounced search; no bulk actions. |
| Kiosk mode | **MISSING** | No kiosk/tablet entry mode. |
| Geofencing | **MISSING** | Acknowledged in `REALNESS.md` as the top remaining gap. |
| NFC attendance | **MISSING** | Listed in `REALNESS.md` gaps. |
| Calendar integration | **MISSING** | No ICS/`expo-calendar`. |
| Push reminders | **MISSING** | `enqueue_session_reminders` creates in-app notifications only; no push. |
| Volunteer invitation | **PARTIAL** | `submit_support_request` (`course_request`→volunteer) exists; there is no invite-by-link with a *predetermined* role/accept flow. |
| Admin broadcasts | **REAL** | `broadcast_notifications` targets active users, atomic count, audited. |
| Organization management | **REAL / PARTIAL** | `OrgManagerScreen` + wizard; branch/committee/course CRUD real. No true multitenant boundary (see below). |
| Multi-tenancy | **PARTIAL** | Branch/committee structure, but no `org_id` on every tenant-owned row; `list_visible_profiles`/RLS use `branch_id`/role, not an organization tenant key. Good for a single org, not SaaS-complete. |
| Offline reads | **REAL** | AsyncStorage/localStorage cache, `readCache`/`writeCache`. |
| Offline writes | **MISSING / unsafe for critical writes** | No command queue/idempotency; check-in gated on `online`. |
| Sync conflict handling | **PARTIAL** | `mutate` reverts on RPC/upsert error (`store.tsx`), but there's no server-time/conflict-resolution policy for offline mutations. |
| Audit log | **REAL** | `audit_log`, admin-only read (`audit_admin_read`), latest 500 fetched client-side. |
| Account deletion | **MISSING / release blocker** | No delete UI/RPC/anonymization path. |
| Privacy controls | **PARTIAL** | Restricted profile directory (`list_visible_profiles` mutes email/phone/uid for non-privileged); `qr_seed` hidden; certificate projection minimal; private notes owner-only. No documented consent/DPA/retention. |
| Accessibility | **PARTIAL** | Uses safe-area, Reduce Motion (`isReducedMotion`), contrast-aware theme, accessibilityRole on some controls. No full VoiceOver/Dynamic Type/44pt target audit. |
| Motion / Reduce Motion | **PARTIAL / good foundation** | Central `isReducedMotion()` honored across onboarding, live session ring, scanner laser, trend bars, celebrations. No global motion contract (normal/reduced/disabled) enforced for every animation. |
| i18n parity | **REAL tooling** | `check-i18n-parity.js` passes: **598 keys** in ar & en. |
| App Store release pipeline | **BLOCKED** | `eas.json` present, but no real-device cert; OAuth callback, camera, print/share need device dev-build testing (per `PRODUCTION_AUDIT_AR.md` §8/§9). |
| Crash monitoring / observability | **MISSING** | No Sentry/Bugsnag/etc.; `PRODUCTION_AUDIT_AR.md` §8 itself lists this as a missing operational component. |
| Load testing | **MISSING** | No load/race harness in repo. |
| Security penetration tests | **MISSING** | No automated pentest suite; RLS/RPC logic reviewed statically only. |

---

## 6. Highest-risk findings — with corrections to the supplied audit

| ID | Severity | Finding | Correction vs supplied audit |
|---|---|---|---|
| **SEC-001** | Critical→**Downgraded to Medium (current code)** | The audit said "no proof that every UI mutation bypasses client diff writes." **I traced them all.** Every sensitive operation goes through `src/data/actions.ts` RPC wrappers; only notifications-read and private-note use `mutate()`/`pushDelta`, both RLS-permitted. | Superseded. The residual risk is DATA-002 (pushDelta remains a live mutation primitive) and DATA-001 (giant fetch), not that screens bypass RPC. |
| **SEC-002** | Critical | Offline critical writes not production-ready. | Confirmed. Keep as Critical. |
| **SEC-003** | High | QR proxy attendance (rotate token prevents replay, not remote/proxy check-in). | Confirmed. No geofence (acknowledged in `REALNESS.md`). |
| **SEC-004** | High | Static 6-digit backup code shareable for whole session. | Confirmed. |
| **SEC-005** | High | Export privacy — exports can exceed UI visibility. | Confirmed; exacerbated by client-side CSV assembling phone numbers from the whole roster in `VolunteerScreens`. Since exports run client-side with the data the user already fetched, an instructor could export contact data for their roster — which is within their RLS scope, but there's no server-scoped export job/audit/signed-URL. |
| **DATA-001** | High | Whole app `fetchRemoteDb()` loads ~23 tables. | Confirmed. |
| **DATA-002** | High | `pushDelta()` client diff sync. | Confirmed, but note it is dormant for sensitive ops (see SEC-001). |
| **UX-001** | High | Course authoring not a mature curriculum system. | Confirmed (module/lesson/assessment missing). |
| **UX-002** | High | Session reporting under-built. | Confirmed. |
| **OPS-001** | High | Push notifications missing. | Confirmed. |
| **OPS-002** | High | Kiosk missing. | Confirmed. |
| **OPS-003** | High | No full analytics/reporting layer. | Confirmed. |
| **RELEASE-001** | Critical | No final production certification. | Confirmed and strengthened: the repo's own `PRODUCTION_AUDIT_AR.md` gates production on a real Postgres reset, RLS integration tests, and EAS device tests. I also verified **no CI config exists in the repo**, so the desired "`db reset` job" isn't actually present. |
| **NEW: QR-001** | Medium | Certificate on-screen verification QR encodes `MSRVERIFY:<serial>` — not a URL, doesn't match the `Verify: 'verify'` link config. | **Missed by the supplied audit.** PDF QR + copy-link are correct. |
| **NEW: EXP-001** | Medium | Session roster export button labeled "PDF" (`sess.export`) but emits CSV via `saveCsv`. | **More specific than the audit's "PDF = PARTIAL."** PDF roster export is genuinely missing; the label is misleading. |
| **NEW: BATCH-001** | Medium | `create_batch_with_sessions` checks instructor schedule conflicts but **not room collisions**. Two batches can be scheduled in the same room at the same time. | **Missed by the supplied audit.** |

---

## 7. What the supplied audit got right and wrong

**Right (confirmed by code):**
- Overall verdict "REAL CORE + PARTIAL PRODUCT + MISSING OPERATIONAL FEATURES + UNVERIFIED E2E."
- DOC-001 documentation drift (understated; there are actually 4+ independent contradictions).
- DATA-001 (giant fetch) and DATA-002 (diff sync) as scale/architecture risks.
- SEC-002/003/004/005, OPS-001/002/003, RELEASE-001.
- The feature inventory verdicts for: profile, course creation (authoring gap), waitlist (no automation), excuses (quality layer missing), realtime (full refresh), offline (read-only), push (missing), certificates (no revocation/reissue), exports (Excel/JSON missing), analytics (partial), account deletion (missing/release blocker), privacy (partial), multi-tenancy (partial).
- The audit's "real backend is not production-complete" framing.

**Wrong / overstated:**
- **SEC-001** ("Critical", "no proof") — I provide the proof; the current app routes all sensitive mutations through RPCs. Downgrade to Medium as a latent risk.
- **"PDF export = PARTIAL"** — the sharper truth is CSV-for-PDF-label + certificate-only PDF.
- **"524 i18n keys"** — the repo has 598; the audit adopted the stale README number.
- **"49 engine tests"** — the suite is ~51 `ok(...)` assertions; the audit adopted the stale README number.
- **"Course details use global db + local filtering"** described as a risk — correct for scale, but it's not a correctness bug because the server RLS already bounds the data the client sees.

**Missed:**
- QR-001 (certificate on-screen QR is a dead token).
- EXP-001 (export button says PDF, produces CSV).
- BATCH-001 (no room-collision check).
- No CI config present despite the "CI db reset job" claim.
- The docs disagree with each other (not just README vs code): README says 3.1/524/49/0001-0003, PRODUCTION_AUDIT says 3.2/598/51, and neither matches the migration directory exactly.

---

## 8. Highest-value next actions

Confirmed as highest-leverage by the code (not just by the audit):

1. **P0 — Domain query layer.** Add server-side methods (or Postgres views + RPCs) for `getCourseOverview`, `getBatchRoster`, `getBatchSessions`, `getSessionRoster`, `getAnalytics(scope)`, and stop loading the full `Db` for every screen. This is the single biggest scale/authorization win and enables per-screen RLS.
2. **P0 — Make realtime incremental.** Replace `onChange → refresh()` full reload with event-driven cache updates for attendance/notifications/sessions. **DONE in the working branch** (`arena/01a034df-arena`, group 4): `subscribeRealtime` now forwards each event, and `applyRealtimePatch` in `src/data/remote.ts` upserts/removes the single row locally for the 6 subscribed tables (sessions, attendance, notifications, excuses, enrollments, point_events) plus refreshes derived batch seats; `store.tsx` applies the patch to the in-memory `Db` + cache and falls back to `refresh()` only when a table/event can't be applied. The realtime publication for these tables already exists in `0004`, so no new SQL is required.
3. **P0 — Offline write policy.** Either disable critical offline writes or implement a command queue (`command_id, created_at, device_time, payload, status, retry_count, server_result`) with server idempotency.
4. **P0 — Room-collision check** in `create_batch_with_sessions` (BATCH-001).
5. **P0 — Fix certificate on-screen QR** to encode the real `/verify?serial=` URL (QR-001).
6. **P0 — Rename/implement roster export** correctly (EXP-001): either produce a real PDF or rename the label to CSV.
7. **P0 — Account deletion** end-to-end (App Store requirement).
8. **P1 — Push notifications**, waitlist promotion automation, session report (summary + export + notify absent), analytics views, CSV/Excel/PDF export center, kiosk, geofence option, crash monitoring.
9. **P0 — Real certification harness:** commit the CI `db reset` job + RLS integration/race tests (none exist in the repo today).
10. **P0 — Fix documentation drift:** one canonical spec; delete the stale 3.1/OTP/524/49/0001-0003 claims.

---

## 9. Bottom line

The project has a **genuine** real backend: Postgres schema (0001), Google auth + RLS + atomic RPC hardening (0004/0005), and scheduled automation (0006). The sensitive operations are correctly routed through server RPCs and protected by RLS that the client cannot bypass. That is materially better than the supplied audit's worst-case reading of SEC-001.

But the product is **not production-certified**: it lacks a domain query layer, incremental realtime, offline-write policy, room-collision check, proper roster/PDF export, account deletion, push, kiosk, geofencing, analytics, crash monitoring, and — decisively — any committed CI/race/device-test harness. The most important correction to the supplied audit is that the bottleneck is **not** client-side security bypassing RPCs (the code handles that), it is the **operational + scale + certification + authoring depth** layer.
