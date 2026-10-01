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

function parseColor(str) {
  if (!str) return null;
  if (typeof str === 'object' && typeof str.r === 'number') return str;
  if (typeof str !== 'string') return null;
  if (str.startsWith('#')) {
    const h = str.replace('#', '');
    const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
    };
  }
  const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (m) {
    return {
      r: parseInt(m[1], 10),
      g: parseInt(m[2], 10),
      b: parseInt(m[3], 10),
      a: m[4] !== undefined ? parseFloat(m[4]) : 1,
    };
  }
  return null;
}

function composite(overlayStr, baseStr) {
  const fg = parseColor(overlayStr);
  const bg = parseColor(baseStr);
  if (!fg || !bg) return null;
  const a = fg.a;
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
    a: 1,
  };
}

function luminance(c) {
  const p = typeof c === 'string' ? parseColor(c) : c;
  if (!p) return 0;
  return 0.2126 * srgb(p.r / 255) + 0.7152 * srgb(p.g / 255) + 0.0722 * srgb(p.b / 255);
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
  // Composite Glass Contrast (WCAG 1.4.3 عبر الأسطح الزجاجية المركبة)
  ['text / glass (زجاج مركّب)', 'text', 'glass', 4.5],
  ['textSecondary / glass (زجاج مركّب)', 'textSecondary', 'glass', 4.5],
  ['textMuted / glass (زجاج مركّب)', 'textMuted', 'glass', 4.5],
  ['textSuccess / glass (زجاج مركّب)', 'textSuccess', 'glass', 4.5],
  ['textWarn / glass (زجاج مركّب)', 'textWarn', 'glass', 4.5],
  ['textDanger / glass (زجاج مركّب)', 'textDanger', 'glass', 4.5],
  ['brandText / glass (زجاج مركّب)', 'brandText', 'glass', 4.5],
  ['text / glassHeavy (زجاج كثيف)', 'text', 'glassHeavy', 4.5],
  ['textSecondary / glassHeavy (زجاج كثيف)', 'textSecondary', 'glassHeavy', 4.5],
  ['textMuted / glassHeavy (زجاج كثيف)', 'textMuted', 'glassHeavy', 4.5],
  ['line (حدود) / card', 'line', 'card', 1], // معلوماتي فقط
];

let failures = 0;
let checked = 0;
console.log('═══════════════════════════════════════════════════════');
console.log('  مسار — بوابة تباين الألوان (WCAG 1.4.3 & Glass Contrast)');
console.log('═══════════════════════════════════════════════════════');
for (const [themeName, map] of Object.entries(themes)) {
  console.log(`\n▸ ${themeName}`);
  for (const [label, fgKey, bgKey, min] of REQUIRED) {
    const fg = map[fgKey];
    let bg = map[bgKey];
    if (!fg || !bg) {
      if (min > 1) {
        failures += 1;
        console.log(`  ✗ ${label.padEnd(36)} مفتاح مفقود (${!fg ? fgKey : bgKey})`);
      }
      continue;
    }

    let effectiveBg = bg;
    if (bg.startsWith('rgba') && map.bg) {
      effectiveBg = composite(bg, map.bg);
    }

    if (!parseColor(fg) || !parseColor(effectiveBg)) {
      console.log(`  · ${label.padEnd(36)} متجاهَل (لون غير قابل للتحليل)`);
      continue;
    }

    checked += 1;
    const r = ratio(fg, effectiveBg);
    const ok = r >= min;
    if (!ok) failures += 1;
    console.log(
      `  ${ok ? '✓' : '✗'} ${label.padEnd(36)} ${r.toFixed(2)}:1 (المطلوب ≥ ${min}:1)`,
    );
  }
}
console.log('\n───────────────────────────────────────────────────────');
if (failures) {
  console.error(`✗ فشل: ${failures} زوجًا دون الحد الأدنى — صحّح التوكنز قبل أي إصدار.`);
  process.exit(1);
}
console.log(`✅ تباين سليم — ${checked} زوجًا مُقاسًا عبر ${Object.keys(themes).length} ثيمات.`);
