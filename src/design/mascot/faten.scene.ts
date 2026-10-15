/**
 * design/mascot/faten.scene.ts — مُجمِّع المشهد: يحوّل (وضعية + لوحة ألوان) إلى
 * قائمة أجزاء SVG مرتّبة بالطبقات.
 *
 * الفائدة: نفس المشهد يُستهلك من ثلاث جهات بلا تكرار:
 *   1. `FatenArt.tsx` عبر react-native-svg (الجوال + الويب).
 *   2. سكربت توليد «ورقة الحالات» في `scripts/faten-sheet.ts` (Node خالص).
 *   3. أي اختبار بصري/هيكلي مستقبلي (يستطيع فحص عدد الطبقات وترتيبها).
 */
import type { FatenPalette } from './faten.palette';
import type { FatenPose } from './faten.pose';
import {
  AURA, BEAK_D, BEAK_HIGHLIGHT_D, BEAK_SEAM_D, BEAK_TIP_D, BLUSH, BODY_D, CAP_D,
  CHEST_BOTTOM_LINE, CHEST_D, CHEST_MARKS, EYE_CENTERS, FACE, FATEN_VIEWBOX, HIGHLIGHT_D,
  HEAD_SHEEN_D, LEG_CLAWS, LEG_SHANKS, LEG_TOES, SHADOW, TAIL_FEATHERS, TAIL_ORIGIN,
  accessoryPrims, browD, capCheekD, capMalarD, closedEyeD, crestGlintD, crestPrimaryD,
  crestSecondaryD, happyEyeD, happyEyeInnerD, openEyePrims, tailFeatherD, tailRachisD,
  wingBarringD, wingCovertD, wingEdgeGlintD, wingPrimaryD, wingRoot,
} from './faten.paths';

export type FatenPart =
  | { layer: 'aura'; cx: number; cy: number; rx: number; ry: number; color: string; opacity: number }
  | { layer: 'shadow'; cx: number; cy: number; rx: number; ry: number; color: string; opacity: number }
  | { layer: 'geometry'; node: import('./faten.paths').FatenPrim; rotate?: number }
  | { layer: 'group'; transform: string; children: import('./faten.paths').FatenPrim[] };

export interface FatenSceneOptions {
  pose: FatenPose;
  palette: FatenPalette;
  /** تجاوز وضع العين (الرمش) */
  eyeMode?: FatenPose['eyes'];
  /** إخفاء الهالة */
  bare?: boolean;
}

const GRADIENTS = ['body', 'cap', 'face', 'chest', 'covert', 'primary', 'beak', 'iris'] as const;

export function sceneGradients(palette: FatenPalette): Record<(typeof GRADIENTS)[number], Array<{ offset: string; color: string }>> {
  return {
    body: [
      { offset: '0%', color: palette.bodyFrom },
      { offset: '48%', color: palette.bodyMid },
      { offset: '100%', color: palette.bodyTo },
    ],
    cap: [
      { offset: '0%', color: palette.capFrom },
      { offset: '60%', color: palette.capMid },
      { offset: '100%', color: palette.capTo },
    ],
    face: [
      { offset: '0%', color: palette.faceFrom },
      { offset: '58%', color: palette.faceMid },
      { offset: '100%', color: palette.faceTo },
    ],
    chest: [
      { offset: '0%', color: palette.chestFrom },
      { offset: '50%', color: palette.chestMid },
      { offset: '100%', color: palette.chestTo },
    ],
    covert: [
      { offset: '0%', color: palette.covertFrom },
      { offset: '100%', color: palette.covertTo },
    ],
    primary: [
      { offset: '0%', color: palette.primaryFrom },
      { offset: '100%', color: palette.primaryTo },
    ],
    beak: [
      { offset: '0%', color: palette.beakFrom },
      { offset: '42%', color: palette.beakMid },
      { offset: '100%', color: palette.beakTo },
    ],
    iris: [
      { offset: '0%', color: palette.irisFrom },
      { offset: '50%', color: palette.irisMid },
      { offset: '100%', color: palette.irisTo },
    ],
  };
}

