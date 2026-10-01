/**
 * design/components.tsx — كتالوج المكونات الموحدة بتصميم Apple Liquid Glass.
 * كل مكون من التوكنز فقط — لا ألوان حرفية. RTL تلقائي.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing, KeyboardAvoidingView, Modal, Platform, Pressable,
  StyleSheet, Text, TextInput, View, ViewStyle, TextStyle, ScrollView,
} from 'react-native';
import { BlurView } from 'expo-blur';
import Svg, { Circle, Path } from 'react-native-svg';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from './theme';
import {
  borderWidth, blurIntensity, columnsFor, componentTokens, fonts, hitSlop, layout, radii,
  scaleType, shadows, spacing, springs, typography,
} from './tokens';
import { isReducedMotion, pressScale, staggerDelay } from './motion';
import { useI18n } from '../i18n';
import { useHaptics } from '../shared/hooks';
import { Icon } from './icons';
import { webInputReset } from './a11y/focus';
import { announce } from './a11y/announce';
import { useFocusTrap } from './a11y/useFocusTrap';
import { rovingTabIndex, useRovingKeys } from './a11y/roving';
import { navigationRef, safeBack } from '../app/navRef';

// ───────────────────────────── نصوص ─────────────────────────────

type TxtVariant = keyof typeof typography;

/** على الويب: صفر min-width حتى ينكمش النص داخل صفوف flex بدل دفع المحتوى للخارج. */
const webTextShrink = Platform.OS === 'web' ? ({ minWidth: 0 } as unknown as TextStyle) : null;

