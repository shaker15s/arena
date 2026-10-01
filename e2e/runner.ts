/**
 * e2e/runner.ts — تشغيل سيناريوهات منطقية للمسارات الأساسية باستخدام بيانات اختبار.
 * لا يفتح متصفحًا ولا يتصل بخدمة حقيقية؛ يظل المسار هنا لأسباب التوافق التاريخية.
 */
import { testOnboardingFlow } from './onboarding.spec';
import { testAuthFlow } from './auth.spec';
import { testAttendanceFlow } from './attendance.spec';
import { testJourneyFlow } from './journey.spec';
import { testCertificatesFlow } from './certificates.spec';
import { testThemeToggleFlow } from './theme-toggle.spec';
import { testRtlFlow } from './rtl.spec';

async function runAllScenarioTests() {
  console.log('===============================================================');
  console.log('   بدء فحوص السيناريو المنطقية (Masar Scenario Checks)');
  console.log('===============================================================');

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  const assert = (condition: boolean, message: string) => {
    if (condition) {
      passed++;
      console.log(`  ✅ ${message}`);
    } else {
      failed++;
      failures.push(message);
      console.error(`  ❌ ${message}`);
    }
  };

  const startTime = Date.now();

  try {
    await testOnboardingFlow(assert);
    await testAuthFlow(assert);
    await testAttendanceFlow(assert);
    await testJourneyFlow(assert);
    await testCertificatesFlow(assert);
    await testThemeToggleFlow(assert);
    await testRtlFlow(assert);
  } catch (err: any) {
    failed++;
    failures.push(`خطأ غير متوقع أثناء تنفيذ السيناريوهات: ${err?.message || err}`);
    console.error('💥 حدث استثناء غير متوقع:', err);
  }

  const duration = Date.now() - startTime;

  console.log('\n===============================================================');
  console.log('   ملخص اختبارات السيناريو المنطقية');
  console.log('===============================================================');
  console.log(`  المدة الإجمالية: ${duration}ms`);
  console.log(`  الناجح: ${passed}`);
  console.log(`  الفاشل: ${failed}`);
  console.log('===============================================================');

  if (failed > 0) {
    console.error('\nقائمة الفحوصات التي فشلت:');
    failures.forEach((f, idx) => console.error(`  ${idx + 1}. ${f}`));
    process.exit(1);
  } else {
    console.log('\nاكتملت جميع اختبارات السيناريو المنطقية بنجاح.');
    process.exit(0);
  }
}

runAllScenarioTests();
