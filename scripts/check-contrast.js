#!/usr/bin/env node
/**
 * scripts/check-contrast.js — بوابة WCAG 1.4.3 (A11Y-20/21).
 *
 * تقرأ قيم الألوان الفعلية من `src/design/tokens.ts` (لا نسخة مكرّرة) وتتحقق أن
 * كل زوج نص/خلفية مُعلن هنا يمرّ 4.5:1 (نص عادي) أو 3:1 (نص كبير/عناصر واجهة).
 * أي كسر = فشل البناء — فممنوع أن يتراجع التباين بصمت بعد اليوم.
 *
 *   node scripts/check-contrast.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TOKENS = path.join(ROOT, 'src', 'design', 'tokens.ts');

// ── WCAG نسب التباين ───────────────────────────────────────────────
const srgb = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function luminance(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
}
function ratio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// ── قراءة الثيمات من المصدر ────────────────────────────────────────
const src = fs.readFileSync(TOKENS, 'utf8');
const themes = {};
for (const name of ['lightTheme', 'darkTheme', 'oledTheme']) {
  const start = src.indexOf(`export const ${name}`);
  if (start < 0) throw new Error(`لم أجد ${name} في ${TOKENS}`);
  const end = src.indexOf('\n};', start);
  const block = src.slice(start, end);
  const map = {};
  for (const m of block.matchAll(/^\s*([A-Za-z][A-Za-z0-9]*)\s*:\s*'([^']+)'/gm)) {
    map[m[1]] = m[2];
  }
  themes[name] = map;
}
// دمج الوراثة كما يفعل الرانتايم (dark ← light، oled ← dark)
themes.darkTheme = { ...themes.lightTheme, ...themes.darkTheme };
themes.oledTheme = { ...themes.darkTheme, ...themes.oledTheme };

/** أزواج إلزامية: [الوصف، مفتاح النص، مفتاح الخلفية، الحد الأدنى] */
const REQUIRED = [
  ['text / card', 'text', 'card', 4.5],
  ['text / bg', 'text', 'bg', 4.5],
  ['textSecondary / card', 'textSecondary', 'card', 4.5],
  ['textSecondary / bg', 'textSecondary', 'bg', 4.5],
  ['textMuted / card', 'textMuted', 'card', 4.5],
  ['textMuted / bg', 'textMuted', 'bg', 4.5],
  ['textSuccess / card', 'textSuccess', 'card', 4.5],
  ['textWarn / card', 'textWarn', 'card', 4.5],
  ['textDanger / card', 'textDanger', 'card', 4.5],
  ['textAccent / card', 'textAccent', 'card', 4.5],
  ['brandText / card', 'brandText', 'card', 4.5],
  ['onBrand / actionPrimary', 'onBrand', 'actionPrimary', 4.5],
  ['onSuccess / actionSuccess', 'onSuccess', 'actionSuccess', 4.5],
  ['onBrand / actionDanger', 'onBrand', 'actionDanger', 4.5],
  ['rarityCommon (عناصر واجهة) / card', 'rarityCommon', 'card', 3],
  // A11Y-10: حلقة التركيز عنصر واجهة ⇒ WCAG 1.4.11 يشترط ≥ 3:1 مع ما يجاورها
  ['focusRing (حلقة التركيز) / bg', 'focusRing', 'bg', 3],
  ['focusRing (حلقة التركيز) / card', 'focusRing', 'card', 3],
  ['line (حدود) / card', 'line', 'card', 1], // معلوماتي فقط
];

let failures = 0;
let checked = 0;
console.log('═══════════════════════════════════════════════════════');
console.log('  مسار — بوابة تباين الألوان (WCAG 1.4.3)');
console.log('═══════════════════════════════════════════════════════');
for (const [themeName, map] of Object.entries(themes)) {
  console.log(`\n▸ ${themeName}`);
  for (const [label, fgKey, bgKey, min] of REQUIRED) {
    const fg = map[fgKey];
    const bg = map[bgKey];
    if (!fg || !bg) {
      if (min > 1) {
        failures += 1;
        console.log(`  ✗ ${label.padEnd(34)} مفتاح مفقود (${!fg ? fgKey : bgKey})`);
      }
      continue;
    }
    if (!/^#[0-9A-Fa-f]{3,8}$/.test(fg) || !/^#[0-9A-Fa-f]{3,8}$/.test(bg)) {
      // ألوان rgba (زجاج/حدود) لا تُقاس هنا — تُختبر في axe على DOM الحقيقي.
      console.log(`  · ${label.padEnd(34)} متجاهَل (rgba)`);
      continue;
    }
    checked += 1;
    const r = ratio(fg, bg);
    const ok = r >= min;
    if (!ok) failures += 1;
    console.log(
      `  ${ok ? '✓' : '✗'} ${label.padEnd(34)} ${r.toFixed(2)}:1 (المطلوب ≥ ${min}:1)`,
    );
  }
}
console.log('\n───────────────────────────────────────────────────────');
if (failures) {
  console.error(`✗ فشل: ${failures} زوجًا دون الحد الأدنى — صحّح التوكنز قبل أي إصدار.`);
  process.exit(1);
}
console.log(`✅ تباين سليم — ${checked} زوجًا مُقاسًا عبر ${Object.keys(themes).length} ثيمات.`);