export function Txt({
  children, variant = 'body', color, align, style, numberOfLines, bold, shrink,
  heading, id,
}: {
  children: React.ReactNode;
  variant?: TxtVariant;
  color?: string;
  align?: TextStyle['textAlign'];
  style?: TextStyle | TextStyle[];
  numberOfLines?: number;
  bold?: boolean;
  /** يسمح بتصغير النص ليطابق سطرًا واحدًا بدل قصّه (نص عربي طويل). */
  shrink?: boolean;
  /**
   * A11Y-02: يحوّل النص إلى عنوان دلالي حقيقي.
   * على الويب يُنتج `<h1>/<h2>/<h3>` حقيقيًا (لأن `role=heading` + `aria-level`
   * يُترجمان إلى وسم العنوان)، وعلى الجوال يُعلنه قارئ الشاشة كـ"عنوان".
   */
  heading?: 'h1' | 'h2' | 'h3';
  /** معرّف العنصر (للربط بـ aria-labelledby في الأقسام). */
  id?: string;
}) {
  const { theme, windowWidth } = useTheme();
  // سلم نصوص متجاوب مع معايرة الخط العربي (1.35x fontSize لمنع قص الحروف الممتدة).
  // العرض من سياق الثيم (CMP-05) — اشتراك واحد في أعلى الشجرة بدل اشتراك لكل نص.
  const base = scaleType(typography[variant], windowWidth);
  const calibratedLineHeight = Math.max(base.lineHeight, Math.round(base.fontSize * 1.35));
  const headingA11y = heading
    ? {
        accessibilityRole: 'header' as const,
        ...(Platform.OS === 'web'
          ? ({
              role: 'heading',
              'aria-level': heading === 'h1' ? 1 : heading === 'h2' ? 2 : 3,
              // A11Y-13: يُسمح بنقل التركيز إلى عنوان الشاشة عند الانتقال (نمط SPA).
              tabIndex: -1,
            } as unknown as object)
          : {}),
      }
    : null;
  return (
    <Text
      id={id}
      numberOfLines={numberOfLines}
      {...(headingA11y as object)}
      // قصّ سطر واحد على العربية بلا تصغير = حروف مبتورة؛ نفعّل التصغير التلقائي.
      adjustsFontSizeToFit={shrink ?? (numberOfLines === 1 ? true : undefined)}
      minimumFontScale={numberOfLines === 1 || shrink ? 0.85 : undefined}
      allowFontScaling
      maxFontSizeMultiplier={2}
      style={[
        // includeFontPadding=false يجعل ارتفاع السطر مطابقًا لـ lineHeight
        // فلا تُقصّ امتدادات الحروف العربية ولا تتزحزح النصوص عن مركزها (أندرويد).
        { includeFontPadding: false },
        // LAYOUT-02: في React Native الافتراضي `flexShrink: 0` (عكس الويب) ⇒ أي نص
        // عربي طويل داخل صف يمدّ الصف خارج الشاشة بدل أن يلتف. نجعله قابلًا
        // للانكماش دائمًا؛ الانكماش لا يحدث إلا عند التجاوز فعلًا.
        { flexShrink: 1 },
        // على الويب عنصر flex لا ينكمش تحت «أعرض كلمة» ما لم نصفر min-width.
        webTextShrink,
        { color: color ?? theme.text, textAlign: align ?? 'auto' },
        base,
        { lineHeight: calibratedLineHeight },
        // DS-04: كان يستخدم h3 (SemiBold 600) — أي أن `bold` لم يكن Bold أصلًا.
        bold ? { fontFamily: fonts.bold } : null,
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
        // minWidth: 0 — عنصر flex على الويب لا ينكمش تحت «أعرض كلمة» افتراضيًا،
        // فكان الصف المتداخل (صف داخل صف) يدفع إخوته خارج عرض الشاشة.
        { flexDirection: 'row', alignItems: center ? 'center' : 'flex-start', minWidth: 0 },
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

export function Spacer({ size = spacing.s2 }: { size?: number }) {
  return <View style={{ height: size, width: size }} />;
}

/**
 * شبكة أعمدة تتكيّف مع عرضها الحقيقي (LAYOUT-01).
 *
 * بديل صفوف `Row` ذات عدد الأعمدة الثابت: تقيس عرضها بـ `onLayout` ثم تختار
 * أكبر عدد أعمدة يتّسع فيه كل عمود لعرض ≥ `minColumnWidth`، وإلا تنزل لعمود
 * أقل — فتبقى البطاقات بأبعاد صحيحة على 320pt مثلما على التابلت.
 *
 * قبل أول قياس (أول إطار) نستخدم `flexBasis` = أدنى عرض، فيلتف المحتوى تلقائيًا
 * بلا قفزة بصرية تُذكر.
 */
export function AutoGrid({ children, gap = spacing.s3, minColumnWidth = layout.minColumn.stat, style }: {
  children: React.ReactNode;
  gap?: number;
  /** أدنى عرض عمود مقبول قبل الانتقال لعدد أعمدة أقل. */
  minColumnWidth?: number;
  style?: ViewStyle | ViewStyle[];
}) {
  const { windowWidth } = useTheme();
  const items = useMemo(() => React.Children.toArray(children).filter(Boolean), [children]);
  const [width, setWidth] = useState(0);

  const cols = useMemo(() => {
    // قبل أول قياس نستخدم عرض النافذة مطروحًا منه الحشوة الجانبية القياسية —
    // تقدير أولي دقيق على الموبايل (العرض = عرض المحتوى) وبلا قفزة تُذكر.
    const avail = width > 0 ? width : Math.max(minColumnWidth, windowWidth - spacing.s5 * 2);
    return columnsFor(avail, Math.max(items.length, 1), minColumnWidth, gap);
  }, [width, windowWidth, gap, minColumnWidth, items.length]);

  const cell = width > 0 ? (width - gap * (cols - 1)) / cols : undefined;

  return (
    <View
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0 && Math.abs(w - width) > 0.5) setWidth(w);
      }}
      style={[{ flexDirection: 'row', flexWrap: 'wrap', gap }, style]}
    >
      {items.map((child, i) => (
        <View
          key={i}
          // الخلية صفّ أفقي: كثير من البطاقات تحمل `flex: 1` داخليًا، وفي عمود
          // رأسي (flexBasis: 0) كان سينهار ارتفاعها إلى صفر؛ أفقيًا تملأ العرض
          // ويظل الارتفاع تلقائيًا، والصفوف تتساوى بـ align-items: stretch.
          style={cell != null
            ? { flexDirection: 'row', width: cell }
            : { flexDirection: 'row', flexGrow: 1, flexShrink: 1, flexBasis: minColumnWidth }}
        >
          {child}
        </View>
      ))}
    </View>
  );
}

const webPointer = Platform.OS === 'web' ? ({ cursor: 'pointer' } as unknown as ViewStyle) : null;

// ───────────────────────────── بطاقات زجاجية ─────────────────────────────

export function Card({ children, style, color, noPad, onPress, solid, heavy, accessibilityLabel, accessibilityHint }: {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  color?: string;
  noPad?: boolean;
  onPress?: () => void;
  /** بطاقة معتمة بلا ضبابية (للحالات التي تحتاج تباينًا كاملًا) */
  solid?: boolean;
  /** ضبابية حقيقية للحالات الاستثنائية فقط (hero/عائم) — الافتراضي سطح زجاجي بلا blur للأداء */
  heavy?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const { theme, isDark } = useTheme();
  const { impactLight } = useHaptics();
  const scale = useRef(new Animated.Value(1)).current;
  const useGlass = !solid && !color;

  const pressIn = () => {
    if (onPress) Animated.spring(scale, { toValue: pressScale.default, useNativeDriver: true, ...springs.default }).start();
  };
  const pressOut = () => {
    if (onPress) Animated.spring(scale, { toValue: 1, useNativeDriver: true, ...springs.default }).start();
  };

  const shell: ViewStyle = {
    borderRadius: radii.xl,
    borderWidth: borderWidth.thin,
    borderColor: theme.glassBorder,
    padding: noPad ? 0 : spacing.s4,
    shadowColor: theme.glassShadow,
    ...(isDark ? shadows.card.dark : shadows.card.light),
    overflow: 'hidden',
  };

  const content = (
    <Animated.View style={[shell, { backgroundColor: useGlass ? theme.glass : color ?? theme.card, transform: [{ scale }] }, style]}>
      {useGlass && heavy ? (
        <BlurView
          intensity={isDark ? blurIntensity.heavyCard.dark : blurIntensity.heavyCard.light}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      ) : null}
      {useGlass ? (
        <LinearGradient
          colors={[
            isDark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(255, 255, 255, 0.65)',
            isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(255, 255, 255, 0.12)',
            'transparent',
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 1.5,
          }}
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
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
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
  // A11Y-21: نصوص الأزرار تستخدم طبقة النصوص الدلالية (≥ 4.5:1) لا الألوان العلامية.
  const fg =
    variant === 'primary' ? theme.onBrand
    : variant === 'secondary' ? theme.brandText
    : variant === 'danger' ? theme.textDanger
    : variant === 'success' ? theme.textSuccess
    : variant === 'gold' ? '#3D2B00'
    : theme.textSecondary;
  const padV = size === 'lg' ? 14 : size === 'md' ? 11 : 8;
  const padH = size === 'lg' ? 22 : size === 'md' ? 16 : 11;
  const minBtnHeight = size === 'lg' ? 52 : size === 'md' ? 44 : 38;

  const press = (v: number) =>
    Animated.spring(scale, { toValue: v, useNativeDriver: true, ...springs.default }).start();

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
          onPressIn={() => press(pressScale.default)}
          onPressOut={() => press(1)}
          style={webPointer}
        >
          <LinearGradient
            colors={[theme.actionPrimary, theme.actionPrimaryTo]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              borderRadius: radii.lg,
              paddingVertical: padV,
              paddingHorizontal: padH,
              minHeight: minBtnHeight,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: spacing.s2,
              opacity: disabled ? 0.45 : 1,
            }}
          >
            {loading ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.s2 }}>
                <Spinner color="#fff" />
                <Text style={{ color: '#fff', fontFamily: typography.h3.fontFamily, fontSize: size === 'lg' ? 16 : 15, includeFontPadding: false, opacity: 0.9 }}>{title}</Text>
              </View>
            ) : (
              <>
                {icon ? (
                  <Icon name={icon} size={18} color="#fff" decorative />
                ) : null}
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
        onPressIn={() => press(pressScale.default)}
        onPressOut={() => press(1)}
        style={[
          webPointer,
          {
            backgroundColor: bg,
            borderRadius: radii.lg,
            paddingVertical: padV,
            paddingHorizontal: padH,
            minHeight: minBtnHeight,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: spacing.s2,
            opacity: disabled ? 0.45 : 1,
            borderWidth: variant === 'ghost' ? 1 : 0,
            borderColor: variant === 'ghost' ? theme.line : 'transparent',
          },
        ]}
      >
        {loading ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.s2 }}>
            <Spinner color={fg} />
            <Text style={{ color: fg, fontFamily: typography.h3.fontFamily, fontSize: size === 'lg' ? 16 : 15, includeFontPadding: false, opacity: 0.9 }}>{title}</Text>
          </View>
        ) : (
          <>
            {icon ? (
              <Icon name={icon} size={18} color={fg} decorative />
            ) : null}
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
      hitSlop={{ top: hitSlop.small, bottom: hitSlop.small, left: hitSlop.small, right: hitSlop.small }}
      onPress={onPress ? () => { impactLight(); onPress(); } : undefined}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center',
        gap: componentTokens.chip.gap,
        minHeight: componentTokens.chip.minHeight,
        backgroundColor: active ? theme.brand : theme.glass,
        borderRadius: radii.full,
        paddingHorizontal: componentTokens.chip.paddingHorizontal,
        paddingVertical: componentTokens.chip.paddingVertical,
        borderWidth: borderWidth.hairline,
        borderColor: active ? 'transparent' : theme.line,
        opacity: pressed ? 0.7 : 1,
        transform: [{ scale: pressed ? pressScale.strong : 1 }],
      })}
    >
      {icon ? <Icon name={icon} size={componentTokens.chip.iconSize} color={active ? theme.onBrand : theme.textSecondary} /> : null}
      <Txt variant="caption" color={active ? theme.onBrand : theme.textSecondary}>{label}</Txt>
    </Pressable>
  );
}

