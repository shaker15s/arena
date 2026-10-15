# دليل مشروع «مسار» الكامل — MASAR 4.0

> هذا الملف هو **المرجع الواحد الشامل** لكل ما يخص المشروع: الرؤية، المعمارية، قاعدة
> البيانات، الأمان، قواعد اللعبة، الشارات، الشاشات، التصميم، التوطين، البوابات،
> الاختبارات، التشغيل والنشر. كل جدول أو رقم في هذا الملف **مستخرج من المستودع
> نفسه** (لا وصف نظري)، وأي تعديل في الكود يجب أن يُتبَع بتحديث هذا الملف.
>
> آخر تحديث: 15 أكتوبر 2026 — «الموجة H» (دقّة الكروت + الأجندة الموحّدة + الشارات + التوثيق).

---

## 0) محتويات الدليل

1. [نظرة عامة وما يفعله التطبيق](#1-نظرة-عامة)
2. [المعمارية ومبدأ «حقيقة واحدة»](#2-المعمارية)
3. [خريطة المستودع](#3-خريطة-المستودع)
4. [نموذج البيانات (43 جدولًا)](#4-نموذج-البيانات)
5. [طبقة RPC: كل ما يكتب ويقرأ](#5-طبقة-rpc)
6. [الترحيلات (38 ملفًا)](#6-الترحيلات)
7. [قواعد اللعبة](#7-قواعد-اللعبة)
8. [الشارات (16 تعريفًا) وكيف تُحسب](#8-الشارات)
9. [الحضور: من الـQR إلى النقطة](#9-الحضور)
10. [الشهادات](#10-الشهادات)
11. [الأدوار والصلاحيات](#11-الأدوار-والصلاحيات)
12. [خريطة الشاشات والتنقّل](#12-خريطة-الشاشات-والتنقّل)
13. [التصميم: Apple Liquid Glass](#13-التصميم)
14. [فطن — تميمة التطبيق](#14-فطن)
15. [التوطين (عربي/إنجليزي)](#15-التوطين)
16. [الأمان والتدقيق ومكافحة التلاعب](#16-الأمان)
17. [بوابات الجودة (Quality Gates)](#17-بوابات-الجودة)
18. [الاختبارات وأرقامها](#18-الاختبارات)
19. [الأجندة الموحّدة ودقّة الكروت (الموجة H)](#19-الأجندة-الموحّدة)
20. [التشغيل والنشر](#20-التشغيل-والنشر)
21. [ما يتبقّى بصراحة](#21-ما-يتبقّى)

---

## 1) نظرة عامة

«مسار» منصّة تدريب مجتمعي عربية (مصرية) تُدار بالكامل على الويب والموبايل عبر
Expo/React Native Web + Supabase:

| البُعد | التفاصيل |
| --- | --- |
| **الجمهور** | طالب · متطوّع/مدرّب · مشرف فرع · أدمن |
| **الرحلة الأساسية** | كورس → دفعة (Batch) → محاضرة → QR دوّار → حضور → نقاط → ستريك → دوري → شهادة |
| **الطابع** | «لعبة تعلّم» بشخصية فطن (تميمة) تحفّز الطالب، ولوحات أرقام للمدرّب والمنظّم |
| **اللغة** | عربي مصري أولًا + إنجليزي كامل (1655 مفتاحًا × لغتين، بلا نصوص مكتوبة في الكود) |
| **المصدر الوحيد للحقيقة** | Postgres/Supabase (جداول + RPC مُدقّقة). العميل لا يكتب جدولًا مباشرة |
| **الإصدار** | `masar@4.0.0` (Expo SDK 54، React Native 0.81، Supabase JS 2) |

---

## 2) المعمارية

### الطبقات (اتجاه التبعية أحادي: `features` → `data`/`design`/`shared`)

```
src/
  app/        التطبيق والتنقّل والجذر (App.tsx, RootNavigator.tsx, ErrorBoundary)
  features/   الشاشات مقسّمة حسب النطاق (today, journey, courses, org, volunteer, …)
  data/       المصدر: supabase.ts (عميل) · actions.ts (RPCs) · remote.ts (قراءة) ·
              engine.ts (مرآة حتمية لنفس قواعد الخادم) · agenda.ts (الأجندة) · store.tsx (حالة)
  design/     نظام التصميم: tokens · components · glass · animations · motion · mascot
  shared/     أدوات نقية: format · plural · calendar · export · sha256 · hooks · errors
  i18n/       قاموسان ar.ts/en.ts + مزوّد I18nProvider
supabase/migrations/  38 ترحيلًا SQL (المخطط + RPCs + RLS + الفهارس)
scripts/    بوابات الجودة والاختبارات والمحاكيات (Node/tsc)
docs/       هذا الدليل + سجلات التنفيذ + تقارير التصميم
```

### مبدأ «حقيقة واحدة» (Single Source of Truth)

- **الكتابة**: كلها عبر RPCs في `data/actions.ts`. لا `insert/update` مباشر من الشاشات.
- **القراءة**: `data/remote.ts` يجلب الجداول إلى شكل `Db`، ومعظم الشاشات تحسب من `Db`
  عبر `data/engine.ts`.
- **`engine.ts` ليس حدًّا أمنيًا**: هو **مرآة حتمية** لنفس معادلات الخادم، موجودة كي
  تعمل الشاشات بلا انتظار شبكة، وكي تُختبر القواعد فعليًا في Node (158 اختبارًا).
  كل معادلة في `engine.ts` لها نظير في SQL؛ واختبار التكافؤ (`parity` + `rpc:types` +
  `test:engine`) هو ما يمنع انحراف المرآة عن الخادم.
- **الأجندة (`data/agenda.ts`)**: طبقة واحدة تجيب عن سؤال «إيه اللي جاي؟» لكل الأدوار
  (طالب/مدرّب/منظّم) — فلا تتناقض الشاشات (انظر §19).

### صيغ الجمع العربية (`shared/plural.ts`)

`tPlural(t, base, n, params)` تختار الصيغة الصحيحة من القاموس (`base.one` · `.two` ·
`.few` · `.many`) وتتبع القاعدة: 0 · 1 · 2 · 3–10 · 11+. مُطبَّقة في 12 موضعًا حيًّا:
عدّادات اليوم، الأعذار المعلّقة، الجلسات الجارية، تغذية راجعة، وحدة الاشتراك الأسبوعي،
عدّاد نهاية الأسبوع، حاجة الشهادة. أي نص جديد فيه رقم + اسم يجب أن يمرّ من هنا.

### التدفق التقني

```
شاشة → actions.ts (RPC) → Postgres (RLS + SECURITY DEFINER) → تغيير
     ↘ remote.ts (SELECT)  → Db في الذاكرة → engine/agenda → واجهة
     ↘ Realtime (subscribeRealtime/applyRealtimePatch) → تحديث تدريجي بلا إعادة جلب كاملة
```

---

## 3) خريطة المستودع

| المسار | الدور |
| --- | --- |
| `src/app/App.tsx` | الجذر: المزوّدات (i18n, theme, prefs, store)، حراسة المسارات، `BadgeModal` |
| `src/app/RootNavigator.tsx` | 4 مكدّسات: طالب/متطوّع/أدمن/مصادقة + التحميل المسبق للتبويبات |
| `src/data/actions.ts` | 94 دالة تغلّف 81 RPC مستخدمًا فعليًا |
| `src/data/engine.ts` | 73 دالة محسوبة نقية (نقاط، ستريك، دوري، شارات، تقارير، أجندة…) |
| `src/data/agenda.ts` | `agendaFor` · `nextAgendaItem` · `todayAgenda` · `daySummary` |
| `src/data/remote.ts` | قراءة كل الجداول + تطبيق Realtime تدريجيًا |
| `src/data/rules.ts` | `RULE_DEFS` (13 قاعدة) · `LEVEL_THRESHOLDS` · `QR_ROTATION_MS` · `HARD_CUTOFF_MIN` |
| `src/design/tokens.ts` | كل الألوان والمسافات والأنصاف والظلال (لا قيم خام خارجها) |
| `src/design/components.tsx` | مكتبة المكوّنات (Card, Row, Txt, Btn, Tag, Chip, Sheet…) |
| `src/design/glass.tsx` | سطح الزجاج (GlassSurface) — الاستخدام الوحيد المسموح لتوكنات الزجاج |
| `src/design/mascot/` | فطن: `FatenArt` (رسم كبيانات) + `faten.lines.ts` (الحوار) |
| `scripts/check-*.js` | بوابات الجودة (§17) |
| `scripts/*.test.ts` / `*-run.js` | الاختبارات والمحاكيات (تُنفَّذ عبر `npm run test:*`) |

---

## 4) نموذج البيانات

43 جدولًا في المخطط العام (`public`). مجموعة بالأدوار:

| المجموعة | الجداول |
| --- | --- |
| **الهوية والتنظيم** | `profiles` · `branches` · `committees` · `courses` · `course_roles` · `batches` · `enrollments` |
| **التدريب** | `sessions` · `session_content` · `course_modules` · `attendance` · `session_feedback` · `excuses` · `attendance_disputes` |
| **التحفيز** | `point_events` · `gamification` · `gamification_rules` · `streak_weeks` · `league_weeks` · `badges` · `user_badges` · `kudos_quotas` |
| **الشهادات** | `certificates` (إصدار/إلغاء/إعادة إصدار + تحقّق عام بالرقم التسلسلي) |
| **الجودة والتقارير** | `course_ratings` · `instructor_ratings` · `organization_ratings` · `course_reports` · `private_notes` |
| **التشغيل** | `notifications` · `push_tokens` · `push_preferences` · `push_outbox` · `report_subscriptions` · `metrics_snapshot` · `internal_settings` · `support_requests` |
| **الأمان والتدقيق** | `audit_log` · `domain_events` · `checkin_attempts` · `checkin_risk_signals` · `rpc_rate_events` · `client_errors` · `command_queue` |

ملاحظات مهمة:

- `sessions.qr_seed` **غير قابل للقراءة من العميل** إطلاقًا (عمود محمي، ترحيل 0029)؛
  التوكن الدوّار يُشتق على الخادم ويُسلَّم عبر `get_session_qr_payload`.
- كل جدول به `ENABLE ROW LEVEL SECURITY` وسياسات مكتوبة في الترحيلات (§16).
- `course_reports` يحمل دورة حياة: `draft → published` مع إشعار مرة واحدة لكل نشر.

---

## 5) طبقة RPC

**قاعدة المشروع: لا كتابة مباشرة من العميل.** 81 اسم RPC تستدعيها الواجهة فعليًا، مغلّفة
في 94 دالة في `data/actions.ts`. أمثلة بحسب النطاق:

| النطاق | RPCs |
| --- | --- |
| حساب/هوية | `complete_my_profile` · `update_my_profile` · `delete_my_account` · `set_my_timezone` · `admin_update_user_access` |
| تنظيم | `create_branch` · `create_committee` · `create_course` · `update_course_details` · `create_batch_with_sessions` · `assign_course_role` · `revoke_course_role` · `cancel_batch` · `bootstrap_organization` |
| محاضرات | `start_training_session` · `close_training_session` · `cancel_training_session` · `reschedule_training_session` · `save_session_content` · `set_session_module` · `rename_course_module` · `delete_course_module` · `reorder_course_module` |
| حضور | `get_session_qr_payload` · `check_in_with_token` · `manual_mark_attendance` · `submit_excuse` · `review_excuse` · `submit_attendance_dispute` · `resolve_attendance_dispute` |
| تسجيل | `join_batch` · `join_batch_by_code` · `leave_batch` · `remove_from_batch` |
| تحفيز | `award_kudos` · `update_gamification_rule` · `set_badge_active` |
| تغذية وتقارير | `submit_session_feedback` · `get_lecture_report` · `get_course_feedback` · `save_course_report` · `publish_course_report` · `delete_course_report` · `get_course_reports` · `get_course_report_summary` |
| شهادات | `issue_batch_certificates` · `revoke_certificate` · `reissue_certificate` · `verify_certificate` (عام) |
| إشعارات | `mark_notifications_read` · `broadcast_notifications` · `register_push_token` · `set_push_preferences` |
| تشغيل | `needs_attention` · `org_weekly_report` · `anticheat_report` · `get_stats_center` · `log_client_error` · `enqueue_command` · `finish_command` · `run_command` |

**ضمانات إلزامية لكل دالة** (تُفحص آليًا في `sql:check`):

1. `SECURITY DEFINER` + `SET search_path = public, pg_temp` (173 دالة، 0 بلا search_path).
2. `REVOKE ALL … FROM PUBLIC` ثم `GRANT EXECUTE` للأدوار المسموحة فقط.
3. تحقّق صلاحية داخلي (`my_role()` / `can_manage_course()` / عضوية الدفعة) قبل أي كتابة.
4. كتابة `audit_log`/`domain_events` للعمليات الحساسة، و`dedupe_key` للإشعارات.
5. تحديد معدّل (rate limit) للدوال الحساسة عبر `rpc_rate_events` (ترحيل 0025).

---

## 6) الترحيلات

38 ملفًا في `supabase/migrations/` بالترتيب الزمني (كل ملف idempotent ويُطبَّق مرّة):

| # | الملف | ماذا يفعل |
| --- | --- | --- |
| 0001 | `schema.sql` | المخطط الأساسي الكامل (كل الجداول + الفهارس + RLS + البيانات المرجعية للشارات وقواعد اللعبة) |
| 0002 | `gamification_rpcs.sql` | دوال النقاط والدوري المشتركة |
| 0004 | `real_auth_and_policies.sql` | ربط Supabase Auth بالبروفايل + السياسات |
| 0005 | `production_hardening.sql` | تقوية الإنتاج + `evaluate_user_badges` + إكمال البروفايل |
| 0006 | `automation_jobs.sql` | تسوية شهرية/أسبوعية آلية + مهام الإشعار |
| 0007 | `room_collision_check.sql` | منع تعارض القاعات عند نشر دفعة |
| 0008 | `account_deletion.sql` | حذف حساب حقيقي (امتثال) |
| 0009 | `waitlist_promotion.sql` | ترقية قائمة الانتظار + مغادرة/اعتذار |
| 0010 | `session_report.sql` | تقرير المحاضرة (أول كيان) + إشعار الغائبين |
| 0011 | `analytics_views.sql` | طبقة تحليلات على الخادم |
| 0012 | `domain_query_layer.sql` | طبقة استعلام نطاقية |
| 0013 | `offline_command_queue.sql` | طابور كتابات بلا شبكة + idempotency |
| 0014 | `critical_fixes.sql` | إصلاحات حرجة من مراجعة الإنتاج |
| 0015 | `command_executor.sql` | منفّذ الطابور |
| 0016 | `avatar_storage_hardening.sql` | تقوية مخزن الصور |
| 0017 | `completion_rule_fix.sql` | إتمام الدفعة بلا الاعتماد على عدّاد ناقص |
| 0018 | `update_course_details.sql` | تعديل الكورس (CRIT-FUNC-01) |
| 0019 | `save_private_note.sql` | الملاحظات الخاصة عبر RPC (إزالة مسار كتابة مباشر) |
| 0020 | `certificate_revocation.sql` | إلغاء وإعادة إصدار الشهادات |
| 0021 | `geofence_optional.sql` | سياج جغرافي اختياري للحضور |
| 0022 | `push_tokens.sql` | سجل أجهزة الإشعارات |
| 0023 | `course_lifecycle_truthfulness.sql` | صدق دورة حياة الكورس + تسوية الوصول |
| 0024 | `course_operating_system.sql` | أساس «نظام تشغيل الكورس» |
| 0025 | `rpc_rate_limits.sql` | تحديد معدّل على الخادم |
| 0026 | `push_delivery_outbox.sql` | خط تسليم الإشعارات (outbox) |
| 0027 | `client_error_log.sql` | مستودع أخطاء العميل (OPS-01) |
| 0028 | `get_today.sql` | قراءات «اليوم» و«كورساتي» |
| 0029 | `secure_qr_seed.sql` | منع قراءة `qr_seed` نهائيًا من العميل |
| 0030 | `ocr_audit_remediation.sql` | معالجة نتائج التدقيق |
| 0031 | `functional_completeness.sql` | إكمال وظيفي على الخادم |
| 0032 | `wave_c_security_rpcs_indexes.sql` | أمان + فهارس |
| 0033 | `unify_admin_update_user_access.sql` | توحيد إدارة وصول المستخدمين |
| 0034 | `live_advisor_hardening.sql` | تقوية الجلسة الحية |
| 0035 | `lecture_feedback_and_reports.sql` | تغذية المحاضرة + تقارير المحاضرة/الكورس + مركز الإحصاءات |
| 0036 | `course_organizer_authority.sql` | سلطة منظّم الكورس (قواعد + وحدات + أدوار) |
| 0037 | `course_reports.sql` | تقارير الكورس: جدول + 5 RPCs (مسودة/نشر/حذف/قراءة/ملخص) |
| 0038 | `more_badges.sql` | **جديد**: هدف ووحدة لكل شارة + 4 شارات جديدة + تقييم كامل للشارات + `my_badge_progress()` |

---

## 7) قواعد اللعبة

كل الأرقام من `src/data/rules.ts` → `RULE_DEFS`، وتُقرأ في الشاشات من `db.rules`
(قابلة للتعديل من شاشة الأدمن، ولها حدود دنيا/عليا):

| المفتاح | القيمة | الحدود | الوحدة |
| --- | --- | --- | --- |
| `points.present` | 10 | 5–20 | نقطة |
| `points.late` | 7 | 0–20 | نقطة |
| `attendance.late_window_min` | 15 | 5–30 | دقيقة |
| `certificate.min_attendance_pct` | 75 | 50–100 | % |
| `kudos.monthly_quota_per_instructor` | 200 | 0–1000 | نقطة |
| `streak.freeze_max_hold` | 2 | 0–5 | عدد |
| `streak.min_sessions_week` | 1 | 1–7 | عدد |
| `league.promotion_pct` | 15 | 5–40 | % |
| `league.relegation_pct` | 15 | 0–40 | % |
| `points.month_bonus` | 50 | 0–200 | نقطة |
| `points.course_complete` | 100 | 0–500 | نقطة |
| `points.rating` | 5 | 0–20 | نقطة |
| `points.feedback` | 5 | 0–20 | نقطة |

**عتبات المستويات** (نقاط تراكمية): `0 · 100 · 300 · 700 · 1500 · 3000 · 6000 · 12000`.

**ثوابت معمارية** (ليست قواعد لعبة قابلة للتعديل): `QR_ROTATION_MS = 25_000`
(دورة التوكن الدوّار) و`HARD_CUTOFF_MIN = 30` (إغلاق التسجيل بعد بدء الجلسة).

**الدوري الأسبوعي**: يبدأ الأحد 00:00 بتوقيت القاهرة؛ أعلى 15% يُرقّون، وأدنى 15% يُهبطون.

---

## 8) الشارات

### التعريفات (16 شارة، 15 نشطة — `season_legend` مخفية لأن «المواسم» ليست كيانًا بعد)

| الكود | الاسم | الندرة | الهدف | الوحدة | شرط الكسب الفعلي |
| --- | --- | --- | --- | --- | --- |
| `first_step` | البداية الصح | عادية | 1 | حضور | أول حضور مسجّل |
| `consistent` | المواظب | عادية | 4 | حضور | 4 محاضرات متتالية في كورس واحد |
| `early_bird` | الطائر المبكر | نادرة | 10 | حضور | 10 حضورات **قبل** وقت البداية |
| `perfection` | الكمال | ملحمية | 4 | حضور | شهر ميلادي (≥4 محاضرات) بحضور 100% |
| `super_streak` | السوبر ستريك | ملحمية | 8 | أسابيع | 8 أسابيع التزام متتالية |
| `streak_12` | الأسطورة الحيّة | أسطورية | 12 | أسابيع | 12 أسبوع التزام متتالي |
| `month_star` | نجم الشهر | ملحمية | 1 | مركز | أعلى نقاط الشهر في فرعك (بشرط > 0 نقطة) |
| `top_scorer` | المتصدر | عادية | 1 | مركز | المركز الأول في دوري أسبوعك |
| `climber` | الصاعد | نادرة | 1 | مركز | ترقية فعلية مسجّلة في `league_weeks` |
| `cert_hunter` | صائد الشهادات | نادرة | 1 | شهادات | أول شهادة سارية |
| `pro_expert` | الخبير المحترف | ملحمية | 3 | شهادات | 3 شهادات سارية |
| `honest_reviewer` | المقيّم الأمين | عادية | 3 | تقييمات | تقييم 3 كورسات |
| `feedback_star` | نجم التغذية الراجعة | عادية | 10 | تغذية | 10 تقييمات لمحاضراتك |
| `marathon` | الماراثون | نادرة | 5 | حضور | 5 محاضرات في أسبوع واحد |
| `comeback` | العودة القوية | نادرة | 1 | حضور | عودة بعد انقطاع 14 يومًا أو أكثر (آخر 30 يومًا) |
| `season_legend` | أسطورة الموسم | أسطورية | — | — | **مخفية** حتى يوجد كيان «موسم» |

### كيف تُحسب «أقرب شارة للكسب» (بعد الموجة H)

كان العيب المُبلَّغ عنه: كرت «أقرب شارة» يعرض نسبة **مُخمَّنة** (مثلًا `cert_hunter = 40%`
قبل أول شهادة!)، وثلاث شارات (`month_star`, `top_scorer`, `climber`) كانت **ميتة**:
موجودة في الجدول والقواميس ولا يمكن كسبها ولا حساب تقدّمها.

المنطق الحالي:

1. `badgeProgressDetail(db, userId, code)` تُرجع لكل شارة: `current` (العدّاد الحقيقي)،
   `target` (الهدف)، `progress = current/target`، `metric` (نوع الوحدة)، `achievable`.
   لا رقم ثابت ولا تقدير.
2. `nearestBadge(db, userId)` تختار **الأعلى تقدّمًا** بين الشارات **غير المكتسبة**
   **والقابلة للكسب** فقط، وتكسر التعادل بالأقل متبقّيًا ثم بترتيب الكود (نتيجة حتمية).
   وإن لم توجد شارة قابلة للكسب 👉 **لا يُعرض الكرت أصلًا** (الصدق أهم من بطاقة فارغة).
3. الكرت يقول: «باقي لك 3 محاضرات» — لا «60%» مبهمة.
4. `badgeBoard(db, userId)` ترتّب لوحة الإنجازات: المكتسب أولًا ثم الأقرب للكسب.

### أين تُمنح الشارات

- **على الخادم**: `public.evaluate_user_badges(p_user_id)` (مُحدَّثة في 0038) تمنح
  الـ15 شارة النشطة بشرط حقيقي، وتكتب إشعارًا بـ`dedupe_key = 'badge:<uid>:<code>'`
  (لا إشعار مرتين لنفس الشارة).
- **في العميل**: `evaluateBadges` (مرآة) للعرض الفوري بلا انتظار.
- **للواجهة**: `public.my_badge_progress()` تُرجع جدولًا (code, current, target,
  progress, metric, earned) لكرت «أقرب شارة» ولوحة الإنجازات.

---

## 9) الحضور

| الخطوة | التفاصيل |
| --- | --- |
| **1. فتح التسجيل** | المدرّب يبدأ الجلسة (`start_training_session`) → الحالة `live` |
| **2. التوكن الدوّار** | QR يتغيّر كل **25 ثانية** (`QR_ROTATION_MS`)؛ التوكن مشتق من `qr_seed` المحمي + رقم الشريحة الزمنية. `qr_seed` **لا يُقرأ من العميل أبدًا** |
| **3. المسح** | السكانر يقرأ التوكن → `check_in_with_token` يتحقق من: التوقيع، الشريحة الزمنية، عضوية الدفعة، عدم التكرار، السياج الجغرافي (اختياري)، وتحديد المعدّل |
| **4. التصنيف** | الحضور قبل نافذة التأخير (`late_window_min = 15`) ⇒ `present` والنقاط الكاملة؛ بعدها ⇒ `late` بنقاط أقل؛ بعد `HARD_CUTOFF_MIN = 30` ⇒ **يُقفل التسجيل** |
| **5. الرمز الاحتياطي** | `backupCodeOf` للمدرّب عند تعذّر الكاميرا (يُكتب في التدقيق) |
| **6. العذر** | الطالب يرفع عذرًا (`submit_excuse`) والمشرف يراجعه (`review_excuse`) ⇒ `excused` لا تُحسب غيابًا |
| **7. النزاع** | طالب يعترض على تسجيله (`submit_attendance_dispute`) ويُحل بالتدقيق (`resolve_attendance_dispute`) |
| **8. الإغلاق** | `close_training_session` يكتب تقرير المحاضرة، وينبّه الغائبين، وتُحتسب النقاط/الستريك |

**مكافحة التلاعب**: `checkin_attempts` + `checkin_risk_signals` يسجلان المحاولات
المشبوهة (توكن قديم، مسافة، تكرار جهاز)، و`anticheat_report` يعرضها للمشرف.

---

## 10) الشهادات

- **الشرط**: حضور ≥ `certificate.min_attendance_pct = 75%` من محاضرات الدفعة.
- **الإصدار**: `issue_batch_certificates` (بعد إغلاق الدفعة) — رقم تسلسلي لكل شهادة.
- **التحقّق العام**: صفحة `Verify` + `verify_certificate` + `public_badge_assertion`
  (بلا تسجيل دخول، بلا كشف بيانات شخصية).
- **الإلغاء/إعادة الإصدار**: `revoke_certificate` / `reissue_certificate` مع سبب مُدقَّق.
- **العرض**: `CertificateViewer` + تصدير HTML/PDF بالتنسيق العربي الكامل.

---

## 11) الأدوار والصلاحيات

| الدور | النطاق | أبرز القدرات |
| --- | --- | --- |
| `student` | مجموعاته المسجّلة | حضور · أعذار · تغذية · تقييم · شارات · شهادات · دوري |
| `volunteer` (مدرّب) | مجموعاته | بدء/إغلاق المحاضرة · تسجيل يدوي · تقرير المحاضرة · كوؤك · ملاحظات خاصة |
| `supervisor` (مشرف/فرع) | فرعه + كورساته | كل ما سبق + إنشاء كورسات/دفعات · مراجعة أعذار · `get_lecture_report` (مجمّع ومجهول) |
| `admin` | المنظّمة | كل ما سبق + الفروع/اللجان · إدارة الوصول · قواعد اللعبة · الشارات · التدقيق · التقارير |

**أدوار الكورس** (`course_roles`): `owner` · `organizer` · `coordinator` ·
`instructor_delegate` — تُمنح بـ`assign_course_role` وتُسحب بـ`revoke_course_role`،
وهي ما يحدّد «سلطة المنظّم» على الكورس (بناء الوحدات، رؤية التغذية، كتابة التقارير).

---

## 12) خريطة الشاشات والتنقّل

4 مكدّسات في `RootNavigator.tsx` بإجمالي **75 تسجيل مسار** (بعض المسارات مشتركة بين
الأدوار). الأبرز:

| المكدّس | التبويبات | أهم الشاشات |
| --- | --- | --- |
| **الطالب** | اليوم · رحلتي · استكشف · صندوق · حسابي | `CourseDetails` · `JourneyMap` · `Scanner` · `AttendanceHistory` · `Wallet` · `League` · `Achievements` · `Certificates` · `CertificateViewer` · `Excuses` · `LectureFeedback` · `LectureReport` · `CourseReport` · `Disputes` · `Verify` · `Support` · `Settings` |
| **المتطوّع/المدرّب** | يومك · مجموعاتي · أدوات · حسابي | `Courses` · `BatchesAdmin` · `CourseManagement` · `SessionsHistory` · `StudentRecord` · `ExcusesInbox` · `StatsCenter` |
| **المشرف/الأدمن** | لوحة التحكم · إدارة · تقارير · حسابي | `Wizard` (تأسيس المنظّمة) · `IssueCertificates` · `StatsCenter` · نفس شاشات الكورسات |
| **المصادقة** | — | `Onboarding` · `SignIn` (Google فقط) · `CompleteProfile` |

**مسار «اليوم» عند الطالب** (بالترتيب الفعلي في الصفحة): الهيدر → بطاقة فطن → بطاقة
الدقائق الحرجة (لو التسجيل مفتوح) → **ملخص النهاردة** (جديد) → تغذية معلّقة →
**المحاضرة الجاية** → الأرقام (ستريك/نقاط/دوري) → Bento حضور/أهلية → السلسلة الأسبوعية →
**أقرب شارة** → وصول سريع.

---

## 13) التصميم

- **الثيم الرسمي**: Apple Liquid Glass — أسطح زجاجية (`GlassSurface`) + تدرّجات ناعمة +
  ظلال منخفضة + حركة موزونة. 3 ثيمات (فاتح/داكن/داكن عالٍ) في `tokens.ts`.
- **ممنوع في الكود**: أي لون/نصف قطر/مسافة/ظل مكتوب رقميًا خارج `src/design/`
  (تفرضها `layout:check` + `glass:check` + `contrast`).
- **المسافات**: سلّم `spacing.s1..s12` (4→48). أي `Row` بأربعة أبناء+ يلزمه `wrap`.
- **الحركة**: كل الأنيميشن يحترم `isReducedMotion()`؛ لا جسيمات لا نهائية زخرفية؛
  الأهداف 60fps (تُقاس في `test:perf`).
- **إتاحة الوصول**: تباين مفحوص لكل ثيم (`contrast`: 51 زوجًا × 3)، منطقة لمس ≥44،
  تسميات `accessibilityLabel/Hint` لكل عنصر تفاعلي (تُفحص في `a11y`)، دعم RTL كامل،
  ولا `textAlign:'end'` (توافق react-native-web).

---

## 14) فطن

- **الرسم كبيانات**: `src/design/mascot/FatenArt.tsx` يبني الشكل من مسارات/أشكال
  مُعرَّفة كبيانات (بلا صور نقطية) ⇒ يتحجّم بلا فقد جودة ويعمل في كل مكان.
- **15 حالة سلوكية**: `_base` · `idle` · `welcome` · `ready` · `attention` · `working` ·
  `success` · `achievement` · `streak_fire` · `alert` · `recovery` · `offline` · `quiet` ·
  `level_up` · `nudge` — لكل حالة تعبير ومزاج ولون مختلف.
- **الحوار**: `faten.lines.ts` — 6 جمل لكل حالة + 14 نصيحة يومية، بكلتا اللغتين،
  وتُنتقى حسب السياق (اسم الطالب، الكورس، الوقت، المتبقّي للشهادة…) مع منع تكرار آخر
  جملتين، وتُرفض الجمل التي تحتاج متغيّرًا غير متاح.
- **التحقق البصري**: `npm run faten:sheet` و`npm run faten:ssr` يولّدان ورقة الحالات
  وشبكة SSR إلى `docs/faten/*.svg|png` (تُراجَع بصريًا بشرط ألا تقلّ حالة عن غيرها).

---

## 15) التوطين

- قاموسان: `src/i18n/ar.ts` و`src/i18n/en.ts` — **1655 مفتاحًا متطابقة** (بوابة `parity`).
- **صيغ الجمع العربية** (`shared/plural.ts`): `arabicCount` + `pluralForm` + `tPlural`
  ⇒ «محاضرة واحدة» / «محاضرتين» / «3 محاضرات» / «11 محاضرة».
- **ممنوع** كتابة نص عربي/إنجليزي مباشر في الشاشات؛ `i18n:lint` يقيس العدد الحالي لكل
  ملف ويمنع الرجوع (`--update` يثبّت التقدّم فقط).
- **عزل ثنائي الاتجاه**: `bidiIsolate` للأرقام والإيميلات داخل الجمل العربية.
- **الأرقام لاتينية** في العدادات (قرار تصميمي لسهولة القراءة)، والعربية في النصوص.

---

## 16) الأمان

| الطبقة | الضمانة |
| --- | --- |
| **الهوية** | Google OAuth فقط عبر Supabase Auth؛ لا حسابات بكلمة مرور |
| **التخويل** | RLS على كل جدول + تحقّق داخلي في كل دالة `SECURITY DEFINER` |
| **search_path** | مُثبَّت `public, pg_temp` في 173 دالة (0 استثناء) |
| **الأسرار** | `qr_seed` غير قابل للقراءة؛ التوكن يُشتق على الخادم فقط |
| **المفاتيح** | `service_role` لا يُستخدم في العميل إطلاقًا؛ `.env` غير مُتتبَّع |
| **الكتابة** | لا `insert/update` مباشر من العميل؛ كل شيء عبر RPC مُدقَّق |
| **المعدّل** | `rpc_rate_events` + قيود على الدوال الحساسة (تسجيل/حضور/كوؤك) |
| **التدقيق** | `audit_log` + `domain_events` لكل عملية إدارية أو مالية |
| **مكافحة التلاعب** | `checkin_attempts` + `checkin_risk_signals` + تقرير `anticheat_report` |
| **الخصوصية** | تصدير/حذف حساب (`delete_my_account`) + `PRIVACY_AND_RETENTION.md` |
| **الأخطاء** | لا تسريب تفاصيل SQL للعميل؛ كل خطأ يُترجم لنص مترجم + كود `MSR-XXXXXX` |

---

## 17) بوابات الجودة

تُنفَّذ كلها في `npm run test:all` (أي فشل = فشل البناء):

| البوابة | السكربت | ما تفحصه |
| --- | --- | --- |
| `typecheck` | `tsc --noEmit` | صفر أخطاء أنواع في كل المشروع |
| `a11y` | `scripts/check-a11y.js` | تسميات الوصول، ترتيب العناوين، مناطق اللمس |
| `hooks:check` | `check-hooks-order.js` | قواعد هوكات React (لا هوك بعد إرجاع مبكر…) |
| `glass:check` | `check-glass-policy.js` | توكنات الزجاج لا تُستخدم خارج `GlassSurface` |
| `contrast` | `check-contrast.js` | تباين الألوان لكل الثيمات |
| `i18n:lint` | `check-i18n-lint.js` | سقف النصوص المضمّنة (لا رجوع عن التقدّم) |
| `parity` | `check-i18n-parity.js` | تطابق القاموسين + صحة كل استخدام ثابت |
| `rpc:check` | `check-rpc-contract.js` | كل RPC يستدعيه العميل **معرَّف فعلًا** في الترحيلات |
| `sql:check` | `check-sql.js` | تحليل نحوي حقيقي + `GRANT` لكل دالة + `search_path` |
| `rpc:types` | `gen-rpc-types.js` | توليد أنواع RPCs ومطابقتها (`src/types/database.ts`) |
| `test:layout` + `layout:check` | `check-layout.js` | قواعد التخطيط (wrap، لا قيم خام، نصوص عربية لا تُقصّ) |
| `faten:ssr` | `faten-ssr-run.js` | شبكة كل حالات فطن تُصيَّر بلا أخطاء |
| `smoke` | `screen-smoke-run.js` | تصيير React حقيقي **لشاشات كاملة** (اليوم · يوم المدرّب · لوحة المنظّم · قاعة الإنجازات) + كروت مستقلة، ورفض `NaN`/`undefined`/النصوص المفقودة، وحفظ لقطة HTML دائمة لكل حالة في `docs/design/smoke/` |
| `sql:check` (بند الصلاحيات) | `check-sql.js` | فوق الفحص النحوي: يرفض منح دوال داخلية (تستقبل معرّف مستخدم) لدور العميل — قائمة حظر `SERVICE_ONLY_FUNCTIONS` |

---

## 18) الاختبارات

تُشغَّل على **محاكي كامل** (`scripts/fixtures/seed.ts`) يمثّل منظّمة حقيقية ببيانات
متناسقة، وبساعة مثبّتة (`Date.UTC(2026,8,30,16,0,0)`) ليكون الناتج حتميًا:

| المجموعة | الملف | التغطية |
| --- | --- | --- |
| `test:engine` | `engine.test.ts` | 163 اختبارًا: الحضور والـQR والتأخير، النقاط، الستريك، الدوري، الشهادات، الأعذار، التغذية والتقارير، **دقّة الأجندة**، **دقّة الشارات**، صياغة الوقت |
| `test:rls` | `rls.test.ts` | مصفوفة الصلاحيات: من يرى/يكتب ماذا في كل جدول |
| `test:search` | `search.test.ts` | البحث والفهرسة |
| `test:calendar` | `calendar.test.ts` | حسابات بداية الأسبوع/الشهر بتوقيت القاهرة + ICS |
| `test:perf` | `perf-benchmark.ts` | ميزانية الأداء (100% مطلوب) |
| `test:pentest` | `security-pentest.ts` | 5/5 فحوصات اختراق منطقي (تصعيد صلاحيات، تلاعب نقاط…) |
| `test:load` | `load-test.ts` | p95 لعمليات القراءة |
| `test:scenarios` | `e2e/runner.ts` | سيناريوهات كاملة من التسجيل للشهادة |

**مبادئ الاختبار**: لا يفحص اختبار «وجود سطر»، بل **سلوكًا** على محاكي حقيقي،
ولكل بلاغ مستخدم يوجد انحدار اختباري يمنع تكراره.

---

## 19) الأجندة الموحّدة

أُضيفت في «الموجة H» لحلّ بلاغ: «عندي محاضرة كمان 10 دقايق ومحاضرة كمان يوم،
فبيقولي محاضرتك الجاية كمان 3 أيام».

### الطبقة الجديدة: `src/data/agenda.ts`

| الدالة | ماذا تُرجع |
| --- | --- |
| `relevantBatchIds(db, userId)` | الدفعات ذات الصلة: تسجيلات نشطة + ما يدرّسه + ما يديره (منظّم كورس) |
| `agendaItemOf(...)` | عنصر أجندة كامل: `startsAt` · `endsAt` · `msUntilStart` · `phase` · `stale` · `canCheckIn` · `attendance` |
| `agendaFor(...)` | الأجندة كاملة، **بلا** ملغاة/مغلقة، مرتّبة زمنيًا |
| `nextAgendaItem(...)` | الجاري أولًا (وليست معلّقة) ← ثم ما لم ينتهِ بعد (نافذة سماح 45 دقيقة) ← ثم أول جلسة لم تبدأ |
| `todayAgenda(...)` | جلسات **اليوم** فقط + العدّادات (إجمالي/محضور/جارية/دقائق متبقية) |
| `daySummary(...)` | `next` + `today` + عدد ما بعد اليوم + عدد التغذية الراجعة المعلّقة |

### القواعد التي كانت مكسورة

| العيب | الأثر على المستخدم | الإصلاح |
| --- | --- | --- |
| العدّاد كان يُطبع كدقائق خام | «بعد 4320 دقيقة» | `startsIn()`: أقل من ساعة ⇒ دقائق · أقل من يوم ⇒ ساعات (+دقائق) · أبعد ⇒ «بكرة/بعد 3 أيام» |
| التاريخ بلا وسم يومي | «3 أغسطس» لا تعرف أقريب أم بعيد | `relativeDayLabel()`: النهاردة · بكرة · بعد بكرة · بعد N أيام · بعد أسبوعين |
| شاشة المدرّب كانت تسمّي أي جلسة مجدولة «محاضرة اليوم» | جلسة بعد 5 أيام تحت عنوان «اليوم» | فلترة على يوم حقيقي (`todayAgenda`) + `vtoday.nextSession` عند عدمها |
| الجلسة الجارية كانت تُستبعد من «القادمة» | الشاشة تبدو فاضية وقت المحاضرة | الجارية أولوية مطلقة في `nextAgendaItem` |
| لوحة المنظّم بلا بطاقة «محاضرتك الجاية» | المنظّم لا يعرف أن عنده محاضرة بعد 10 دقائق | `NextSessionCard` في لوحة المشرف/الأدمن |
| صيغ الجمع خاطئة | «1 محاضرات» | `tPlural` + صيغ 0/1/2/3–10/11+ |
| «أقرب شارة» بنسب مُخمَّنة | 40% لشارة لم تُكسب | تقدّم حقيقي + «باقي لك 3 محاضرات» |

### كيف تتحقّق من ذلك بنفسك

```bash
npm run test:engine   # 158 اختبارًا، منها: «محاضرة بعد 10 دقائق تتقدّم على محاضرة بعد 3 أيام»
npm run smoke         # يصيّر الكروت فعليًا ويحفظ لقطاتها في docs/design/smoke/
```

---

## 20) التشغيل والنشر

### المتطلّبات

- Node 20+ · npm · (اختياري) Expo Go للموبايل.
- مشروع Supabase + متغيّرات البيئة في `.env`:

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
EXPO_PUBLIC_PUBLIC_APP_URL=https://<نطاق-النشر>
```

لا مفاتيح `service_role` في العميل، ولا `.env` في Git (موجود في `.gitignore`).

### الخطوات

```bash
npm install                       # تثبيت التبعيات
npm run typecheck                 # تحقّق أنواع سريع
npm run test:all                  # كل البوابات والاختبارات (إلزامي قبل النشر)

# قاعدة البيانات: طبّق الترحيلات بالترتيب 0001 → 0038
# (عبر supabase CLI: supabase db push، أو الصق كل ملف في SQL Editor بالترتيب)

npm run web                       # تشغيل التطوير على الويب
npm run export:web                # بناء الإنتاج إلى dist/
npm run preview                   # خدمة نسخة الإنتاج محليًا
```

### بنية النشر

- **الويب**: `dist/` (Expo export) — قابلة للاستضافة على أي مضيف ساكن (Vercel/Netlify/S3).
- **الموبايل**: EAS Build (android/ios) — `app.json` مضبوط للإشعارات والصور الرمزية.
- **الإشعارات**: outbox (`push_outbox`) + عامل يستهلكه (انظر ترحيل 0026).
- **المراقبة**: `client_errors` + `metrics_snapshot` + لوحة «يحتاج تدخلك».

---

## 21) ما يتبقّى

صادقًا وبلا تجميل:

1. **الشهادات والمعاملات الحرجة** مغطّاة، لكن لا يوجد اختبار تكامل على Postgres حقيقي
   داخل هذا المستودع (لا Postgres في بيئة الفحص) — الترحيلات تُفحص نحويًا وبنيويًا،
   والمنطق يُختبر على محاكي `engine.ts` المطابق.
2. **الترتيب الزمني للترحيلات**: يجب تطبيقها بالترتيب؛ لا يوجد رقم `schema_version`
   مركزي بعد.
3. **`season_legend`** تبقى مخفية حتى يوجد كيان «موسم» حقيقي.
4. **التحقق البصري** لبعض الشاشات يعتمد على لقطات HTML (`docs/design/smoke/`) ومراجعة
   بشرية؛ لا متصفّح آلي في البيئة.
5. **مزامنة بلا شبكة** مبنية (طابور + idempotency) لكن سيناريوهات «انقطاع طويل أثناء
   المحاضرة» تحتاج اختبار ميداني على أجهزة حقيقية.
6. **نصوص إشعارات الشارات** تُكتب على الخادم بالعربية (`name_ar`) — التنبيه داخل التطبيق
   يترجم على العميل، لكن مستخدم الإنجليزية يستلم عنوان الإشعار بالعربية من الخادم.
   الإصلاح المقترح: تمرير لغة المستخدم (`profiles.locale`) إلى `evaluate_user_badges`.

---

_License: خاص — حقوق مشروع «مسار»._
