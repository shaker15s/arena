#!/usr/bin/env node
/**
 * scripts/check-glass.js — بوابة التحقق من نظام الزجاج وتراكب الطبقات (Glass System Gate).
 *
 * القواعد الملزمة (توجيه §2/§4/§27/§35):
 * 1. ممنوع استخدام <BlurView أو backdropFilter أو intensity > 0 خارج الملفات المسموحة:
 *    - src/design/surfaces.tsx (FunctionalGlass)
 *    - src/design/glass.tsx (GlassSurface)
 *    - src/design/tokens.ts (glass tokens)
 *    - src/app/RootNavigator.tsx
 *    - src/app/App.tsx
 *    - src/features/attendance/ScannerScreen.tsx
 * 2. ممنوع تعشيش FunctionalGlass داخل FunctionalGlass (Nested Glass).
 * 3. ممنوع استخدام ألوان rgba عشوائية داخل src/features (يُسمح بتراكبات الكاميرا في ScannerScreen
 *    وتراكبات التوكنز الدلالية المعتمدة).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const FEATURES = path.join(SRC, 'features');

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (/\.(tsx?|jsx?)$/.test(e.name)) acc.push(full);
  }
  return acc;
}

const GLASS_WHITELIST = new Set([
  path.normalize('src/design/surfaces.tsx'),
  path.normalize('src/design/glass.tsx'),
  path.normalize('src/design/tokens.ts'),
  path.normalize('src/app/RootNavigator.tsx'),
  path.normalize('src/app/App.tsx'),
  path.normalize('src/features/attendance/ScannerScreen.tsx'),
]);

// التراكبات اللونية المسموحة في طبقة المميزات (أبيض/أسود شفاف، أو توكنز دلالية معتمدة)
const ALLOWED_RGBA_PATTERNS = [
  /rgba\(\s*255\s*,\s*255\s*,\s*255\s*,/i, // White overlay
  /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,/i,       // Black overlay
  /rgba\(\s*60\s*,\s*60\s*,\s*67\s*,/i,     // Apple separator
  /rgba\(\s*84\s*,\s*84\s*,\s*88\s*,/i,     // Apple dark separator
  /rgba\(\s*245\s*,\s*158\s*,\s*11\s*,/i,   // Gold / Amber accent
  /rgba\(\s*217\s*,\s*119\s*,\s*6\s*,/i,    // Amber dark
  /rgba\(\s*254\s*,\s*243\s*,\s*199\s*,/i,  // Amber soft
  /rgba\(\s*255\s*,\s*237\s*,\s*213\s*,/i,  // Orange / Amber 100 soft
  /rgba\(\s*251\s*,\s*191\s*,\s*36\s*,/i,   // Amber glow
  /rgba\(\s*56\s*,\s*189\s*,\s*248\s*,/i,   // Sky / Cyan
  /rgba\(\s*15\s*,\s*23\s*,\s*42\s*,/i,     // Slate 900
  /rgba\(\s*30\s*,\s*41\s*,\s*59\s*,/i,     // Slate 800
  /rgba\(\s*148\s*,\s*163\s*,\s*184\s*,/i,  // Slate 400
  /rgba\(\s*203\s*,\s*213\s*,\s*225\s*,/i,  // Slate 300
  /rgba\(\s*241\s*,\s*245\s*,\s*249\s*,/i,  // Slate 100
  /rgba\(\s*16\s*,\s*185\s*,\s*129\s*,/i,   // Emerald
  /rgba\(\s*6\s*,\s*44\s*,\s*31\s*,/i,      // Emerald dark
  /rgba\(\s*236\s*,\s*253\s*,\s*245\s*,/i,  // Emerald soft
  /rgba\(\s*124\s*,\s*58\s*,\s*237\s*,/i,   // Violet
  /rgba\(\s*30\s*,\s*27\s*,\s*75\s*,/i,     // Indigo dark
  /rgba\(\s*243\s*,\s*232\s*,\s*255\s*,/i,  // Violet soft
  /rgba\(\s*32\s*,\s*23\s*,\s*50\s*,/i,     // Dark purple
  /rgba\(\s*20\s*,\s*16\s*,\s*36\s*,/i,     // Dark violet
  /rgba\(\s*24\s*,\s*20\s*,\s*42\s*,/i,     // Dark celebration
  /rgba\(\s*20\s*,\s*184\s*,\s*166\s*,/i,   // Teal
];

const violations = [];
let filesChecked = 0;

for (const file of walk(SRC)) {
  filesChecked += 1;
  const rel = path.relative(ROOT, file);
  const isWhitelisted = GLASS_WHITELIST.has(path.normalize(rel));
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');

  // 1) فحص استخدام الضبابية خارج الملفات المسموحة
  if (!isWhitelisted) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (/<BlurView\b/.test(line)) {
        violations.push({ file: rel, line: i + 1, issue: 'استخدام <BlurView> محظور خارج طبقة FunctionalGlass المعتمدة' });
      }
      if (/backdropFilter\b/.test(line)) {
        violations.push({ file: rel, line: i + 1, issue: 'استخدام backdropFilter محظور خارج طبقة FunctionalGlass المعتمدة' });
      }
      const intMatch = line.match(/\bintensity\s*[:=]\s*\{?([a-zA-Z0-9_.]+)\}?/);
      if (intMatch && intMatch[1] !== '0' && intMatch[1] !== 'false') {
        violations.push({ file: rel, line: i + 1, issue: `استخدام intensity=${intMatch[1]} محظور خارج المكونات المسموحة` });
      }
    }
  }

  // 2) فحص تعشيش FunctionalGlass داخل FunctionalGlass
  let glassDepth = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // تجاهل التعليقات
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;

    const opens = (line.match(/<FunctionalGlass(?:\s|>|$)/g) || []).length;
    const selfCloses = (line.match(/<FunctionalGlass[^>]*\/>/g) || []).length;
    const closes = (line.match(/<\/FunctionalGlass>/g) || []).length;

    const netOpens = opens - selfCloses;
    if (glassDepth > 0 && opens > 0) {
      violations.push({ file: rel, line: i + 1, issue: 'ممنوع تعشيش FunctionalGlass داخل FunctionalGlass آخر' });
    }
    glassDepth += netOpens - closes;
    if (glassDepth < 0) glassDepth = 0;
  }

  // 3) فحص ألوان rgba في src/features
  if (rel.startsWith('src' + path.sep + 'features') && !rel.endsWith('ScannerScreen.tsx')) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.trim().startsWith('//')) continue;
      const rgbaMatches = line.match(/rgba\([^)]+\)/g);
      if (rgbaMatches) {
        for (const rgba of rgbaMatches) {
          const isAllowed = ALLOWED_RGBA_PATTERNS.some((pat) => pat.test(rgba));
          if (!isAllowed) {
            violations.push({ file: rel, line: i + 1, issue: `لون rgba غير معتمد (${rgba}) — يجب استخدام ألوان الثيم الدلالية` });
          }
        }
      }
    }
  }
}

console.log('═══════════════════════════════════════════════════════');
console.log('  مسار — بوابة نظام الزجاج وطبقات الأسطح (Glass Check)');
console.log('═══════════════════════════════════════════════════════');
console.log(`  • ملفات مفحوصة: ${filesChecked}`);

if (violations.length > 0) {
  console.log(`\n✗ تم العثور على ${violations.length} مخالفة في نظام الزجاج:`);
  for (const v of violations) {
    console.log(`   ${v.file}:${v.line} — ${v.issue}`);
  }
  console.error('\n✗ فشل فحص نظام الزجاج: راجع توجيه فصل المحتوى عن الزجاج (§2/§4/§27/§35).');
  process.exit(1);
}

console.log('\n✅ نظام الزجاج سليم ومطابق تمامًا للمواصفة القياسية.');
process.exit(0);