export function Tag({ label, color, bg, icon }: { label: string; color: string; bg: string; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center',
      gap: componentTokens.tag.gap,
      backgroundColor: bg, borderRadius: radii.full,
      paddingHorizontal: componentTokens.tag.paddingHorizontal,
      paddingVertical: componentTokens.tag.paddingVertical,
      alignSelf: 'flex-start',
    }}>
      {icon ? <Icon name={icon} size={componentTokens.tag.iconSize} color={color} /> : null}
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
  // A11Y-14: ←/→ (مع انعكاس RTL) + Home/End تنقل بين التبويبات وتُحدّث القيمة.
  const activeIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const rovingRefs = useRovingKeys({
    count: options.length,
    onMove: (index) => {
      const opt = options[index];
      if (opt && opt.value !== value) { impactLight(); onChange(opt.value); }
    },
  });
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: theme.fill, borderRadius: radii.full, padding: componentTokens.segmented.padding }}>
      {options.map((opt, index) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            ref={(el: any) => { rovingRefs.current[index] = el as HTMLElement | null; }}
            {...rovingTabIndex(index, activeIndex)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={opt.label}
            onPress={() => { impactLight(); onChange(opt.value); }}
            style={{
              flex: 1, flexDirection: 'row', gap: componentTokens.segmented.gap, alignItems: 'center', justifyContent: 'center',
              backgroundColor: active ? theme.card : 'transparent',
              borderRadius: radii.full, paddingVertical: componentTokens.segmented.paddingVertical,
              shadowColor: theme.glassShadow,
              ...(active ? shadows.control : { shadowOpacity: 0, shadowRadius: 0 }),
            }}
          >
            {opt.icon ? <Icon name={opt.icon} size={componentTokens.segmented.iconSize} color={active ? theme.brand : theme.textMuted} /> : null}
            <Txt variant="caption" color={active ? theme.text : theme.textMuted}>{opt.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

// ───────────────────────────── حقول إدخال ─────────────────────────────

export function Input({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  multiline,
  icon,
  error,
  maxLength,
  secure,
  autoCapitalize,
  autoComplete,
  textContentType,
  inputMode,
  onIconPress,
  onSubmitEditing,
  returnKeyType,
  autoFocus,
  width,
  accessibilityLabel,
}: {
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
  autoComplete?: 'off' | 'name' | 'tel' | 'email' | 'username' | 'current-password' | 'new-password' | 'one-time-code' | 'organization' | 'street-address';
  textContentType?: 'none' | 'name' | 'telephoneNumber' | 'emailAddress' | 'username' | 'password' | 'newPassword' | 'oneTimeCode' | 'organizationName' | 'fullStreetAddress';
  inputMode?: 'none' | 'text' | 'decimal' | 'numeric' | 'tel' | 'search' | 'email' | 'url';
  onIconPress?: () => void;
  onSubmitEditing?: () => void;
  returnKeyType?: 'done' | 'go' | 'next' | 'search' | 'send';
  autoFocus?: boolean;
  /** عرض مقيّد (مثلًا حقول HH:MM) — القيمة من `sizes` في tokens. */
  width?: number;
  /** تسمية للحقل نفسه لبرامج قراءة الشاشة (لا تُعرَض بصريًا). */
  accessibilityLabel?: string;
}) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const [focused, setFocused] = useState(false);
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const errorId = React.useId();

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

  const isInteractiveIcon = Boolean(onIconPress || (Platform.OS === 'web' && icon === 'calendar'));

  return (
    <View style={width ? { width, alignSelf: 'center' } : { alignSelf: 'stretch' }}>
      {label ? (
        <Txt
          variant="caption"
          color={theme.textSecondary}
          numberOfLines={1}
          style={{ marginBottom: 6, textAlign: 'center' }}
        >
          {label}
        </Txt>
      ) : null}
      <View
        style={{
          flexDirection: 'row', alignItems: multiline ? 'flex-start' : 'center', gap: componentTokens.input.gap,
          backgroundColor: theme.fill,
          borderRadius: radii.lg, borderWidth: error || focused ? borderWidth.medium : borderWidth.hairline,
          borderColor: error ? theme.danger : focused ? theme.brand : theme.fillBorder,
          paddingHorizontal: componentTokens.input.paddingHorizontal,
          paddingVertical: multiline ? componentTokens.input.paddingVerticalMultiline : componentTokens.input.paddingVertical,
          minHeight: multiline ? componentTokens.input.minHeightMultiline : componentTokens.input.minHeight,
          shadowColor: focused ? theme.brand : 'transparent',
          shadowOpacity: focused ? 0.12 : 0,
          shadowRadius: focused ? 12 : 0,
          shadowOffset: { width: 0, height: 4 },
        }}
      >
        {icon ? (
          isInteractiveIcon ? (
            <Pressable
              hitSlop={hitSlop.default}
              accessibilityRole="button"
              accessibilityLabel={label ?? t('a11y.insightAction')}
              onPress={handleIconClick}
              style={[Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null, { marginTop: multiline ? 10 : 0 }]}
            >
              <Icon name={icon} size={componentTokens.input.iconSize} color={error ? theme.danger : focused ? theme.brand : theme.textMuted} />
            </Pressable>
          ) : (
            <View
              accessible={false}
              aria-hidden={true}
              style={{ marginTop: multiline ? 10 : 0 }}
            >
              <Icon name={icon} size={componentTokens.input.iconSize} color={error ? theme.danger : focused ? theme.brand : theme.textMuted} />
            </View>
          )
        ) : null}
        <TextInput
          value={value}
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={onSubmitEditing}
          returnKeyType={returnKeyType}
          autoFocus={autoFocus}
          onKeyPress={(e: any) => {
            if (!multiline && onSubmitEditing && (e.key === 'Enter' || e.nativeEvent?.key === 'Enter')) {
              onSubmitEditing();
            }
          }}
          accessibilityLabel={accessibilityLabel ?? label ?? placeholder}
          placeholder={placeholder}
          placeholderTextColor={theme.textMuted}
          keyboardType={keyboardType}
          multiline={multiline}
          maxLength={maxLength}
          secureTextEntry={secure}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          textContentType={textContentType}
          inputMode={inputMode}
          {...(Platform.OS === 'web'
            ? ({
                'aria-invalid': Boolean(error),
                ...(error ? { 'aria-errormessage': errorId, 'aria-describedby': errorId } : {}),
              } as unknown as object)
            : {})}
          textAlignVertical={multiline ? 'top' : 'center'}
          style={{
            flex: 1, color: theme.text, fontFamily: typography.body.fontFamily, fontSize: 15,
            textAlign: width ? 'center' : 'auto', paddingVertical: multiline ? 6 : 8, paddingRight: 8,
            minWidth: 0, width: '100%',
            ...webInputReset,
          }}
        />
        {value.length > 0 && !multiline ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('a11y.clearInput')}
            hitSlop={hitSlop.default}
            onPress={() => onChange('')}
            style={({ pressed }) => ({
              opacity: pressed ? 0.7 : 0.45,
              cursor: Platform.OS === 'web' ? ('pointer' as any) : undefined,
            })}
          >
            <Icon name="close-circle" size={18} color={theme.textMuted} />
          </Pressable>
        ) : null}
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
      {error ? (
        <View
          nativeID={errorId}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          {...(Platform.OS === 'web' ? ({ id: errorId, role: 'alert' } as unknown as object) : {})}
        >
          <Txt variant="micro" color={theme.danger} style={{ marginTop: 4 }}>{error}</Txt>
        </View>
      ) : null}
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
    const toValue = Math.min(1, Math.max(0, progress));
    if (isReducedMotion()) {
      Animated.timing(anim, { toValue, duration: 200, useNativeDriver: false }).start();
    } else {
      // انتقال تقدّم = spring موحّد (DS-08) — لم يعد هناك نظام easing موازٍ.
      Animated.spring(anim, { toValue, useNativeDriver: false, ...springs.default }).start();
    }
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
    // حلقة نبض مستمرة — Easing هنا ليس «نظام حركة» بل دورة بلا هدف (انظر motion.ts).
    const loopEasing = Easing.inOut(Easing.ease);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: urgent ? 1.18 : 1.06, duration: urgent ? 520 : 1200, easing: loopEasing, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: urgent ? 520 : 1200, easing: loopEasing, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [urgent, pulse]);
  return (
    <Animated.View style={{ transform: [{ scale: pulse }] }}>
      <Icon name="flame" size={size} color={urgent ? '#FF3B30' : '#FF9F0A'} />
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
  return <Txt variant={variant} color={color} style={{ fontVariant: ['tabular-nums'] }}>{String(display)}</Txt>;
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
      // إيقاع أقسام موحّد (توكن s3): كل أطفال القسم متباعدون حتى لو كانت
      // كروتًا مرسومة عبر map — كانت «لازقة» لأن الـgap بكان على الحاوية الأم فقط.
      gap: spacing.s3,
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
      <View style={{ alignItems: 'center', paddingVertical: spacing.s10, paddingHorizontal: spacing.s6, gap: spacing.s3 }}>
        <View
          accessible={false}
          style={{
            width: componentTokens.emptyState.iconBox, height: componentTokens.emptyState.iconBox,
            borderRadius: componentTokens.emptyState.iconBoxRadius,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: theme.brandSoft,
            borderWidth: borderWidth.thin, borderColor: `${theme.brand}22`,
            transform: [{ rotate: '-3deg' }],
          }}
        >
          <Text accessible={false} style={{ fontSize: componentTokens.emptyState.emojiSize, transform: [{ rotate: '3deg' }] }}>{emoji}</Text>
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
    const loopEasing = Easing.inOut(Easing.ease);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 900, easing: loopEasing, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 700, easing: loopEasing, useNativeDriver: true }),
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
    <Card style={[{ gap: spacing.s3, padding: spacing.s4, minHeight: height }, style] as any}>
      <Row center gap={spacing.s3}>
        <Shimmer width={48} height={48} radius={16} />
        <View style={{ flex: 1, gap: spacing.s2 }}>
          <Shimmer width="70%" height={16} radius={8} />
          <Shimmer width="45%" height={12} radius={6} />
        </View>
      </Row>
      <Spacer size={spacing.s1} />
      <Shimmer width="90%" height={10} radius={6} />
    </Card>
  );
}

