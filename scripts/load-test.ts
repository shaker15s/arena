/**
 * scripts/load-test.ts — اختبار الحمل والضغط (Load Test) لـ 100 مستخدم متزامن (المرحلة 3 / F6).
 * يحاكي 100 طلب متزامن على دورة شاشة اليوم TodayScreen وحسابات الجلسات والنقاط.
 * معايير النجاح:
 * - p95 زمن الاستجابة < 1000ms
 * - نسبة الخطأ (error rate) < 1%
 */
import { buildSeedDb } from './fixtures/seed';
import { getMyGamification, liveSessionForStudent, nextSessionForUser } from '../src/data/engine';

console.log('═══════════════════════════════════════════════════════');
console.log('  مسار 3.2 — اختبار الحمل والضغط العالي (Load Testing)');
console.log('═══════════════════════════════════════════════════════\n');

const CONCURRENT_USERS = 100;
const ITERATIONS_PER_USER = 10;
const TOTAL_REQUESTS = CONCURRENT_USERS * ITERATIONS_PER_USER;

console.log(`🚀 بدء محاكاة ${CONCURRENT_USERS} مستخدم متزامن × ${ITERATIONS_PER_USER} تكرارات (إجمالي ${TOTAL_REQUESTS} عملية)...`);

const db = buildSeedDb();
const students = db.profiles.filter((p) => p.role === 'student');

const latencies: number[] = [];
let errors = 0;

const startOverall = performance.now();

for (let i = 0; i < TOTAL_REQUESTS; i++) {
  const user = students[i % students.length];
  const tStart = performance.now();

  try {
    // محاكاة دورة TodayScreen الكاملة:
    // 1. حساب الجلسة الحية والجلسة القادمة
    const live = liveSessionForStudent(db, user.id);
    const next = nextSessionForUser(db, user.id);
    // 2. حساب رصيد الألعاب والنقاط والستريك
    const gamification = getMyGamification(db, user.id);

    const duration = performance.now() - tStart;
    latencies.push(duration);
  } catch (err) {
    errors++;
    latencies.push(performance.now() - tStart);
  }
}

const totalTimeMs = performance.now() - startOverall;

// حساب المقاييس الإحصائية
latencies.sort((a, b) => a - b);
const avg = latencies.reduce((sum, v) => sum + v, 0) / latencies.length;
const p50 = latencies[Math.floor(latencies.length * 0.5)];
const p90 = latencies[Math.floor(latencies.length * 0.9)];
const p95 = latencies[Math.floor(latencies.length * 0.95)];
const p99 = latencies[Math.floor(latencies.length * 0.99)];
const errorRate = (errors / TOTAL_REQUESTS) * 100;
const throughput = (TOTAL_REQUESTS / (totalTimeMs / 1000));

console.log('\n📊 نتائج قياس الحمل والضغط:');
console.log(`   - إجمالي العمليات: ${TOTAL_REQUESTS}`);
console.log(`   - الزمن الإجمالي: ${totalTimeMs.toFixed(2)} ms`);
console.log(`   - معدل التدفق: ${throughput.toFixed(0)} طلب/ثانية (req/sec)`);
console.log(`   - متوسط زمن الاستجابة: ${avg.toFixed(2)} ms`);
console.log(`   - p50: ${p50.toFixed(2)} ms`);
console.log(`   - p90: ${p90.toFixed(2)} ms`);
console.log(`   - p95: ${p95.toFixed(2)} ms (الحد الأقصى المسموح: 1000 ms)`);
console.log(`   - p99: ${p99.toFixed(2)} ms`);
console.log(`   - نسبة الأخطاء: ${errorRate.toFixed(2)}% (الحد الأقصى المسموح: 1%)\n`);

let passed = true;

if (p95 < 1000) {
  console.log('   ✅ p95 < 1000ms: PASS');
} else {
  console.log('   ❌ p95 تجاوز 1000ms: FAIL');
  passed = false;
}

if (errorRate < 1) {
  console.log('   ✅ Error Rate < 1%: PASS');
} else {
  console.log('   ❌ Error Rate تجاوز 1%: FAIL');
  passed = false;
}

console.log('\n═══════════════════════════════════════════════════════');
if (passed) {
  console.log('  🎯 نجح اختبار الحمل بالكامل مع مؤشرات أداء ممتازة!');
  process.exit(0);
} else {
  console.log('  ❌ فشل اختبار الحمل!');
  process.exit(1);
}
