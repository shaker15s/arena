/**
 * design/components.tsx — كتالوج المكونات الموحدة بتصميم Apple Liquid Glass.
 * كل مكون من التوكنز فقط — لا ألوان حرفية. RTL تلقائي.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, KeyboardAvoidingView, Modal, Platform, Pressable,
  StyleSheet, Text, TextInput, View, ViewStyle, TextStyle, ScrollView,
} from 'react-native';
import { BlurView } from 'expo-blur';
import Svg, { Circle, Path } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from './theme';
import { radii, spacing, typography } from './tokens';
import { easing, isReducedMotion, scalePress, staggerDelay } from './motion';
import { useI18n } from '../i18n';
import { useHaptics } from '../shared/hooks';

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
      allowFontScaling
      maxFontSizeMultiplier={1.4}
      style={[
        // includeFontPadding=false يجعل ارتفاع السطر مطابقًا لـ lineHeight
        // فلا تُقصّ امتدادات الحروف العربية ولا تتزحزح النصوص عن مركزها (أندرويد).
        { includeFontPadding: false },
        { color: color ?? theme.text, textAlign: align ?? 'auto' },
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

const webPointer = Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null;

// ───────────────────────────── بطاقات زجاجية ─────────────────────────────

export function Card({ children, style, glass, color, noPad, onPress, solid, heavy }: {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  /** مُبقاة للتوافق — الزجاج صار الأساس */
  glass?: boolean;
  color?: string;
  noPad?: boolean;
  onPress?: () => void;
  /** بطاقة معتمة بلا ضبابية (للحالات التي تحتاج تباينًا كاملًا) */
  solid?: boolean;
  /** ضبابية حقيقية للحالات الاستثنائية فقط (hero/عائم) — الافتراضي سطح زجاجي بلا blur للأداء */
  heavy?: boolean;
}) {
  const { theme, isDark } = useTheme();
  const { impactLight } = useHaptics();
  const scale = useRef(new Animated.Value(1)).current;
  const useGlass = !solid && !color;

  const pressIn = () => {
    if (onPress) Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, damping: 22, stiffness: 260 }).start();
  };
  const pressOut = () => {
    if (onPress) Animated.spring(scale, { toValue: 1, useNativeDriver: true, damping: 22, stiffness: 260 }).start();
  };

  const shell: ViewStyle = {
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: theme.glassBorder,
    padding: noPad ? 0 : spacing.s4,
    shadowColor: '#000',
    shadowOpacity: isDark ? 0.28 : 0.07,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
    overflow: 'hidden',
  };

  const content = (
    <Animated.View style={[shell, { backgroundColor: useGlass ? theme.glass : color ?? theme.card, transform: [{ scale }] }, style]}>
      {useGlass && heavy ? (
        <BlurView
          intensity={isDark ? 34 : 42}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      ) : null}
      {children}
    </Animated.View>
  );
  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => { impactLight(); onPress(); }}
        onPressIn={pressIn}
        onPressOut={pressOut}
        style={webPointer}
      >
        {content}
      </Pressable>
    );
  }
  return content;
}

// ───────────────────────────── أزرار ─────────────────────────────

