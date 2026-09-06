/**
 * design/illustrations/OnboardingSlide2Illustration.tsx
 * رسم توضيحي متجه احترافي جاهز لشريحة الحضور الذكي والـ QR (unDraw / Storyset style)
 */
import React from 'react';
import { SvgXml } from 'react-native-svg';
import { SLIDE2_SVG } from './svgStrings';

export function OnboardingSlide2Illustration({ size = 220 }: { size?: number }) {
  return <SvgXml xml={SLIDE2_SVG} width={size} height={size * 0.85} />;
}
