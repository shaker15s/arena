import { matchesSearch, normalizeArabic } from '../src/shared/search';
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
ok(arabicCount(1, { zero: '0', one: '1', two: '2', few: 'f', many: 'm' }) === '1', 'جمع 1');
ok(arabicCount(2, { zero: '0', one: '1', two: '2', few: 'f', many: 'm' }) === '2', 'جمع 2');
ok(arabicCount(5, { zero: '0', one: '1', two: '2', few: 'f', many: 'm' }) === 'f', 'جمع 3–10');
ok(classifyError('Failed to fetch') === 'network', 'تصنيف شبكة');
ok(classifyError('forbidden') === 'permission', 'تصنيف صلاحية');
ok(screenForNotification('session', 'student')?.name === 'Scanner', 'إشعار جلسة → ماسح');
ok(screenForNotification('excuse', 'volunteer')?.params?.tab === 'inbox', 'إشعار عذر مدرب → صندوق');

console.log(`\n════ البحث: ${passed} ناجح، ${failed} فاشل ════`);
if (failed > 0) process.exit(1);
