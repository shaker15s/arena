/**
 * design/glass.tsx — محوّل مادة زجاجية واحد للتنقل وأدوات التحكم العائمة.
 *
 * iOS 26+ يستخدم مادة النظام الأصلية عند توافرها، وiOS الأقدم يستخدم BlurView
 * باعتدال، والويب يستخدم backdrop-filter كتطوير تدريجي، وAndroid يأخذ تعبئة ثابتة
 * عالية العتامة. المحتوى والبطاقات لا تستخدم هذه المادة.
 */
import React from 'react';
import { Animated, Platform, Pressable, View, ViewStyle, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from './theme';
import { useA11yPrefsOptional } from './preferences';
import { blurIntensity, borderWidth, orbs, radii, shadows, sizes, spacing, typography } from './tokens';
import { isReducedMotion, pressScale } from './motion';

function canUseNativeLiquidGlass(): boolean {
  if (Platform.OS !== 'ios') return false;
  try {
    return isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
  } catch {
    // Expo Go أو بناء أصلي لا يضم الوحدة يجب أن يتراجع بأمان إلى التعبئة العادية.
    return false;
  }
}

/**
 * سطح زجاجي تكيفي — محصور في التنقل والأدوات العائمة.
 * لا يغيّر الوظيفة أو التباين عند غياب المؤثر أو تفعيل تقليل الشفافية.
 */
export function GlassSurface({
  children,
  style,
  radius = radii.xl,
  tintColor,
  intensity = blurIntensity.surface,
  borderless,
}: {
  children?: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  radius?: number;
  tintColor?: string;
  intensity?: number;
  borderless?: boolean;
}) {
  const { theme, isDark, themeName } = useTheme();
  const preferences = useA11yPrefsOptional();
  const highContrast = preferences?.highContrast ?? false;
  const isLiquid = themeName === 'liquid';
  // High contrast uses the same opaque material as Reduce Transparency so that
  // blur never lowers legibility; the stronger border remains a clear affordance.
  const reduceTransparency = Boolean(preferences?.effectiveReduceTransparency || highContrast);
  const useNativeGlass = !reduceTransparency && canUseNativeLiquidGlass();
  const webBlur = isLiquid
    ? `blur(28px) saturate(210%) brightness(104%)`
    : `blur(${blurIntensity.webSurface}px) saturate(150%)`;
  const fill = reduceTransparency
    ? theme.card
    : (tintColor ?? (isLiquid ? 'rgba(13, 23, 46, 0.62)' : theme.glassHeavy));

  const liquidBorderColor = isLiquid
    ? 'rgba(255, 255, 255, 0.22)'
    : theme.fillBorder;

  return (
    <View
      // RN Web strips custom className from View; dataSet reliably exposes the CSS hook.
      {...(Platform.OS === 'web'
        ? ({ dataSet: { masarGlassSurface: 'true' } } as unknown as object)
        : {})}
      style={[
        {
          position: 'relative',
          borderRadius: radius,
          overflow: 'hidden',
          backgroundColor: fill,
          borderWidth: borderless ? 0 : highContrast ? borderWidth.medium : borderWidth.thin,
          borderColor: highContrast ? theme.textMuted : liquidBorderColor,
        },
        Platform.OS === 'web' && !reduceTransparency
          ? ({
              backdropFilter: webBlur,
              WebkitBackdropFilter: webBlur,
              boxShadow: isLiquid ? '0 12px 40px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.28)' : undefined,
            } as unknown as ViewStyle)
          : null,
        style,
        // التفضيل يتقدّم على أي تعبئة/Blur يضيفها المستدعي.
        reduceTransparency
          ? ({ backgroundColor: theme.card, backdropFilter: 'none', WebkitBackdropFilter: 'none', boxShadow: 'none' } as unknown as ViewStyle)
          : null,
      ]}
    >
      {useNativeGlass ? (
        <GlassView
          pointerEvents="none"
          glassEffectStyle={isLiquid ? 'clear' : 'regular'}
          colorScheme={isDark ? 'dark' : 'light'}
          tintColor={tintColor}
          style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
        />
      ) : !reduceTransparency && Platform.OS === 'ios' ? (
        <BlurView
          pointerEvents="none"
          intensity={isLiquid ? 55 : intensity}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {/* Specular top rim highlight لمحاكاة انكسار الضوء السائل على حافة زجاج أبل */}
      {!reduceTransparency ? (
        <LinearGradient
          colors={
            isLiquid
              ? ['rgba(255, 255, 255, 0.38)', 'rgba(255, 255, 255, 0.08)', 'transparent']
              : isDark
              ? ['rgba(255, 255, 255, 0.18)', 'transparent']
              : ['rgba(255, 255, 255, 0.55)', 'transparent']
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: isLiquid ? 2 : 1.5,
            zIndex: 1,
          }}
          pointerEvents="none"
        />
      ) : null}
      {children}
    </View>
  );
}

// ═══════════════ Ambient background ═══════════════
/** كرة ساكنة وخافتة للزخرفة فقط؛ لا حلقات GPU مستمرة في شاشات العمل. */
export function AmbientOrb({ size = 320, color, style }: {
  size?: number;
  color: string;
  style?: ViewStyle;
}) {
  const { isDark, themeName } = useTheme();
  const preferences = useA11yPrefsOptional();
  const oled = themeName === 'oled';
  if (preferences?.effectiveReduceTransparency || preferences?.highContrast) return null;

  const effectiveOpacity = oled ? 0.15 : isDark ? 0.35 : 0.75;
  return (
    <View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          opacity: effectiveOpacity,
        },
        style,
      ]}
    />
  );
}