function eyesPrims(pose: FatenPose, palette: FatenPalette, eyeMode: FatenPose['eyes']) {
  const prims: import('./faten.paths').FatenPrim[] = [];
  for (const cx of EYE_CENTERS) {
    if (eyeMode === 'happy') {
      prims.push({ kind: 'path', d: happyEyeD(cx), stroke: { p: 'capTo' }, strokeWidth: 5.6, linecap: 'round' });
      prims.push({ kind: 'path', d: happyEyeInnerD(cx), stroke: { p: 'beakMid' }, strokeWidth: 1.8, linecap: 'round', opacity: 0.75 });
      continue;
    }
    if (eyeMode === 'closed') {
      prims.push({ kind: 'path', d: closedEyeD(cx), stroke: { p: 'capTo' }, strokeWidth: 4.6, linecap: 'round' });
      continue;
    }
    const closed = eyeMode === 'squint' ? Math.max(pose.squint, 0.45) : pose.squint;
    const base = eyeMode === 'sparkle' ? 14.6 : 14.2;
    const ry = base * (1 - Math.min(closed, 0.7) * 0.5);
    const cy = 72 - closed * 1.4;
    prims.push(...openEyePrims(cx, {
      cy,
      ry,
      eyeWhite: palette.eyeWhite,
      eyeRing: palette.eyeRing,
      pupil: palette.pupil,
      irisGradId: 'iris',
      angry: eyeMode === 'fierce',
      sparkle: eyeMode === 'sparkle',
    }));
  }
  return prims;
}

