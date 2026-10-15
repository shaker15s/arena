# إعداد Supabase لمسار 3.2

## 1) إنشاء المشروع وتطبيق المخطط القانوني الوحيد

المصدر القانوني للمخطط هو مجلد `supabase/migrations` فقط. لا تنفّذ ملفات SQL منفردة أو بترتيب يدوي.
المسار `0001` → `0017` ينشئ الجداول، Google Auth، التخزين، المهام المجدولة، RLS، وواجهات RPC الذرية —
بما فيها `0014` (إصلاح قيود CHECK + rate limiting للكود الاحتياطي + mark_notifications_read)،
و`0015` (منفّذ طابور الأوامر المؤجلة run_command)، و`0016` (تقييد bucket الصور)،
و`0017` (اكتمال الدفعة من جلساتها لا من sessions_count القابل للتعديل).
ولا يزرع أي فرع أو كورس أو مستخدم وهمي.

> ملفات `WEB_EDITOR_UPGRADE*.sql` للمشاريع القائمة تُولَّد آليًا من الـ migrations:
> `node scripts/build-web-editor-sql.js 0014 0015 0016 0017 > supabase/WEB_EDITOR_UPGRADE_3.sql`
> — لا تعدّلها يدويًا أبدًا.

```bash
npx supabase login
npx supabase link --project-ref <PROJECT-REF>
npx supabase db push
```

نفّذ أول نشر على مشروع **staging**، اختبره، ثم كرر `db push` على production. لا تعدّل migration طُبّقت بالفعل؛
أي تغيير لاحق يجب أن يكون migration جديدة.

> **تنبيه للنسخ القديمة:** إذا طُبقت ملفات `0001`–`0004` القديمة المتعارضة على مشروع سابق، فلا تعتبره قاعدة صالحة
> بمجرد `db push`. ما دام المشروع قبل الإطلاق، أنشئ مشروع staging جديدًا من السلسلة الحالية. إن وُجدت بيانات حقيقية، خذ نسخة
> احتياطية ونفّذ خطة تحويل بيانات مخصصة ومراجَعة بدل إعادة الضبط أو افتراض توافق المخططين.
>
> يتطلب `0006_automation_jobs.sql` إتاحة امتداد `pg_cron` في خطة Supabase. المهام ليست تجميلية:
> فهي تغلق الجلسات المنسية، وتسوي الستريك والدوري وبونص الشهر، وترسل تذكيرات الجلسات بصورة idempotent.

## 2) إنشاء أول أدمن بأمان

لا يتحول «أول شخص يصل للموقع» إلى أدمن تلقائيًا. هذا يمنع الاستيلاء على مشروع جديد قبل اكتمال الإعداد.
الطريقة المفضلة هي إنشاء المستخدم من **Auth Admin API** (بيئة خادم فقط) مع App Metadata التالية قبل أول دخول:

```json
{ "masar_bootstrap_admin": "true" }
```

لا تضع `service_role` في التطبيق أو `.env` التي تبدأ بـ`EXPO_PUBLIC_`.
إذا أنشأت الحساب أولًا كطالب، نفّذ مرة واحدة من SQL Editor بعد التأكد من البريد:

```sql
BEGIN;
DO $$
DECLARE v_profile uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE role='admin') THEN
    RAISE EXCEPTION 'admin_already_exists';
  END IF;
  SELECT p.id INTO STRICT v_profile
  FROM public.profiles p JOIN auth.users u ON u.id=p.user_id
  WHERE lower(u.email)=lower('owner@example.com');
  UPDATE public.profiles SET role='admin',updated_at=now() WHERE id=v_profile;
  INSERT INTO public.audit_log(actor_id,action,target,payload)
  VALUES(v_profile,'bootstrap_admin',v_profile::text,jsonb_build_object('method','sql_editor'));
END $$;
COMMIT;
```

بعدها استخدم شاشة المستخدمين داخل التطبيق لكل تغييرات الأدوار والحالة؛ فهي تمر عبر RPC مدققة ولا تعتمد على تعديل محلي.

## 3) تفعيل Google OAuth

1. في **Google Cloud Console → APIs & Services → Credentials** أنشئ OAuth Web Client.
2. أضف URI التالي إلى **Authorized redirect URIs**:
   `https://<PROJECT-REF>.supabase.co/auth/v1/callback`
