/**
 * design/components/GlassBtn.tsx — زر زجاجي تفاعلي مع نوابض Apple Fluid Interfaces
 * يدعم شفافية أنيقة، حد رفيع لامع، واشتداد في التأثير عند الضغط مع Haptics
 */
import React, { useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../theme';
import { Txt } from '../components';
import { radii, sizes, spacing } from '../tokens';
import { isReducedMotion } from '../motion';
import { FunctionalGlass } from '../surfaces';

export type BtnKind = 'primary' | 'secondary' | 'tertiary' | 'glass';

export interface GlassBtnProps {
  label: string;
  onPress: () => void;
  icon?: React.ReactNode;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'subtle' | 'highlight' | 'danger' | BtnKind;
  kind?: BtnKind;
}

export function GlassBtn({
  label,
  onPress,
  icon,
  disabled = false,
  style,
  size = 'md',
  variant = 'subtle',
  kind,
}: GlassBtnProps) {
  const { theme, isDark } = useTheme();
  const reduced = isReducedMotion();

  const scaleAnim = useRef(new Animated.Value(1)).current;
  const pressAnim = useRef(new Animated.Value(0)).current;

  // Touch Target: الحد الأدنى 44px لجميع المقاسات بما فيها sm (معيار Apple HIG وWCAG)
  const height = size === 'lg' ? sizes.ctaButton : sizes.touchTarget;

  const handlePressIn = () => {
    if (disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (!reduced) {
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 0.96,
          useNativeDriver: true,
          friction: 4,
          tension: 180,
        }),
        Animated.timing(pressAnim, {
          toValue: 1,
          duration: 120,
          useNativeDriver: true,
        }),
      ]).start();
    }
  };

  const handlePressOut = () => {
    if (!reduced) {
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          useNativeDriver: true,
          friction: 4,
          tension: 180,
        }),
        Animated.timing(pressAnim, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    }
  };

  // تعيين النوع الفعلي: primary | secondary | tertiary | glass
  const isDanger = variant === 'danger';
  const effectiveKind: BtnKind = kind ?? (
    variant === 'highlight' ? 'primary'
    : variant === 'subtle' ? 'glass'
    : variant === 'danger' ? 'primary'
    : (variant as BtnKind) ?? 'glass'
  );

  let baseBg: string;
  let baseBorderColor: string;
  let textColor: string;

  if (isDanger) {
    baseBg = 'rgba(239, 68, 68, 0.12)';
    baseBorderColor = theme.danger;
    textColor = theme.danger;
  } else if (effectiveKind === 'primary') {
    baseBg = theme.actionPrimary;
    baseBorderColor = theme.actionPrimary;
    textColor = theme.onBrand;
  } else if (effectiveKind === 'secondary') {
    baseBg = theme.fill;
    baseBorderColor = theme.fillBorder;
    textColor = theme.brandText;
  } else if (effectiveKind === 'tertiary') {
    baseBg = 'transparent';
    baseBorderColor = 'transparent';
    textColor = theme.textSecondary;
  } else {
    // kind === 'glass'
    baseBg = theme.surfaceGlass;
    baseBorderColor = isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 122, 255, 0.22)';
    textColor = theme.text;
  }

  return (
    <Animated.View
      style={[
        { transform: [{ scale: scaleAnim }] },
        disabled && { opacity: 0.4 },
      ]}
    >
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[
          styles.btnBase,
          {
            height,
            backgroundColor: effectiveKind === 'glass' ? 'transparent' : baseBg,
            borderColor: baseBorderColor,
            borderRadius: radii.lg,
          },
          style,
        ]}
      >
        {effectiveKind === 'glass' ? (
          <FunctionalGlass kind="control" style={StyleSheet.absoluteFill} />
        ) : null}

        <View style={styles.contentRow}>
          {icon ? <View style={styles.iconSlot}>{icon}</View> : null}
          <Txt
            variant={size === 'sm' ? 'caption' : 'bodyMed'}
            bold
            color={textColor}
          >
            {label}
          </Txt>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/** زر دائري زجاجي بقياس 44px (معيار Apple للحجم الأدنى للمس) */
export function IconGlassButton({
  icon,
  onPress,
  size = 44,
  accessibilityLabel,
  style,
  badge,
}: {
  icon: React.ReactNode;
  onPress: () => void;
  size?: number;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  badge?: number | string;
}) {
  const effectiveSize = Math.max(sizes.touchTarget, size);
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Animated.spring(scaleAnim, {
      toValue: 0.92,
      useNativeDriver: true,
      friction: 4,
      tension: 180,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      friction: 4,
      tension: 180,
    }).start();
  };

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }]}>
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={[
          styles.iconBtnBase,
          {
            width: effectiveSize,
            height: effectiveSize,
            borderRadius: effectiveSize / 2,
          },
          style,
        ]}
      >
        <FunctionalGlass
          kind="control"
          style={[StyleSheet.absoluteFill, { borderRadius: effectiveSize / 2 }]}
        />
        {icon}
        {badge !== undefined ? (
          <View style={styles.badge}>
            <Txt variant="micro" bold color="#FFF">
              {badge}
            </Txt>
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  btnBase: {
    overflow: 'hidden',
    borderWidth: 1.2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.s4,
    minHeight: sizes.touchTarget,
    minWidth: sizes.touchTarget,
  },
  iconBtnBase: {
    overflow: 'hidden',
    borderWidth: 1.2,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: sizes.touchTarget,
    minWidth: sizes.touchTarget,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  iconSlot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -2,
    end: -2,
    backgroundColor: '#EF4444',
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 1.5,
    borderColor: '#FFF',
  },
});
