-- 0033_unify_admin_update_user_access.sql
-- MASAR 3.4 — إصلاح PGRST203 (الخطأ الفعلي المُقاس من PostgREST الحيّ):
--
-- كانت ثلاث بصمات للدالة بنفس الاسم قيد التشغيل:
--   (UUID, TEXT, TEXT)                — من 0005 (قديمة، بلا حماية last-admin)
--   (UUID, TEXT, TEXT, UUID)          — من WEB_EDITOR_UPGRADE.sql (ترقية يدوية، لم تُسجَّل هنا)
--   (UUID, TEXT, TEXT, UUID, BOOLEAN) — من 0030 (الصلبة: is_admin + حماية آخر أدمن + منع تعطيل الذات)
--
-- PostgREST كان يفشل بأي Nداء JSON (4 أو 3 مفاتيح) بـ PGRST203
-- «Could not choose the best candidate function» — لهذا كان تغيير أي مستخدم
-- إلى «متطوع» في شاشة الإدارة يُرجِع خطأً دائمًا.
--
-- لا استدعاء داخلي (SQL/View/Function) لأيٍّ من البصمات القديمة — تحقّق عبر
-- grep كامل على supabase/ — والمتعامل الوحيد هو العميل عبر RPC.
-- نُبقي الصيغة الصلبة الوحيدة (0030) و نمحو الباقي.

BEGIN;

DROP FUNCTION IF EXISTS public.admin_update_user_access(UUID, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.admin_update_user_access(UUID, TEXT, TEXT);

-- الصيغة القانونية الوحيدة بعد هذه النقطة — إعادة تأكيد الصلاحيات (بوابة sql:check).
REVOKE ALL ON FUNCTION public.admin_update_user_access(UUID, TEXT, TEXT, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user_access(UUID, TEXT, TEXT, UUID, BOOLEAN) TO authenticated;

COMMIT;
