/**
 * design/mascot/FatenArt.tsx — طبقة عرض رسم «صقر مسار» (Faten 3.0)
 *
 * هذا الملف **رقيق عن قصد**: كل الهندسة في `faten.paths.ts` وتركيب المشهد في
 * `faten.scene.ts`. هنا نحوّل المشهد إلى عناصر react-native-svg فقط.
 *
 * لماذا؟ لأن نفس المشهد يُولِّد دليلًا بصريًا في `docs/faten/` من سكربت Node
 * (بلا React)، فأي تعديل في الشكل يظهر في التوثيق في نفس اللحظة بلا نسخة مكرّرة.
 *
 * إصلاح عيب حقيقي: معرّفات التدرجات كانت ثابتة (`falconBodyGrad`) فتتصادم عند
 * وجود أكثر من تميمة في الشاشة (تدرجات خاطئة على الويب) — الآن كل مثيل يحمل
 * معرّفات فريدة عبر `useId`.
 */
import React, { useId } from 'react';
import Svg, {
  Circle, Defs, Ellipse, G, LinearGradient, Path, Polygon, RadialGradient, Stop,
} from 'react-native-svg';
import { FATEN_DARK, FATEN_LIGHT, FatenPalette } from './faten.palette';
import { FATEN_BASE_POSE, FatenEyeMode, FatenPose } from './faten.pose';
import { buildFatenScene, sceneGradients, type FatenPart } from './faten.scene';
import type { FatenPaint, FatenPrim } from './faten.paths';
import { FATEN_VIEWBOX } from './faten.paths';

export { FATEN_VIEWBOX };

export interface FatenArtProps {
  size?: number;
  pose?: FatenPose;
  palette?: FatenPalette;
  colorMode?: 'light' | 'dark';
  /** تجاوز مؤقت لوضع العين (يستخدمه الرمش) */
  eyeMode?: FatenEyeMode;
  /** إخفاء الهالة (للاستخدامات الصغيرة/الزخرفية) */
  bare?: boolean;
}

function resolvePaint(paint: FatenPaint | undefined, palette: FatenPalette, ids: Record<string, string>): string | undefined {
  if (paint === undefined) return undefined;
  if (typeof paint === 'string') return paint;
  if ('p' in paint) return palette[paint.p] as string;
  return `url(#${ids[paint.grad]})`;
}

function renderPrim(prim: FatenPrim, palette: FatenPalette, ids: Record<string, string>, key: number | string) {
  switch (prim.kind) {
    case 'path':
      return (
        <Path
          key={key}
          d={prim.d}
          fill={resolvePaint(prim.fill, palette, ids) ?? 'none'}
          stroke={resolvePaint(prim.stroke, palette, ids)}
          strokeWidth={prim.strokeWidth}
          strokeLinecap={prim.linecap}
          strokeLinejoin={prim.linejoin}
          opacity={prim.opacity}
        />
      );
    case 'circle':
      return (
        <Circle
          key={key}
          cx={prim.cx}
          cy={prim.cy}
          r={prim.r}
          fill={resolvePaint(prim.fill, palette, ids) ?? 'none'}
          stroke={resolvePaint(prim.stroke, palette, ids)}
          strokeWidth={prim.strokeWidth}
          opacity={prim.opacity}
        />
      );
    case 'ellipse':
      return (
        <Ellipse
          key={key}
          cx={prim.cx}
          cy={prim.cy}
          rx={prim.rx}
          ry={prim.ry}
          fill={resolvePaint(prim.fill, palette, ids) ?? 'none'}
          stroke={resolvePaint(prim.stroke, palette, ids)}
          strokeWidth={prim.strokeWidth}
          opacity={prim.opacity}
        />
      );
    case 'polygon':
      return (
        <Polygon
          key={key}
          points={prim.points}
          fill={resolvePaint(prim.fill, palette, ids) ?? 'none'}
          stroke={resolvePaint(prim.stroke, palette, ids)}
          strokeWidth={prim.strokeWidth}
          opacity={prim.opacity}
        />
      );
    case 'group':
      return (
        <G key={key} transform={prim.transform}>
          {prim.children.map((child, i) => renderPrim(child, palette, ids, i))}
        </G>
      );
    default:
      return null;
  }
}

function renderPart(part: FatenPart, palette: FatenPalette, ids: Record<string, string>, index: number) {
  switch (part.layer) {
    case 'aura':
      return <Ellipse key={`aura-${index}`} cx={part.cx} cy={part.cy} rx={part.rx} ry={part.ry} fill={`url(#${ids.aura})`} />;
    case 'shadow':
      return <Ellipse key={`shadow-${index}`} cx={part.cx} cy={part.cy} rx={part.rx} ry={part.ry} fill={part.color} opacity={part.opacity} />;
    case 'group':
      return (
        <G key={`group-${index}`} transform={part.transform}>
          {part.children.map((child, i) => renderPrim(child, palette, ids, i))}
        </G>
      );
    case 'geometry':
      return renderPrim(part.node, palette, ids, index);
    default:
      return null;
  }
}

export function FatenArt({
  size = 110,
  pose = FATEN_BASE_POSE,
  palette,
  colorMode = 'light',
  eyeMode,
  bare = false,
}: FatenArtProps) {
  const rawId = useId();
  const uid = `f${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const p = palette ?? (colorMode === 'dark' ? FATEN_DARK : FATEN_LIGHT);
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

  const scene = buildFatenScene({ pose, palette: p, eyeMode, bare });
  const gradients = sceneGradients(p);
  const width = size;
  const height = size * (FATEN_VIEWBOX.h / FATEN_VIEWBOX.w);

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${FATEN_VIEWBOX.w} ${FATEN_VIEWBOX.h}`} fill="none">
      <Defs>
        <RadialGradient id={ids.aura} cx="50%" cy="46%" r="52%">
          <Stop offset="52%" stopColor={p.aura} stopOpacity={p.auraOpacity} />
          <Stop offset="100%" stopColor={p.aura} stopOpacity={0} />
        </RadialGradient>
        {(Object.keys(gradients) as Array<keyof typeof gradients>).map((name) => (
          <LinearGradient
            key={name}
            id={ids[name]}
            x1={name === 'iris' ? '36%' : name === 'face' ? '30%' : '0%'}
            y1="0%"
            x2={name === 'iris' ? '36%' : '100%'}
            y2="100%"
          >
            {gradients[name].map((stop, i) => (
              <Stop key={i} offset={stop.offset} stopColor={stop.color} />
            ))}
          </LinearGradient>
        ))}
      </Defs>

      {scene.map((part, i) => renderPart(part, p, ids, i))}
    </Svg>
  );
}

export default FatenArt;
