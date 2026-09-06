/**
 * design/components/Toast.tsx — نظام التنبيهات العائمة التفاعلي
 * مستوحى من Gluestack v5 Toast في MASAR_ASSETS_RESEARCH.md
 * يدعم 4 حالات (success, error, warning, streak) مع فيزياء ارتدادية واهتزاز لمسي.
 */
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Txt } from '../components';
import { radii, spacing } from '../tokens';
import { isReducedMotion } from '../motion';

export type ToastType = 'success' | 'error' | 'warning' | 'streak';

export interface ToastProps {
  visible: boolean;
  type?: ToastType;
  title: string;
  message?: string;
  durationMs?: number;
  onDismiss?: () => void;
  style?: StyleProp<ViewStyle>;
}

const TOAST_THEMES: Record<
  ToastType,
  { bg: string; border: string; icon: string; haptic: Haptics.NotificationFeedbackType }
> = {
  success: {
    bg: '#064E3B',
    border: '#10B981',
    icon: '✅',
    haptic: Haptics.NotificationFeedbackType.Success,
  },
  error: {
    bg: '#7F1D1D',
    border: '#EF4444',
    icon: '❌',
    haptic: Haptics.NotificationFeedbackType.Error,
  },
  warning: {
    bg: '#78350F',
    border: '#F59E0B',
    icon: '⚠️',
    haptic: Haptics.NotificationFeedbackType.Warning,
  },
  streak: {
    bg: '#431407',
    border: '#EA580C',
    icon: '🔥',
    haptic: Haptics.NotificationFeedbackType.Success,
  },
};

export function Toast({
  visible,
  type = 'success',
  title,
  message,
  durationMs = 3500,
  onDismiss,
  style,
}: ToastProps) {
  const reduced = isReducedMotion();
  const slideAnim = useRef(new Animated.Value(-80)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      const theme = TOAST_THEMES[type];
      Haptics.notificationAsync(theme.haptic).catch(() => {});

      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 20,
          friction: 6,
          tension: 80,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();

      const timer = setTimeout(() => {
        handleDismiss();
      }, durationMs);

      return () => clearTimeout(timer);
    } else {
      slideAnim.setValue(-80);
      opacityAnim.setValue(0);
    }
  }, [visible, type, durationMs]);

  const handleDismiss = () => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: -80,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(() => {
      if (onDismiss) onDismiss();
    });
  };

  if (!visible) return null;

  const currentTheme = TOAST_THEMES[type];

  return (
    <Animated.View
      style={[
        styles.toastContainer,
        {
          backgroundColor: currentTheme.bg,
          borderColor: currentTheme.border,
          opacity: opacityAnim,
          transform: [{ translateY: slideAnim }],
        },
        style,
      ]}
    >
      <View style={styles.iconWrapper}>
        <Txt variant="body">{currentTheme.icon}</Txt>
      </View>
      <View style={styles.textWrapper}>
        <Txt variant="bodyMed" bold style={styles.titleText}>
          {title}
        </Txt>
        {message ? (
          <Txt variant="caption" style={styles.messageText}>
            {message}
          </Txt>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toastContainer: {
    position: 'absolute',
    top: 40,
    left: 20,
    right: 20,
    zIndex: 9999,
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm + 2,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  iconWrapper: {
    marginEnd: spacing.sm,
  },
  textWrapper: {
    flex: 1,
  },
  titleText: {
    color: '#F8FAFC',
  },
  messageText: {
    color: '#E2E8F0',
    marginTop: 2,
  },
});
