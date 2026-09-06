/**
 * design/components/GlassBtn.tsx — زر زجاجي تفاعلي مع نوابض Apple Fluid Interfaces
 * يدعم شفافية أنيقة، حد رفيع لامع، واشتداد في التأثير عند الضغط مع Haptics
 */
import React, { useRef } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme';
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
  const { theme, isDark, themeName } = useTheme();
  const oled = themeName === 'oled';
  const reduced = isReducedMotion();

  const scaleAnim = useRef(new Animated.Value(1)).current;
  const pressAnim = useRef(new Animated.Value(0)).current;

  const height =
    size === 'sm' ? 38 : size === 'lg' ? sizes.ctaButton : 44;

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

  const baseBorderColor =
    variant === 'danger'
      ? theme.danger
      : isDark
      ? 'rgba(255, 255, 255, 0.16)'
      : 'rgba(0, 122, 255, 0.22)';

  const baseBg =
    variant === 'danger'
      ? 'rgba(239, 68, 68, 0.12)'
      : isDark
      ? oled
        ? 'rgba(255, 255, 255, 0.08)'
        : 'rgba(30, 41, 59, 0.65)'
      : 'rgba(255, 255, 255, 0.65)';

  const textColor =
    variant === 'danger'
      ? theme.danger
      : variant === 'highlight'
      ? theme.brand
      : theme.text;

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
            backgroundColor: baseBg,
            borderColor: baseBorderColor,
            borderRadius: radii.button,
          },
          style,
        ]}
      >
        {Platform.OS !== 'android' && (
          <BlurView
            intensity={isDark ? 28 : 45}
            tint={isDark ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
        )}

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
  const { theme, isDark } = useTheme();
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
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: isDark
              ? 'rgba(255, 255, 255, 0.1)'
              : 'rgba(255, 255, 255, 0.75)',
            borderColor: isDark
              ? 'rgba(255, 255, 255, 0.18)'
              : 'rgba(0, 122, 255, 0.18)',
          },
          style,
        ]}
      >
        {Platform.OS !== 'android' && (
          <BlurView
            intensity={35}
            tint={isDark ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
        )}
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
    paddingHorizontal: spacing.md,
  },
  iconBtnBase: {
    overflow: 'hidden',
    borderWidth: 1.2,
    alignItems: 'center',
    justifyContent: 'center',
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
    right: -2,
    backgroundColor: '#EF4444',
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 1.5,
    borderColor: '#FFF',
  },
});
