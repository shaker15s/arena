/**
 * scripts/faten-sheet.ts — يولّد «ورقة حالات فطن» من **نفس** الهندسة التي يرسمها
 * التطبيق (faten.paths + faten.scene)، بلا React ولا React Native.
 *
 * الاستخدام:
 *   npx tsc -p tsconfig.test.json && node .test-build/scripts/faten-sheet.js
 *
 * المخرجات:
 *   docs/faten/faten-states.svg   — 14 حالة في صفّين (مرجع تصميمي + دليل بصري)
 *   docs/faten/faten-single.svg   — الوضعية الأساسية بحجم كبير
 *
 * القيمة: أي تعديل في شكل الشخصية يظهر في التوثيق فورًا، ويراجعه البشر بعينهم
 * بدل الاعتماد على «يبدو صحيحًا» — ويصلح كمرجع للتصميم ولاختبارات بصرية لاحقة.
 */
import * as fs from 'fs';
import * as path from 'path';
import { FATEN_LIGHT } from '../src/design/mascot/faten.palette';
import { FATEN_POSES } from '../src/design/mascot/faten.pose';
import { buildFatenScene, sceneGradients } from '../src/design/mascot/faten.scene';
import { FATEN_VIEWBOX, type FatenPaint, type FatenPrim } from '../src/design/mascot/faten.paths';
import type { FatenBehaviorState } from '../src/design/mascot/mascot.types';

const palette = FATEN_LIGHT;

const AR_LABELS: Record<FatenBehaviorState, string> = {
  idle: 'سكون — تنفّس هادئ',
  welcome: 'ترحيب',
  ready: 'جاهز',
  attention: 'انتباه — إجراء مطلوب',
  working: 'تحقّق/معالجة',
  success: 'نجاح مؤكد',
  achievement: 'إنجاز',
  streak_fire: 'ستريك مشتعل',
  alert: 'تنبيه خطر',
  recovery: 'تعافٍ ودعم',
  offline: 'بلا اتصال',
  quiet: 'وضع هادئ',
  level_up: 'ترقية مستوى',
  nudge: 'همسة تذكير',
};

function paintToSvg(paint: FatenPaint | undefined, ids: Record<string, string>): string | undefined {
  if (paint === undefined) return undefined;
  if (typeof paint === 'string') return paint;
  if ('p' in paint) return (palette as unknown as Record<string, string>)[paint.p];
  return `url(#${ids[paint.grad]})`;
}

