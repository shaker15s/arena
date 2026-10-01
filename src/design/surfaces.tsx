/**
 * design/surfaces.tsx — أسطح نظام التصميم مسار (Surfaces & Layering Architecture).
 *
 * القواعد الملزمة (توجيه §2/§4/§27):
 * 1. Surface: طبقة المحتوى الأساسية — بلا ضبابية (intensity={0}) دائمًا.
 * 2. ElevatedSurface: بطاقة مرفوعة بظل أعمق وبلا ضبابية (intensity={0}) دائمًا.
 * 3. FunctionalGlass: الطبقة الزجاجية الوظيفية العائمة فقط (شريط التبويبات، القوائم، الألواح، الكاميرا).
 *    المكوّن الوحيد المسموح له بـ intensity > 0.
 */
import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { useTheme } from './theme';
import { glass, radii, shadows, spacing } from './tokens';
import { GlassSurface } from './glass';

export interface SurfaceProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  emphasis?: 'default' | 'hero';
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

/**
 * Surface: طبقة المحتوى الأساسية (Content layer).
 * لا ضبابية أبدًا (intensity={0}).
 */
export function Surface({
  children,
  style,
  emphasis = 'default',
  accessibilityLabel,
  accessibilityHint,
}: SurfaceProps) {
  const { theme, isDark } = useTheme();
  const pad = emphasis === 'hero' ? spacing.s6 : spacing.s4;
  const cardShadow = isDark ? shadows.card.dark : shadows.card.light;

  return (
    <GlassSurface
      intensity={0}
      radius={radii.xl}
      tintColor={theme.card}
      accessibilityRole="region"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={[
        {
          padding: pad,
          shadowColor: theme.glassShadow,
          ...cardShadow,
        },
        style,
      ]}
    >
      {children}
    </GlassSurface>
  );
}

export interface ElevatedSurfaceProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  emphasis?: 'default' | 'hero';
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

/**
 * ElevatedSurface: بطاقة مرفوعة بظل أعمق (elevation 2..3) ومحتوى صلب بلا ضبابية (intensity={0}).
 */
export function ElevatedSurface({
  children,
  style,
  radius = radii.xl,
  emphasis = 'default',
  accessibilityLabel,
  accessibilityHint,
}: ElevatedSurfaceProps) {
  const { theme, isDark } = useTheme();
  const pad = emphasis === 'hero' ? spacing.s6 : spacing.s4;

  return (
    <GlassSurface
      intensity={0}
      radius={radius}
      tintColor={theme.cardElevated || theme.card}
      accessibilityRole="region"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={[
        {
          padding: pad,
          shadowColor: theme.glassShadow,
          shadowOpacity: isDark ? 0.35 : 0.12,
          shadowRadius: 28,
          shadowOffset: { width: 0, height: 12 },
          elevation: 12,
        },
        style,
      ]}
    >
      {children}
    </GlassSurface>
  );
}

export type FunctionalGlassKind = 'tabBar' | 'toolbar' | 'sheet' | 'popover' | 'scanner' | 'control';

export interface FunctionalGlassProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  kind: FunctionalGlassKind;
}

/**
 * FunctionalGlass: الزجاج الوظيفي للكروم العائم فقط (النافيجيشن، الألواح، النوافذ المنبثقة، أزرار التحكم العائمة).
 * المكوّن الوحيد في التطبيق المسموح له بضبابية خلفية (intensity > 0).
 */
export function FunctionalGlass({
  children,
  style,
  kind,
}: FunctionalGlassProps) {
  const { theme } = useTheme();
  const level = (kind === 'scanner' || kind === 'sheet') ? glass.sheet : glass.floating;
  const tint = (kind === 'sheet' || kind === 'popover') ? theme.backdropBlur : theme.surfaceGlass;
  const radius = kind === 'control' ? radii.md : radii.xl;

  return (
    <GlassSurface
      intensity={level.intensity}
      tintColor={tint}
      radius={radius}
      style={style}
    >
      {children}
    </GlassSurface>
  );
}
