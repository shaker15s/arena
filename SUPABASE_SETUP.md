# إعداد Supabase لمسار 3.1

## 1) إنشاء المشروع والمخطط

1. أنشئ مشروعًا على [supabase.com](https://supabase.com).
2. من **SQL Editor** نفّذ الملفات بالترتيب:
   1. `supabase/001_complete_schema.sql` (الجداول + الدوال الأساسية)
   2. `supabase/migrations/0004_real_auth_and_policies.sql` (**إلزامي** — الدخول بجوجل + سياسات RLS الصحيحة + bucket الصور + Realtime)
   3. `supabase/seed/seed.sql` (اختياري: الشارات وقواعد اللعبة الافتراضية)

> بدون الملف الثاني ستفشل كل عمليات الكتابة، لأن سياسات RLS الأصلية كانت تقارن
> `auth.uid()` بأعمدة تشير إلى `profiles.id`.

## 2) تفعيل الدخول بحساب Google

1. **Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web)**.
2. في **Authorized redirect URIs** أضف:
   ```
   https://<PROJECT-REF>.supabase.co/auth/v1/callback
   ```
3. انسخ `Client ID` و `Client Secret` إلى:
   **Supabase → Authentication → Providers → Google** وفعّله.
4. **Authentication → URL Configuration**:
   - `Site URL`: رابط نسخة الويب (مثلاً `https://masar.example.com`).
   - `Redirect URLs`: أضف كل ما يلي
     ```
     http://localhost:8081
     https://masar.example.com
     masar://auth/callback
     exp://*
     ```
   (`masar` هو الـ scheme المعرَّف في `app.json`.)

للبناء الأصلي (iOS/Android) أنشئ أيضًا OAuth clients خاصة بالمنصتين في Google Cloud
باستخدام bundle identifier / package name وبصمة SHA-1.

## 3) متغيرات البيئة

انسخ `.env.example` إلى `.env` واملأه:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://<PROJECT-REF>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
```

بدون هذه المفاتيح يعرض التطبيق شاشة «الإعداد مطلوب» ولا يعرض أي بيانات وهمية.

## 4) صور المستخدمين

المايجريشن ينشئ bucket باسم `avatars` (قراءة عامة، كتابة لصاحب المجلد فقط)،
والمسار المستخدم: `avatars/<auth-user-id>/avatar_<timestamp>.jpg`.

## 5) أول مستخدم = أدمن

دالة `handle_new_user` تجعل **أول** حساب يسجّل الدخول أدمن (لأنه لا يوجد أدمن بعد)،
وباقي الحسابات تُنشأ كطلاب. لترقية مستخدم لاحقًا:

```sql
UPDATE public.profiles SET role = 'supervisor' WHERE email = 'someone@example.com';
```

## 6) الوظائف المجدولة (اختياري لكن موصى به)

فعّل امتداد `pg_cron` ثم طبّق `supabase/migrations/0003_cron_jobs.sql`
(إقفال الجلسات المنسية كل 30 دقيقة + تصفية الستريك والدوري فجر كل أحد).

## 7) تشغيل التطبيق

```bash
npm install
npm run web        # معاينة ويب
npx expo start     # موبايل عبر Expo Go / development build
```

## 8) فحوصات الجودة

```bash
npm run typecheck    # صفر أخطاء
npm run parity       # تطابق مفاتيح العربية/الإنجليزية
npm run test:engine  # 49 اختبار سلوكي لقلب النظام
```