function primToSvg(prim: FatenPrim, ids: Record<string, string>): string {
  const attrs = (extra: Record<string, string | number | undefined>) =>
    Object.entries(extra)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${k}="${v}"`)
      .join(' ');
  switch (prim.kind) {
    case 'path':
      return `<path d="${prim.d}" ${attrs({
        fill: paintToSvg(prim.fill, ids) ?? 'none',
        stroke: paintToSvg(prim.stroke, ids),
        'stroke-width': prim.strokeWidth,
        'stroke-linecap': prim.linecap,
        'stroke-linejoin': prim.linejoin,
        opacity: prim.opacity,
      })}/>`;
    case 'circle':
      return `<circle ${attrs({
        cx: prim.cx, cy: prim.cy, r: prim.r,
        fill: paintToSvg(prim.fill, ids) ?? 'none',
        stroke: paintToSvg(prim.stroke, ids),
        'stroke-width': prim.strokeWidth,
        opacity: prim.opacity,
      })}/>`;
    case 'ellipse':
      return `<ellipse ${attrs({
        cx: prim.cx, cy: prim.cy, rx: prim.rx, ry: prim.ry,
        fill: paintToSvg(prim.fill, ids) ?? 'none',
        stroke: paintToSvg(prim.stroke, ids),
        'stroke-width': prim.strokeWidth,
        opacity: prim.opacity,
      })}/>`;
    case 'polygon':
      return `<polygon ${attrs({
        points: prim.points,
        fill: paintToSvg(prim.fill, ids) ?? 'none',
        stroke: paintToSvg(prim.stroke, ids),
        'stroke-width': prim.strokeWidth,
        opacity: prim.opacity,
      })}/>`;
    case 'group':
      return `<g transform="${prim.transform}">${prim.children.map((c) => primToSvg(c, ids)).join('')}</g>`;
    default:
      return '';
  }
}

function defsFor(uid: string) {
  const ids: Record<string, string> = {
    aura: `${uid}-aura`,
    body: `${uid}-body`,
    cap: `${uid}-cap`,
    face: `${uid}-face`,
    chest: `${uid}-chest`,
    covert: `${uid}-covert`,
    primary: `${uid}-primary`,
    beak: `${uid}-beak`,
    iris: `${uid}-iris`,
  };
  const gradients = sceneGradients(palette);
  const defs: string[] = [
    `<radialGradient id="${ids.aura}" cx="50%" cy="46%" r="52%">` +
      `<stop offset="52%" stop-color="${palette.aura}" stop-opacity="${palette.auraOpacity}"/>` +
      `<stop offset="100%" stop-color="${palette.aura}" stop-opacity="0"/>` +
      `</radialGradient>`,
  ];
  for (const name of Object.keys(gradients) as Array<keyof typeof gradients>) {
    defs.push(
      `<linearGradient id="${ids[name]}" x1="0%" y1="0%" x2="100%" y2="100%">` +
        gradients[name].map((s) => `<stop offset="${s.offset}" stop-color="${s.color}"/>`).join('') +
        `</linearGradient>`,
    );
  }
  return { ids, defs: `<defs>${defs.join('')}</defs>` };
}

/** يرسم تميمة واحدة كاملة داخل إحداثيات الـ viewBox الأصلي */
function mascotSvg(state: FatenBehaviorState): string {
  const uid = `f-${state}`;
  const { ids, defs } = defsFor(uid);
  const scene = buildFatenScene({ pose: FATEN_POSES[state], palette });
  const body = scene
    .map((part) => {
      if (part.layer === 'aura') {
        return `<ellipse cx="${part.cx}" cy="${part.cy}" rx="${part.rx}" ry="${part.ry}" fill="url(#${ids.aura})"/>`;
      }
      if (part.layer === 'shadow') {
        return `<ellipse cx="${part.cx}" cy="${part.cy}" rx="${part.rx}" ry="${part.ry}" fill="${part.color}" opacity="${part.opacity}"/>`;
      }
      if (part.layer === 'group') {
        return `<g transform="${part.transform}">${part.children.map((c) => primToSvg(c, ids)).join('')}</g>`;
      }
      return primToSvg((part as { node: FatenPrim }).node, ids);
    })
    .join('');
  return defs + body;
}

function buildSheet(states: FatenBehaviorState[]): string {
  const cellW = FATEN_VIEWBOX.w + 24;
  const cellH = FATEN_VIEWBOX.h + 54;
  const cols = 4;
  const rows = Math.ceil(states.length / cols);
  const width = cols * cellW;
  const height = rows * cellH + 92;

  const cells = states
    .map((state, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = col * cellW + 12;
      const y = row * cellH + 74;
      return (
        `<g transform="translate(${x} ${y})">` +
        `<rect x="0" y="0" width="${FATEN_VIEWBOX.w}" height="${FATEN_VIEWBOX.h}" rx="26" fill="#F7F9FC" stroke="#E3E8F0"/>` +
        mascotSvg(state) +
        `<text x="${FATEN_VIEWBOX.w / 2}" y="${FATEN_VIEWBOX.h + 26}" text-anchor="middle" ` +
        `font-family="'IBM Plex Sans Arabic','Segoe UI',sans-serif" font-size="15" fill="#1F2937">${AR_LABELS[state]}</text>` +
        `<text x="${FATEN_VIEWBOX.w / 2}" y="${FATEN_VIEWBOX.h + 44}" text-anchor="middle" ` +
        `font-family="'IBM Plex Sans Arabic',monospace" font-size="11.5" fill="#6B7280">${state}</text>` +
        `</g>`
      );
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#FFFFFF"/>
  <text x="${width / 2}" y="40" text-anchor="middle" font-family="'IBM Plex Sans Arabic','Segoe UI',sans-serif" font-size="24" font-weight="700" fill="#111827">صقر مسار «فطن» — ورقة الحالات الـ14 (Faten 3.0)</text>
  <text x="${width / 2}" y="64" text-anchor="middle" font-family="'IBM Plex Sans Arabic','Segoe UI',sans-serif" font-size="13" fill="#6B7280">مُولَّدة من نفس هندسة الرسم المُستخدمة في التطبيق — src/design/mascot/faten.paths.ts</text>
  ${cells}
</svg>`;
}

function buildSingle(state: FatenBehaviorState = 'idle'): string {
  const scale = 2;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${FATEN_VIEWBOX.w * scale}" height="${FATEN_VIEWBOX.h * scale}" viewBox="0 0 ${FATEN_VIEWBOX.w} ${FATEN_VIEWBOX.h}">
  <rect width="${FATEN_VIEWBOX.w}" height="${FATEN_VIEWBOX.h}" fill="#FFFFFF"/>
  ${mascotSvg(state)}
</svg>`;
}

const ALL_STATES = Object.keys(FATEN_POSES) as FatenBehaviorState[];
// المسار نسبةً لجذر المشروع (السكربت يعمل من الجذر عبر npm) — لا `__dirname`
// لأن الملف المُصرّف يقع داخل .test-build.
const outDir = path.resolve(process.cwd(), 'docs', 'faten');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'faten-states.svg'), buildSheet(ALL_STATES), 'utf8');
fs.writeFileSync(path.join(outDir, 'faten-single.svg'), buildSingle('idle'), 'utf8');
console.log(`✓ فطن: وُلِّدت ورقة ${ALL_STATES.length} حالة في docs/faten/faten-states.svg`);
