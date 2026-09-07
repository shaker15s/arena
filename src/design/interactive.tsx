/**
 * design/interactive.tsx — مكوّنات تفاعلية متقدمة مستوحاة من Uiverse.io
 * مصممة ومضبوطة بالكامل لتتوافق مع نظام تصميم Masär (Apple Liquid Glass + Tokens + RTL).
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from './theme';
import { radii, spacing, typography } from './tokens';
import { isReducedMotion } from './motion';
import { useHaptics } from '../shared/hooks';
import { Spinner, Txt } from './components';

// ───────────────────────────── 1. JellyButton (زر الإجراء الحماسي مع الارتداد الزنبركي) ─────────────────────────────

interface JellyButtonProps {
  title: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'brand' | 'purple' | 'success' | 'gold';
  size?: 'md' | 'lg';
  full?: boolean;
  style?: ViewStyle;
}

export function JellyButton({
  title,
  onPress,
  icon,
  loading,
  disabled,
  variant = 'brand',
  size = 'lg',
  full = true,
  style,
}: JellyButtonProps) {
  const { theme, isDark } = useTheme();
  const { impactMedium, impactLight } = useHaptics();
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    if (disabled || loading) return;
    if (isReducedMotion()) return;
    impactLight();
    Animated.spring(scale, {
      toValue: 0.94,
      damping: 14,
      stiffness: 300,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    if (disabled || loading) return;
    if (isReducedMotion()) return;
    Animated.spring(scale, {
      toValue: 1,
      damping: 10,
      stiffness: 180,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  };

  const handlePress = () => {
    if (disabled || loading) return;
    impactMedium();
    onPress();
  };

  const gradientColors: [string, string] =
    variant === 'purple'
      ? ['#9333EA', '#7928CA']
      : variant === 'success'
      ? [theme.teal, theme.success]
      : variant === 'gold'
      ? ['#F59E0B', '#D97706']
      : [theme.brandGradientFrom, theme.brandGradientTo];

  const shadowColor =
    variant === 'purple'
      ? '#9333EA'
      : variant === 'success'
      ? theme.success
      : variant === 'gold'
      ? '#D97706'
      : theme.brand;

  const height = size === 'lg' ? 54 : 46;

  return (
    <Animated.View
      style={[
        {
          transform: [{ scale }],
          width: full ? '100%' : undefined,
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading) }}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={[
          styles.jellyPressable,
          {
            height,
            borderRadius: radii.button,
            shadowColor,
            shadowOpacity: isDark ? 0.35 : 0.25,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 7 },
            elevation: 8,
          },
        ]}
      >
        <LinearGradient
          colors={gradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.jellyGradient, { borderRadius: radii.button, height }]}
        >
          {/* لمسة الـ 3D Highlight العلوية الزجاجية */}
          <View style={styles.topGlassHighlight} />

          {loading ? (
            <View style={styles.contentRow}>
              <Spinner color="#FFFFFF" />
              <Txt variant="bodyMed" color="#FFFFFF" bold>
                {title}
              </Txt>
            </View>
          ) : (
            <View style={styles.contentRow}>
              {icon && <Ionicons name={icon} size={size === 'lg' ? 20 : 18} color="#FFFFFF" />}
              <Txt variant="bodyMed" color="#FFFFFF" bold style={{ fontSize: size === 'lg' ? 16 : 15 }}>
                {title}
              </Txt>
            </View>
          )}

          {/* لمسة الـ Highlight السفلية الخافتة */}
          <View style={styles.bottomGlassHighlight} />
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

// ───────────────────────────── 2. PillGradientSearchInput (حقل البحث المميز بالتدرج الزجاجي) ─────────────────────────────

interface PillGradientSearchInputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  onClear?: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: ViewStyle;
}

