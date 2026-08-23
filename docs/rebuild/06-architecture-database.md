# 06 — المعمارية التقنية وقاعدة البيانات

> **الهدف:** أساس هندسي يُبنى مرة واحدة صحيحة: طبقات نظيفة، عقود RPC محسومة، أمان Zero-Trust، وأوفلاين صادق.

---

## 1. الستاك المعتمد (محسوم)

| الطبقة | الاختيار | السبب |
|---|---|---|
| الإطار | **React Native 0.81 + Expo SDK 54 + TypeScript** (صارم `strict`) | استمرارية المشروع الحالي + نضج EAS |
| الملاحة | React Navigation 7 (Native Stack) | انتقالات أصلية وربط عميق |
| الحالة المحلية | **Zustand 5** (واجهة/جلسة/شبكة) | خفيف، بدون boilerplate |
| حالة السيرفر | **TanStack Query** (كاش + أوفلاين + إعادة محاولة) | يفصل بيانات السيرفر عن حالة الواجهة |
| الحركة | Reanimated 4 + Skia + Skottie | أداء 60/120fps (وثيقة 05) |
| الخلفية | **Supabase** (Postgres + Auth OTP + Realtime + Storage + Edge Functions) | العقود الـ 31 الموجودة تعمل — نرقّي ولا نعيد اختراع العجلة |
| الإشعارات | expo-notifications (قنوات Android مخصصة) | تذكير الجلسات والتحفيز |
| الأمان | expo-secure-store + Crypto | جلسة مشفرة Keychain/Keystore |
| الاختبارات | Jest (وحدات) + Maestro (E2E) | الفلو الذهبي آلي |
| CI/CD | GitHub Actions + EAS Build | كما في CI_DEPLOYMENT_PLAN الحالي مع توسّع |

## 2. هيكل المشروع الجديد (Feature-Sliced)

```
src/
├── app/                 # Bootstrap: providers, linking, gesture root, boot splash gate
├── design/
│   ├── tokens.ts        # ألوان/تايب/مسافات/حركة — المصدر الوحيد
│   ├── theme.tsx        # ThemeProvider (فاتح/داكن/OLED/النظام)
│   ├── motion.ts        # presets الحركة الموحدة (duration/easing/spring)
│   └── components/      # AppButton, AppCard, GlassView, StatRing, Flame, Odometer...
├── features/
│   ├── <feature>/
│   │   ├── screens/     # شاشات الميزة
│   │   ├── components/  # مكونات خاصة بالميزة فقط
│   │   ├── api.ts       # استدعاءات RPC الخاصة بها + عقودها
│   │   └── hooks.ts
│   └── ... (auth, today, explore, journey, attendance, gamification,
│            certificates, sessions, org, profile, notifications)
├── shared/              # ما يتشاركه أكثر من ميزة (utils, validators, formatters, analytics)
├── data/
│   ├── supabase.ts      # العميل الوحيد (SecureStore adapter)
│   ├── rpc/             # عقود مولّدة الأنواع لكل دالة
│   └── realtime/        # subscriptions (الحضور الحي، الإشعارات)
└── i18n/                # ar.ts / en.ts + فاحص تكافؤ آلي
supabase/
├── migrations/          # SQL مرقّم مراجَع في الـ PR
├── functions/           # Edge Functions (cron الدوري الأسبوعي...)
└── seed/                # بيانات بذر: فرع تجريبي + كورس + قواعد اللعبة الافتراضية
```

**قواعد البناء الصارمة (Linted):**
- ممنوع لون/مسافة/خط حرفي — من `design/tokens` فقط.
- ممنوع استدعاء Supabase مباشرة من شاشة — عبر `features/*/api.ts` (حتى تبقى العقود قابلة للاختبار).
- ممنوع نص حرفي في JSX — عبر `t('key')` والتكافؤ عربي/إنجليزي مفحوص في CI.
- كل شاشة تعرض حالاتها الست (وثيقة 03 §5) قبل اعتمادها.

## 3. مخطط قاعدة البيانات

### 3.1 الجداول الأساسية (المنقولة من 2.0 بتنقيح)
`profiles(user_id, full_name, phone, role, branch_id, avatar_url, status, ...)`
`branches(id, name, governorate, address, supervisor_id, ...)`
`committees(id, branch_id, name)` · `courses(id, committee_id, title, field, sessions_count, status)` · `batches(id, course_id, instructor_id, capacity, schedule_json, start_date, status)` · `enrollments(user_id, batch_id, status, joined_at)` · `sessions(id, batch_id, seq, title, starts_at, status)` · `attendance(session_id, user_id, status, checked_in_at, method, note)` · `certificates(id, user_id, batch_id, serial, issued_at)` · `excuses(id, user_id, session_id, reason, file_url, status, reviewed_by, note)` · `session_reports(id, session_id, done, planned, challenges)` · `course_ratings(...)` · `notifications(...)`