export function SkeletonList({ count = 3, height = 100 }: { count?: number; height?: number }) {
  return (
    <View style={{ gap: spacing.s3 }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} height={height} />
      ))}
    </View>
  );
}

export { useDebounce, useHaptics } from '../shared/hooks';

// ───────────────────────────── Header / Screen ─────────────────────────────

export function Header({ title, subtitle, back, right, onSubtitlePress, onTitlePress }: {
  title: string; subtitle?: string; back?: () => void; right?: React.ReactNode;
  onSubtitlePress?: () => void; onTitlePress?: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const titleId = React.useId();

  // A11Y-13 + WEB-03: عند تركيب رأس شاشة جديد (انتقال داخل التطبيق) ننقل التركيز إلى
  // العنوان على الويب ليقرأه قارئ الشاشة فورًا، ونضبط document.title، ونُعلنه صوتيًا على الجوال.
  useEffect(() => {
    if (!title) return;
    if (Platform.OS === 'web') {
      if (typeof document !== 'undefined') {
        document.title = `${title} — ${t('common.appName')}`;
      }
      const el = typeof document !== 'undefined' ? document.getElementById(titleId) : null;
      if (el && typeof (el as unknown as HTMLElement).focus === 'function') {
        (el as unknown as HTMLElement).focus({ preventScroll: true });
      }
      return;
    }
    announce(title, 'polite');
  }, [title, titleId, t]);

  return (
    <View
      {...(Platform.OS === 'web' ? ({ role: 'banner' } as unknown as object) : {})}
      style={{ paddingHorizontal: spacing.s5, paddingTop: insets.top + spacing.s3, paddingBottom: spacing.s3 }}
    >
      <Row between center>
        <Row center gap={spacing.s3} style={{ flex: 1 }}>
          {back ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.back')}
              hitSlop={hitSlop.default}
              onPress={() => {
                const beforeKey = navigationRef.isReady() ? navigationRef.getCurrentRoute()?.key : undefined;
                back();
                const afterKey = navigationRef.isReady() ? navigationRef.getCurrentRoute()?.key : undefined;
                if (beforeKey && beforeKey === afterKey && navigationRef.isReady() && !navigationRef.canGoBack()) {
                  safeBack();
                }
              }}
              style={({ pressed }) => ({
              width: componentTokens.backButton.size, height: componentTokens.backButton.size,
              borderRadius: componentTokens.backButton.radius,
              backgroundColor: theme.fill,
              alignItems: 'center', justifyContent: 'center',
              opacity: pressed ? 0.7 : 1,
            })}>
              <BackIcon color={theme.text} />
            </Pressable>
          ) : null}
          <View style={{ flex: 1 }}>
            {onTitlePress ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={title}
                onPress={onTitlePress}
                style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
              >
                <Txt variant="h1" numberOfLines={1} heading="h1" id={titleId}>{title}</Txt>
              </Pressable>
            ) : (
              <Txt variant="h1" numberOfLines={1} heading="h1" id={titleId}>{title}</Txt>
            )}
            {subtitle ? (
              onSubtitlePress ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={subtitle}
                  onPress={onSubtitlePress}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.s1,
                    opacity: pressed ? 0.75 : 1,
                    transform: [{ scale: pressed ? pressScale.subtle : 1 }],
                  })}
                >
                  <Txt variant="caption" color={theme.textSecondary}>{subtitle}</Txt>
                  <Icon name="chevron-forward" size={12} color={theme.textMuted} style={{ opacity: 0.7 }} />
                </Pressable>
              ) : (
                <Txt variant="caption" color={theme.textSecondary}>{subtitle}</Txt>
              )
            ) : null}
          </View>
        </Row>
        {right}
      </Row>
    </View>
  );
}

