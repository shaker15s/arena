/**
 * scripts/faten-ssr-run.js — يشغّل تحقّق React SSR لمكوّن فطن ويُنتج:
 *   docs/faten/faten-react-ssr.svg  — 14 حالة مرسومة عبر المكوّن الفعلي
 *   docs/faten/faten-react-one.svg  — الحالة الأساسية مكبّرة
 * وحالة خروج ≠ 0 عند أي مشكلة في المخرَج.
 *
 * لماذا ملف .js؟ لأننا نحتاج تحميل react-native-svg «نسخة الويب» في Node بلا
 * Metro/bundler — وهو ما يتطلّب تحويل مسارات (`react-native` → `react-native-web`).
 */
'use strict';
const path = require('path');
const fs = require('fs');
const Module = require('module');

const root = path.resolve(__dirname, '..');
const resolveFilename = Module._resolveFilename;

// 1) خريطة الوحدات: أي طلب لـ react-native أو react-native-svg يُوجَّه لنسخة الويب.
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'react-native') {
    // نسخة CommonJS — نسخة ESM تفشل في Node 22 (استيراد مجلدات)
    return path.join(root, 'node_modules', 'react-native-web', 'dist', 'cjs', 'index.js');
  }
  if (request.startsWith('react-native/')) {
    // مكوّنات Fabric الأصلية (codegenNativeComponent) لا وجود لها على الويب —
    // نعيد مكوّنًا صامتًا لأنّ مسار الويب لا يستخدمها أصلًا.
    return path.join(root, 'scripts', 'faten-ssr-shims.js');
  }
  if (request === 'react-native-svg') {
    return path.join(root, 'node_modules', 'react-native-svg', 'lib', 'commonjs', 'ReactNativeSVG.web.js');
  }
  const resolved = resolveFilename.call(this, request, parent, isMain, options);
  // محاكاة «دقة المنصّة» في Metro: لو فيه ملف `.web.js` مقابل، استخدمه.
  // (Node لا يعرف هذا السلوك، وبدونه تُحمَّل نسخة الجوال داخل SSR.)
  if (resolved.includes(`${path.sep}react-native-svg${path.sep}`) && resolved.endsWith('.js')) {
    const webVariant = resolved.replace(/\.js$/, '.web.js');
    if (fs.existsSync(webVariant)) return webVariant;
  }
  return resolved;
};

process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { FatenArt } = require(path.join(root, '.test-build', 'src', 'design', 'mascot', 'FatenArt.js'));
const ssr = require(path.join(root, '.test-build', 'scripts', 'faten-ssr.js'));
// الراستر اختياري: بعض البيئات لا تحتوي الحزمة — الفحوص النصية تبقى حاسمة.
let Resvg = null;
try { ({ Resvg } = require('/tmp/svgtool/node_modules/@resvg/resvg-js')); } catch { /* بلا راستر */ }

const htmlByState = ssr.renderFatenStates({ React, renderToStaticMarkup, FatenArt });

let failures = 0;
const stateNames = Object.keys(htmlByState);
console.log(`\n══ تحقّق React SSR لمكوّن فطن (${stateNames.length} رسمة) ══\n`);
for (const name of stateNames) {
  const problems = ssr.auditSsrHtml(htmlByState[name]);
  if (problems.length > 0) {
    failures += problems.length;
    console.log(`❌ ${name}: ${problems.join(' · ')}`);
  } else {
    console.log(`✅ ${name}: SVG سليم (${(htmlByState[name].length / 1024).toFixed(1)}KB)`);
  }
}

// فحص إضافي مهم: تميّز العلامات في المخرَج بين حالتين مختلفتين (لو كان الـ pose
// لا يصل للمكوّن لكان الناتج متطابقًا — وهو خطأ صامت خطير).
const idle = htmlByState.idle;
const achieve = htmlByState.achievement;
if (idle === achieve) {
  failures += 1;
  console.log('❌ الحالات مختلفة لكن المخرَج متطابق — الوضعية لا تصل للمكوّن');
} else {
  console.log('✅ الفروق بين الحالات تصل فعلًا إلى المخرَج (idle ≠ achievement)');
}

const outDir = path.resolve(root, 'docs', 'faten');
fs.mkdirSync(outDir, { recursive: true });

// ورقة الحالات المرسومة من المكوّن الفعلي
const cols = 4;
const cellW = 220;
const cellH = 260;
const rows = Math.ceil(stateNames.length / cols);
const sheetW = cols * cellW;
const sheetH = rows * cellH + 60;
const cells = stateNames
  .map((name, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const inner = htmlByState[name].replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    return (
      `<g transform="translate(${col * cellW + 10} ${row * cellH + 60})">` +
      `<rect width="200" height="232" rx="20" fill="#F7F9FC" stroke="#E3E8F0"/>` +
      `<svg width="200" height="232" viewBox="0 0 200 232">${inner}</svg>` +
      `<text x="100" y="252" text-anchor="middle" font-family="'IBM Plex Sans Arabic',sans-serif" font-size="12" fill="#374151">${name}</text>` +
      `</g>`
    );
  })
  .join('');
fs.writeFileSync(
  path.join(outDir, 'faten-react-ssr.svg'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW}" height="${sheetH}" viewBox="0 0 ${sheetW} ${sheetH}">` +
    `<rect width="${sheetW}" height="${sheetH}" fill="#fff"/>` +
    `<text x="${sheetW / 2}" y="30" text-anchor="middle" font-family="'IBM Plex Sans Arabic',sans-serif" font-size="18" font-weight="700" fill="#111827">فطن — مخرَج React الحقيقي (react-native-svg web)</text>` +
    cells +
    `</svg>`,
  'utf8',
);

// صورة كبيرة للحالة الأساسية
const oneSvg = ssr.htmlToSvg(htmlByState.__base, 420, 487);
fs.writeFileSync(path.join(outDir, 'faten-react-one.svg'), oneSvg, 'utf8');
if (Resvg) {
  fs.writeFileSync(
    path.join(outDir, 'faten-react-ssr.png'),
    new Resvg(fs.readFileSync(path.join(outDir, 'faten-react-ssr.svg'), 'utf8'), {
      fitTo: { mode: 'width', value: 1000 },
      background: '#FFFFFF',
    }).render().asPng(),
  );
} else {
  console.log('ℹ️ resvg غير متاح — تخطّي توليد PNG (المخرَج SVG كافٍ للفحص)');
}

console.log(`\n${failures === 0 ? '✅' : '❌'} النتيجة: ${failures === 0 ? 'كل الرسومات سليمة' : failures + ' مشكلة'}`);
process.exit(failures === 0 ? 0 : 1);
