#!/usr/bin/env node
/**
 * scripts/check-a11y.js — بوابة إمكانية الوصول الآلية (A11Y Gate).
 *
 * تمنع الانحدار الصامت في الطبقة الدلالية: كل ضغطة (Pressable/TouchableOpacity)
 * يجب أن تحمل دورًا و/أو اسمًا مقروءًا، وكل أيقونة يجب أن تكون عبر المكوّن
 * الموحّد (زخرفية افتراضيًا)، وممنوع نص عربي مضمّن داخل خصائص الوصول،
 * وممنوع إلغاء `outline` بلا بديل مرئي.
 *
 *   node scripts/check-a11y.js
 *
 * ملاحظة منهجية: هذا فحص ثابت (Static) مساعد — لا يغني عن axe على DOM حقيقي
 * ولا عن جولة VoiceOver/TalkBack اليدوية (ملحق G في الخطة).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const ARABIC = /[\u0600-\u06FF]/;

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (/\.tsx?$/.test(e.name)) acc.push(full);
  }
  return acc;
}

const errors = [];
const warnings = [];
let pressables = 0;
let icons = 0;
let screensChecked = 0;
let screensWithHeading = 0;
const screensMissingHeading = [];

for (const file of walk(SRC)) {
  const rel = path.relative(ROOT, file);
  const src = fs.readFileSync(file, 'utf8');

  // 1) مكوّن الأيقونة الموحّد: ممنوع أيونات مباشرة في الشاشات (بقيت في components/icons فقط)
  if (!/design[\\/](icons\.tsx|components\.tsx)$/.test(file)) {
    for (const m of src.matchAll(/<Ionicons\b/g)) {
      errors.push(`${rel}:${src.slice(0, m.index).split('\n').length} — استخدام <Ionicons> مباشرة؛ استخدم <Icon> من design/icons.`);
    }
  }

  // 2) عدّ الأيقونات الموحّدة (للإحصاء في تقرير البوابة)
  icons += [...src.matchAll(/<Icon\b/g)].length;

  // 3) كل <Pressable> يجب أن يحمل دورًا أو اسمًا خلال 14 سطرًا من فتحه
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    if (!/<Pressable\b/.test(line)) return;
    pressables += 1;
    const window = lines.slice(i, i + 14).join('\n');
    const hasRole = /accessibilityRole=/.test(window);
    const hasLabel = /accessibilityLabel=/.test(window);
    const isDecorativeWrapper =
      /accessible=\{false\}/.test(window) || /pointerEvents="none"/.test(window);
    if (!isDecorativeWrapper && !hasRole && !hasLabel) {
      const inDesign = rel.includes('design');
      const msg = `${rel}:${i + 1} — <Pressable> بلا accessibilityRole/Label (A11Y-31).`;
      if (inDesign) warnings.push(msg);
      else errors.push(msg);
    }
  });

  // 4) ممنوع نص عربي مضمّن داخل خصائص الوصول (يجب أن يأتي من i18n)
  //    يغطي الشكل النصي المباشر (`="..."`) والقوالب النصية (`={\`...\`}`).
  for (const m of src.matchAll(/accessibility(?:Label|Hint)=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    const value = m[1] ?? m[2] ?? '';
    if (ARABIC.test(value)) {
      errors.push(`${rel}:${src.slice(0, m.index).split('\n').length} — نص عربي مضمّن في accessibilityLabel/Hint؛ استخدم t('...') (A11Y-33).`);
    }
  }

  // 5) ممنوع إلغاء outline بلا بديل مرئي (البديل مسموح فقط في طبقة CSS المركزية)
  if (/outlineStyle:\s*'none'/.test(src) && !/design[\\/]a11y[\\/]focus\.ts$/.test(file)) {
    warnings.push(`${rel} — outlineStyle:'none' خارج الطبقة المركزية؛ راجع مؤشر التركيز.`);
  }
}

// 6) A11Y-04: كل شاشة (مكوّن مُصدَّر اسمه ينتهي بـ Screen) يجب أن تُصدر عنوانًا
//    دلاليًا h1 — عبر <Header> (المكوّن الذي يولّد h1) أو heading="h1" مباشرة.
//    الشاشات الفرعية داخل نفس الملف تُفحص بنطاق جسم الدالة.
for (const file of walk(SRC)) {
  const rel = path.relative(ROOT, file);
  if (!rel.includes('features') && !rel.includes(path.join('app', 'RootNavigator'))) continue;
  const src = fs.readFileSync(file, 'utf8');
  const fnRe = /export\s+function\s+(\w*Screen)\s*\(/g;
  for (const m of src.matchAll(fnRe)) {
    const name = m[1];
    const start = m.index;
    // نطاق الدالة: من التعريف حتى تعريف شاشة تالية أو نهاية الملف.
    const next = src.slice(start + 1).search(/export\s+function\s+\w+\s*\(|^function\s+\w+Screen\s*\(/m);
    const body = next === -1 ? src.slice(start) : src.slice(start, start + 1 + next);
    screensChecked += 1;
    const hasHeading = /<Header\b/.test(body) || /heading="h1"/.test(body) || /<SemanticScreen\b/.test(body);
    if (hasHeading) screensWithHeading += 1;
    else screensMissingHeading.push(`${rel} — ${name}`);
  }
}

// 7) مواءمة لون حلقة التركيز بين التوكنز و CSS الويب (منع الانحراف الصامت)
{
  const tokens = fs.readFileSync(path.join(SRC, 'design', 'tokens.ts'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const tokenValues = [...tokens.matchAll(/focusRing:\s*'(#[0-9A-Fa-f]{6})'/g)].map((x) => x[1].toUpperCase());
  const cssValues = [...html.matchAll(/--masar-focus:\s*(#[0-9A-Fa-f]{6})/g)].map((x) => x[1].toUpperCase());
  const light = tokenValues[0];
  const dark = tokenValues[1];
  if (!light || !dark) {
    errors.push('tokens.ts — focusRing غير معرّف للثيمين (A11Y-10).');
  } else if (!cssValues.includes(light) || !cssValues.includes(dark)) {
    errors.push(
      `public/index.html — قيم --masar-focus (${cssValues.join(', ') || 'لا شيء'}) لا تطابق توكنز focusRing (${light}, ${dark}).`,
    );
  }
}

console.log('═══════════════════════════════════════════════════════');
console.log('  مسار — بوابة إمكانية الوصول (Static A11y Gate)');
console.log('═══════════════════════════════════════════════════════');
console.log(`  • عناصر ضغط مفحوصة: ${pressables}`);
console.log(`  • أيقونات موحّدة (<Icon>): ${icons}`);
console.log(`  • شاشات بها عنوان h1: ${screensWithHeading}/${screensChecked}`);
console.log(`  • أخطاء: ${errors.length} · تحذيرات: ${warnings.length}`);

if (screensMissingHeading.length) {
  console.log('\n⚠️ شاشات بلا عنوان h1 (A11Y-04):');
  for (const w of screensMissingHeading.slice(0, 20)) console.log('   ' + w);
}
if (warnings.length) {
  console.log('\n⚠️ تحذيرات:');
  for (const w of warnings.slice(0, 15)) console.log('   ' + w);
}
if (errors.length) {
  console.log('\n✗ أخطاء:');
  for (const e of errors.slice(0, 40)) console.log('   ' + e);
  console.error(`\n✗ فشل: ${errors.length} مخالفة وصول — أصلحها قبل الدمج.`);
  process.exit(1);
}
console.log('\n✅ لا مخالفات وصول ثابتة.');
