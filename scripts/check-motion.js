#!/usr/bin/env node
/**
 * scripts/check-motion.js — بوابة التحقق من أمان الحركة (Reduced Motion & Animation Gate).
 *
 * القواعد الملزمة (توجيه §6/§8/§35 وWCAG 2.3.3 / 2.2.2):
 * 1. أي ملف يستخدم `Animated.loop` أو حركات لا نهائية يجب أن يتحقق من تفضيل تقليل الحركة
 *    عبر `isReducedMotion()` أو `observeReducedMotion()` أو حارس `reduced`.
 * 2. أي ملف يستخدم `setInterval` لتحديثات الحركة/الوقت الدوري يجب أن ينظف المؤقت بـ `clearInterval`
 *    أو يخضع لحارس تقليل الحركة.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (/\.(tsx?|jsx?)$/.test(e.name)) acc.push(full);
  }
  return acc;
}

const violations = [];
let filesChecked = 0;
let loopCount = 0;
let intervalCount = 0;

for (const file of walk(SRC)) {
  filesChecked += 1;
  const rel = path.relative(ROOT, file);
  const content = fs.readFileSync(file, 'utf8');

  const hasAnimatedLoop = /Animated\.loop\(/.test(content);
  const hasSetInterval = /\bsetInterval\(/.test(content);

  if (hasAnimatedLoop) {
    loopCount += 1;
    const hasMotionGuard = /isReducedMotion|observeReducedMotion|\breduced\b/.test(content);
    if (!hasMotionGuard) {
      violations.push({
        file: rel,
        issue: 'يستخدم Animated.loop دون حارس تقليل الحركة (isReducedMotion / observeReducedMotion)',
      });
    }
  }

  if (hasSetInterval) {
    intervalCount += 1;
    const hasIntervalCleanupOrGuard = /clearInterval|isReducedMotion|observeReducedMotion/.test(content);
    if (!hasIntervalCleanupOrGuard) {
      violations.push({
        file: rel,
        issue: 'يستخدم setInterval دون دالة تنظيف (clearInterval) أو حارس تقليل الحركة',
      });
    }
  }
}

console.log('═══════════════════════════════════════════════════════');
console.log('  مسار — بوابة أمان الحركة وتقليل الحركة (Motion Check)');
console.log('═══════════════════════════════════════════════════════');
console.log(`  • ملفات مفحوصة: ${filesChecked}`);
console.log(`  • حلقات حركية مفحوصة (Animated.loop): ${loopCount}`);
console.log(`  • مؤقتات دورية مفحوصة (setInterval): ${intervalCount}`);

if (violations.length > 0) {
  console.log(`\n✗ تم العثور على ${violations.length} مخالفة في حراس الحركة:`);
  for (const v of violations) {
    console.log(`   ${v.file} — ${v.issue}`);
  }
  console.error('\n✗ فشل فحص أمان الحركة: تحقق من دعم تقليل الحركة (A11Y-52 وWCAG 2.3.3).');
  process.exit(1);
}

console.log('\n✅ جميع الحركات والمؤقتات تخضع لحراس تقليل الحركة والتنظيف.');
process.exit(0);
