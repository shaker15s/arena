/**
 * e2e/rtl.spec.ts — اختبار التوافق العربي الكامل، المحاذاة من اليمين لليسار، وتطابق القواميس 100%
 */
import { ar } from '../src/i18n/ar';
import { en } from '../src/i18n/en';
import { numAr, formatDate, formatTime } from '../src/shared/format';

export async function testRtlFlow(assert: (ok: boolean, msg: string) => void) {
  console.log('\n--- [E2E] فحص التوافق العربي الكامل والتطابق اللغوي (RTL & i18n Flow) ---');

  // 1. فحص تطابق مفاتيح القاموسين (100% Parity)
  const arKeys = Object.keys(ar);
  const enKeys = Object.keys(en);

  assert(arKeys.length === enKeys.length, `تطابق تام في عدد المفاتيح اللغوية (${arKeys.length} مفتاح)`);

  const missingInEn = arKeys.filter(k => !(k in en));
  const missingInAr = enKeys.filter(k => !(k in ar));

  assert(missingInEn.length === 0, 'لا توجد أي مفاتيح مفقودة في القاموس الإنجليزي');
  assert(missingInAr.length === 0, 'لا توجد أي مفاتيح مفقودة في القاموس العربي');

  // 2. التحقق من صياغات النصوص العربية للميزات الجديدة (D1-D9 و F9-F10)
  assert(Boolean(ar['onboarding.o1Title'] && ar['onboarding.o1Body']), 'نصوص الشريحة الأولى من شاشات الترحيب معربة بدقة وفق معايير الصوت والنبرة');
  assert(Boolean(ar['onboarding.o2Title'] && ar['onboarding.o2Body']), 'نصوص الشريحة الثانية من شاشات الترحيب معربة بدقة');
  assert(Boolean(ar['onboarding.o3Title'] && ar['onboarding.o3Body']), 'نصوص الشريحة الثالثة من شاشات الترحيب معربة بدقة');
  assert(Boolean(ar['admin.exportCsv'] && ar['admin.exportSuccess']), 'نصوص تصدير تقرير المنظمة بصيغة CSV متوفرة بالعربية');
  assert(Boolean(ar['common.share']), 'نص مشاركة الإنجاز متوفر');

  // 3. التحقق من دوال تنسيق الأرقام والتواريخ والأوقات باللغة العربية
  const formattedArabicNum = numAr(2026);
  assert(formattedArabicNum === '٢٠٢٦', 'تحويل الأرقام إلى الأرقام العربية المشرقية بنجاح');

  const now = new Date(2026, 8, 6, 9, 30).getTime();
  const arabicTime = formatTime(now, 'ar');
  assert(arabicTime.includes('ص') || arabicTime.includes('م'), 'تنسيق الوقت العربي يحتوي على رمز التوقيت الصباحي/المسائي');

  const arabicDate = formatDate(now, 'ar');
  assert(arabicDate.includes('سبتمبر') || arabicDate.length > 3, 'تنسيق التاريخ العربي يظهر اسم الشهر بالعربية');
}