export function PillGradientSearchInput({
  value,
  onChangeText,
  placeholder,
  onClear,
  icon = 'search',
  style,
}: PillGradientSearchInputProps) {
  const { theme, isDark } = useTheme();
  const [focused, setFocused] = useState(false);
  const borderAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(borderAnim, {
      toValue: focused ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [focused, borderAnim]);

  const gradientColors: [string, string] = isDark
    ? focused
      ? ['#0A84FF', '#5E5CE6']
      : ['rgba(255,255,255,0.15)', 'rgba(255,255,255,0.05)']
    : focused
    ? ['#007AFF', '#5856D6']
    : ['#E0E7FF', '#FCE7F3'];

  return (
    <View style={[{ alignSelf: 'stretch' }, style]}>
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[
          styles.pillOuterGradient,
          {
            shadowColor: focused ? theme.brand : '#000',
            shadowOpacity: focused ? 0.22 : 0.04,
            shadowRadius: focused ? 12 : 6,
            elevation: focused ? 4 : 1,
          },
        ]}
      >
        <View
          style={[
            styles.pillInnerContainer,
            {
              backgroundColor: isDark ? 'rgba(24,24,28,0.92)' : 'rgba(255,255,255,0.96)',
            },
          ]}
        >
          <Ionicons
            name={icon}
            size={19}
            color={focused ? theme.brand : theme.textMuted}
            style={{ marginStart: 12, marginEnd: 8 }}
          />
          <TextInput
            value={value}
            onChangeText={onChangeText}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
            placeholderTextColor={theme.textMuted}
            returnKeyType="search"
            style={[
              styles.pillTextInput,
              {
                color: theme.text,
                fontFamily: typography.body.fontFamily,
                ...(Platform.OS === 'web'
                  ? ({ outlineStyle: 'none', border: 'none', background: 'transparent' } as object)
                  : {}),
              },
            ]}
          />
          {value.length > 0 && (
            <Pressable
              hitSlop={10}
              onPress={() => {
                onChangeText('');
                onClear?.();
              }}
              style={styles.clearBtn}
            >
              <Ionicons name="close-circle" size={18} color={theme.textMuted} />
            </Pressable>
          )}
        </View>
      </LinearGradient>
    </View>
  );
}

// ───────────────────────────── 3. SaveActionButton (زر الحفظ / المفضلة المرتد بنعومة) ─────────────────────────────

interface SaveActionButtonProps {
  saved: boolean;
  onToggle: (nextState: boolean) => void;
  size?: number;
}

export function SaveActionButton({ saved, onToggle, size = 42 }: SaveActionButtonProps) {
  const { theme, isDark } = useTheme();
  const { impactLight, impactMedium } = useHaptics();
  const scale = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    if (saved) impactLight();
    else impactMedium();

    const next = !saved;
    onToggle(next);

    scale.setValue(0.7);
    Animated.spring(scale, {
      toValue: 1,
      damping: 12,
      stiffness: 240,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={saved ? 'إزالة من المحفوظات' : 'حفظ'}
      onPress={handlePress}
      hitSlop={8}
      style={[
        styles.saveActionBox,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: saved
            ? isDark
              ? 'rgba(10,132,255,0.22)'
              : 'rgba(0,122,255,0.14)'
            : isDark
            ? 'rgba(255,255,255,0.12)'
            : 'rgba(0,0,0,0.06)',
          borderColor: saved ? theme.brand : 'transparent',
          borderWidth: saved ? 1.5 : 0,
        },
      ]}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <Ionicons
          name={saved ? 'bookmark' : 'bookmark-outline'}
          size={Math.round(size * 0.48)}
          color={saved ? theme.brand : isDark ? '#FFFFFF' : theme.textSecondary}
        />
      </Animated.View>
    </Pressable>
  );
}

// ───────────────────────────── 4. SuccessWaveAlert (بطاقة النجاح الزجاجية التفاعلية) ─────────────────────────────

interface SuccessWaveAlertProps {
  title: string;
  description: string;
  onClose?: () => void;
  actionText?: string;
  onAction?: () => void;
}