### 3.2 الجداول الجديدة (قلب مسار 3.0)
```sql
-- دفتر النقاط: مصدر الحقيقة الوحيد
point_events(id, user_id, points, reason_code,        -- 'attendance.present' | 'course.complete' | 'kudos' ...
             ref_type, ref_id,                        -- (session|course|badge), id
             awarded_by,                              -- NULL = نظام
             idempotency_key UNIQUE, created_at)

-- الاستريك: تقييم أسبوعي محفوظ للتاريخ
streak_weeks(user_id, week_start, status,             -- kept|frozen|pending|broken
             sessions_total, sessions_honored, freeze_used boolean, PRIMARY KEY(user_id, week_start))
profiles_gamification(user_id PK,                      -- كاش مشتق من الدفاتر (يُعاد بناؤه دائمًا)
             current_streak_weeks, longest_streak_weeks, freezes_held, level,
             league_tier, updated_at)

-- الشارات
badges(code PK, name_ar, name_en, rarity, icon, criteria_json, active boolean)
user_badges(user_id, badge_code, context_json, awarded_at, PRIMARY KEY(user_id, badge_code))

-- الدوري الأسبوعي
league_weeks(user_id, week_start, tier, xp_week, final_rank, outcome,   -- promoted|stayed|relegated
             PRIMARY KEY(user_id, week_start))

-- QR الدوّار: توكنات الجلسة الموقّتة
session_qr_tokens(id, session_id, seq, token_hash, valid_from, valid_until, PRIMARY KEY(session_id, seq))

-- قواعد اللعبة (يظبطها المشرف من S49)
gamification_rules(key PK, value jsonb, scope jsonb,  -- global | {branch_id}
                   updated_by, updated_at)

-- شفافية إدارية
audit_log(id, actor_id, action, target, payload jsonb, created_at)

-- كوتا المنح اليدوي الشهرية للمدرب (ضد التضخم)
kudos_quota(instructor_id, month, spent, PRIMARY KEY(instructor_id, month))
```

### 3.3 عقود RPC الجديدة/المعدّلة (تضاف للـ 31 الحالية)
| الدالة | التوقيع | الحسم |
|---|---|---|
| `student_check_in_v2` | `(p_token text)` → نجاح الرمز + النافذة + Idempotency في معاملة واحدة → يرجع `{status, points, streak, league_xp}` | صارم |
| `start_session_v2` | `(p_batch_id, p_title)` → ينشئ الجلسة + يسلسل توكنات `session_qr_tokens` (كل 25 ثانية لمدة الجلسة + هامش) | — |
| `get_session_qr` | `(p_session_id)` → التوكن الصالح حاليًا للمدرب فقط | — |
| `close_session_v2` | `(p_session_id)` → يقفل التسجيل · يحاسب الغائبين · يمنح بونص الثبات · يحدّث `streak_weeks` جزئيًا | معاملة واحدة |
| `get_my_gamification` | `()` → نقاط (SUM الدفتر)، مستوى، ستريك، مُجمّدات، موضع الدوري، أقرب شارة | استعلام واحد للهوم |
| `get_weekly_league` | `(p_tier?)` → ترتيب فئة الفرع للأسبوع الجاري + مناطق الصعود/الهبوط | — |
| `admin_update_rule` | `(p_key, p_value)` → تحقق حدود + كتابة القاعدة + audit_log | مشرف لفرعه / أدمن للعام |
| `award_kudos` | `(p_student_id, p_points, p_reason)` → يفحص كوتا الشهر ثم يمنح | مدرب |
| `review_excuse_v2` | نفس الحالية + عند القبول: تحديث `streak_weeks` المعلّق → kept عبر trigger | — |
| `issue_certificates_v2` | الحالية + نقاط الإتمام +100 + شارة «صائد الشهادات» في نفس المعاملة | — |

**قاعدة:** كل دالة تمنح نقاطًا/شارات/شهادات هي `SECURITY DEFINER` وتتحقق من الدور داخل جسدها، وتكتب `point_events` مع `idempotency_key` — الضغط المتكرر = نتيجة واحدة.

### 3.4 الوظائف المجدولة (Cron عبر Edge Functions)
| الجدولة | المهمة |
|---|---|
| يوميًا 23:55 (Africa/Cairo) | غلق أي جلسة منسية مفتوحة → حساب الغياب |
| السبت 23:59 | إقفال أسبوع الدوري: حساب الصعود/الهبوط + إشعارات |
| الأحد 00:00 | فتح أسبوع استريك جديد لكل طالب له جلسات مجدولة · تصفير كوتا البونص الشهري أول كل شهر |
| عند الطلب | «معاينة أثر القاعدة» للمشرف قبل حفظ قيمة جديدة |

## 4. الأمان والخصوصية (Zero-Trust محسوم)
- **لا مفاتيح service_role في العميل أبدًا** — كل الصلاحيات داخل Postgres RLS + SECURITY DEFINER.
- RLS مفعّلة على كل جدول: الطالب يرى نفسه فقط في الدفاتر، ويرى ترتيب الدوري كأسماء مستعارة في الفئة.
- الجلسة في SecureStore · المفاتيح الحساسة مشفرة · `audit_log` لا يُحذف أبدًا.
- بيانات الأعذار والملاحظات الخاصة: وصول مقيد للمدرب والمشرف فقط.
- سياسة احتفاظ: point_events و attendance محفوظة ما دام المركز نشطًا (التاريخ مقدس).

## 5. الأوفلاين والتزامن
- التنقّل (NetInfo) يقود Query Client: أوفلاين → pause + بانر، عودة → refetch ذكي.
- كاش حتمي للكتالوج والرحلة (الطالب يرى آخر حالة بدون نت) — مع وسام «محفوظة منذ…».
- الكتابة أوفلاين تُحظر بواجهة ودودة (الحضور يتطلب اتصالًا بطبيعته — الرمز متجدد).
- ذاكرة الجهاز: صور الكتالوج WebP مضغوطة + حد كاش 50MB.

## 6. التحليلات (Analytics Events — خفيفة ومحترمة)
أحداث مجهولة بلا PII: `app_open, otp_success, enroll, check_in_success/fail{reason}, streak_broken, badge_earned, league_promoted, cert_issued` — تُقرأ في لوحة واحدة لتحسين المنتج باستمرار.
