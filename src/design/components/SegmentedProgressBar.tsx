/**
 * design/components/SegmentedProgressBar.tsx — شريط تقدم بشرائح منفصلة (Duolingo Style)
 * بديل للشريط المصمت المستمر، يوفر مؤشر خطوات واضح وجذاب لشاشات الترحيب والدروس والمراحل.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { radii, spacing } from '../tokens';
import { isReducedMotion } from '../motion';

export interface SegmentedProgressBarProps {
  totalSegments: number;
  currentSegment: number; // 0-indexed أو 1-indexed
  activeColor?: string;
  inactiveColor?: string;
  segmentHeight?: number;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}

export function SegmentedProgressBar({
  totalSegments = 3,
  currentSegment = 0,
  activeColor,
  inactiveColor,
  segmentHeight = 6,
  gap = 6,
  style,
}: SegmentedProgressBarProps) {
  const { theme } = useTheme();
  const reduced = isReducedMotion();

  const activeBg = activeColor ?? theme.brand;
  const inactiveBg = inactiveColor ?? theme.fillStrong;

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 1, max: totalSegments, now: currentSegment + 1 }}
      accessibilityLabel={`الخطوة ${currentSegment + 1} من ${totalSegments}`}
      style={[styles.container, { gap }, style]}
    >
      {Array.from({ length: totalSegments }).map((_, index) => {
        const isCompleted = index < currentSegment;
        const isCurrent = index === currentSegment;
        const isPassedOrCurrent = index <= currentSegment;

        return (
          <View
            key={index}
            style={[
              styles.segmentBase,
              {
                height: segmentHeight,
                backgroundColor: isPassedOrCurrent ? activeBg : inactiveBg,
                flex: 1,
                opacity: isCurrent ? 1 : isCompleted ? 0.85 : 0.35,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    direction: 'ltr',
    alignItems: 'center',
    width: '100%',
  },
  segmentBase: {
    borderRadius: radii.full,
  },
});
