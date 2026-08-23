# 🚀 دليل إعداد Supabase - Masar 3.0

## 📋 الخطوات المطلوبة

### 1️⃣ إنشاء الجداول في Supabase Editor

1. افتح مشروعك على Supabase: https://supabase.com/dashboard/
2. اذهب إلى **SQL Editor** من القائمة الجانبية
3. اضغط **New Query**
4. انسخ كل المحتوى من ملف `supabase/001_complete_schema.sql`
5. الصقه في SQL Editor
6. اضغط **Run** (أو Ctrl+Enter)

⏱️ هذا سينشئ:
- ✅ 25+ جدول (profiles, branches, courses, batches, sessions, attendance, ...)
- ✅ كل الفهارس (indexes) للأداء
- ✅ Row Level Security (RLS) policies
- ✅ دوال RPC (check_in_session, get_user_gamification)
- ✅ Triggers للتحديث التلقائي
- ✅ بيانات افتراضية (8 فروع RTC, 6 كورسات, 12 شارة, 11 قاعدة لعبة)

---

### 2️⃣ تفعيل Google OAuth

1. اذهب إلى **Authentication** → **Providers**
2. اضغط على **Google**
3. فعّل **Enable Google provider**
4. ستحتاج:
   - **Client ID** و **Client Secret** من Google Cloud Console
   
#### الحصول على Google OAuth Credentials:

1. افتح https://console.cloud.google.com/
2. أنشئ مشروع جديد أو استخدم الموجود
3. اذهب إلى **APIs & Services** → **Credentials**
4. اضغط **Create Credentials** → **OAuth Client ID**
5. اختر **Web application**
6. في **Authorized redirect URIs** أضف:
   ```
   https://udqgaudtclkbaygftndx.supabase.co/auth/v1/callback
   ```
7. اضغط **Create**
8. انسخ **Client ID** و **Client Secret**
9. الصقهم في Supabase

---

### 3️⃣ إعداد Storage (للمرفقات والأفاتار)

1. اذهب إلى **Storage**
2. اضغط **New Bucket**
3. اسم الـ bucket: `avatars`
4. فعّل **Public bucket**
5. اضغط **Create bucket**

كرر الخطوات لـ:
- `excuses` (لمرفقات الأعذار) - **Private**
- `certificates` (للشهادات) - **Public**

---

### 4️⃣ التحقق من الإعدادات

بعد تشغيل الـ SQL، تحقق من:

✅ **Tables** - يجب أن ترى 25+ جدول  
✅ **Authentication** → **Users** - يجب أن تكون Google مفعّلة  
✅ **RLS Policies** - كل جدول عليه سياسة  
✅ **Functions** - يجب أن ترى `check_in_session` و `get_user_gamification`

---

### 5️⃣ اختبار التطبيق

1. شغّل التطبيق: `npm run dev`
2. اضغط **تسجيل الدخول بـ Google**
3. سجّل دخول بحساب `shakerabdallah66@gmail.com`
4. يجب أن يظهر دورك **admin** تلقائياً
5. أضف رقم موبايل من شاشة الملف الشخصي

---

## 🔐 الأدوار والصلاحيات

### Admin (shakerabdallah66@gmail.com)
- ✅ تحكم كامل في كل الفروع والكورسات
- ✅ إدارة المدربين والمشرفين
- ✅ تعديل قواعد اللعبة
- ✅ إصدار الشهادات
- ✅ رؤية كل التقارير والإحصائيات

### Supervisor/مشرف
- ✅ إدارة فرع واحد
- ✅ تعيين المدربين
- ✅ مراجعة الأعذار
- ✅ إصدار شهادات الفرع

### Volunteer/مدرب
- ✅ فتح الجلسات وتسجيل الحضور
- ✅ تقديم الأعذار للطلاب
- ✅ تقييم الطلاب (kudos)
- ✅ كتابة تقارير الجلسات

### Student/طالب
- ✅ التسجيل في الكورسات
- ✅ تسجيل الحضور بـ QR
- ✅ رؤية النقاط والاستريك
- ✅ تقديم الأعذار
- ✅ تقييم الكورسات والمدربين

---

## 📊 الجداول المهمة للإدمن

### branches
الفروع الحقيقية لـ RTC (تم إنشاء 8 فروع افتراضياً)

### courses
الكورسات المتاحة (تم إنشاء 6 كورسات افتراضياً)

### gamification_rules
قواعد اللعبة - يمكن تعديلها من لوحة التحكم:
- `points.present`: نقاط الحضور في الموعد (افتراضي: 10)
- `points.late`: نقاط الحضور متأخراً (افتراضي: 7)
- `certificate.min_attendance_pct`: نسبة الحضور للشهادة (افتراضي: 75%)

### audit_log
سجل العمليات - لكل عملية حساسة (من غيّر قاعدة؟ من منح نقاط؟)

---

## 🎯 الخطوات التالية للتشغيل

1. ✅ **تم** إنشاء قاعدة البيانات
2. ✅ **تم** تفعيل Google OAuth
3. ⏳ **اختياري** رفع صور الكورسات في Storage
4. ⏳ **اختياري** إضافة المزيد من الكورسات من لوحة التحكم
5. ⏳ **اختياري** تعيين مشرفين لكل فرع
6. ✅ **جاهز** للاختبار والإطلاق!

---

## 🆘 حل المشاكل

### المشكلة: "relation does not exist"
**الحل**: تأكد من تشغيل ملف SQL بالكامل في Supabase Editor

### المشكلة: "new row violates row-level security policy"
**الحل**: تأكد من أن المستخدم مسجل دخول وحصل على profile تلقائياً

### المشكلة: Google login لا يعمل
**الحل**: تأكد من إضافة redirect URL الصحيح في Google Cloud Console

---

## 📞 الدعم

لو احتجت مساعدة:
1. راجع logs في Supabase Dashboard → **Logs**
2. تحقق من RLS policies
3. تأكد من أن environment variables صحيحة في `.env`

---

**التطبيق جاهز للإطلاق!** 🚀
