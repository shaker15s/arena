/**
 * design/components.tsx — كتالوج المكونات الموحدة بتصميم Apple Liquid Glass.
 * كل مكون من التوكنز فقط — لا ألوان حرفية. RTL تلقائي.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated, Easing, Modal, Platform, Pressable, StyleSheet, Text,
  TextInput, View, ViewStyle, TextStyle, ScrollView,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from './theme';
import { radii, spacing, typography } from './tokens';
import { duration, easing, isReducedMotion } from './motion';
import { useI18n } from '../i18n';

// ───────────────────────────── نصوص ─────────────────────────────

type TxtVariant = keyof typeof typography;

export function Txt({
  children, variant = 'body', color, align, style, numberOfLines, bold,
}: {
  children: React.ReactNode;
  variant?: TxtVariant;
  color?: string;
  align?: TextStyle['textAlign'];
  style?: TextStyle | TextStyle[];
  numberOfLines?: number;
  bold?: boolean;
}) {
  const { theme } = useTheme();
  const base = typography[variant];
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        { color: color ?? theme.text, textAlign: align ?? 'auto', writingDirection: 'auto' as const },
        base,
        bold ? { fontFamily: typography.h3.fontFamily } : null,
        style,
      ]}
    >
      {children}
    </Text>
  );
}

// ───────────────────────────── عناصر تخطيط ─────────────────────────────

export function Row({ children, style, gap, center, between, wrap }: {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  gap?: number;
  center?: boolean;
  between?: boolean;
  wrap?: boolean;
}) {
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: center ? 'center' : 'flex-start' },
        between ? { justifyContent: 'space-between' } : null,
        wrap ? { flexWrap: 'wrap' } : null,
        gap != null ? { gap } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Spacer({ size = 8 }: { size?: number }) {
  return <View style={{ height: size, width: size }} />;
}

// ───────────────────────────── بطاقات زجاجية ─────────────────────────────

export function Card({ children, style, glass, color, noPad, onPress }: {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  glass?: boolean;
  color?: string;
  noPad?: boolean;
  onPress?: () => void;
}) {
  const { theme, isDark } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;

  const pressIn = () => {
    if (onPress) Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, damping: 22, stiffness: 260 }).start();
  };
  const pressOut = () => {
    if (onPress) Animated.spring(scale, { toValue: 1, useNativeDriver: true, damping: 22, stiffness: 260 }).start();
  };

  const content = (
    <Animated.View
      style={[
        {
          backgroundColor: glass ? theme.glass : color ?? theme.card,
          borderRadius: radii.card,
          borderWidth: 1,
          borderColor: isDark ? 'rgba(84,84,88,0.35)' : 'rgba(255,255,255,0.5)',
          padding: noPad ? 0 : spacing.s4,
          shadowColor: '#000',
          shadowOpacity: glass ? 0.04 : 0.06,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 8 },
          elevation: 8,
          transform: [{ scale }],
        },
        style,
      ]}
    >
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

// ───────────────────────────── أزرار ─────────────────────────────

export function Btn({
  title, onPress, variant = 'primary', size = 'md', icon, disabled, loading, style, full,
}: {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'gold';
  size?: 'sm' | 'md' | 'lg';
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  full?: boolean;
}) {
  const { theme, isDark } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;

  const isGradient = variant === 'primary';
  const bg =
    variant === 'primary' ? theme.brand
    : variant === 'secondary' ? theme.brandSoft
    : variant === 'danger' ? theme.dangerSoft
    : variant === 'success' ? theme.successSoft
    : variant === 'gold' ? theme.certGold
    : 'transparent';
  const fg =
    variant === 'primary' ? '#FFFFFF'
    : variant === 'secondary' ? theme.brand
    : variant === 'danger' ? theme.danger
    : variant === 'success' ? theme.success
    : variant === 'gold' ? '#3D2B00'
    : theme.textSecondary;
  const padV = size === 'lg' ? 16 : size === 'md' ? 13 : 9;
  const padH = size === 'lg' ? 24 : size === 'md' ? 18 : 14;

  const press = (v: number) =>
    Animated.spring(scale, { toValue: v, useNativeDriver: true, damping: 22, stiffness: 260 }).start();

  if (isGradient) {
    return (
      <Animated.View style={[{ transform: [{ scale }] }, full ? { alignSelf: 'stretch' } as ViewStyle : null, style]}>
        <Pressable
          onPress={loading || disabled ? undefined : onPress}
          onPressIn={() => press(0.96)}
          onPressOut={() => press(1)}
        >
          <LinearGradient
            colors={[theme.brandGradientFrom, theme.brandGradientTo]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              borderRadius: radii.button,
              paddingVertical: padV,
              paddingHorizontal: padH,
              minHeight: size === 'lg' ? 56 : 48,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 8,
              opacity: disabled ? 0.45 : 1,
            }}
          >
            {loading ? (
              <Spinner color="#fff" />
            ) : (
              <>
                {icon ? <Ionicons name={icon} size={18} color="#fff" /> : null}
                <Text style={{ color: '#fff', fontFamily: typography.h3.fontFamily, fontSize: size === 'lg' ? 17 : 15 }}>{title}</Text>
              </>
            )}
          </LinearGradient>
        </Pressable>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[{ transform: [{ scale }] }, full ? { alignSelf: 'stretch' } as ViewStyle : null, style]}>
      <Pressable
        onPress={loading || disabled ? undefined : onPress}
        onPressIn={() => press(0.96)}
        onPressOut={() => press(1)}
        style={{
          backgroundColor: bg,
          borderRadius: radii.button,
          paddingVertical: padV,
          paddingHorizontal: padH,
          minHeight: size === 'lg' ? 56 : 48,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 8,
          opacity: disabled ? 0.45 : 1,
          borderWidth: variant === 'ghost' ? 1 : 0,
          borderColor: variant === 'ghost' ? theme.line : 'transparent',
        }}
      >
        {loading ? (
          <Spinner color={fg} />
        ) : (
          <>
            {icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
            <Text style={{ color: fg, fontFamily: typography.h3.fontFamily, fontSize: size === 'lg' ? 17 : 15 }}>{title}</Text>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

export function Spinner({ color }: { color?: string }) {
  const { theme } = useTheme();
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 800, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Ionicons name="ellipse-outline" size={20} color={color ?? theme.brand} />
    </Animated.View>
  );
}

// ───────────────────────────── Chips / Tags / Segmented ─────────────────────────────

export function Chip({ label, active, onPress, icon }: {
  label: string; active?: boolean; onPress?: () => void; icon?: keyof typeof Ionicons.glyphMap;
}) {
  const { theme, isDark } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: active ? theme.brand : isDark ? 'rgba(120,120,128,0.24)' : 'rgba(120,120,128,0.12)',
        borderRadius: radii.pill, paddingHorizontal: 14, paddingVertical: 9,
        borderWidth: 0.5,
        borderColor: active ? 'transparent' : isDark ? 'rgba(84,84,88,0.3)' : 'rgba(60,60,67,0.15)',
        opacity: pressed ? 0.7 : 1,
        transform: [{ scale: pressed ? 0.96 : 1 }],
      })}
    >
      {icon ? <Ionicons name={icon} size={14} color={active ? '#fff' : theme.textSecondary} /> : null}
      <Txt variant="caption" color={active ? '#fff' : theme.textSecondary}>{label}</Txt>
    </Pressable>
  );
}

export function Tag({ label, color, bg, icon }: { label: string; color: string; bg: string; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: bg, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start' }}>
      {icon ? <Ionicons name={icon} size={12} color={color} /> : null}
      <Txt variant="micro" color={color}>{label}</Txt>
    </View>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: {
  options: Array<{ value: T; label: string; icon?: keyof typeof Ionicons.glyphMap }>;
  value: T;
  onChange: (v: T) => void;
}) {
  const { theme, isDark } = useTheme();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: isDark ? 'rgba(120,120,128,0.24)' : 'rgba(120,120,128,0.12)', borderRadius: radii.pill, padding: 3 }}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={{
              flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
              backgroundColor: active ? (isDark ? 'rgba(60,60,67,0.5)' : theme.card) : 'transparent',
              borderRadius: radii.pill, paddingVertical: 9,
              shadowColor: active ? '#000' : 'transparent',
              shadowOpacity: active ? 0.05 : 0,
              shadowRadius: active ? 8 : 0,
              shadowOffset: { width: 0, height: 2 },
            }}
          >
            {opt.icon ? <Ionicons name={opt.icon} size={14} color={active ? theme.brand : theme.textMuted} /> : null}
            <Txt variant="caption" color={active ? theme.text : theme.textMuted}>{opt.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

// ───────────────────────────── حقول إدخال ─────────────────────────────

export function Input({ label, value, onChange, placeholder, keyboardType, multiline, icon, error, maxLength, secure }: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'phone-pad' | 'decimal-pad';
  multiline?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  error?: string;
  maxLength?: number;
  secure?: boolean;
}) {
  const { theme, isDark } = useTheme();
  return (
    <View style={{ alignSelf: 'stretch' }}>
      {label ? <Txt variant="caption" color={theme.textSecondary} style={{ marginBottom: 6 }}>{label}</Txt> : null}
      <View
        style={{
          flexDirection: 'row', alignItems: multiline ? 'flex-start' : 'center', gap: 10,
          backgroundColor: isDark ? 'rgba(120,120,128,0.24)' : 'rgba(120,120,128,0.12)',
          borderRadius: radii.button, borderWidth: error ? 1.5 : 0.5,
          borderColor: error ? theme.danger : isDark ? 'rgba(84,84,88,0.3)' : 'rgba(60,60,67,0.15)',
          paddingHorizontal: 16, paddingVertical: multiline ? 12 : 4, minHeight: multiline ? 90 : 52,
        }}
      >
        {icon ? <Ionicons name={icon} size={18} color={theme.textMuted} style={{ marginTop: multiline ? 10 : 0 }} /> : null}
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={theme.textMuted}
          keyboardType={keyboardType}
          multiline={multiline}
          maxLength={maxLength}
          secureTextEntry={secure}
          style={{
            flex: 1, color: theme.text, fontFamily: typography.body.fontFamily, fontSize: 15,
            textAlign: 'auto', paddingVertical: 10,
            ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as object : {}),
          }}
        />
      </View>
      {error ? <Txt variant="micro" color={theme.danger} style={{ marginTop: 4 }}>{error}</Txt> : null}
    </View>
  );
}

// ───────────────────────────── تقدم ─────────────────────────────

export function ProgressBar({ progress, color, height = 8, track }: {
  progress: number; color?: string; height?: number; track?: string;
}) {
  const { theme, isDark } = useTheme();
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: Math.min(1, Math.max(0, progress)),
      duration: isReducedMotion() ? 200 : 600,
      easing: easing.standard, useNativeDriver: false,
    }).start();
  }, [progress, anim]);
  const width = anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  return (
    <View style={{ height, borderRadius: height, backgroundColor: isDark ? 'rgba(120,120,128,0.24)' : 'rgba(120,120,128,0.12)', overflow: 'hidden' }}>
      <Animated.View style={{ height, borderRadius: height, backgroundColor: color ?? theme.brand, width }} />
    </View>
  );
}

export function StatRing({ size = 72, stroke = 7, progress, color, children }: {
  size?: number; stroke?: number; progress: number; color?: string; children?: React.ReactNode;
}) {
  const { theme, isDark } = useTheme();
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(anim, { toValue: progress, useNativeDriver: false, damping: 18, stiffness: 150 }).start();
  }, [progress, anim]);
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const AnimatedCircle = Animated.createAnimatedComponent(Circle);
  const dashOffset = anim.interpolate({ inputRange: [0, 1], outputRange: [circ, 0] });
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={isDark ? 'rgba(84,84,88,0.3)' : 'rgba(120,120,128,0.12)'} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2} cy={size / 2} r={r}
          stroke={color ?? theme.brand} strokeWidth={stroke} fill="none"
          strokeDasharray={`${circ} ${circ}`}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}

// ───────────────────────────── لهيب الستريك ─────────────────────────────

export function Flame({ size = 22, urgent }: { size?: number; urgent?: boolean }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: urgent ? 1.25 : 1.08, duration: urgent ? 400 : 1000, easing: easing.inOut, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: urgent ? 400 : 1000, easing: easing.inOut, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [urgent, pulse]);
  return (
    <Animated.View style={{ transform: [{ scale: pulse }] }}>
      <Ionicons name="flame" size={size} color={urgent ? '#FF3B30' : '#FF9F0A'} />
    </Animated.View>
  );
}

// ───────────────────────────── أفاتار ─────────────────────────────

export function Avatar({ name, color, size = 44, ring }: { name: string; color: string; size?: number; ring?: string }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('');
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2, backgroundColor: color,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: ring ? 2.5 : 0, borderColor: ring ?? 'transparent',
      shadowColor: color, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    }}>
      <Text style={{ color: '#fff', fontFamily: typography.h3.fontFamily, fontSize: size * 0.34 }}>{initials}</Text>
    </View>
  );
}

// ───────────────────────────── عداد رقمي ─────────────────────────────

export function CountUp({ value, variant = 'numberHero', color, duration: dur = 500 }: {
  value: number; variant?: TxtVariant; color?: string; duration?: number;
}) {
  const [display, setDisplay] = useState(0);
  const prevRef = useRef(0);
  useEffect(() => {
    const from = prevRef.current;
    prevRef.current = value;
    if (isReducedMotion()) { setDisplay(value); return; }
    const start = Date.now();
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / dur);
      const easedVal = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (value - from) * easedVal));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [value, dur]);
  return <Txt variant={variant} color={color}>{String(display)}</Txt>;
}

// ───────────────────────────── أنيميشن دخول متدرج ─────────────────────────────

export function FadeIn({ children, index = 0, style }: { children: React.ReactNode; index?: number; style?: ViewStyle | ViewStyle[] }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: isReducedMotion() ? 200 : 350,
      delay: isReducedMotion() ? 0 : index * 70,
      easing: easing.standard, useNativeDriver: true,
    }).start();
  }, [anim, index]);
  return (
    <Animated.View style={[{
      opacity: anim,
      transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: isReducedMotion() ? [0, 0] : [20, 0] }) }],
    }, style]}>
      {children}
    </Animated.View>
  );
}

// ───────────────────────────── حالات فارغة / خطأ ─────────────────────────────

export function Empty({ emoji, title, body, cta, onCta }: {
  emoji: string; title: string; body?: string; cta?: string; onCta?: () => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.s10, paddingHorizontal: spacing.s6, gap: 12 }}>
      <Text style={{ fontSize: 52 }}>{emoji}</Text>
      <Txt variant="h2" align="center">{title}</Txt>
      {body ? <Txt variant="body" color={theme.textSecondary} align="center" style={{ maxWidth: 300 }}>{body}</Txt> : null}
      {cta && onCta ? <View style={{ marginTop: 10 }}><Btn title={cta} onPress={onCta} /></View> : null}
    </View>
  );
}

// ───────────────────────────── Shimmer / Skeleton ─────────────────────────────

export function Shimmer({ width = '100%', height = 14, radius = 10, style }: {
  width?: number | string; height?: number; radius?: number; style?: ViewStyle;
}) {
  const { theme, isDark } = useTheme();
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 700, easing: easing.inOut, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 700, easing: easing.inOut, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);
  return (
    <Animated.View
      style={[{
        width: width as number, height, borderRadius: radius,
        backgroundColor: isDark ? 'rgba(84,84,88,0.3)' : 'rgba(120,120,128,0.12)',
        opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.9] }),
      }, style]}
    />
  );
}

// ───────────────────────────── Header / Screen ─────────────────────────────

export function Header({ title, subtitle, back, right }: {
  title: string; subtitle?: string; back?: () => void; right?: React.ReactNode;
}) {
  const { theme, isDark } = useTheme();
  return (
    <View style={{ paddingHorizontal: spacing.s5, paddingTop: spacing.s3, paddingBottom: spacing.s3 }}>
      <Row between center>
        <Row center gap={12} style={{ flex: 1 }}>
          {back ? (
            <Pressable onPress={back} style={({ pressed }) => ({
              width: 44, height: 44, borderRadius: 22,
              backgroundColor: isDark ? 'rgba(120,120,128,0.24)' : 'rgba(120,120,128,0.12)',
              alignItems: 'center', justifyContent: 'center',
              opacity: pressed ? 0.7 : 1,
            })}>
              <BackIcon color={theme.text} />
            </Pressable>
          ) : null}
          <View style={{ flex: 1 }}>
            <Txt variant="h1" numberOfLines={1}>{title}</Txt>
            {subtitle ? <Txt variant="caption" color={theme.textSecondary}>{subtitle}</Txt> : null}
          </View>
        </Row>
        {right}
      </Row>
    </View>
  );
}

export function BackIcon({ color }: { color: string }) {
  const { rtl } = useI18n();
  return <Ionicons name={rtl ? 'chevron-forward' : 'chevron-back'} size={22} color={color} />;
}

// ───────────────────────────── ورقة سفلية ─────────────────────────────

export function Sheet({ visible, onClose, children, title }: {
  visible: boolean; onClose: () => void; children: React.ReactNode; title?: string;
}) {
  const { theme, isDark } = useTheme();
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (visible) {
      Animated.spring(anim, { toValue: 1, useNativeDriver: true, damping: 20, stiffness: 180 }).start();
    } else {
      anim.setValue(0);
    }
  }, [visible, anim]);
  if (!visible) return null;
  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: theme.overlay, justifyContent: 'flex-end' }} onPress={onClose}>
        <Animated.View
          style={{
            backgroundColor: isDark ? theme.card : theme.card,
            borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl,
            padding: spacing.s5, paddingBottom: spacing.s8,
            maxHeight: '88%',
            borderTopWidth: 0.5,
            borderTopColor: isDark ? 'rgba(84,84,88,0.3)' : 'rgba(255,255,255,0.5)',
            shadowColor: '#000',
            shadowOpacity: 0.15,
            shadowRadius: 30,
            shadowOffset: { width: 0, height: -10 },
            transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [400, 0] }) }],
          }}
        >
          <Pressable onPress={(e) => e.stopPropagation?.()}>
            <View style={{ alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: isDark ? 'rgba(84,84,88,0.4)' : 'rgba(120,120,128,0.2)', marginBottom: 14 }} />
            {title ? <Txt variant="h2" style={{ marginBottom: 12 }}>{title}</Txt> : null}
            {children}
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

// ───────────────────────────── سطر قائمة ─────────────────────────────

export function ListRow({ icon, iconBg, title, subtitle, onPress, right, danger }: {
  icon?: keyof typeof Ionicons.glyphMap;
  iconBg?: string;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  right?: React.ReactNode;
  danger?: boolean;
}) {
  const { theme, isDark } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 12,
        backgroundColor: isDark ? 'rgba(28,28,30,0.72)' : 'rgba(255,255,255,0.72)',
        borderRadius: radii.cardSm, padding: 14,
        borderWidth: 0.5,
        borderColor: isDark ? 'rgba(84,84,88,0.25)' : 'rgba(255,255,255,0.5)',
        opacity: pressed ? 0.7 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      {icon ? (
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: iconBg ?? theme.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon} size={19} color={danger ? theme.danger : theme.brand} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Txt variant="bodyMed" color={danger ? theme.danger : undefined}>{title}</Txt>
        {subtitle ? <Txt variant="caption" color={theme.textSecondary}>{subtitle}</Txt> : null}
      </View>
      {right ?? (onPress ? <BackIcon color={theme.textMuted} /> : null)}
    </Pressable>
  );
}

// ───────────────────────────── Switch ─────────────────────────────

export function CustomSwitch({ value, onChange, color }: { value: boolean; onChange: (v: boolean) => void; color?: string }) {
  const { theme, isDark } = useTheme();
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(anim, { toValue: value ? 1 : 0, useNativeDriver: false, damping: 22, stiffness: 260 }).start();
  }, [value, anim]);
  const bg = anim.interpolate({ inputRange: [0, 1], outputRange: [
    isDark ? 'rgba(120,120,128,0.32)' : '#E5E5EA',
    color ?? theme.brand,
  ]});
  const translate = anim.interpolate({ inputRange: [0, 1], outputRange: [2, 22] });
  return (
    <Pressable onPress={() => onChange(!value)}>
      <Animated.View style={{ width: 51, height: 31, borderRadius: 16, backgroundColor: bg, justifyContent: 'center' }}>
        <Animated.View style={{ width: 27, height: 27, borderRadius: 14, backgroundColor: '#fff', transform: [{ translateX: translate }], shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 }} />
      </Animated.View>
    </Pressable>
  );
}

// ───────────────────────────── نجوم التقييم ─────────────────────────────

export function Stars({ value, size = 16, onRate }: { value: number; size?: number; onRate?: (v: number) => void }) {
  const { theme } = useTheme();
  return (
    <Row gap={2}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Pressable key={i} onPress={onRate ? () => onRate(i) : undefined} disabled={!onRate}>
          <Ionicons name={i <= Math.round(value) ? 'star' : 'star-outline'} size={size} color={i <= Math.round(value) ? theme.certGold : theme.textMuted} />
        </Pressable>
      ))}
    </Row>
  );
}

// ───────────────────────────── وسام ندرة ─────────────────────────────

export function RarityFrame({ rarity, children }: { rarity: 'common' | 'rare' | 'epic' | 'legendary'; children: React.ReactNode }) {
  const { theme } = useTheme();
  const color =
    rarity === 'legendary' ? theme.rarityLegendary
    : rarity === 'epic' ? theme.rarityEpic
    : rarity === 'rare' ? theme.rarityRare
    : theme.rarityCommon;
  return (
    <View style={{ borderWidth: 2, borderColor: color, borderRadius: 18, padding: 2, alignSelf: 'center' }}>
      {children}
    </View>
  );
}

export { ScrollView };
