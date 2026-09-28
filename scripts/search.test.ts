import { matchesSearch, matchesAny, normalizeArabic, rankSearch, searchScore } from '../src/shared/search';
import { arabicCount } from '../src/shared/plural';
import { classifyError } from '../src/shared/errors';
import { screenForNotification } from '../src/shared/notifyRoute';

let passed = 0, failed = 0;
function ok(cond: boolean, name: string) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
}

console.log('\n═ بحث عربي / أخطاء / تنقل إشعار ═');
ok(normalizeArabic('أحمد') === normalizeArabic('احمد'), 'همزة أحمد ≈ احمد');
ok(matchesSearch('محمد عبد الرحمن', 'محم'), 'بحث جزئي محم');
ok(matchesSearch('Python Fundamentals', 'python'), 'بحث لاتيني بلا حالة');
ok(!matchesSearch('دورة تصميم', 'xyz'), 'لا تطابق عشوائي');
// FUNC-07 — التطبيع الشامل (همزات/تاء مربوطة/تشكيل/تطويل/أرقام/حروف فارسية)
ok(normalizeArabic('أحمد') === normalizeArabic('أحمَد'), 'تشكيل: أحمد ≈ أحمَد');
ok(normalizeArabic('إبراهيم') === normalizeArabic('ابراهيم'), 'همزة تحت الألف: إبراهيم ≈ ابراهيم');
ok(normalizeArabic('مسؤول') === normalizeArabic('مسوول'), 'همزة على الواو: مسؤول ≈ مسوول');
ok(matchesSearch('قائلاً', 'قايلا'), 'همزة على الياء + تنوين: قائلاً ≈ قايلا');
ok(matchesSearch('فاطمة علي', 'فاطمه'), 'تاء مربوطة: فاطمة ≈ فاطمه');
ok(matchesSearch('مـــسار', 'مسار'), 'تطويل: مـــسار ≈ مسار');
ok(matchesSearch('محمّد', 'محمد'), 'شدّة: محمّد ≈ محمد');
ok(matchesSearch('محاضرة ٣', 'محاضرة 3'), 'أرقام عربية-هندية: ٣ ≈ 3');
ok(matchesSearch('مصطفى', 'مصطفي'), 'ألف مقصورة: مصطفى ≈ مصطفي');
ok(matchesSearch('کتاب النحو', 'كتاب'), 'كاف فارسية: ک ≈ ك');
ok(matchesSearch('عبد الله محمد', 'عبدالله'), 'موصول/منفصل: عبدالله ≈ عبد الله');
ok(matchesSearch('محمد عبد الرحمن', 'عبد محمد'), 'كلمات بأي ترتيب: عبد محمد');
ok(matchesSearch('Café Rive', 'cafe'), 'علامات لاتينية: Café ≈ cafe');
ok(matchesSearch('دورة Python', 'PYTHON'), 'حالة الأحرف لاتينية');
ok(searchScore('أحمد', 'أحمد') > searchScore('محمد أحمد', 'أحمد'), 'ترتيب: التطابق التام أولاً');
ok(searchScore('أحمد محمود', 'أحمد') > searchScore('علي أحمد', 'أحمد'), 'ترتيب: البداية قبل الوسط');
ok(rankSearch(['علي أحمد', 'أحمد محمود'], 'احمد', (x) => [x])[0] === 'أحمد محمود', 'rankSearch يرتّب بالملاءمة');
ok(rankSearch(['دورة', 'محاضرة'], '', (x) => [x]).length === 2, 'استعلام فارغ ⇒ كل العناصر');
ok(matchesAny(['أحمد', null], 'احمد'), 'matchesAny يتجاوز الفوارغ');
ok(arabicCount(1, { zero: '0', one: '1', two: '2', few: 'f', many: 'm' }) === '1', 'جمع 1');
ok(arabicCount(2, { zero: '0', one: '1', two: '2', few: 'f', many: 'm' }) === '2', 'جمع 2');
ok(arabicCount(5, { zero: '0', one: '1', two: '2', few: 'f', many: 'm' }) === 'f', 'جمع 3–10');
ok(matchesSearch('أحمد', 'أحم'), 'بادئة قصيرة تعمل');
ok(!matchesSearch('أحمد', 'أحمذ'), 'لا تطابق خاطئ');
ok(classifyError('Failed to fetch') === 'network', 'تصنيف شبكة');
ok(classifyError('forbidden') === 'permission', 'تصنيف صلاحية');
ok(screenForNotification('session', 'student')?.name === 'Scanner', 'إشعار جلسة → ماسح');
ok(screenForNotification('excuse', 'volunteer')?.params?.tab === 'inbox', 'إشعار عذر مدرب → صندوق');

console.log(`\n════ البحث: ${passed} ناجح، ${failed} فاشل ════`);
if (failed > 0) process.exit(1);
