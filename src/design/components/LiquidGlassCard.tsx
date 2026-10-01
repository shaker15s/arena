/**
 * design/components/LiquidGlassCard.tsx
 *
 * @deprecated LiquidGlassCard is deprecated in favor of ElevatedSurface (Directive §7).
 * Content surfaces must not have real-time blur. Use ElevatedSurface from `src/design/surfaces`.
 */
import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { ElevatedSurface } from '../surfaces';

export interface LiquidGlassCardProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
  glowColor?: string;
  borderColor?: string;
  hasShimmerBorder?: boolean;
}

/**
 * @deprecated LiquidGlassCard is deprecated. Use ElevatedSurface from `src/design/surfaces` instead.
 */
export function LiquidGlassCard({
  children,
  style,
}: LiquidGlassCardProps) {
  if (__DEV__) {
    console.warn('[DEPRECATED] LiquidGlassCard is deprecated. Use ElevatedSurface from src/design/surfaces instead.');
  }

  return (
    <ElevatedSurface emphasis="hero" style={style}>
      {children}
    </ElevatedSurface>
  );
}