export function Btn({
  title, onPress, variant = 'primary', size = 'md', icon, disabled, loading, style, full,
  accessibilityHint,
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
  accessibilityHint?: string;
}) {
  const { theme } = useTheme();
  const { impactLight, impactMedium } = useHaptics();
  const scale = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    if (!onPress || disabled || loading) return;
    if (variant === 'primary' || variant === 'danger') impactMedium();
    else impactLight();
    onPress();
  };

  const isGradient = variant === 'primary';
  const bg =
    variant === 'primary' ? theme.brand
    : variant === 'secondary' ? theme.brandSoft
    : variant === 'danger' ? theme.dangerSoft
    : variant === 'success' ? theme.successSoft
    : variant === 'gold' ? theme.certGold
    : 'transparent';
  const fg =
    variant === 'primary' ? theme.onBrand
    : variant === 'secondary' ? theme.brand
    : variant === 'danger' ? theme.danger
    : variant === 'success' ? theme.success
    : variant === 'gold' ? '#3D2B00'
    : theme.textSecondary;
  const padV = size === 'lg' ? 16 : size === 'md' ? 13 : 10;
  const padH = size === 'lg' ? 24 : size === 'md' ? 18 : 14;
  const minBtnHeight = size === 'lg' ? 64 : size === 'md' ? 56 : 48;

  const press = (v: number) =>
    Animated.spring(scale, { toValue: v, useNativeDriver: true, damping: 22, stiffness: 260 }).start();

  if (isGradient) {
    return (
      <Animated.View style={[
        {
          transform: [{ scale }], shadowColor: theme.brand,
          shadowOpacity: disabled ? 0 : 0.22, shadowRadius: 14,
          shadowOffset: { width: 0, height: 7 }, elevation: disabled ? 0 : 7,
        },
        full ? { alignSelf: 'stretch' } as ViewStyle : null,
        style,
      ]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityHint={accessibilityHint}
          accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading) }}
          onPress={loading || disabled ? undefined : handlePress}
          onPressIn={() => press(scalePress)}
          onPressOut={() => press(1)}
          style={webPointer}
        >
          <LinearGradient
            colors={[theme.brandGradientFrom, theme.brandGradientTo]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              borderRadius: radii.button,
              paddingVertical: padV,
              paddingHorizontal: padH,
              minHeight: minBtnHeight,
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
                <Text style={{ color: '#fff', fontFamily: typography.h3.fontFamily, fontSize: size === 'lg' ? 16 : 15, includeFontPadding: false }}>{title}</Text>
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
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading) }}
        onPress={loading || disabled ? undefined : handlePress}
        onPressIn={() => press(scalePress)}
        onPressOut={() => press(1)}
        style={[
          webPointer,
          {
            backgroundColor: bg,
            borderRadius: radii.button,
            paddingVertical: padV,
            paddingHorizontal: padH,
            minHeight: minBtnHeight,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 8,
            opacity: disabled ? 0.45 : 1,
            borderWidth: variant === 'ghost' ? 1 : 0,
            borderColor: variant === 'ghost' ? theme.line : 'transparent',
          },
        ]}
      >
        {loading ? (
          <Spinner color={fg} />
        ) : (
          <>
            {icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
            <Text style={{ color: fg, fontFamily: typography.h3.fontFamily, fontSize: size === 'lg' ? 16 : 15, includeFontPadding: false }}>{title}</Text>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

export function Spinner({ color }: { color?: string }) {
  const { theme } = useTheme();
  return <ActivityIndicator size="small" color={color ?? theme.brand} />;
}

// ───────────────────────────── Chips / Tags / Segmented ─────────────────────────────

export function Chip({ label, active, onPress, icon }: {
  label: string; active?: boolean; onPress?: () => void; icon?: keyof typeof Ionicons.glyphMap;
}) {
  const { theme } = useTheme();
  const { impactLight } = useHaptics();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(active) }}
      accessibilityLabel={label}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      onPress={onPress ? () => { impactLight(); onPress(); } : undefined}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40,
        backgroundColor: active ? theme.brand : theme.glass,
        borderRadius: radii.pill, paddingHorizontal: 14, paddingVertical: 9,
        borderWidth: 0.5,
        borderColor: active ? 'transparent' : theme.line,
        opacity: pressed ? 0.7 : 1,
        transform: [{ scale: pressed ? 0.96 : 1 }],
      })}
    >
      {icon ? <Ionicons name={icon} size={14} color={active ? theme.onBrand : theme.textSecondary} /> : null}
      <Txt variant="caption" color={active ? theme.onBrand : theme.textSecondary}>{label}</Txt>
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
  const { theme } = useTheme();
  const { impactLight } = useHaptics();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: theme.fill, borderRadius: radii.pill, padding: 3 }}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={opt.label}
            onPress={() => { impactLight(); onChange(opt.value); }}
            style={{
              flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
              backgroundColor: active ? theme.card : 'transparent',
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

export function Input({ label, value, onChange, placeholder, keyboardType, multiline, icon, error, maxLength, secure, autoCapitalize, onIconPress }: {
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
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  onIconPress?: () => void;
}) {
  const { theme } = useTheme();
  const [focused, setFocused] = useState(false);
  const dateInputRef = useRef<HTMLInputElement | null>(null);

  const handleIconClick = () => {
    if (onIconPress) {
      onIconPress();
      return;
    }
    if (Platform.OS === 'web' && icon === 'calendar' && dateInputRef.current) {
      if (typeof (dateInputRef.current as any).showPicker === 'function') {
        (dateInputRef.current as any).showPicker();
      } else {
        dateInputRef.current.focus();
      }
    }
  };

  return (
    <View style={{ alignSelf: 'stretch' }}>
      {label ? <Txt variant="caption" color={theme.textSecondary} style={{ marginBottom: 6 }}>{label}</Txt> : null}
      <View
        style={{
          flexDirection: 'row', alignItems: multiline ? 'flex-start' : 'center', gap: 10,
          backgroundColor: theme.fill,
          borderRadius: radii.button, borderWidth: error || focused ? 1.5 : 0.5,
          borderColor: error ? theme.danger : focused ? theme.brand : theme.fillBorder,
          paddingHorizontal: 16, paddingVertical: multiline ? 12 : 4, minHeight: multiline ? 96 : 54,
          shadowColor: focused ? theme.brand : 'transparent',
          shadowOpacity: focused ? 0.12 : 0,
          shadowRadius: focused ? 12 : 0,
          shadowOffset: { width: 0, height: 4 },
        }}
      >
        {icon ? (
          <Pressable
            hitSlop={8}
            onPress={handleIconClick}
            style={[Platform.OS === 'web' && (icon === 'calendar' || onIconPress) ? { cursor: 'pointer' } as any : null, { marginTop: multiline ? 10 : 0 }]}
          >
            <Ionicons name={icon} size={20} color={error ? theme.danger : focused ? theme.brand : theme.textMuted} />
          </Pressable>
        ) : null}
        <TextInput
          value={value}
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel={label ?? placeholder}
          placeholder={placeholder}
          placeholderTextColor={theme.textMuted}
          keyboardType={keyboardType}
          multiline={multiline}
          maxLength={maxLength}
          secureTextEntry={secure}
          autoCapitalize={autoCapitalize}
          textAlignVertical={multiline ? 'top' : 'center'}
          style={{
            flex: 1, color: theme.text, fontFamily: typography.body.fontFamily, fontSize: 15,
            textAlign: 'auto', paddingVertical: multiline ? 6 : 8, paddingRight: 8,
            minWidth: 0, width: '100%',
            ...(Platform.OS === 'web' ? { outlineStyle: 'none', border: 'none', background: 'transparent' } as object : {}),
          }}
        />
        {Platform.OS === 'web' && icon === 'calendar' && (
          <input
            ref={dateInputRef as any}
            type="date"
            style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
            onChange={(e) => {
              if (e.target.value) {
                onChange(e.target.value);
              }
            }}
          />
        )}
      </View>
      {error ? <Txt variant="micro" color={theme.danger} style={{ marginTop: 4 }}>{error}</Txt> : null}
    </View>
  );
}

// ───────────────────────────── تقدم ─────────────────────────────

export function ProgressBar({ progress, color, height = 8, track }: {
  progress: number; color?: string; height?: number; track?: string;
}) {
  const { theme } = useTheme();
  const anim = useRef(new Animated.Value(0)).current;
  const pct = Math.min(100, Math.max(0, Math.round(progress * 100)));
  useEffect(() => {
    Animated.timing(anim, {
      toValue: Math.min(1, Math.max(0, progress)),
      duration: isReducedMotion() ? 200 : 600,
      easing: easing.standard, useNativeDriver: false,
    }).start();
  }, [progress, anim]);
  const width = anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      style={{ height, borderRadius: height, backgroundColor: theme.fill, overflow: 'hidden' }}
    >
      <Animated.View style={{ height, borderRadius: height, backgroundColor: color ?? theme.brand, width }} />
    </View>
  );
}

export function StatRing({ size = 72, stroke = 7, progress, color, children }: {
  size?: number; stroke?: number; progress: number; color?: string; children?: React.ReactNode;
}) {
  const { theme } = useTheme();
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
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={theme.fill} strokeWidth={stroke} fill="none" />
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
    if (isReducedMotion()) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: urgent ? 1.18 : 1.06, duration: urgent ? 520 : 1200, easing: easing.inOut, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: urgent ? 520 : 1200, easing: easing.inOut, useNativeDriver: true }),
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
      <Text style={{ color: '#fff', fontFamily: typography.h3.fontFamily, fontSize: size * 0.34, includeFontPadding: false }}>{initials}</Text>
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
    let frame = 0;
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / dur);
      const easedVal = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (value - from) * easedVal));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, dur]);
  return <Txt variant={variant} color={color}>{String(display)}</Txt>;
}

