/**
 * design/components/Toast.tsx — نظام التنبيهات العائمة التفاعلي الموحّد (§33)
 * مكوّن السطح الرسمي (ToastSurface) والمضيف المستقل (Toast).
 * يدعم الأنواع المعيارية الأربعة (success, error, warn, info) بالإضافة إلى (streak/warning).
 */
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Icon } from '../icons';
import { useTheme } from '../theme';
import { GlassSurface } from '../glass';
import { Txt } from '../components';
import { hitSlop, radii, spacing, borderWidth } from '../tokens';
import { isReducedMotion } from '../motion';
import { useI18n } from '../../i18n';

export type ToastKind = 'success' | 'error' | 'warn' | 'info';
export type ToastType = ToastKind | 'warning' | 'streak';

export interface ToastSurfaceProps {
  kind?: ToastType;
  type?: ToastType;
  title?: string;
  message: string;
  onDismiss?: () => void;
  style?: StyleProp<ViewStyle>;
  action?: { label: string; onPress: () => void };
}

export interface ToastProps {
  visible: boolean;
  kind?: ToastType;
  type?: ToastType;
  title?: string;
  message?: string;
  durationMs?: number;
  onDismiss?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function normalizeToastKind(kind?: ToastType): ToastKind {
  if (!kind) return 'info';
  if (kind === 'warning') return 'warn';
  if (kind === 'streak') return 'warn';
  return kind;
}

/**
 * ToastSurface — السطح البصري المعتمد للتنبيهات العائمة (§33)
 * تصميم زجاجي موحّد عالي التباين متوافق مع كافة الثيمات والوصول.
 */
export function ToastSurface({
  kind,
  type,
  title,
  message,
  onDismiss,
  style,
  action,
}: ToastSurfaceProps) {
  const { theme, isDark } = useTheme();
  const { t } = useI18n();

  const resolvedKind: ToastType = kind ?? type ?? 'info';

  const color = resolvedKind === 'success'
    ? theme.success
    : resolvedKind === 'error'
    ? theme.danger
    : resolvedKind === 'streak'
    ? theme.warn
    : resolvedKind === 'warn' || resolvedKind === 'warning'
    ? theme.warn
    : theme.brand;

  const iconName: keyof typeof Ionicons.glyphMap = resolvedKind === 'success'
    ? 'checkmark-circle'
    : resolvedKind === 'error'
    ? 'alert-circle'
    : resolvedKind === 'streak'
    ? 'flame'
    : resolvedKind === 'warn' || resolvedKind === 'warning'
    ? 'warning'
    : 'information-circle';

  return (
    <GlassSurface
      radius={18}
      tintColor={isDark ? 'rgba(24,24,28,0.94)' : 'rgba(255,255,255,0.96)'}
      style={[
        styles.surfaceContainer,
        {
          borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
          shadowColor: '#000',
          shadowOpacity: isDark ? 0.35 : 0.16,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 10 },
          elevation: 14,
        },
        style,
      ]}
    >
      <View style={styles.contentRow}>
        <View style={[styles.iconBadge, { backgroundColor: `${color}1F` }]}>
          <Icon name={iconName} size={18} color={color} />
        </View>
        <View style={styles.textContainer}>
          {title ? (
            <Txt variant="bodyMed" bold numberOfLines={1} shrink style={{ color: theme.text }}>
              {title}
            </Txt>
          ) : null}
          <Txt
            variant={title ? 'caption' : 'bodyMed'}
            color={theme.text}
            numberOfLines={2}
            style={{ fontWeight: title ? '400' : '500' }}
          >
            {message}
          </Txt>
        </View>
        {action ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={action.onPress}
            hitSlop={hitSlop.default}
            style={({ pressed }) => [styles.actionButton, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Txt variant="caption" bold color={color}>
              {action.label}
            </Txt>
          </Pressable>
        ) : null}
        {onDismiss ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('a11y.toastDismiss') || 'إغلاق التنبيه'}
            hitSlop={hitSlop.default}
            onPress={onDismiss}
            style={({ pressed }) => [
              styles.dismissButton,
              {
                backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Icon name="close" size={16} color={theme.textSecondary} />
          </Pressable>
        ) : null}
      </View>
    </GlassSurface>
  );
}

/**
 * Toast — المكوّن المستقل مع حركة الدخول والتوقيت التلقائي والاهتزاز اللمسي (§33)
 */
export function Toast({
  visible,
  kind,
  type,
  title,
  message = '',
  durationMs = 3500,
  onDismiss,
  style,
}: ToastProps) {
  const insets = useSafeAreaInsets();
  const reduced = isReducedMotion();
  const slideAnim = useRef(new Animated.Value(-80)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  const resolvedKind = kind ?? type ?? 'info';

  useEffect(() => {
    if (visible) {
      const hapticType = resolvedKind === 'success'
        ? Haptics.NotificationFeedbackType.Success
        : resolvedKind === 'error'
        ? Haptics.NotificationFeedbackType.Error
        : resolvedKind === 'warn' || resolvedKind === 'warning'
        ? Haptics.NotificationFeedbackType.Warning
        : Haptics.NotificationFeedbackType.Success;

      Haptics.notificationAsync(hapticType).catch(() => {});

      if (reduced) {
        slideAnim.setValue(0);
        opacityAnim.setValue(1);
      } else {
        Animated.parallel([
          Animated.spring(slideAnim, {
            toValue: 0,
            friction: 7,
            tension: 85,
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 1,
            duration: 180,
            useNativeDriver: true,
          }),
        ]).start();
      }

      const timer = setTimeout(() => {
        handleDismiss();
      }, durationMs);

      return () => clearTimeout(timer);
    } else {
      slideAnim.setValue(-80);
      opacityAnim.setValue(0);
    }
  }, [visible, resolvedKind, durationMs, reduced]);

  const handleDismiss = () => {
    if (reduced) {
      if (onDismiss) onDismiss();
      return;
    }
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: -80,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }),
    ]).start(() => {
      if (onDismiss) onDismiss();
    });
  };

  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      accessibilityLiveRegion="polite"
      style={[
        styles.floatingContainer,
        {
          top: Math.max(insets.top, 12) + spacing.s2,
          opacity: opacityAnim,
          transform: [{ translateY: slideAnim }],
        },
        style,
      ]}
    >
      <ToastSurface
        kind={resolvedKind}
        title={title}
        message={message}
        onDismiss={handleDismiss}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  floatingContainer: {
    position: 'absolute',
    start: spacing.s4,
    end: spacing.s4,
    zIndex: 9999,
    alignItems: 'center',
  },
  surfaceContainer: {
    width: '100%',
    maxWidth: 520,
    borderWidth: borderWidth.thin,
    overflow: 'hidden',
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s3,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  textContainer: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  actionButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.sm,
  },
  dismissButton: {
    padding: 6,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
