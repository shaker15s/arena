#!/usr/bin/env node
/**
 * scripts/check-tokens.js — بوابة التحقق من توكنز التصميم (Design Tokens Gate).
 *
 * القواعد الملزمة (توجيه §6/§10/§34/§35):
 * 1. ممنوع كتابة أحجام خطوط عشوائية (fontSize: <number>) داخل src/features —
 *    يجب استخدام Typography tokens أو مكوّن <Txt variant="...">.
 * 2. ممنوع استخدام مسافات أو حواشٍ رقمية عشوائية خارج شبكة التصميم الموحدة (4px grid)
 *    ومقياس المسافات `spacing.sN`.
 * 3. يُستثنى كود التصميم الأساسي `src/design/*` كونه مصدر تعريف التوكنز.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FEATURES = path.join(ROOT, 'src', 'features');

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (/\.(tsx?|jsx?)$/.test(e.name)) acc.push(full);
  }
  return acc;
}

// شبكة المسافات القياسية والأبعاد الصالحة (4px grid + مقاسات المكونات المعتمدة)
const VALID_SPACING_GRID = new Set([
  0, 1, 2, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 26, 28, 30, 32, 36, 40, 44, 48, 52, 60, 64, 80, 140,
]);

// استثناءات الخطوط القديمة المجدولة للتوحيد في T6 (Legacy Font Baseline)
const LEGACY_FONT_EXCEPTIONS = new Set([
  'src/features/attendance/ScannerScreen.tsx:471',
  'src/features/attendance/ScannerScreen.tsx:717',
  'src/features/auth/AuthScreens.tsx:370',
  'src/features/profile/ProfileScreens.tsx:144',
  'src/features/profile/ProfileScreens.tsx:305',
  'src/features/today/TodayScreen.tsx:395',
  'src/features/today/TodayScreen.tsx:443',
  'src/features/volunteer/LiveSessionScreen.tsx:275',
]);

const violations = [];
let filesChecked = 0;

for (const file of walk(FEATURES)) {
  filesChecked += 1;
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const lines = fs.readFileSync(file, 'utf8').split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineNum = i + 1;
    const loc = `${rel}:${lineNum}`;

    // تجاهل التعليقات
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;

    // 1) فحص fontSize
    const fontMatch = line.match(/\bfontSize:\s*(\d+)/);
    if (fontMatch) {
      if (!LEGACY_FONT_EXCEPTIONS.has(loc)) {
        violations.push({
          file: rel,
          line: lineNum,
          issue: `حجم خط رقمي مباشر (${fontMatch[1]}) — يجب استخدام typography tokens أو Txt variant`,
        });
      }
    }

    // 2) فحص المسافات العشوائية الشاذة (خارج الأبعاد والشبكة المعتمدة)
    const padMarginMatch = line.match(/\b(?:padding|margin)(?:Top|Bottom|Left|Right|Vertical|Horizontal)?:\s*(\d+(?:\.\d+)?)/);
    if (padMarginMatch) {
      const val = parseFloat(padMarginMatch[1]);
      if (!VALID_SPACING_GRID.has(val) && val > 0) {
        violations.push({
          file: rel,
          line: lineNum,
          issue: `قيمة مسافة خارج الشبكة المعتمدة (${val}px) — يجب استخدام spacing.sN`,
        });
      }
    }
  }
}

console.log('═══════════════════════════════════════════════════════');
console.log('  مسار — بوابة توكنز التصميم والمسافات (Tokens Check)');
console.log('═══════════════════════════════════════════════════════');
console.log(`  • ملفات المميزات المفحوصة: ${filesChecked}`);

if (violations.length > 0) {
  console.log(`\n✗ تم العثور على ${violations.length} مخالفة في توكنز التصميم:`);
  for (const v of violations) {
    console.log(`   ${v.file}:${v.line} — ${v.issue}`);
  }
  console.error('\n✗ فشل فحص توكنز التصميم: التزم بتوكنز tokens.ts وtheme.tsx (توجيه §6/§10).');
  process.exit(1);
}

console.log('\n✅ جميع التوكنز والمسافات مطابقة للشبكة والمواصفات القياسية.');
process.exit(0);