export function BackIcon({ color }: { color: string }) {
  const { rtl } = useI18n();
  return <Icon name={rtl ? 'chevron-forward' : 'chevron-back'} size={22} color={color} />;
}

export function DisclosureIcon({ color, size = 18 }: { color: string; size?: number }) {
  const { rtl } = useI18n();
  return <Icon name={rtl ? 'chevron-back' : 'chevron-forward'} size={size} color={color} />;
}

// ───────────────────────────── ورقة سفلية ─────────────────────────────

export function Sheet({ visible, onClose, children, title }: {
  visible: boolean; onClose: () => void; children: React.ReactNode; title?: string;
}) {
  const { theme, isDark } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;
  // A11Y-12: حصر التركيز داخل اللوح + إغلاق بـEscape + إرجاع التركيز عند الإغلاق
  const trapRef = useFocusTrap<View>({ active: visible, onEscape: onClose });
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
            ref={trapRef as unknown as React.Ref<View>}
            accessibilityViewIsModal
            // WAI-ARIA Dialog Pattern: الدور dialog على الويب + اسم من العنوان
            {...(Platform.OS === 'web'
              ? ({ role: 'dialog', 'aria-modal': true, 'aria-label': title } as unknown as object)
              : {})}
            style={{
              width: '100%', maxWidth: componentTokens.sheet.maxWidth, alignSelf: 'center',
              backgroundColor: theme.card,
              borderTopLeftRadius: radii.xxl, borderTopRightRadius: radii.xxl,
              paddingHorizontal: spacing.s5, paddingTop: spacing.s4,
              paddingBottom: Platform.OS === 'web' ? 28 : spacing.s8 + insets.bottom,
              maxHeight: '92%',
              borderWidth: borderWidth.thin,
              borderBottomWidth: 0,
              borderColor: theme.glassBorder,
              shadowColor: theme.glassShadow,
              ...shadows.sheet,
              transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [800, 0] }) }],
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <View style={{
              alignSelf: 'center',
              width: componentTokens.sheet.grabberWidth, height: componentTokens.sheet.grabberHeight,
              borderRadius: 3, backgroundColor: theme.separator, marginBottom: 12,
            }} />
            
            {title ? (
              <Row between center style={{ marginBottom: 12 }}>
                <Txt variant="h2" style={{ flex: 1 }}>{title}</Txt>
                <View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('common.close') || 'Close dialog'}
                    hitSlop={{ top: hitSlop.generous, bottom: hitSlop.generous, left: hitSlop.generous, right: hitSlop.generous }}
                    onPress={onClose}
                    style={[webPointer, { width: 32, height: 32, borderRadius: 16, backgroundColor: theme.line, alignItems: 'center', justifyContent: 'center' }]}
                  >
                    <Icon name="close" size={18} color={theme.textSecondary} />
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

export function ListRow({ icon, iconBg, title, subtitle, onPress, right, danger, grow }: {
  icon?: keyof typeof Ionicons.glyphMap;
  iconBg?: string;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  right?: React.ReactNode;
  danger?: boolean;
  /** يملأ ارتفاع عموده في الشبكات (أعمدة متساوية بدل ارتفاعات متناثرة حسب التمرير) */
  grow?: boolean;
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
          flexDirection: 'row', alignItems: 'center',
          gap: componentTokens.listRow.gap,
          minHeight: componentTokens.listRow.minHeight,
          ...(grow ? { flex: 1 } : null),
          backgroundColor: theme.glass,
          borderRadius: radii.lg,
          padding: componentTokens.listRow.padding,
          borderWidth: borderWidth.hairline,
          borderColor: theme.glassBorder,
          opacity: pressed ? 0.7 : 1,
          transform: [{ scale: pressed ? pressScale.subtle : 1 }],
        },
      ])}
    >
      {icon ? (
        <View style={{
          width: componentTokens.listRow.iconBox, height: componentTokens.listRow.iconBox,
          borderRadius: radii.md, backgroundColor: iconBg ?? theme.brandSoft,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name={icon} size={componentTokens.listRow.iconSize} color={danger ? theme.danger : theme.brand} />
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
  const { impactLight, impactMedium } = useHaptics();
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;
  const pressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(anim, {
      toValue: value ? 1 : 0,
      useNativeDriver: false,
      damping: 20,
      stiffness: 300,
      mass: 0.8,
    }).start();
  }, [value, anim]);

  const bg = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.fillStrong, color ?? theme.brand],
  });

  // النقل من اليسار لليمين بسلاسة ناعمة — الأبعاد كلها من componentTokens.switch (CMP-01)
  const translate = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [componentTokens.switch.travelStart, componentTokens.switch.travelEnd],
  });

  // تمدد القرص عند اللمس والضغط (تأثير Apple & Uiverse الإنسيابي)
  const thumbWidth = pressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [componentTokens.switch.thumb, componentTokens.switch.thumbPressed],
  });

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={value ? 'مفعّل' : 'معطّل'}
      accessibilityState={{ checked: value }}
      onPress={() => {
        if (!value) impactMedium();
        else impactLight();
        onChange(!value);
      }}
      onPressIn={() => {
        Animated.timing(pressAnim, { toValue: 1, duration: 120, useNativeDriver: false }).start();
      }}
      onPressOut={() => {
        Animated.spring(pressAnim, { toValue: 0, damping: 15, stiffness: 250, useNativeDriver: false }).start();
      }}
      hitSlop={hitSlop.comfy}
    >
      <Animated.View
        style={{
          width: componentTokens.switch.width,
          height: componentTokens.switch.height,
          borderRadius: componentTokens.switch.radius,
          backgroundColor: bg,
          justifyContent: 'center',
          direction: 'ltr',
          paddingHorizontal: 1,
        }}
      >
        <Animated.View
          style={{
            width: thumbWidth,
            height: componentTokens.switch.thumb,
            borderRadius: componentTokens.switch.thumbRadius,
            backgroundColor: '#FFFFFF',
            transform: [{ translateX: translate }],
            shadowColor: theme.glassShadow,
            ...shadows.thumb,
          }}
        />
      </Animated.View>
    </Pressable>
  );
}

