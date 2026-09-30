/**
 * design/illustrations/EmptyStateIllustration.tsx
 * رسم توضيحي متجه احترافي جاهز للحالات الفارغة (unDraw / Storyset style)
 */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';

export function EmptyStateIllustration({ size = 180 }: { size?: number }) {
  const [xml, setXml] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    void import('./svgStrings').then((m) => {
      if (mounted) setXml(m.EMPTY_STATE_SVG);
    });
    return () => { mounted = false; };
  }, []);
  if (!xml) return <View style={{ width: size, height: size * 0.85 }} />;
  return <SvgXml xml={xml} width={size} height={size * 0.85} />;
}
