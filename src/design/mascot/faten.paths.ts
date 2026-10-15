/**
 * design/mascot/faten.paths.ts — هندسة شخصية «فطن» كبيانات نقية.
 *
 * لماذا هذا الملف منفصل عن الرسم؟
 *   • الرسم (FatenArt.tsx) يصبح طبقة عرض رقيقة: يحوّل البيانات إلى عناصر SVG فقط.
 *   • نفس البيانات تُنتج **ورقة الحالات** في `docs/faten/` (سكربت Node بلا React)
 *     فيصبح لدينا دليل بصري حقيقي مُولَّد من نفس المسارات التي يراها المستخدم —
 *     لا نسخة مكرّرة تنفصل عن الأصل مع الوقت.
 *   • صفر اعتماد على React أو React Native هنا (يعمل في Node لاختبارات وتوليد الأصول).
 */
import type { FatenPalette } from './faten.palette';

export const FATEN_VIEWBOX = { w: 200, h: 232 };

export type GradientName = 'body' | 'cap' | 'face' | 'chest' | 'covert' | 'primary' | 'beak' | 'iris';

/** لون: ثابت نصي، أو من لوحة الشخصية، أو تدرّج مُسمّى */
export type FatenPaint = string | { p: keyof FatenPalette } | { grad: GradientName };

export type FatenPrim =
  | {
      kind: 'path';
      d: string;
      fill?: FatenPaint;
      stroke?: FatenPaint;
      strokeWidth?: number;
      opacity?: number;
      linecap?: 'round' | 'butt';
      linejoin?: 'round' | 'miter';
      dash?: string;
    }
  | { kind: 'circle'; cx: number; cy: number; r: number; fill?: FatenPaint; stroke?: FatenPaint; strokeWidth?: number; opacity?: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill?: FatenPaint; stroke?: FatenPaint; strokeWidth?: number; opacity?: number }
  | { kind: 'polygon'; points: string; fill?: FatenPaint; opacity?: number; stroke?: FatenPaint; strokeWidth?: number }
  | { kind: 'group'; transform: string; children: FatenPrim[] };

/** انعكاس أفقي: −1 لليسار و+1 لليمين */
export const sign = (side: 'left' | 'right') => (side === 'left' ? -1 : 1);

/* ────────────────────────────── الجسم ────────────────────────────── */

export const BODY_D =
  'M100 20 C74 20 53 40 52 68 C51 84 46 98 41 112 C32 134 34 166 58 182 ' +
  'C74 192 126 192 142 182 C166 166 168 134 159 112 C154 98 149 84 148 68 ' +
  'C147 40 126 20 100 20 Z';

export const CHEST_D =
  'M100 78 C86 78 76 98 76 126 C76 158 87 178 100 178 ' +
  'C113 178 124 158 124 126 C124 98 114 78 100 78 Z';

export const CHEST_MARKS: string[] = [
  'M88 106 C89 103 91 102 92 104 C93 102 95 103 96 106 C94 104.5 90 104.5 88 106 Z',
  'M105 109 C106 106 108 105 109 107 C110 105 112 106 113 109 C111 107.5 107 107.5 105 109 Z',
  'M80 126 C81 123 83 122 84 124 C85 122 87 123 88 126 C86 124.5 82 124.5 80 126 Z',
  'M96 128 C97 125 99 124 100 126 C101 124 103 125 104 128 C102 126.5 98 126.5 96 128 Z',
  'M112 130 C113 127 115 126 116 128 C117 126 119 127 120 130 C118 128.5 114 128.5 112 130 Z',
  'M88 148 C89 145 91 144 92 146 C93 144 95 145 96 148 C94 146.5 90 146.5 88 148 Z',
  'M106 150 C107 147 109 146 110 148 C111 146 113 147 114 150 C112 148.5 108 148.5 106 150 Z',
  'M96 168 C97 165 99 164 100 166 C101 164 103 165 104 168 C102 166.5 98 166.5 96 168 Z',
];

export const CHEST_BOTTOM_LINE = 'M82 174 C90 182 110 182 118 174';

export const HEAD_SHEEN_D = 'M58 44 C66 30 82 22 100 22 C118 22 134 30 142 44 C132 34 118 30 100 30 C82 30 68 34 58 44 Z';

export const HIGHLIGHT_D = 'M58 56 C62 38 78 26 100 26';