// ───────────────────────────── نجوم التقييم ─────────────────────────────

export function Stars({ value, size = 16, onRate }: { value: number; size?: number; onRate?: (v: number) => void }) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const { impactLight } = useHaptics();
  // A11Y-14: نمط radiogroup — أسهم ←/→/↑/↓ تغيّر التقييم، وHome/End يقفزان.
  const rounded = Math.round(value);
  const rovingRefs = useRovingKeys({
    count: 5,
    onMove: (index) => {
      if (!onRate) return;
      const next = index + 1;
      if (next !== rounded) { impactLight(); onRate(next); }
    },
  });
  return (
    <View
      {...(onRate ? { accessibilityRole: 'radiogroup' as const, accessibilityLabel: t('a11y.rating') } : {})}
      style={{ flexDirection: 'row', gap: componentTokens.stars.gap }}
    >
      {[1, 2, 3, 4, 5].map((i, index) => (
        <Pressable
          key={i}
          ref={(el: any) => { rovingRefs.current[index] = el as HTMLElement | null; }}
          {...(onRate ? rovingTabIndex(index, Math.max(0, rounded - 1)) : {})}
          accessibilityRole={onRate ? 'radio' : 'image'}
          accessibilityLabel={t('a11y.starOf', { i })}
          accessibilityState={onRate ? { checked: i === rounded } : undefined}
          onPress={onRate ? () => { impactLight(); onRate(i); } : undefined}
          disabled={!onRate}
          hitSlop={hitSlop.tight}
        >
          <Icon name={i <= Math.round(value) ? 'star' : 'star-outline'} size={size} color={i <= Math.round(value) ? theme.certGold : theme.textMuted} />
        </Pressable>
      ))}
    </View>
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
    <View style={{ borderWidth: borderWidth.thick, borderColor: color, borderRadius: radii.lg, padding: 2, alignSelf: 'center' }}>
      {children}
    </View>
  );
}

