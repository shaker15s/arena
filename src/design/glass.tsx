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
  const { theme, isDark } = useTheme();
  const preferences = useA11yPrefsOptional();
  const reduceTransparency = preferences?.effectiveReduceTransparency ?? false;
  const highContrast = preferences?.highContrast ?? false;
  const useNativeGlass = !reduceTransparency && canUseNativeLiquidGlass();
  const webBlur = `blur(${blurIntensity.webSurface}px) saturate(150%)`;
  const fill = reduceTransparency ? theme.card : (tintColor ?? theme.glassHeavy);

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
          borderColor: highContrast ? theme.textMuted : theme.fillBorder,
        },
        Platform.OS === 'web' && !reduceTransparency
          ? ({ backdropFilter: webBlur, WebkitBackdropFilter: webBlur } as unknown as ViewStyle)
          : null,
        style,
        // التفضيل يتقدّم على أي تعبئة/Blur يضيفها المستدعي.
        reduceTransparency
          ? ({ backgroundColor: theme.card, backdropFilter: 'none', WebkitBackdropFilter: 'none' } as unknown as ViewStyle)
          : null,
      ]}
    >
      {useNativeGlass ? (
        <GlassView
          pointerEvents="none"
          glassEffectStyle="regular"
          colorScheme={isDark ? 'dark' : 'light'}
          tintColor={tintColor}
          style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
        />
      ) : !reduceTransparency && Platform.OS === 'ios' ? (
        <BlurView
          pointerEvents="none"
          intensity={intensity}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
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
  const { theme, isDark } = useTheme();
  return (
    <View
      style={[
        { flex: 1, backgroundColor: theme.bg, overflow: 'hidden' },
        style,
        // CSS `hidden` still creates a programmatically scrollable box. The large
        // decorative orb can make it 180px taller than the viewport, so focusing
        // a button scrolls the whole app offscreen. `clip` preserves the visual
        // crop without introducing a scroll container on the web.
        Platform.OS === 'web' ? ({ overflow: 'clip' } as unknown as ViewStyle) : null,
      ]}
    >
      <LinearGradient
        colors={[theme.bgGradientFrom, theme.bgGradientTo]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* لمسة لونية ساكنة وخفيفة؛ أسطح المحتوى المعتمة تحمي وضوح النصوص فوقها. */}
      <AmbientOrb size={orbs.size.md} color={theme.orbPrimary} style={orbs.position.topRight} />
      <AmbientOrb size={orbs.size.lg} color={theme.orbSecondary} style={orbs.position.bottomLeft} />
      <AmbientOrb size={orbs.size.sm} color={theme.orbTertiary} style={orbs.position.midLeft} />
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