/** يبني المشهد كاملًا بالترتيب الصحيح للطبقات (من الخلف للأمام) */
export function buildFatenScene({ pose, palette, eyeMode, bare = false }: FatenSceneOptions): FatenPart[] {
  const parts: FatenPart[] = [];
  const effectiveEye = eyeMode ?? pose.eyes;

  if (!bare) {
    parts.push({ layer: 'aura', ...AURA, color: palette.aura, opacity: palette.auraOpacity });
  }
  parts.push({ layer: 'shadow', ...SHADOW, color: palette.shadow, opacity: palette.shadowOpacity });

  const head = pose.headTilt;
  const inner: import('./faten.paths').FatenPrim[] = [];

  // 1) الذيل المروحي
  inner.push({
    kind: 'group',
    transform: `translate(0 ${pose.tailWag})`,
    children: TAIL_FEATHERS.flatMap((f, i) => [
      {
        kind: 'group' as const,
        transform: `translate(${TAIL_ORIGIN.x} ${TAIL_ORIGIN.y}) rotate(${f.rot})`,
        children: [
          {
            kind: 'path' as const,
            d: tailFeatherD(f),
            fill: (i % 2 === 0 ? { p: 'primaryTo' } : { p: 'bodyTo' }) as import('./faten.paths').FatenPaint,
          },
          { kind: 'path' as const, d: tailRachisD(f, -1), stroke: { p: 'featherLine' } as const, strokeWidth: 2, linecap: 'round' as const, opacity: 0.45 },
          { kind: 'path' as const, d: tailRachisD(f, 1), stroke: { p: 'featherLine' } as const, strokeWidth: 1.6, linecap: 'round' as const, opacity: 0.3 },
        ],
      },
    ]),
  });

  // 2) الأرجل
  for (const d of LEG_SHANKS) {
    inner.push({ kind: 'path', d, stroke: { p: 'beakTo' }, strokeWidth: 8, linecap: 'round' });
  }
  for (const d of LEG_TOES) {
    inner.push({ kind: 'path', d, stroke: { p: 'beakMid' }, strokeWidth: 6.5, linecap: 'round' });
  }
  for (const d of LEG_CLAWS) {
    inner.push({ kind: 'path', d, stroke: { p: 'primaryTo' }, strokeWidth: 3.6, linecap: 'round' });
  }

  // 3) الجسم
  inner.push({ kind: 'path', d: BODY_D, fill: { grad: 'body' } });

  // 4) الأجنحة (طبقتان + أشرطة ريش)
  for (const side of ['left', 'right'] as const) {
    const root = wingRoot(side);
    const children: import('./faten.paths').FatenPrim[] = [
      { kind: 'path', d: wingPrimaryD(side), fill: { grad: 'primary' } },
      { kind: 'path', d: wingCovertD(side), fill: { grad: 'covert' } },
    ];
    for (const d of wingBarringD(side)) {
      children.push({ kind: 'path', d, stroke: { p: 'featherShade' }, strokeWidth: 2.4, linecap: 'round', opacity: 0.42 });
    }
    children.push({ kind: 'path', d: wingEdgeGlintD(side), stroke: { p: 'featherLine' }, strokeWidth: 1.7, linecap: 'round', opacity: 0.38 });
    // رفع خفيف للجناح عند الوضعيات المفتوحة: الدوران وحده يجعل الجناح «لوحًا»؛
    // الرفع يعطي إحساس الكتف الصقري المرفوع (Lift + Rotate).
    const lift = pose.wingAngle < -12 ? -4 : pose.wingAngle > 9 ? 2 : 0;
    inner.push({
      kind: 'group',
      transform: `translate(0 ${lift}) rotate(${pose.wingAngle * (side === 'left' ? -1 : 1)} ${root.cx} ${root.cy})`,
      children,
    });
  }

  // 5) الصدر
  inner.push({ kind: 'path', d: CHEST_D, fill: { grad: 'chest' } });
  for (const d of CHEST_MARKS) {
    inner.push({ kind: 'path', d, fill: { p: 'bodyMid' }, opacity: 0.3 });
  }
  inner.push({ kind: 'path', d: CHEST_BOTTOM_LINE, stroke: { p: 'featherLine' }, strokeWidth: 2.4, linecap: 'round', opacity: 0.5 });

  // 6) ثنية الرقبة: قوس رفيع أسفل الرأس (فصل بصري خفيف — القوس العريض كان يُقرأ
  //    كـ«فم مفتوح» على الصدر، فخفّضناه إلى خط واحد رقيق)
  inner.push({
    kind: 'path',
    d: 'M74 122 C82 132 118 132 126 122 C120 130 112 134 100 134 C88 134 80 130 74 122 Z',
    fill: { p: 'bodyTo' },
    opacity: 0.1,
  });

  // 7) الرأس: القرص الوجهي + القبعة الداكنة + شريط الوجنة
  inner.push({ kind: 'ellipse', ...FACE, fill: { grad: 'face' } });
  inner.push({ kind: 'path', d: CAP_D, fill: { grad: 'cap' } });
  inner.push({ kind: 'path', d: capMalarD('left'), fill: { grad: 'cap' }, opacity: 0.92 });
  inner.push({ kind: 'path', d: capMalarD('right'), fill: { grad: 'cap' }, opacity: 0.92 });
  inner.push({ kind: 'path', d: capCheekD('left'), fill: { grad: 'cap' }, opacity: 0.86 });
  inner.push({ kind: 'path', d: capCheekD('right'), fill: { grad: 'cap' }, opacity: 0.86 });
  inner.push({ kind: 'path', d: HEAD_SHEEN_D, fill: '#FFFFFF', opacity: 0.1 });

  // 8) الوجنتان
  for (const b of BLUSH) {
    inner.push({ kind: 'ellipse', ...b, fill: { p: 'blush' }, opacity: 0.34 });
  }

  // 9) العينان + الحاجب الصقري
  inner.push(...eyesPrims(pose, palette, effectiveEye));
  inner.push({ kind: 'path', d: browD('left', pose.browAngle), fill: { p: 'capMid' } });
  inner.push({ kind: 'path', d: browD('right', pose.browAngle), fill: { p: 'capMid' } });

  // 10) المنقار المعقوف
  inner.push({
    kind: 'group',
    transform: `translate(0 ${pose.mouthOpen})`,
    children: [
      { kind: 'path', d: BEAK_D, fill: { grad: 'beak' } },
      { kind: 'path', d: BEAK_HIGHLIGHT_D, fill: '#FFFFFF', opacity: 0.32 },
      { kind: 'path', d: BEAK_SEAM_D, stroke: { p: 'beakTo' }, strokeWidth: 2, linecap: 'round', opacity: 0.45 },
      { kind: 'path', d: BEAK_TIP_D, fill: { p: 'beakTo' }, opacity: 0.6 },
    ],
  });

  // 11) العرف
  inner.push({
    kind: 'group',
    transform: `translate(104 34) rotate(${pose.crestPerk * 9}) translate(-104 -34)`,
    children: [
      { kind: 'path', d: crestPrimaryD(pose.crestPerk), fill: { p: 'crestFrom' } },
      { kind: 'path', d: crestSecondaryD(pose.crestPerk), fill: { p: 'crestTo' } },
      { kind: 'path', d: crestGlintD, stroke: { p: 'featherLine' }, strokeWidth: 1.6, linecap: 'round', opacity: 0.38 },
    ],
  });

  // 12) الأكسسوار
  const accessory = accessoryPrims(pose.accessory);
  if (accessory.length > 0) inner.push({ kind: 'group', transform: 'translate(0 0)', children: accessory });

  // 13) لمعان الحافة
  inner.push({ kind: 'path', d: HIGHLIGHT_D, stroke: '#FFFFFF', strokeWidth: 3.4, linecap: 'round', opacity: 0.14 });

  parts.push({ layer: 'group', transform: `rotate(${head} 100 150)`, children: inner });
  return parts;
}

export { FATEN_VIEWBOX };