/* ────────────────────────────── الذيل ────────────────────────────── */

export interface TailFeather { x: number; rot: number; len: number }

export const TAIL_FEATHERS: TailFeather[] = [
  { x: -27, rot: -33, len: 56 },
  { x: -14, rot: -16, len: 64 },
  { x: 0, rot: 0, len: 68 },
  { x: 14, rot: 16, len: 64 },
  { x: 27, rot: 33, len: 56 },
];

export const tailFeatherD = (f: TailFeather) =>
  `M${f.x - 10} 0 C${f.x - 14} ${f.len * 0.45} ${f.x - 8} ${f.len * 0.92} ${f.x} ${f.len} ` +
  `C${f.x + 8} ${f.len * 0.92} ${f.x + 14} ${f.len * 0.45} ${f.x + 10} 0 Z`;

export const tailRachisD = (f: TailFeather, dir: 1 | -1) =>
  `M${f.x + dir * 5} ${f.len * (dir === -1 ? 0.3 : 0.34)} L${f.x + dir * 3} ${f.len * (dir === -1 ? 0.78 : 0.8)}`;

/* ────────────────────────────── الأجنحة ────────────────────────────── */

export const wingPrimaryD = (side: 'left' | 'right') => {
  const f = sign(side);
  const x = (v: number) => 100 + f * v;
  return (
    `M${x(50)} 90 C${x(47)} 104 ${x(45)} 122 ${x(47)} 144 C${x(49)} 162 ${x(55)} 174 ${x(63)} 178 ` +
    `C${x(72)} 180 ${x(77)} 172 ${x(76)} 160 C${x(74)} 138 ${x(72)} 116 ${x(68)} 96 ` +
    `C${x(64)} 88 ${x(55)} 86 ${x(50)} 90 Z`
  );
};

export const wingCovertD = (side: 'left' | 'right') => {
  const f = sign(side);
  const x = (v: number) => 100 + f * v;
  return (
    `M${x(58)} 96 C${x(56)} 112 ${x(55)} 130 ${x(57)} 148 C${x(59)} 164 ${x(63)} 172 ${x(68)} 174 ` +
    `C${x(72)} 168 ${x(71)} 152 ${x(69)} 136 C${x(67)} 118 ${x(65)} 104 ${x(62)} 96 ` +
    `C${x(61)} 94 ${x(59)} 94 ${x(58)} 96 Z`
  );
};

export const wingBarringD = (side: 'left' | 'right'): string[] => {
  const f = sign(side);
  const x = (v: number) => 100 + f * v;
  return [
    `M${x(70)} 128 C${x(66)} 142 ${x(65)} 158 ${x(69)} 170`,
    `M${x(58)} 126 C${x(55)} 140 ${x(55)} 154 ${x(58)} 166`,
  ];
};

export const wingEdgeGlintD = (side: 'left' | 'right') => {
  const f = sign(side);
  const x = (v: number) => 100 + f * v;
  return `M${x(76)} 142 C${x(72)} 152 ${x(71)} 162 ${x(74)} 172`;
};

export const wingRoot = (side: 'left' | 'right') => {
  const f = sign(side);
  return { cx: 100 + f * 57, cy: 100 };
};

/* ────────────────────────────── الأرجل ────────────────────────────── */

export const LEG_SHANKS = ['M90 176 L90 194', 'M110 176 L110 194'];
export const LEG_TOES = [
  'M90 194 L80 203', 'M90 194 L90 205', 'M90 194 L100 203',
  'M110 194 L100 203', 'M110 194 L110 205', 'M110 194 L120 203',
];
export const LEG_CLAWS = [
  'M80 203 L77 207', 'M90 205 L90 209', 'M100 203 L103 207',
  'M100 203 L97 207', 'M110 205 L110 209', 'M120 203 L123 207',
];

/* ────────────────────────────── الرأس والوجه ────────────────────────────── */

export const FACE = { cx: 100, cy: 78, rx: 41, ry: 39 };

export const CAP_D =
  'M100 18 C73 18 53 38 53 68 C53 68 62 61 72 57 C82 53 92 56 100 66 ' +
  'C108 56 118 53 128 57 C138 61 147 68 147 68 C147 38 127 18 100 18 Z';

