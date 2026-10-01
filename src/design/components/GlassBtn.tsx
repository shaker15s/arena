/**
 * design/components/GlassBtn.tsx — عناصر تحكم زجاجية عائمة، فوق محوّل المادة المشترك.
 * الأسطح الزجاجية محصورة هنا في أدوات التحكم الثانوية؛ الأفعال الأساسية تبقى مصمتة.
 */
import React, { useRef, useState } from 'react';
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
import { GlassSurface } from '../glass';
import { Txt } from '../components';
import { radii, sizes, spacing } from '../tokens';
import { isReducedMotion } from '../motion';

export interface GlassBtnProps {
  label: string;
  onPress: () => void;
  icon?: React.ReactNode;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'subtle' | 'highlight' | 'danger';
}

export function GlassBtn({
  label,
  onPress,
  icon,
  disabled = false,
  style,
  size = 'md',
  variant = 'subtle',
}: GlassBtnProps) {
  const { theme } = useTheme();
  const reduced = isReducedMotion();
  const [focused, setFocused] = useState(false);
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const height = size === 'lg' ? sizes.ctaButton : sizes.touchTarget;
  const textColor = variant === 'danger'
    ? theme.textDanger
    : variant === 'highlight'
      ? theme.brandText
      : theme.text;
  const borderColor = variant === 'danger'
    ? theme.danger
    : variant === 'highlight'
      ? theme.brand
      : theme.fillBorder;

  const animateScale = (toValue: number) => {
    if (reduced || disabled) return;
    Animated.spring(scaleAnim, {
      toValue,
      useNativeDriver: true,
      friction: 5,
      tension: 220,
    }).start();
  };

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }, disabled && { opacity: 0.55 }]}>
      <Pressable
        onPress={onPress}
        onPressIn={() => {
          if (disabled) return;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          animateScale(0.98);
        }}
        onPressOut={() => animateScale(1)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={disabled}
        focusable={!disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        style={({ pressed }) => [
          styles.btnBase,
          {
            minHeight: height,
            borderColor: focused ? theme.focusRing : borderColor,
            borderWidth: focused ? 2 : 1,
            borderRadius: radii.lg,
            opacity: pressed && !reduced ? 0.9 : 1,
          },
          style,
        ]}
      >
        <GlassSurface radius={radii.lg} borderless style={StyleSheet.absoluteFill} />
        <View style={styles.contentRow}>
          {icon ? <View style={styles.iconSlot}>{icon}</View> : null}
          <Txt variant={size === 'sm' ? 'caption' : 'bodyMed'} bold color={textColor}>
            {label}
          </Txt>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/** زر أيقونة عائم مع هدف لمس لا يقل عن 44pt. */
export function IconGlassButton({
  icon,
  onPress,
  size = sizes.iconButton,
  accessibilityLabel,
  style,
  badge,
  disabled = false,
}: {
  icon: React.ReactNode;
  onPress: () => void;
  size?: number;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  badge?: number | string;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  const [focused, setFocused] = useState(false);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const targetSize = Math.max(size, sizes.iconButton);
  const reduced = isReducedMotion();

  const animateScale = (toValue: number) => {
    if (reduced || disabled) return;
    Animated.spring(scaleAnim, {
      toValue,
      useNativeDriver: true,
      friction: 5,
      tension: 220,
    }).start();
  };

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }, disabled && { opacity: 0.55 }]}>
      <Pressable
        onPress={onPress}
        onPressIn={() => {
          if (disabled) return;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          animateScale(0.96);
        }}
        onPressOut={() => animateScale(1)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={disabled}
        focusable={!disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
        style={({ pressed }) => [
          styles.iconBtnBase,
          {
            width: targetSize,
            height: targetSize,
            borderRadius: targetSize / 2,
            borderColor: focused ? theme.focusRing : theme.fillBorder,
            borderWidth: focused ? 2 : 1,
            opacity: pressed && !reduced ? 0.88 : 1,
          },
          style,
        ]}
      >
        <GlassSurface radius={targetSize / 2} borderless style={StyleSheet.absoluteFill} />
        {icon}
        {badge !== undefined ? (
          <View style={[styles.badge, { backgroundColor: theme.danger, borderColor: theme.card }]}>
            <Txt variant="micro" bold color="#FFFFFF">{badge}</Txt>
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  btnBase: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.s4,
    backgroundColor: 'transparent',
  },
  iconBtnBase: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.s2,
  },
  iconSlot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 1,
    end: 1,
    minWidth: 18,
    minHeight: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
});