export function AppBackground({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const { theme, isDark, themeName } = useTheme();
  const isLiquid = themeName === 'liquid';
  return (
    <View
      style={[
        { flex: 1, backgroundColor: theme.bg, overflow: 'hidden' },
        style,
        Platform.OS === 'web' ? ({ overflow: 'clip' } as unknown as ViewStyle) : null,
      ]}
    >
      <LinearGradient
        colors={[theme.bgGradientFrom, theme.bgGradientTo]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* كرات إضاءة مائية محيطية تسبح خلف الزجاج وتشف عبره */}
      <AmbientOrb size={orbs.size.md} color={theme.orbPrimary} style={orbs.position.topRight} />
      <AmbientOrb size={orbs.size.lg} color={theme.orbSecondary} style={orbs.position.bottomLeft} />
      <AmbientOrb size={orbs.size.sm} color={theme.orbTertiary} style={orbs.position.midLeft} />
      {isLiquid ? (
        <AmbientOrb
          size={360}
          color="rgba(14, 165, 233, 0.22)"
          style={{ position: 'absolute', top: '18%', right: -80 }}
        />
      ) : null}
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

/**
 * اسم تاريخي للتوافق مع شاشات المصادقة؛ هذا سطح محتوى صلب وليس زجاجًا شفافًا.
 */
export function GlassCard({ children, style }: {
  children?: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
}) {
  const { theme } = useTheme();
  const preferences = useA11yPrefsOptional();
  const highContrast = preferences?.highContrast ?? false;
  return (
    <View
      style={[
        {
          backgroundColor: theme.card,
          borderRadius: radii.xl,
          borderWidth: highContrast ? borderWidth.medium : borderWidth.thin,
          borderColor: highContrast ? theme.textMuted : theme.fillBorder,
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

// ═══════════════ Stat Bubble (solid metric surface) ═══════════════
export function StatBubble({ value, label, icon, color, onPress, onLongPress }: {
  value: string | number;
  label: string;
  icon?: React.ReactNode;
  color?: string;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  const { theme } = useTheme();
  const preferences = useA11yPrefsOptional();
  const highContrast = preferences?.highContrast ?? false;
  const reduceMotion = isReducedMotion();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${label} ${value}`}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 72,
        backgroundColor: theme.card,
        borderRadius: radii.lg,
        padding: spacing.s3,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.s1,
        borderWidth: highContrast ? borderWidth.medium : borderWidth.thin,
        borderColor: highContrast ? theme.textMuted : theme.fillBorder,
        shadowColor: theme.glassShadow,
        ...shadows.bubble,
        opacity: pressed ? 0.88 : 1,
        transform: !reduceMotion && pressed ? [{ scale: pressScale.default }] : undefined,
      })}
    >
      {icon ?? null}
      <Animated.Text
        numberOfLines={1}
        adjustsFontSizeToFit
        allowFontScaling
        maxFontSizeMultiplier={2}
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
        adjustsFontSizeToFit
        allowFontScaling
        maxFontSizeMultiplier={2}
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
