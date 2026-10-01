/**
 * design/glass.tsx — أسطح الزجاج (Liquid Glass) بأسلوب Apple.
 * الزجاج الحقيقي (BlurView) للطبقات العائمة فقط — البطاقات تستخدم surfaceGlass من التوكنز.
 */
import React, { useEffect, useRef } from 'react';
import { AccessibilityRole, Animated, Platform, Pressable, View, ViewStyle, StyleSheet, StyleProp } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from './theme';
import { blurIntensity, borderWidth, orbs, radii, shadows, sizes, spacing, typography } from './tokens';
import { isReducedMotion, pressScale } from './motion';

/**
 * سطح زجاجي حقيقي (Apple Liquid Glass): ضبابية خلفية + طبقة لون شفافة
 * + حد فاتح علوي. يُستخدم للطبقات العائمة فقط (شاشة الدخول، البوب‌أوف) — لا يُتعشّش داخل بطاقات.
 */
export function GlassSurface({
  children,
  style,
  radius = radii.xl,
  tintColor,
  intensity = blurIntensity.surface,
  borderless,
  accessibilityRole,
  accessibilityLabel,
  accessibilityHint,
}: {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  tintColor?: string;
  intensity?: number;
  borderless?: boolean;
  accessibilityRole?: AccessibilityRole | 'region';
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const { theme, isDark } = useTheme();
  const isAndroid = Platform.OS === 'android';
  const hasBlur = intensity > 0;
  // GL-01: شدة الضبابية على الويب موحّدة من blurIntensity.webSurface للأسطح ذات الضبابية فقط (ممنوع في طبقة المحتوى).
  const webBlur = hasBlur ? `blur(${blurIntensity.webSurface}px) saturate(180%)` : undefined;

  return (
    <View
      accessibilityRole={accessibilityRole as AccessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      {...(Platform.OS === 'web' && accessibilityRole === 'region' ? ({ role: 'region' } as any) : {})}
      style={[
        { borderRadius: radius, overflow: 'hidden' },
        Platform.OS === 'web' && hasBlur
          ? ({ backdropFilter: webBlur, WebkitBackdropFilter: webBlur } as unknown as ViewStyle)
          : null,
        isAndroid
          ? {
              backgroundColor: tintColor ?? (isDark ? 'rgba(30, 41, 59, 0.94)' : 'rgba(255, 255, 255, 0.94)'),
              elevation: 4,
            }
          : null,
        style,
      ]}
    >
      {!isAndroid && hasBlur && (
        <BlurView
          intensity={intensity}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
      )}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: isAndroid ? 'transparent' : (tintColor ?? theme.glass),
            borderRadius: radius,
            borderWidth: borderless ? 0 : borderWidth.thin,
            borderColor: theme.glassBorder,
          },
        ]}
      />
      {children}
    </View>
  );
}

// ═══════════════ Ambient background ═══════════════
export function AmbientOrb({ size = 320, color, drift = 18, style }: {
  size?: number; color: string; drift?: number; style?: ViewStyle;
}) {
  const { isDark, themeName } = useTheme();
  const oled = themeName === 'oled';
  const reduced = isReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) return undefined;
    // حركة طفو مستمرة وهادئة (Orb Drift)
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(progress, { toValue: 1, duration: 12000, useNativeDriver: true }),
      Animated.timing(progress, { toValue: 0, duration: 12000, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduced, progress]);

  // A11Y-52: تعطيل الكرات العائمة بالكامل عند تفعيل تقليل الحركة
  if (reduced) return null;

  const animatedTransform = [
    { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, drift] }) },
    { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -drift * 0.6] }) },
    { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) },
  ];

  const effectiveOpacity = oled ? 0.15 : isDark ? 0.35 : 0.75;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute', width: size, height: size, borderRadius: size / 2,
          backgroundColor: color,
          opacity: effectiveOpacity,
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
      {/* مقاسات ومواضع الـ Orbs موحّدة من توكنز orbs (GL-02) */}
      <AmbientOrb size={orbs.size.md} color={theme.orbPrimary} style={orbs.position.topRight} />
      <AmbientOrb size={orbs.size.lg} color={theme.orbSecondary} drift={-22} style={orbs.position.bottomLeft} />
      <AmbientOrb size={orbs.size.sm} color={theme.orbTertiary} drift={12} style={orbs.position.midLeft} />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, {
        borderWidth: Platform.OS === 'web' ? 1 : 0,
        borderColor: isDark ? 'rgba(255,255,255,0.015)' : 'rgba(255,255,255,0.2)',
      }]} />
      {children}
    </View>
  );
}

/** يثبت اتساع المحتوى على الويب/التابلت مع بقاء الموبايل بعرضه الكامل. */
export function ContentFrame({ children, style, maxWidth = sizes.contentMaxWidth }: {
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
          borderRadius: radii.xl,
          borderWidth: borderWidth.thin,
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
        borderRadius: radii.lg,
        padding: spacing.s3,
        alignItems: 'center',
        gap: 4,
        borderWidth: borderWidth.thin,
        borderColor: theme.glassBorder,
        shadowColor: theme.glassShadow,
        ...shadows.bubble,
        // GL-01: نفس شدة ضبابية GlassSurface على الويب — سطح واحد = قيمة واحدة.
        ...(Platform.OS === 'web'
          ? {
              backdropFilter: `blur(${blurIntensity.webSurface}px) saturate(180%)`,
              WebkitBackdropFilter: `blur(${blurIntensity.webSurface}px) saturate(180%)`,
            } as unknown as ViewStyle
          : {}),
        opacity: pressed ? 0.85 : 1,
        transform: [{ scale: pressed ? pressScale.default : 1 }],
      })}
    >
      {icon ?? null}
      <Animated.Text
        numberOfLines={1}
        adjustsFontSizeToFit
        allowFontScaling
        maxFontSizeMultiplier={1.4}
        // GL-03: من مقياس التايبوغرافيا مباشرة — كانت 20/26 hardcoded بينما h2 الموحّد 20/29
        // والفرق يقطع امتدادات الحروف العربية.
        style={{
          color: color ?? theme.text,
          fontSize: typography.h2.fontSize,
          lineHeight: typography.h2.lineHeight,
          fontFamily: typography.h2.fontFamily,
          includeFontPadding: false,
        }}
      >
        {String(value)}
      </Animated.Text>
      <Animated.Text
        numberOfLines={1}
        allowFontScaling
        maxFontSizeMultiplier={1.4}
        style={{
          color: theme.textMuted,
          fontSize: typography.micro.fontSize,
          lineHeight: typography.micro.lineHeight,
          fontFamily: typography.micro.fontFamily,
          includeFontPadding: false,
        }}
      >
        {label}
      </Animated.Text>
    </Pressable>
  );
}