export const capMalarD = (side: 'left' | 'right') => (side === 'left'
  ? 'M72 57 C62 61 53 68 53 68 C53 86 56 100 63 112 C67 102 68 88 72 76 C71 68 71 61 72 57 Z'
  : 'M128 57 C138 61 147 68 147 68 C147 86 144 100 137 112 C133 102 132 88 128 76 C129 68 129 61 128 57 Z');

export const capCheekD = (side: 'left' | 'right') => (side === 'left'
  ? 'M62 78 C64 98 70 114 82 126 C76 112 71 98 70 82 C67 80 65 78 62 78 Z'
  : 'M138 78 C136 98 130 114 118 126 C124 112 129 98 130 82 C133 80 135 78 138 78 Z');

export const BEAK_D =
  'M100 74 C90 74 84 80 85 90 C86 101 92 111 97 120 C99 124 100 127 100 131 ' +
  'C101 127 103 123 106 116 C111 106 115 97 115 88 C115 79 110 74 100 74 Z';

export const BEAK_HIGHLIGHT_D = 'M92 79 C89 86 90 95 95 103 C97 96 97 86 95 79 Z';
export const BEAK_SEAM_D = 'M85 88 C91 93 109 93 115 88';
export const BEAK_TIP_D = 'M99 122 C97 124 96 126 97 128 C98 126 100 124 101 122 Z';

export const crestPrimaryD = (perk: number) =>
  `M96 36 C89 ${17 - perk * 5} 94 ${6 - perk * 5} 103 ${5 - perk * 5} ` +
  `C110 ${6 - perk * 4} 108 ${19 - perk * 4} 104 37 Z`;

export const crestSecondaryD = (perk: number) =>
  `M104 37 C107 ${20 - perk * 4} 115 ${12 - perk * 5} 120 ${18 - perk * 4} ` +
  `C124 ${24 - perk * 2} 117 ${31} 110 38 Z`;

export const crestGlintD = 'M99 34 C95 24 96 16 100 12';

export const browD = (side: 'left' | 'right', angle: number) => {
  const a = angle;
  if (side === 'left') {
    return `M55 ${52 + a} C63 ${44 + a * 1.2} 72 ${42 + a * 1.6} 85 ${48 + a * 2.2} ` +
      `C78 ${50 + a * 2.1} 68 ${50 + a * 1.4} 57 ${58 + a * 1.2} Z`;
  }
  return `M145 ${52 + a} C137 ${44 + a * 1.2} 128 ${42 + a * 1.6} 115 ${48 + a * 2.2} ` +
    `C122 ${50 + a * 2.1} 132 ${50 + a * 1.4} 143 ${58 + a * 1.2} Z`;
};

/** عين مبتهجة (قوس مبتسم) */
export const happyEyeD = (cx: number) => `M${cx - 14} 74 C${cx - 8} 60 ${cx + 8} 60 ${cx + 14} 74`;
export const happyEyeInnerD = (cx: number) => `M${cx - 11} 75 C${cx - 7} 65 ${cx + 7} 65 ${cx + 11} 75`;
/** عين مغمضة (نائم/هادئ) */
export const closedEyeD = (cx: number) => `M${cx - 12} 72 C${cx - 6} 80 ${cx + 6} 80 ${cx + 12} 72`;

export const EYE_CENTERS = [77, 123];

export function sparklePoints(x: number, y: number, r: number): string {
  const q = r * 0.28;
  return `${x},${y - r} ${x + q},${y - q} ${x + r},${y} ${x + q},${y + q} ` +
    `${x},${y + r} ${x - q},${y + q} ${x - r},${y} ${x - q},${y - q}`;
}

/* ────────────────────────────── الأكسسوارات ────────────────────────────── */

const GOLD: FatenPaint = { p: 'accessoryGold' };
const GOLD_DARK: FatenPaint = { p: 'accessoryGoldDark' };
const WHITE = '#FFFFFF';

function sparkleSet(items: Array<[number, number, number]>, fill: FatenPaint, opacity = 0.95): FatenPrim[] {
  return items.map(([x, y, r]) => ({ kind: 'polygon', points: sparklePoints(x, y, r), fill, opacity }));
}

