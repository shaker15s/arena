/**
 * design/components/LiquidGlassCard.tsx
 * @deprecated الاسم محفوظ للتوافق؛ بطاقات المحتوى أصبحت صلبة، والزجاج محصور في
 * التنقل/التحكم عبر GlassSurface. لا تُضف Blur أو لمعانًا إلى بطاقة بيانات.
 */
import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { useA11yPrefsOptional } from '../preferences';
import { borderWidth, radii, shadows, spacing } from '../tokens';

export interface LiquidGlassCardProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** @deprecated تُهمل؛ بطاقة المحتوى لا تستخدم Blur. */
  intensity?: number;
  /** @deprecated تُهمل؛ لا توهج زخرفيًا على بطاقات البيانات. */
  glowColor?: string;
  borderColor?: string;
  /** @deprecated تُهمل؛ لا حواف لمعان زخرفية. */
  hasShimmerBorder?: boolean;
}

/** توافق خلفي لاسم قديم؛ المظهر الفعلي سطح محتوى واضح وغير شفاف. */
export function LiquidGlassCard({ children, style, borderColor }: LiquidGlassCardProps) {
  const { theme, isDark } = useTheme();
  const preferences = useA11yPrefsOptional();
  const highContrast = preferences?.highContrast ?? false;

  return (
    <View
      style={[
        {
          backgroundColor: theme.card,
          borderRadius: radii.xl,
          borderWidth: highContrast ? borderWidth.medium : borderWidth.thin,
          borderColor: borderColor ?? (highContrast ? theme.textMuted : theme.fillBorder),
          padding: spacing.s4,
          shadowColor: theme.glassShadow,
          ...(isDark ? shadows.card.dark : shadows.card.light),
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
