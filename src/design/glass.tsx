/**
 * design/glass.tsx — مكونات الزجاج (Liquid Glass) بأسلوب Apple
 * GlassCard, GlassButton, GradientBackground, GlassHeader, إلخ
 */
import React, { useEffect, useRef } from 'react';
import {
  Animated, Platform, Pressable, View, ViewStyle, StyleSheet,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from './theme';
import { radii, spacing } from './tokens';

// ═══════════════ Glass Background Gradient ═══════════════
export function AppBackground({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const { theme, isDark } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, ...style }}>
      <LinearGradient
        colors={isDark ? ['#1C1C1E', '#000000'] : ['#FFFFFF', '#F2F2F7']}
        style={StyleSheet.absoluteFill}
      />
      {/* Decorative gradient orbs for Apple aesthetic */}
      <View style={{
        position: 'absolute', top: -100, right: -60,
        width: 280, height: 280, borderRadius: 140,
        backgroundColor: isDark ? 'rgba(10, 132, 255, 0.08)' : 'rgba(0, 122, 255, 0.05)',
      }} />
      <View style={{
        position: 'absolute', bottom: 100, left: -80,
        width: 320, height: 320, borderRadius: 160,
        backgroundColor: isDark ? 'rgba(175, 82, 222, 0.06)' : 'rgba(88, 86, 214, 0.04)',
      }} />
      {children}
    </View>
  );
}

// ═══════════════ Glass Card (Apple Frosted) ═══════════════
export function GlassCard({
  children, style, onPress, elevated, color, noPad,
}: {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  onPress?: () => void;
  elevated?: boolean;
  color?: string;
  noPad?: boolean;
}) {
  const { theme, isDark } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;

  const pressIn = () => {
    Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, damping: 22, stiffness: 260 }).start();
  };
  const pressOut = () => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, damping: 22, stiffness: 260 }).start();
  };

  const baseStyle: ViewStyle = {
    backgroundColor: color ?? (elevated ? theme.cardElevated : isDark ? 'rgba(28,28,30,0.72)' : 'rgba(255,255,255,0.72)'),
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(84,84,88,0.35)' : 'rgba(255,255,255,0.5)',
    padding: noPad ? 0 : spacing.s4,
    shadowColor: '#000',
    shadowOpacity: elevated ? 0.1 : 0.06,
    shadowRadius: elevated ? 30 : 20,
    shadowOffset: { width: 0, height: elevated ? 12 : 8 },
    elevation: elevated ? 12 : 8,
  };

  const content = (
    <Animated.View style={[baseStyle, { transform: [{ scale }] }, style]}>
      {children}
    </Animated.View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} onPressIn={pressIn} onPressOut={pressOut}>
        {content}
      </Pressable>
    );
  }
  return content;
}

// ═══════════════ Glass Pill Button ═══════════════
export function GlassPill({
  children, onPress, active, style,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  active?: boolean;
  style?: ViewStyle;
}) {
  const { theme, isDark } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ([
        {
          backgroundColor: active
            ? theme.brand
            : isDark ? 'rgba(120,120,128,0.24)' : 'rgba(120,120,128,0.12)',
          borderRadius: radii.pill,
          paddingHorizontal: 16,
          paddingVertical: 10,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 6,
          borderWidth: active ? 0 : 0.5,
          borderColor: isDark ? 'rgba(84,84,88,0.3)' : 'rgba(60,60,67,0.15)',
          opacity: pressed ? 0.7 : 1,
          transform: [{ scale: pressed ? 0.96 : 1 }],
        },
        style,
      ])}
    >
      {children}
    </Pressable>
  );
}

// ═══════════════ Apple Gradient Button ═══════════════
export function GradientBtn({
  title, onPress, icon, disabled, loading, size = 'md', style,
}: {
  title: string;
  onPress?: () => void;
  icon?: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  size?: 'sm' | 'md' | 'lg';
  style?: ViewStyle;
}) {
  const { theme } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;

  const pressIn = () => Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, damping: 22, stiffness: 260 }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, damping: 22, stiffness: 260 }).start();

  const heights = { sm: 40, md: 50, lg: 56 };
  const fonts = { sm: 14, md: 16, lg: 17 };

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <Pressable
        onPress={disabled || loading ? undefined : onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        disabled={disabled}
      >
        <LinearGradient
          colors={[theme.brandGradientFrom, theme.brandGradientTo]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            height: heights[size],
            borderRadius: radii.button,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 8,
            paddingHorizontal: 24,
            opacity: disabled ? 0.5 : 1,
          }}
        >
          {icon}
          <Animated.Text style={{
            color: '#fff',
            fontFamily: 'IBMPlexSansArabic_600SemiBold',
            fontSize: fonts[size],
          }}>
            {title}
          </Animated.Text>
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

