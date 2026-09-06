/**
 * e2e/runner.ts — مشغّل اختبارات التكامل الشاملة للمسارات الذهبية (Golden Paths E2E Test Suite)
 * ينفذ كافة السيناريوهات لضمان جاهزية النظام 100% قبل الإطلاق
 */
import { testOnboardingFlow } from './onboarding.spec';
import { testAuthFlow } from './auth.spec';
import { testAttendanceFlow } from './attendance.spec';
import { testJourneyFlow } from './journey.spec';
import { testCertificatesFlow } from './certificates.spec';
import { testThemeToggleFlow } from './theme-toggle.spec';
import { testRtlFlow } from './rtl.spec';

async function runAllE2ETests() {
  console.log('===============================================================');
  console.log('   🚀 بدء تنفيذ اختبارات التكامل الشاملة (Masär E2E Suite)   ');
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
    failures.push(`خطأ غير متوقع أثناء تنفيذ الاختبارات: ${err?.message || err}`);
    console.error('💥 حدث استثناء غير متوقع:', err);
  }

  const duration = Date.now() - startTime;

  console.log('\n===============================================================');
  console.log(`   📊 ملخص نتائج اختبارات التكامل (E2E Integration Results)    `);
  console.log('===============================================================');
  console.log(`  ⏱️  المدة الإجمالية : ${duration}ms`);
  console.log(`  ✅ الفحوصات الناجحة: ${passed}`);
  console.log(`  ❌ الفحوصات الفاشلة: ${failed}`);
  console.log('===============================================================');

  if (failed > 0) {
    console.error('\nقائمة الفحوصات التي فشلت:');
    failures.forEach((f, idx) => console.error(`  ${idx + 1}. ${f}`));
    process.exit(1);
  } else {
    console.log('\n🎉 اكتملت جميع اختبارات التكامل الشاملة بنجاح بنسبة 100%!');
    process.exit(0);
  }
}

runAllE2ETests();