// ───────────────────────────── أنيميشن دخول متدرج ─────────────────────────────

export function FadeIn({ children, index = 0, delay = 0, style }: { children: React.ReactNode; index?: number; delay?: number; style?: ViewStyle | ViewStyle[] }) {
  const anim = useRef(new Animated.Value(0)).current;
  const runningAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    const finalDelay = delay > 0 ? Math.min(delay, 420) : staggerDelay(index);
    if (isReducedMotion()) {
      anim.setValue(1);
    } else {
      const springAnim = Animated.spring(anim, {
        toValue: 1,
        useNativeDriver: true,
        damping: 20,
        stiffness: 150,
      });
      const composed = finalDelay > 0
        ? Animated.sequence([Animated.delay(finalDelay), springAnim])
        : springAnim;
      runningAnimRef.current = composed;
      composed.start();
    }
    return () => {
      runningAnimRef.current?.stop();
    };
  }, [anim, index, delay]);

  return (
    <Animated.View style={[{
      opacity: anim,
      transform: [
        { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: isReducedMotion() ? [0, 0] : [12, 0] }) },
        { scale: anim.interpolate({ inputRange: [0, 1], outputRange: isReducedMotion() ? [1, 1] : [0.97, 1] }) }
      ],
    }, style]}>
      {children}
    </Animated.View>
  );
}

