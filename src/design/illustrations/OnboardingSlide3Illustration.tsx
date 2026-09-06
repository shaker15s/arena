/**
 * design/illustrations/OnboardingSlide3Illustration.tsx
 * رسم توضيحي متجه احترافي جاهز لشريحة الشهادات المعتمدة والاحتفال (unDraw / Storyset style)
 */
import React from 'react';
import { SvgXml } from 'react-native-svg';
import { SLIDE3_SVG } from './svgStrings';

export function OnboardingSlide3Illustration({ size = 220 }: { size?: number }) {
  return <SvgXml xml={SLIDE3_SVG} width={size} height={size * 0.85} />;
}
