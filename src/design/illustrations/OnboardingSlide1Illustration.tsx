/**
 * design/illustrations/OnboardingSlide1Illustration.tsx
 * رسم توضيحي متجه احترافي جاهز لشريحة الجدول الذكي والمحاضرات (unDraw / Storyset style)
 */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';

export function OnboardingSlide1Illustration({ size = 220 }: { size?: number }) {
  const [xml, setXml] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    void import('./svgStrings').then((m) => {
      if (mounted) setXml(m.SLIDE1_SVG);
    });
    return () => { mounted = false; };
  }, []);
  if (!xml) return <View style={{ width: size, height: size * 0.85 }} />;
  return <SvgXml xml={xml} width={size} height={size * 0.85} />;
}
