# تقرير التدقيق والاعتماد الهندسي الشامل — مسار 3.2 (Engineering State & Certification)

> **تاريخ التقييم والمراجعة الفنية:** 2026-09-07  
> **حالة الاعتماد الهندسية:** 🟡 **معتمد مع قيود موثقة (PASS WITH DOCUMENTED CONSTRAINTS)**  
> **التقييم الفني الإجمالي:** **85 / 100** (نواة قاعدة بيانات متينة، أمان RLS محقق خادميًا، واجهات متجاوبة مع قيود معمارية مدروسة)

---

## 1. جدول الشفافية والجاهزية الهندسية

| المجال (Area) | الحالة (Status) | نوع الفحص والتأكيد | الملاحظات والحدود الواقعية (Engineering Reality) |
| --- | --- | --- | --- |
| **Auth (Google OAuth)** | ✅ PASS | Live HTTP + Client PKCE | يعمل عبر Google OAuth مع عزل الصلاحيات ومنح دور `student` افتراضيًا. تم إزالة Apple Sign-In لعدم تهيئته على Supabase. |
| **Attendance / QR Security** | ✅ PASS | Live Supabase + Column Privileges | مفتاح `qr_seed` محجوب تمامًا عن الاستعلام المباشر عبر PostgreSQL REVOKE (كود الخطأ 42501 مؤكد شبكيًا). الرمز الدوار 25 ثانية والكود الاحتياطي 6 أرقام. |
| **Database RLS & Security** | ✅ PASS | Live PostgREST Pentest + 29 Migrations | 112 دالة `SECURITY DEFINER` مع `search_path = public, pg_temp`. حظر إدراج `audit_log` المجهول مؤكد بـ RLS 42501. |
| **Rate Limiting (F5)** | ✅ PASS | Migration 0025 + In-Memory Simulation | نافذة انزلاقية خادمية (Sliding-window) في Postgres على دوال الانضمام والأعذار والإشعارات. |
| **Concurrency & Overbooking** | ✅ PASS | Migration 0005 (`FOR UPDATE`) + Engine Test | حجز المقاعد مؤمن بقفل الصفوف `SELECT ... FOR UPDATE` لمنع التجاوز اللحظي. |
| **Certificates Lifecycle** | ✅ PASS | Engine Tests + Verification Route | استحقاق الحضور ≥ 75%، توليد سيريال فريد، صفحة تحقق عامة مستقلة لا تتطلب تسجيل دخول، دعم الإلغاء بمبرر وإعادة الإصدار. |
| **Offline Command Queue** | 🟡 PASS WITH CONSTRAINTS | Engine Simulation + AsyncStorage | حفظ العمليات غير الحساسة زمنيًا في `command_queue` وإعادة بثها عند عودة الاتصال. الحضور يتطلب اتصالًا لحماية التوقيت. |
| **Performance & Benchmarks** | 🟡 PASS WITH CONSTRAINTS | Node.js Memory Benchmark + Live Queries | قياسات Node المحلية تعطي أزمنة ميكروية (0.3ms - 40ms). زمن الاستجابة الحقيقي عبر الإنترنت يرتبط بشبكة المستخدم وخادم Supabase (50ms - 250ms). |
| **Accessibility (WCAG 2.2 AA)** | 🟡 IN PROGRESS (P1) | Static Audit + Component Inspection | جاري رفع تغطية `accessibilityLabel` و `accessibilityRole` على كافة الأزرار والأهداف التفاعلية لتحقيق الامتثال الكامل. |
| **Design & Architecture** | 🟡 IN PROGRESS (P2) | Refactoring & Consolidation | جاري توحيد كتالوج المكونات وتفكيك الشاشات الأحادية الكبيرة (`CourseManagementScreen`, `AdminScreens`). |

---

## 2. تفصيل الفحوصات الفنية المنفذة

### أ) فحص الأمان واختبار الاختراق الحقيقي (`scripts/security-pentest.ts`)
1. **فحص حظر قراءة الهواتف:** تم التحقق عبر استعلام REST مباشر بمفتاح `anon` — تعيد RLS مصفوفة فارغة وتمنع استخراج أرقام هواتف غير المالك.
2. **فحص حماية الـ `qr_seed`:** تم التحقق عبر طلب REST مباشر على `sessions?select=qr_seed` بمفتاح `anon` — الخادم يرجع خطأ PostgreSQL `42501` (رفض الصلاحية على مستوى العمود).
3. **فحص حظر حقن سجلات التدقيق:** تم إرسال طلب POST غير مصرح به على `audit_log` — الخادم يرجع خطأ RLS `42501`.
4. **الفحص الهيكلي لترحيلات SQL:** التحقق من 29 ملف migration للتأكد من حماية دوال `SECURITY DEFINER` وسحب صلاحيات التعديل المباشر.

### ب) فحص الأداء والتحمل (`scripts/perf-benchmark.ts` & `scripts/load-test.ts`)
- **تنبيه شفاف:** قياسات الـ load test والـ benchmark تعمل على الذاكرة المحلية (In-Memory Node Runtime) لمحاكاة سلوك المحرك الحسابي. وهي تثبت كفاءة خوارزميات التلعيب والفرز (O(N log N)) وخلوها من الانهيارات، وليست بديلاً عن اختبار إجهاد الشبكة (Network Stress Test) عبر k6 أو أداة مماثلة.

### ج) فحص التكامل والمسارات الذهبية (`e2e/runner.ts`)
- تنفيذ 62 فحصًا تغطي مسارات الترحيب، الدخول، الحضور، محفظة النقاط، الشهادات، وتبديل المظهر.

---

## 3. خارطة طريق التحسين المستمر

1. **إتمام المرحلة الحالية (P1 & P2):**
   - استكمال Code Splitting وحزم الويب لخفض الحجم دون 1 MB.
   - إتمام وسوم قراءة الشاشة (Screen Reader VoiceOver / TalkBack).
   - توحيد واجهات المكونات في `src/design/components/index.ts`.
2. **المرحلة القادمة (P3):**
   - إضافة طبقة التخزين المحلي المقسم (SQLite عبر `expo-sqlite`) لتعزيز الأداء مع آلاف السجلات دون تحميل الذاكرة.
   - ربط نظام تتبع الأعطال المباشر (Sentry) للمراقبة في الوقت الفعلي.
