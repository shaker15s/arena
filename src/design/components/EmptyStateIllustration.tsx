/**
 * design/components/EmptyStateIllustration.tsx
 * رسم توضيحي متجه احترافي للحالات الفارغة (unDraw / Storyset style).
 * مكوّن مركزي يدعم التحميل الكسول للـSVG واحتياطي فوري (fallback).
 */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';

export interface EmptyStateIllustrationProps {
  size?: number;
  fallback?: React.ReactNode;
}

export function EmptyStateIllustration({
  size = 180,
  fallback,
}: EmptyStateIllustrationProps) {
  const [xml, setXml] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void import('../illustrations/svgStrings').then((m) => {
      if (mounted) setXml(m.EMPTY_STATE_SVG);
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (!xml) {
    return fallback ? <>{fallback}</> : <View style={{ width: size, height: size * 0.85 }} />;
  }

  return <SvgXml xml={xml} width={size} height={size * 0.85} />;
}