export function SuccessWaveAlert({
  title,
  description,
  onClose,
  actionText,
  onAction,
}: SuccessWaveAlertProps) {
  const { theme, isDark } = useTheme();

  return (
    <View
      style={[
        styles.successWaveCard,
        {
          backgroundColor: isDark ? 'rgba(13,40,24,0.85)' : '#FFFFFF',
          borderColor: isDark ? theme.success + '44' : theme.success + '33',
        },
      ]}
    >
      {/* الدائرة الخضراء الزاهية للأيقونة */}
      <View style={[styles.successIconBubble, { backgroundColor: theme.successSoft }]}>
        <Ionicons name="checkmark-circle" size={24} color={theme.success} />
      </View>

      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bodyMed" color={theme.success} bold>
          {title}
        </Txt>
        <Txt variant="caption" color={theme.textSecondary}>
          {description}
        </Txt>
        {actionText && onAction && (
          <Pressable onPress={onAction} style={{ marginTop: 6 }}>
            <Txt variant="micro" color={theme.brand} bold>
              {actionText} ←
            </Txt>
          </Pressable>
        )}
      </View>

      {onClose && (
        <Pressable hitSlop={10} onPress={onClose} style={{ alignSelf: 'flex-start' }}>
          <Ionicons name="close" size={18} color={theme.textMuted} />
        </Pressable>
      )}
    </View>
  );
}

// ───────────────────────────── 5. BubbleExpandButton (الزر الداكن الفخم بتوسع الفقاعة) ─────────────────────────────

interface BubbleExpandButtonProps {
  title: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: ViewStyle;
}

export function BubbleExpandButton({ title, onPress, icon, style }: BubbleExpandButtonProps) {
  const { theme } = useTheme();
  const bubbleScale = useRef(new Animated.Value(0.2)).current;
  const bubbleOpacity = useRef(new Animated.Value(0)).current;

  const handlePressIn = () => {
    Animated.parallel([
      Animated.timing(bubbleScale, { toValue: 5, duration: 320, useNativeDriver: true }),
      Animated.timing(bubbleOpacity, { toValue: 0.85, duration: 180, useNativeDriver: true }),
    ]).start();
  };

  const handlePressOut = () => {
    Animated.parallel([
      Animated.timing(bubbleScale, { toValue: 0.2, duration: 250, useNativeDriver: true }),
      Animated.timing(bubbleOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start();
  };

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[styles.bubbleBtn, { borderRadius: radii.button }, style]}
    >
      <Animated.View
        style={[
          styles.bubbleBackground,
          {
            backgroundColor: theme.brand,
            opacity: bubbleOpacity,
            transform: [{ scale: bubbleScale }],
          },
        ]}
      />
      <View style={styles.contentRow}>
        {icon && <Ionicons name={icon} size={18} color="#FFFFFF" style={{ zIndex: 2 }} />}
        <Txt variant="bodyMed" color="#FFFFFF" bold style={{ zIndex: 2 }}>
          {title}
        </Txt>
      </View>
    </Pressable>
  );
}

// ───────────────────────────── Styles ─────────────────────────────

const styles = StyleSheet.create({
  jellyPressable: {
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
  },
  jellyGradient: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    paddingHorizontal: 20,
  },
  topGlassHighlight: {
    position: 'absolute',
    top: 3,
    width: '78%',
    height: 1.5,
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
    borderRadius: 1,
  },
  bottomGlassHighlight: {
    position: 'absolute',
    bottom: 3,
    width: '75%',
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 1,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pillOuterGradient: {
    height: 52,
    borderRadius: 26,
    padding: 2,
    justifyContent: 'center',
  },
  pillInnerContainer: {
    flex: 1,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pillTextInput: {
    flex: 1,
    fontSize: 15,
    textAlign: 'right',
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  clearBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  saveActionBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  successWaveCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 18,
    borderWidth: 1.5,
    gap: 14,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  successIconBubble: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleBtn: {
    height: 50,
    backgroundColor: '#18181B',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  bubbleBackground: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
  },
});