export function OfflineQueueBanner({
  online,
  pendingCount,
  onSync,
}: {
  online: boolean;
  pendingCount: number;
  onSync?: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();
  if (online && pendingCount <= 0) return null;
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.s3,
        paddingHorizontal: spacing.s4,
        paddingVertical: 8,
        marginHorizontal: spacing.s5,
        marginTop: spacing.s2,
        borderRadius: radii.md,
        backgroundColor: online ? theme.brandSoft : theme.warnSoft,
        borderWidth: 1,
        borderColor: online ? theme.brand : theme.warn,
      }}
    >
      <Row center gap={spacing.s2} style={{ flex: 1 }}>
        <Icon
          name={online ? 'cloud-upload-outline' : 'cloud-offline-outline'}
          size={16}
          color={online ? theme.brand : theme.warn}
        />
        <Txt variant="caption" color={online ? theme.brand : theme.warn} style={{ flex: 1 }}>
          {pendingCount > 0
            ? t('offline.pendingBanner', { count: pendingCount })
            : t('common.offlineBanner')}
        </Txt>
      </Row>
      {online && pendingCount > 0 && onSync ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('offline.syncNow')}
          onPress={onSync}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: radii.sm,
            backgroundColor: theme.brand,
          }}
        >
          <Txt variant="micro" color="#FFFFFF">{t('offline.syncNow')}</Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

export { ScrollView };
export { LiquidGlassCard } from './components/LiquidGlassCard';
export { Skeleton, PageSkeleton, TodayCardSkeleton } from './components/SkeletonLoader';
export { Toast } from './components/Toast';
export { SegmentedProgressBar } from './components/SegmentedProgressBar';
export { GlassBtn, IconGlassButton } from './components/GlassBtn';
export { XPBar } from './components/XPBar';
export { BentoGrid, BentoItem } from './components/BentoGrid';
export { StreakCalendarGrid } from './components/StreakCalendarGrid';
export { NotificationBell } from './components/NotificationBell';
export { BorderBeam } from './components/BorderBeam';
export { AnimatedShinyText } from './components/AnimatedShinyText';
export { SpotlightCard } from './components/SpotlightCard';
export { Screen, Section, Landmark, LiveRegion, VisuallyHidden, SkipLink } from './a11y/semantics';