/** يرسم أكسسوار الوضعية — عنصر واحد فقط (لا «شجرة زينة») */
export function accessoryPrims(
  accessory: 'none' | 'flame' | 'medal' | 'star' | 'check' | 'magnifier' | 'alert' | 'shield' | 'wifiOff' | 'zzz' | 'sparkle',
): FatenPrim[] {
  switch (accessory) {
    case 'flame':
      return [
        { kind: 'path', d: 'M100 12 C94 20 96 26 100 30 C104 26 106 20 100 12 Z', fill: GOLD_DARK, opacity: 0.95 },
        { kind: 'path', d: 'M100 46 C104 38 108 32 112 26 C114 34 112 42 106 46 Z', fill: GOLD, opacity: 0.9 },
        ...sparkleSet([[40, 40, 5], [160, 48, 4]], GOLD),
        ...sparkleSet([[150, 150, 4.5], [50, 156, 4]], GOLD_DARK),
      ];
    case 'medal':
      return [
        { kind: 'path', d: 'M100 168 L88 138', stroke: '#DC2626', strokeWidth: 5, linecap: 'round' },
        { kind: 'path', d: 'M100 168 L112 138', stroke: '#B91C1C', strokeWidth: 5, linecap: 'round' },
        { kind: 'circle', cx: 100, cy: 172, r: 13, fill: GOLD },
        { kind: 'circle', cx: 100, cy: 172, r: 9.5, fill: 'none', stroke: GOLD_DARK, strokeWidth: 2 },
        { kind: 'polygon', points: sparklePoints(100, 172, 6), fill: WHITE, opacity: 0.95 },
        ...sparkleSet([[34, 36, 6], [166, 42, 5]], GOLD),
        ...sparkleSet([[30, 132, 4.5], [170, 138, 4]], GOLD_DARK),
      ];
    case 'star':
      return [
        { kind: 'circle', cx: 158, cy: 40, r: 15, fill: GOLD },
        { kind: 'circle', cx: 158, cy: 40, r: 15, fill: 'none', stroke: GOLD_DARK, strokeWidth: 2.5 },
        { kind: 'polygon', points: sparklePoints(158, 40, 9), fill: WHITE, opacity: 0.95 },
        ...sparkleSet([[40, 44, 6], [172, 104, 4.5]], GOLD),
        ...sparkleSet([[26, 104, 4.5]], GOLD_DARK),
      ];
    case 'check':
      return [
        { kind: 'circle', cx: 156, cy: 42, r: 14, fill: '#22C55E' },
        { kind: 'circle', cx: 156, cy: 42, r: 14, fill: 'none', stroke: '#15803D', strokeWidth: 2 },
        { kind: 'path', d: 'M149 42 L154 47 L163 36', stroke: WHITE, strokeWidth: 3.4, linecap: 'round', linejoin: 'round' },
      ];
    case 'magnifier':
      return [
        { kind: 'circle', cx: 158, cy: 40, r: 15, fill: 'none', stroke: { p: 'irisMid' }, strokeWidth: 4 },
        { kind: 'circle', cx: 158, cy: 40, r: 15, fill: { p: 'irisFrom' }, opacity: 0.25 },
        { kind: 'path', d: 'M169 51 L180 64', stroke: { p: 'irisTo' }, strokeWidth: 5.4, linecap: 'round' },
        { kind: 'path', d: 'M151 34 C153 30 158 28 162 30', stroke: WHITE, strokeWidth: 2.4, linecap: 'round', opacity: 0.8 },
      ];
    case 'alert':
      return [
        { kind: 'circle', cx: 156, cy: 42, r: 14, fill: GOLD },
        { kind: 'circle', cx: 156, cy: 42, r: 14, fill: 'none', stroke: GOLD_DARK, strokeWidth: 2 },
        { kind: 'path', d: 'M156 34 L156 44', stroke: '#7C2D12', strokeWidth: 3.4, linecap: 'round' },
        { kind: 'circle', cx: 156, cy: 49.5, r: 2.2, fill: '#7C2D12' },
      ];
    case 'shield':
      return [
        { kind: 'path', d: 'M100 150 C112 150 122 156 124 162 C122 174 112 182 100 184 C88 182 78 174 76 162 C78 156 88 150 100 150 Z', fill: '#0EA5E9', opacity: 0.9 },
        { kind: 'path', d: 'M100 154 C109 154 117 158 118.5 162.5 C117 171.5 109 177.5 100 179 C91 177.5 83 171.5 81.5 162.5 C83 158 91 154 100 154 Z', fill: 'none', stroke: WHITE, strokeWidth: 2, opacity: 0.7 },
        { kind: 'path', d: 'M100 162 C102.5 158 108 158 108 162.5 C108 166 104 169 100 172 C96 169 92 166 92 162.5 C92 158 97.5 158 100 162 Z', fill: WHITE, opacity: 0.95 },
      ];
    case 'wifiOff':
      return [
        { kind: 'circle', cx: 156, cy: 42, r: 14, fill: '#64748B' },
        { kind: 'path', d: 'M147 40 C150 36 155 34 156 34', stroke: WHITE, strokeWidth: 2.6, linecap: 'round', opacity: 0.85 },
        { kind: 'path', d: 'M151 45 C153 43 156 42 158 42', stroke: WHITE, strokeWidth: 2.6, linecap: 'round', opacity: 0.85 },
        { kind: 'circle', cx: 156, cy: 49, r: 1.8, fill: WHITE },
        { kind: 'path', d: 'M146 50 L166 34', stroke: WHITE, strokeWidth: 3, linecap: 'round' },
      ];
    case 'zzz':
      return [
        { kind: 'path', d: 'M146 34 L158 34 L146 46 L158 46', stroke: { p: 'bodyMid' }, strokeWidth: 3.2, linecap: 'round', linejoin: 'round', opacity: 0.75 },
        { kind: 'path', d: 'M164 20 L173 20 L164 29 L173 29', stroke: { p: 'bodyMid' }, strokeWidth: 2.6, linecap: 'round', linejoin: 'round', opacity: 0.7 },
        { kind: 'path', d: 'M132 22 L140 22 L132 30 L140 30', stroke: { p: 'bodyMid' }, strokeWidth: 2.2, linecap: 'round', linejoin: 'round', opacity: 0.5 },
      ];
    case 'sparkle':
      return [
        ...sparkleSet([[162, 34, 8], [36, 40, 6]], GOLD),
        ...sparkleSet([[172, 96, 4.6], [26, 92, 4.2]], GOLD_DARK),
      ];
    case 'none':
    default:
      return [];
  }
}

