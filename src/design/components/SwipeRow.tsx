/**
 * design/components/SwipeRow.tsx — صف قابل للسحب (SwipeRow)
 * يتيح سحب المحتوى يميناً أو يساراً لإظهار إجراءات مثل القراءة أو الحذف.
 * يدعم اتجاهات RTL والحركة المخفضة.
 */
import React, { useRef } from 'react';
import { Animated, I18nManager, PanResponder, StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from '../components';
import { useTheme } from '../theme';
import { isReducedMotion } from '../motion';
import { spacing, radii, springs } from '../tokens';

export interface SwipeRowProps {
  children: React.ReactNode;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  leftColor?: string;
  rightColor?: string;
  leftIcon?: keyof typeof Ionicons.glyphMap;
  rightIcon?: keyof typeof Ionicons.glyphMap;
  leftLabel?: string;
  rightLabel?: string;
  threshold?: number;
  disabled?: boolean;
  style?: ViewStyle;
}

export function SwipeRow({
  children,
  onSwipeLeft,
  onSwipeRight,
  leftColor,
  rightColor,
  leftIcon = 'checkmark-circle',
  rightIcon = 'trash',
  leftLabel,
  rightLabel,
  threshold = 80,
  disabled = false,
  style,
}: SwipeRowProps) {
  const { theme } = useTheme();
  const pan = useRef(new Animated.Value(0)).current;

  const isRTL = I18nManager.isRTL;

  // في RTL: السحب الجسدي لليسار = الإجراء الأيمن منطقياً والعكس
  const onPhysicalSwipeLeft = isRTL ? onSwipeRight : onSwipeLeft;
  const onPhysicalSwipeRight = isRTL ? onSwipeLeft : onSwipeRight;

  const physicalLeftColor = isRTL ? (rightColor ?? theme.danger) : (leftColor ?? theme.success);
  const physicalRightColor = isRTL ? (leftColor ?? theme.success) : (rightColor ?? theme.danger);

  const physicalLeftIcon = isRTL ? rightIcon : leftIcon;
  const physicalRightIcon = isRTL ? leftIcon : rightIcon;

  const physicalLeftLabel = isRTL ? rightLabel : leftLabel;
  const physicalRightLabel = isRTL ? leftLabel : rightLabel;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => {
        if (disabled) return false;
        return Math.abs(gs.dx) > Math.abs(gs.dy) && Math.abs(gs.dx) > 10;
      },
      onPanResponderMove: (_, gs) => {
        let dx = gs.dx;
        if (dx > 0 && !onPhysicalSwipeRight) dx = 0;
        else if (dx < 0 && !onPhysicalSwipeLeft) dx = 0;
        pan.setValue(dx);
      },
      onPanResponderRelease: (_, gs) => {
        const dx = gs.dx;
        const reduced = isReducedMotion();

        const springBack = () => {
          if (reduced) {
            pan.setValue(0);
          } else {
            Animated.spring(pan, {
              toValue: 0,
              useNativeDriver: true,
              damping: springs.bouncy.damping,
              stiffness: springs.bouncy.stiffness,
              mass: springs.bouncy.mass,
            }).start();
          }
        };

        if (dx < -threshold && onPhysicalSwipeLeft) {
          onPhysicalSwipeLeft();
          springBack();
        } else if (dx > threshold && onPhysicalSwipeRight) {
          onPhysicalSwipeRight();
          springBack();
        } else {
          springBack();
        }
      },
      onPanResponderTerminate: () => {
        if (isReducedMotion()) {
          pan.setValue(0);
        } else {
          Animated.spring(pan, {
            toValue: 0,
            useNativeDriver: true,
            damping: springs.bouncy.damping,
            stiffness: springs.bouncy.stiffness,
            mass: springs.bouncy.mass,
          }).start();
        }
      },
    })
  ).current;

  return (
    <View style={[styles.container, style]}>
      {/* الطبقة الخلفية */}
      <View style={StyleSheet.absoluteFill}>
        {/* الجهة اليسرى الجسدية (تظهر عند السحب لليمين) */}
        {onPhysicalSwipeRight && (
          <Animated.View
            style={[
              styles.actionContainer,
              {
                alignItems: isRTL ? 'flex-end' : 'flex-start',
                backgroundColor: physicalLeftColor,
                opacity: pan.interpolate({
                  inputRange: [0, threshold / 2, threshold],
                  outputRange: [0, 0.5, 1],
                  extrapolate: 'clamp',
                }),
              },
            ]}
          >
            <Ionicons name={physicalLeftIcon} size={24} color="#fff" />
            {physicalLeftLabel && (
              <Txt variant="micro" color="#fff" style={{ marginTop: 2 }}>
                {physicalLeftLabel}
              </Txt>
            )}
          </Animated.View>
        )}

        {/* الجهة اليمنى الجسدية (تظهر عند السحب لليسار) */}
        {onPhysicalSwipeLeft && (
          <Animated.View
            style={[
              styles.actionContainer,
              {
                alignItems: isRTL ? 'flex-start' : 'flex-end',
                backgroundColor: physicalRightColor,
                opacity: pan.interpolate({
                  inputRange: [-threshold, -threshold / 2, 0],
                  outputRange: [1, 0.5, 0],
                  extrapolate: 'clamp',
                }),
              },
            ]}
          >
            <Ionicons name={physicalRightIcon} size={24} color="#fff" />
            {physicalRightLabel && (
              <Txt variant="micro" color="#fff" style={{ marginTop: 2 }}>
                {physicalRightLabel}
              </Txt>
            )}
          </Animated.View>
        )}
      </View>

      {/* المحتوى الأمامي القابل للسحب */}
      <Animated.View
        style={{ transform: [{ translateX: pan }] }}
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    borderRadius: radii.md,
    minHeight: 44,
  },
  actionContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
});