/** قائمة بتأخير متدرج — كل عنصر يظهر بعد الذي قبله */
export function StaggeredList({ children, baseDelay = 50, style }: {
  children: React.ReactNode[];
  baseDelay?: number;
  style?: ViewStyle;
}) {
  return (
    <View style={style}>
      {React.Children.map(children, (child, i) => (
        <FadeIn delay={i * baseDelay} key={i}>
          {child}
        </FadeIn>
      ))}
    </View>
  );
}

// ───────────────────────────── حالات فارغة / خطأ ─────────────────────────────

export function Empty({ emoji, title, body, cta, onCta }: {
  emoji: string; title: string; body?: string; cta?: string; onCta?: () => void;
}) {
  const { theme } = useTheme();
  return (
    <FadeIn>
      <View style={{ alignItems: 'center', paddingVertical: spacing.s10, paddingHorizontal: spacing.s6, gap: 12 }}>
        <View
          accessible={false}
          style={{
            width: 92, height: 92, borderRadius: 30,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: theme.brandSoft,
            borderWidth: 1, borderColor: `${theme.brand}22`,
            transform: [{ rotate: '-3deg' }],
          }}
        >
          <Text accessible={false} style={{ fontSize: 44, transform: [{ rotate: '3deg' }] }}>{emoji}</Text>
        </View>
        <Txt variant="h2" align="center">{title}</Txt>
        {body ? <Txt variant="body" color={theme.textSecondary} align="center" style={{ maxWidth: 340 }}>{body}</Txt> : null}
        {cta && onCta ? <View style={{ marginTop: 10 }}><Btn title={cta} onPress={onCta} icon="arrow-forward" /></View> : null}
      </View>
    </FadeIn>
  );
}

// ───────────────────────────── Shimmer / Skeleton ─────────────────────────────

export function Shimmer({ width = '100%', height = 14, radius = 10, style }: {
  width?: number | string; height?: number; radius?: number; style?: ViewStyle;
}) {
  const { theme } = useTheme();
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (isReducedMotion()) {
      anim.setValue(0.55);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 900, easing: easing.inOut, useNativeDriver: true }),
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
        backgroundColor: theme.fill,
        opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.9] }),
      }, style]}
    />
  );
}

export function SkeletonCard({ height = 120, style }: { height?: number; style?: ViewStyle }) {
  return (
    <Card style={[{ gap: 10, padding: spacing.s4, minHeight: height }, style] as any}>
      <Row center gap={12}>
        <Shimmer width={48} height={48} radius={16} />
        <View style={{ flex: 1, gap: 6 }}>
          <Shimmer width="70%" height={16} radius={8} />
          <Shimmer width="45%" height={12} radius={6} />
        </View>
      </Row>
      <Spacer size={4} />
      <Shimmer width="90%" height={10} radius={6} />
    </Card>
  );
}

export function SkeletonList({ count = 3, height = 100 }: { count?: number; height?: number }) {
  return (
    <View style={{ gap: 12 }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} height={height} />
      ))}
    </View>
  );
}

export { useDebounce, useHaptics } from '../shared/hooks';

// ───────────────────────────── Header / Screen ─────────────────────────────

