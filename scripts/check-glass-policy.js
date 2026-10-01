#!/usr/bin/env node
/**
 * بوابة سياسة المادة: المؤثرات الحقيقية/الويب لا تتسرب إلى بطاقات المحتوى.
 * GlassSurface في design/glass.tsx هو المحوّل الوحيد المسموح له بمعرفة التنفيذ.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const ADAPTER = path.join(SRC, 'design', 'glass.tsx');
const violations = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) inspect(file);
  }
}

function inspect(file) {
  if (file === ADAPTER) return;
  const source = fs.readFileSync(file, 'utf8');
  const relative = path.relative(ROOT, file).replaceAll(path.sep, '/');
  const checks = [
    [/from\s+['"]expo-blur['"]|<BlurView\b/, 'استخدم BlurView عبر GlassSurface فقط'],
    [/from\s+['"]expo-glass-effect['"]|<GlassView\b|\bisLiquidGlassAvailable\s*\(/, 'استخدم expo-glass-effect عبر المحوّل فقط'],
    [/\b(?:Webkit)?backdropFilter\s*:/, 'لا تضع backdrop-filter خارج GlassSurface'],
    [/\btheme\.(?:glass|glassHeavy|glassBorder)\b/, 'استخدم ألوان مادة الزجاج عبر GlassSurface فقط؛ للمحتوى والحشوات استخدم أدوار السطوح المناسبة'],
  ];
  for (const [pattern, message] of checks) {
    if (pattern.test(source)) violations.push(`  ✗ ${relative}: ${message}`);
  }
}

walk(SRC);
if (violations.length) {
  console.error('✗ خالفت سياسة الزجاج الموحد:\n' + violations.join('\n'));
  process.exit(1);
}
console.log('✓ سياسة المادة سليمة — GlassSurface يملك Blur/Glass/CSS filter وتوكنز التعبئة فقط.');
