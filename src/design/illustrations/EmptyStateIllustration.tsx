/**
 * design/illustrations/EmptyStateIllustration.tsx
 * رسم توضيحي متجه احترافي جاهز للحالات الفارغة (unDraw / Storyset style)
 */
import React from 'react';
import { SvgXml } from 'react-native-svg';
import { EMPTY_STATE_SVG } from './svgStrings';

export function EmptyStateIllustration({ size = 180 }: { size?: number }) {
  return <SvgXml xml={EMPTY_STATE_SVG} width={size} height={size * 0.85} />;
}