// ═══════════════ Glass Section Header ═══════════════
export function GlassHeader({ title, subtitle, right }: {
  title: string; subtitle?: string; right?: React.ReactNode;
}) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.s5, paddingVertical: spacing.s2 }}>
      <View style={{ flex: 1 }}>
        <Animated.Text style={{ color: theme.text, fontSize: 28, lineHeight: 36, fontFamily: 'IBMPlexSansArabic_700Bold' }}>
          {title}
        </Animated.Text>
        {subtitle ? (
          <Animated.Text style={{ color: theme.textSecondary, fontSize: 13, lineHeight: 18, fontFamily: 'IBMPlexSansArabic_500Medium', marginTop: 2 }}>
            {subtitle}
          </Animated.Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

// ═══════════════ Stat Bubble (Glass Metric) ═══════════════
export function StatBubble({ value, label, icon, color, onPress }: {
  value: string | number;
  label: string;
  icon?: React.ReactNode;
  color?: string;
  onPress?: () => void;
}) {
  const { theme, isDark } = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({
      flex: 1,
      backgroundColor: isDark ? 'rgba(28,28,30,0.72)' : 'rgba(255,255,255,0.72)',
      borderRadius: 20,
      padding: 14,
      alignItems: 'center',
      gap: 4,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(84,84,88,0.35)' : 'rgba(255,255,255,0.5)',
      shadowColor: '#000',
      shadowOpacity: 0.05,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 } as const,
      elevation: 6,
      opacity: pressed ? 0.85 : 1,
      transform: [{ scale: pressed ? 0.97 : 1 }],
    })}>
      {icon ?? null}
      <Animated.Text style={{ color: color ?? theme.text, fontSize: 22, fontFamily: 'IBMPlexSansArabic_700Bold' }}>
        {String(value)}
      </Animated.Text>
      <Animated.Text style={{ color: theme.textMuted, fontSize: 11, fontFamily: 'IBMPlexSansArabic_500Medium' }}>
        {label}
      </Animated.Text>
    </Pressable>
  );
}

// ═══════════════ Gradient Text ═══════════════
export function GradientText({ text, style }: { text: string; style?: ViewStyle }) {
  const { theme } = useTheme();
  return (
    <LinearGradient
      colors={[theme.brandGradientFrom, theme.brandGradientTo]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[style]}
    >
      {/* Gradient fills text on web, fallback to brand color */}
      <Animated.Text style={{
        fontSize: 28,
        fontFamily: 'IBMPlexSansArabic_700Bold',
        color: theme.brand,
        opacity: 0,
        position: 'absolute',
      }}>
        {text}
      </Animated.Text>
      <Animated.Text style={{
        fontSize: 28,
        fontFamily: 'IBMPlexSansArabic_700Bold',
        color: theme.brand,
      }}>
        {text}
      </Animated.Text>
    </LinearGradient>
  );
}

// ═══════════════ Apple Separator ═══════════════
export function AppleSeparator({ indent }: { indent?: number }) {
  const { theme } = useTheme();
  return (
    <View style={{ height: 0.5, backgroundColor: theme.separator, marginStart: indent ?? 0 }} />
  );
}

// ═══════════════ Glass FAB ═══════════════
export function GlassFAB({ icon, onPress, label, color }: {
  icon: React.ReactNode;
  onPress: () => void;
  label?: string;
  color?: string;
}) {
  const { theme } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.05, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1200, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View style={{ transform: [{ scale: pulse }] }}>
      <Pressable
        onPressIn={() => Animated.spring(scale, { toValue: 0.92, useNativeDriver: true, damping: 15, stiffness: 200 }).start()}
        onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, damping: 15, stiffness: 200 }).start()}
        onPress={onPress}
      >
        <LinearGradient
          colors={[color ?? theme.brandGradientFrom, theme.brandGradientTo]}
          style={{
            width: 62, height: 62, borderRadius: 31,
            alignItems: 'center', justifyContent: 'center',
            shadowColor: color ?? theme.brand,
            shadowOpacity: 0.4,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 8 },
            elevation: 12,
          }}
        >
          <Animated.View style={{ transform: [{ scale }] }}>
            {icon}
          </Animated.View>
        </LinearGradient>
        {label ? (
          <Animated.Text style={{
            textAlign: 'center', marginTop: 4,
            fontSize: 10, fontFamily: 'IBMPlexSansArabic_500Medium',
            color: theme.textMuted,
          }}>
            {label}
          </Animated.Text>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}