export function Header({ title, subtitle, back, right }: {
  title: string; subtitle?: string; back?: () => void; right?: React.ReactNode;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingHorizontal: spacing.s5, paddingTop: insets.top + spacing.s3, paddingBottom: spacing.s3 }}>
      <Row between center>
        <Row center gap={12} style={{ flex: 1 }}>
          {back ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.back')}
              hitSlop={8}
              onPress={back}
              style={({ pressed }) => ({
              width: 44, height: 44, borderRadius: 15,
              backgroundColor: theme.fill,
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

export function DisclosureIcon({ color, size = 18 }: { color: string; size?: number }) {
  const { rtl } = useI18n();
  return <Ionicons name={rtl ? 'chevron-back' : 'chevron-forward'} size={size} color={color} />;
}

// ───────────────────────────── ورقة سفلية ─────────────────────────────

export function Sheet({ visible, onClose, children, title }: {
  visible: boolean; onClose: () => void; children: React.ReactNode; title?: string;
}) {
  const { theme, isDark } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (visible) {
      if (isReducedMotion()) anim.setValue(1);
      else Animated.spring(anim, { toValue: 1, useNativeDriver: true, damping: 22, stiffness: 200 }).start();
    } else {
      anim.setValue(0);
    }
  }, [visible, anim]);
  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: theme.overlay }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            style={StyleSheet.absoluteFill}
            onPress={onClose}
          >
            <BlurView intensity={isDark ? 20 : 12} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          </Pressable>

          <Animated.View
            accessibilityViewIsModal
            style={{
              width: '100%', maxWidth: 620, alignSelf: 'center',
              backgroundColor: theme.card,
              borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl,
              paddingHorizontal: spacing.s5, paddingTop: spacing.s4,
              paddingBottom: Platform.OS === 'web' ? 28 : spacing.s8 + insets.bottom,
              maxHeight: '92%',
              borderWidth: 1,
              borderBottomWidth: 0,
              borderColor: theme.glassBorder,
              shadowColor: '#000',
              shadowOpacity: 0.28,
              shadowRadius: 36,
              shadowOffset: { width: 0, height: -12 },
              transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [800, 0] }) }],
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <View style={{ alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: theme.separator, marginBottom: 12 }} />
            
            {title ? (
              <Row between center style={{ marginBottom: 12 }}>
                <Txt variant="h2" style={{ flex: 1 }}>{title}</Txt>
                <View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('common.close') || 'Close dialog'}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    onPress={onClose}
                    style={[webPointer, { width: 32, height: 32, borderRadius: 16, backgroundColor: theme.line, alignItems: 'center', justifyContent: 'center' }]}
                  >
                    <Ionicons name="close" size={18} color={theme.textSecondary} />
                  </Pressable>
                </View>
              </Row>
            ) : null}

            <View style={{ flex: 1, minHeight: 0 }}>
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
                {children}
              </ScrollView>
            </View>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
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
  const { theme } = useTheme();
  const { impactLight } = useHaptics();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={title}
      onPress={onPress ? () => { impactLight(); onPress(); } : undefined}
      style={({ pressed }) => ([
        webPointer,
        {
          flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 68,
          backgroundColor: theme.glass,
          borderRadius: radii.cardSm, padding: 14,
          borderWidth: 0.5,
          borderColor: theme.glassBorder,
          opacity: pressed ? 0.7 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ])}
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
  const { theme } = useTheme();
  const { impactLight } = useHaptics();
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(anim, { toValue: value ? 1 : 0, useNativeDriver: false, damping: 22, stiffness: 260 }).start();
  }, [value, anim]);
  const bg = anim.interpolate({ inputRange: [0, 1], outputRange: [
    theme.fillStrong,
    color ?? theme.brand,
  ]});
  const translate = anim.interpolate({ inputRange: [0, 1], outputRange: [2, 22] });
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={() => { impactLight(); onChange(!value); }}
      hitSlop={8}
    >
      <Animated.View style={{ width: 51, height: 31, borderRadius: 16, backgroundColor: bg, justifyContent: 'center', direction: 'ltr' }}>
        <Animated.View style={{ width: 27, height: 27, borderRadius: 14, backgroundColor: '#fff', transform: [{ translateX: translate }], shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 }} />
      </Animated.View>
    </Pressable>
  );
}

// ───────────────────────────── نجوم التقييم ─────────────────────────────

export function Stars({ value, size = 16, onRate }: { value: number; size?: number; onRate?: (v: number) => void }) {
  const { theme } = useTheme();
  const { impactLight } = useHaptics();
  return (
    <Row gap={2}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Pressable
          key={i}
          accessibilityRole={onRate ? 'radio' : 'image'}
          accessibilityLabel={`${i} / 5`}
          accessibilityState={onRate ? { checked: i === Math.round(value) } : undefined}
          onPress={onRate ? () => { impactLight(); onRate(i); } : undefined}
          disabled={!onRate}
          hitSlop={4}
        >
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
