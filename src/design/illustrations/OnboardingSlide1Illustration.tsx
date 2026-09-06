/**
 * design/illustrations/OnboardingSlide1Illustration.tsx
 * رسم توضيحي متجه احترافي جاهز لشريحة الجدول الذكي والمحاضرات (unDraw / Storyset style)
 */
import React from 'react';
import { SvgXml } from 'react-native-svg';
import { SLIDE1_SVG } from './svgStrings';

export function OnboardingSlide1Illustration({ size = 220 }: { size?: number }) {
  return <SvgXml xml={SLIDE1_SVG} width={size} height={size * 0.85} />;
}