/** يرسم العين المفتوحة (القزحية + البؤبؤ + اللمعان + الشرارة) */
export function openEyePrims(
  cx: number,
  opts: { eyeWhite: string; eyeRing: string; pupil: string; irisGradId: string; ry: number; cy: number; angry?: boolean; sparkle?: boolean },
): FatenPrim[] {
  const { cy, ry } = opts;
  const prims: FatenPrim[] = [
    { kind: 'ellipse', cx, cy, rx: 13.6, ry: ry + 0.6, fill: opts.eyeWhite },
    { kind: 'ellipse', cx, cy, rx: 13.6, ry: ry + 0.6, fill: 'none', stroke: opts.eyeRing, strokeWidth: 2.4 },
    { kind: 'ellipse', cx, cy, rx: 11.6, ry: Math.max(ry - 0.4, 4), fill: { grad: 'iris' } },
    { kind: 'ellipse', cx, cy, rx: 7.4, ry: Math.max(ry - 3.4, 3), fill: opts.pupil, opacity: opts.angry ? 0.92 : 0.86 },
    { kind: 'circle', cx: cx - 4.4, cy: cy - 5.5, r: 3.6, fill: '#FFFFFF' },
    { kind: 'circle', cx: cx + 4.8, cy: cy + 5, r: 1.7, fill: '#FFFFFF', opacity: 0.75 },
  ];
  if (opts.angry) {
    prims.push({ kind: 'ellipse', cx, cy, rx: 13.6, ry: ry + 0.6, fill: { p: 'capTo' }, opacity: 0.34 });
  }
  if (opts.sparkle) {
    prims.push({ kind: 'polygon', points: sparklePoints(cx, cy - 6, 10), fill: { p: 'beakFrom' }, opacity: 0.9 });
  }
  return prims;
}

export const AURA = { cx: 100, cy: 112, rx: 92, ry: 106 };
export const SHADOW = { cx: 100, cy: 212, rx: 46, ry: 8 };
export const BLUSH = [
  { cx: 70, cy: 97, rx: 7, ry: 4.2 },
  { cx: 130, cy: 97, rx: 7, ry: 4.2 },
];
export const TAIL_ORIGIN = { x: 100, y: 146 };
