/**
 * design/glass.tsx — أسطح الزجاج (Liquid Glass) بأسلوب Apple.
 * الزجاج الحقيقي (BlurView) للطبقات العائمة فقط — البطاقات تستخدم surfaceGlass من التوكنز.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, View, ViewStyle, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from './theme';
import { radii, spacing, typography } from './tokens';
import { isReducedMotion } from './motion';

/**
 * سطح زجاجي حقيقي (Apple Liquid Glass): ضبابية خلفية + طبقة لون شفافة
 * + حد فاتح علوي. يُستخدم للطبقات العائمة فقط (شاشة الدخول، البوب‌أوف) — لا يُتعشّش داخل بطاقات.
 */
export function GlassSurface({
  children, style, radius = radii.card, tintColor, intensity = 40, borderless,
}: {
  children?: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  radius?: number;
  tintColor?: string;
  intensity?: number;
  borderless?: boolean;
}) {
  const { theme, isDark } = useTheme();
  return (
    <View style={[{ borderRadius: radius, overflow: 'hidden' }, Platform.OS === 'web' ? { backdropFilter: 'blur(20px) saturate(180%)', WebkitBackdropFilter: 'blur(20px) saturate(180%)' } as any : null, style]}>
      <BlurView
        intensity={intensity}
        tint={isDark ? 'dark' : 'light'}
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: tintColor ?? theme.glass,
            borderRadius: radius,
            borderWidth: borderless ? 0 : 1,
            borderColor: theme.glassBorder,
          },
        ]}
      />
      {children}
    </View>
  );
}

// ═══════════════ Ambient background ═══════════════
function AmbientOrb({
  size, color, style, drift = 18,
}: {
  size: number;
  color: string;
  style: ViewStyle;
  drift?: number;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (isReducedMotion()) return undefined;
    // موجتان عند دخول الشاشة ثم سكون — لا حلقة GPU دائمة
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(progress, { toValue: 1, duration: 9000, useNativeDriver: true }),
      Animated.timing(progress, { toValue: 0, duration: 9000, useNativeDriver: true }),
    ]), { iterations: 2 });
    loop.start();
    return () => loop.stop();
  }, [progress]);

  const animatedTransform = isReducedMotion()
    ? []
    : [
        { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, drift] }) },
        { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -drift * 0.6] }) },
        { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) },
      ];

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute', width: size, height: size, borderRadius: size / 2,
          backgroundColor: color,
          transform: animatedTransform,
        },
        style,
      ]}
    />
  );
}

export function AppBackground({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const { theme, isDark } = useTheme();
  return (
    <View style={[{ flex: 1, backgroundColor: theme.bg, overflow: 'hidden' }, style]}>
      <LinearGradient
        colors={[theme.bgGradientFrom, theme.bgGradientTo]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <AmbientOrb size={420} color={theme.orbPrimary} style={{ top: -190, right: -115 }} />
      <AmbientOrb size={460} color={theme.orbSecondary} drift={-22} style={{ bottom: -180, left: -160 }} />
      <AmbientOrb size={230} color={theme.orbTertiary} drift={12} style={{ top: '36%' as any, left: -90 }} />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, {
        borderWidth: Platform.OS === 'web' ? 1 : 0,
        borderColor: isDark ? 'rgba(255,255,255,0.015)' : 'rgba(255,255,255,0.2)',
      }]} />
      {children}
    </View>
  );
}

/** يثبت اتساع المحتوى على الويب/التابلت مع بقاء الموبايل بعرضه الكامل. */
export function ContentFrame({ children, style, maxWidth = 1120 }: {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  maxWidth?: number;
}) {
  return (
    <View style={[{ width: '100%', maxWidth, alignSelf: 'center' }, style]}>
      {children}
    </View>
  );
}

/** بطاقة زجاجية ساكنة (بلا ضبابية) — للطبقة المحتوى. الضبابية للطبقات العائمة فقط. */
export function GlassCard({ children, style }: {
  children?: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
}) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: theme.glass,
          borderRadius: radii.card,
          borderWidth: 1,
          borderColor: theme.glassBorder,
          padding: spacing.s4,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// ═══════════════ Stat Bubble (Glass Metric) ═══════════════
export function StatBubble({ value, label, icon, color, onPress, onLongPress }: {
  value: string | number;
  label: string;
  icon?: React.ReactNode;
  color?: string;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${label} ${value}`}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => ({
        flex: 1,
        backgroundColor: theme.glass,
        borderRadius: radii.cardSm,
        padding: spacing.s3,
        alignItems: 'center',
        gap: 4,
        borderWidth: 1,
        borderColor: theme.glassBorder,
        shadowColor: '#000',
        shadowOpacity: 0.05,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 6 } as const,
        elevation: 6,
        ...(Platform.OS === 'web' ? { backdropFilter: 'blur(16px) saturate(160%)', WebkitBackdropFilter: 'blur(16px) saturate(160%)' } as any : {}),
        opacity: pressed ? 0.85 : 1,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      {icon ?? null}
      <Animated.Text
        numberOfLines={1}
        adjustsFontSizeToFit
        allowFontScaling
        maxFontSizeMultiplier={1.4}
        style={{ color: color ?? theme.text, fontSize: 20, lineHeight: 26, fontFamily: typography.h1.fontFamily, includeFontPadding: false }}
      >
        {String(value)}
      </Animated.Text>
      <Animated.Text
        numberOfLines={1}
        allowFontScaling
        maxFontSizeMultiplier={1.4}
        style={{ color: theme.textMuted, fontSize: 11, lineHeight: 17, fontFamily: typography.caption.fontFamily, includeFontPadding: false }}
      >
        {label}
      </Animated.Text>
    </Pressable>
  );
}