3. انسخ Client ID وClient Secret إلى **Supabase → Authentication → Providers → Google**.
4. في **Authentication → URL Configuration** اضبط Site URL على نطاق الويب الإنتاجي، وأضف روابط staging والإنتاج و:
   - `masar://auth/callback`
   - روابط development build المستخدمة فعليًا فقط.
5. للبناء الأصلي أنشئ OAuth clients خاصة بـiOS وAndroid باستخدام:
   - iOS bundle: `org.masaregypt.app`
   - Android package: `org.masaregypt.app`
   - بصمات SHA الصحيحة لكل ملف توقيع.

لا تستخدم wildcard واسعًا في Redirect URLs على production.

## 4) متغيرات البيئة

انسخ `.env.example` إلى ملف بيئة محلي غير متتبع:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://<PROJECT-REF>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
EXPO_PUBLIC_APP_URL=https://masar.example.com
```

`EXPO_PUBLIC_APP_URL` هو أصل رابط التحقق العام من الشهادات. يجب أن يفتح المسار `/verify?serial=...` على نسخة الويب.
بدون إعداد Supabase يعرض التطبيق «الإعداد مطلوب» ولا يستبدل الخادم ببيانات وهمية.

## 5) التخزين وRealtime

المسار ينشئ bucket عام القراءة باسم `avatars`، والكتابة مقتصرة على مجلد المستخدم:
`<auth-user-id>/avatar_<timestamp>.jpg`. راجع سياسة الاحتفاظ بالصور والخصوصية قبل الإطلاق.

تُضاف جداول الجلسات والحضور والإشعارات والأعذار والتسجيلات والطلبات إلى Realtime بصورة idempotent.

## 6) إنشاء بيانات المؤسسة الحقيقية

بعد دخول الأدمن:
1. استخدم «ابدأ مركزك» لإنشاء الفرع واللجان والكورس والمجموعة والجلسات في معاملة خادم واحدة.
2. أو استخدم شاشات التنظيم والكورسات والمجموعات منفصلة؛ نشر المجموعة وجلساتها ذري.
3. لا تستخدم `supabase/seed/seed.sql` لإنتاج بيانات مؤسسة؛ الملف يحتوي مراجع الشارات والقواعد فقط.

## 7) البناء والتشغيل

```bash
npm ci
npm run typecheck
npm run parity
npm run test:engine
npm run export:web
npx eas build --profile development --platform all
```

اختبر على development build حقيقي: الكاميرا، QR، Google callback، مشاركة CSV/PDF، الطباعة، وروابط التحقق.
Expo Go أو web export وحدهما لا يثبتان سلامة التكاملات الأصلية.

## 8) استكشاف: الدخول بجوجل يرجعني لشاشة الترحيب

الأعراض: بعد اختيار حساب Google يعود التطبيق لشاشة الأونبوردينج/الدخول دون جلسة.

الأسباب الشائعة بالترتيب:

1. **النطاق الحالي غير مسجل في Redirect URLs** — عند التجربة على `localhost` أو رابط
   preview (مثل `*.vercel.app` مؤقتًا أو نطاق معاينة)، يرفض Supabase الرجوع إليه
   ويحوّل المتصفح إلى Site URL بدون كود دخول. الحل: أضف النطاق في
   **Authentication → URL Configuration → Redirect URLs** مثل `http://localhost:8081/**`
   (للتطوير فقط) ثم أعد المحاولة. التطبيق الآن يعرض هذا السبب في شاشة الدخول بدل الصمت.
2. **كود رجوع قديم عالق في الرابط** — إعادة تحميل صفحة تحتوي `?code=…` مستهلكًا تفشل
   دائمًا. التطبيق ينظف هذه البارامترات تلقائيًا بعد أول تحميل.
3. **الجلسة لم تُحفظ على الجهاز** (متصفح يحجب التخزين/وضع خاص) — جرّب نافذة عادية.

للتنقيح: افتح Network في المتصفح وابحث عن طلب `/auth/v1/token?grant_type=pkce` —
رسالة الخطأ فيه (مثل `Invalid request: auth code already used` أو
`PKCE code verifier not found`) تحدد السبب مباشرة.

## 10) ترتيب الترحيلات ومعرفة «أنا واصل لفين؟»

الترحيلات في `supabase/migrations/` **مرتّبة وتُطبَّق بالترتيب** (`0001` ← `0038`).
لا يوجد جدول `schema_version` مركزي، فإذا شغّلت ترحيلًا يعتمد على ترحيل غير مُطبَّق
تظهر أخطاء Postgres مثل:

