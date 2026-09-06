/**
 * design/components/NotificationBell.tsx — مكوّن جرس الإشعارات الموحد
 * يحتوي على شارة نابضة باللون الأحمر، وحجم لمس قياسي (44x44)، وتغذية لمسية وإمكانية وصول كاملة.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleProp, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { useI18n } from '../../i18n';
import { useHaptics } from '../../shared/hooks';
import { Txt } from '../components';
import { isReducedMotion } from '../motion';

export interface NotificationBellProps {
  count?: number;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  size?: number;
}

export function NotificationBell({
  count = 0,
  onPress,
  style,
  size = 44,
}: NotificationBellProps) {
  const { theme, isDark } = useTheme();
  const { t, lang } = useI18n();
  const { impactLight } = useHaptics();

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const badgeScale = useRef(new Animated.Value(count > 0 ? 1 : 0)).current;

  const hasUnread = count > 0;

  useEffect(() => {
    if (isReducedMotion()) return;

    if (hasUnread) {
      Animated.spring(badgeScale, {
        toValue: 1,
        friction: 5,
        tension: 100,
        useNativeDriver: true,
      }).start();

      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.25,
            duration: 1200,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1200,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      Animated.timing(badgeScale, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [hasUnread, badgeScale, pulseAnim]);

  const accessHint = hasUnread
    ? lang === 'ar'
      ? `لديك ${count} إشعار غير مقروء`
      : `You have ${count} unread notifications`
    : undefined;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('notif.title')}
      accessibilityHint={accessHint}
      onPress={() => {
        impactLight();
        onPress();
      }}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)',
          borderWidth: 1,
          borderColor: theme.glassBorder,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.75 : 1,
          transform: [{ scale: pressed ? 0.94 : 1 }],
          cursor: Platform.OS === 'web' ? ('pointer' as any) : undefined,
        },
        style,
      ]}
    >
      <Ionicons
        name={hasUnread ? 'notifications' : 'notifications-outline'}
        size={Math.round(size * 0.48)}
        color={hasUnread ? theme.brand : theme.text}
      />

      {hasUnread && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 2,
            end: 2,
            transform: [{ scale: badgeScale }],
          }}
        >
          {/* هالة النبض الخلفية */}
          <Animated.View
            style={{
              position: 'absolute',
              inset: -2,
              borderRadius: 12,
              backgroundColor: theme.danger,
              opacity: pulseAnim.interpolate({
                inputRange: [1, 1.25],
                outputRange: [0.45, 0],
              }),
              transform: [{ scale: pulseAnim }],
            }}
          />

          {/* عداد الإشعارات */}
          <View
            style={{
              minWidth: 18,
              height: 18,
              borderRadius: 9,
              backgroundColor: theme.danger,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 4,
              borderWidth: 2,
              borderColor: theme.bg,
              shadowColor: theme.danger,
              shadowOpacity: 0.5,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 2 },
              elevation: 4,
            }}
          >
            <Txt
              variant="micro"
              color="#FFFFFF"
              style={{
                fontSize: 9.5,
                lineHeight: 12,
                fontWeight: '700',
                includeFontPadding: false,
              }}
            >
              {count > 99 ? '99+' : count}
            </Txt>
          </View>
        </Animated.View>
      )}
    </Pressable>
  );
}