```
ERROR: 42703: column "module_id" does not exist          -- 0036 يحتاج 0035
ERROR: 42P01: relation "public.session_feedback" does not exist   -- 0038 يحتاج 0035
```

### الطريقة الأسرع: ملف واحد يُشغَّل مرة واحدة

لو قاعدة بياناتك متأخّرة (مثال: واقفة عند `0034`) ومحتاج تكمّل بالترتيب دفعة واحدة،
استخدم **ملف التطبيق الموحّد**:

```
supabase/diagnostics/apply_0035_0038.sql
```

1. Supabase Dashboard → **SQL Editor** → **New query**.
2. الصق **الملف كامل** → **Run**.
3. شوف آخر جدول ناتج: لازم يطلع صف واحد فيه `✅ الترحيلات 0035 → 0038 مطبَّقة — مبروك`
   و«عدد الشارات (المتوقّع 16)» = **16**.

الملف مبني بحيث لا يخطئ: في الأول **بوابة تحقّق مسبق** تتأكد أن ترحيلات الأساس
(`0001…0034`) مطبَّقة فعلًا وتقول بالعربي أي كائن ناقص، وبعده نصوص `0035` → `0036` →
`0037` → `0038` حرفيًا من `supabase/migrations/`، وفي الآخر استعلام تحقّق. وكل الجمل
idempotent، فإعادة التشغيل آمنة. الملف مُولَّد آليًا:

```bash
npm run migrations:bundle         # إعادة توليد الملف من ملفات الترحيل
npm run migrations:bundle:check   # بوابة: تفشل لو الملف قديم مقارنةً بالترحيلات
npm run sql:exec                  # يشغّل الترحيلات فعلًا على Postgres (PGlite) بلا أخطاء
```

بعد ما ينجح الملف، اختياري: امنح الشارات الجديدة للمستخدمين الحاليين فورًا (بدل انتظار
أول تقييم) — السطر موجود في نهاية الملف نفسه كتعليق جاهز للنسخ:

```sql
select public.evaluate_user_badges(id)
from public.profiles
where role = 'student' and status = 'active';
```

### الطريقة البديلة: ملفًا ملفًا

**قبل أي ترحيل جديد، اعرف مستواك**: افتح `supabase/diagnostics/migration_level.sql`
والصق محتواه في SQL Editor ثم Run — سيُظهر جدولًا لكل ترحيل بحالة ✅/❌. ابدأ من
**أول ترحيل مكتوب أمامه ❌** وطبّق الملفات بعده بالترتيب. الملف للقراءة فقط ولا يكتب شيئًا.

كل الترحيلات **idempotent** (`IF NOT EXISTS` / `ON CONFLICT` / `CREATE OR REPLACE`)،
فتكرار تطبيق ترحيل مكتمل آمن. ولمنع الأخطاء الغامضة، الترحيلات التي تعتمد على سابقتها
تحتوي **تحقّقًا مسبقًا** يشرح بالعربية والإنجليزية أي ترحيل ينقصك:

```
ERROR: MASAR 0038 needs migration 0035 first (session_feedback table).
       Required order: 0035 -> 0036 -> 0037 -> 0038.
```

مثال كامل لإكمال قاعدة بيانات متأخرة:

```
0035_lecture_feedback_and_reports.sql   →  Run
0036_course_organizer_authority.sql     →  Run
0037_course_reports.sql                 →  Run
0038_more_badges.sql                    →  Run
```

اختياري بعد 0038 (لمنح الشارات الجديدة للمستخدمين الحاليين فورًا، إذ تُحسب عادة عند
إغلاق المحاضرات):

```sql
select public.evaluate_user_badges(id)
from public.profiles
where role = 'student' and status = 'active';
```

## 11) قائمة ما قبل الإنتاج

- طبّق migrations على staging من قاعدة فارغة واختبر سياسات كل دور.
- اختبر سباقات التسجيل في آخر مقعد، تكرار QR، إغلاق الجلسة مرتين، وإصدار الشهادات مرتين.
- راقب `cron.job_run_details` و`audit_log` وSupabase Auth logs.
- اضبط نسخًا احتياطية، تنبيهات الأخطاء، وسياسة استرداد قبل دعوة المستخدمين.
- ثبّت نطاق الويب وOAuth redirects و`EXPO_PUBLIC_APP_URL` لكل بيئة.
