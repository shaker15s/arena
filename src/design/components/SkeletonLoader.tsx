/**
 * design/components/SkeletonLoader.tsx — مكوّن التحميل الهيكلي (Skeleton)
 * مستوحى من Gluestack v5 Skeleton في MASAR_ASSETS_RESEARCH.md
 * يوفر تأثير وميض ناعم (Shimmer Wave) كبديل فوري أثناء تحميل البيانات.
 */
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme';
import { radii } from '../tokens';
import { isReducedMotion } from '../motion';

export interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  circle?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Skeleton({
  width = '100%',
  height = 18,
  borderRadius = radii.md,
  circle = false,
  style,
}: SkeletonProps) {
  const { isDark } = useTheme();
  const reduced = isReducedMotion();

  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) return;

    const shimmerLoop = Animated.loop(
      Animated.timing(shimmerAnim, {
        toValue: 1,
        duration: 1400,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    shimmerLoop.start();

    return () => shimmerLoop.stop();
  }, [reduced, shimmerAnim]);

  const baseBg = isDark ? '#1E293B' : '#E2E8F0';
  const shimmerColor = isDark ? 'rgba(51, 65, 85, 0.6)' : 'rgba(248, 250, 252, 0.75)';

  const translateX = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-200, 200],
  });

  const finalRadius = circle
    ? typeof height === 'number'
      ? height / 2
      : 24
    : borderRadius;

  return (
    <View
      style={[
        styles.skeletonBase,
        {
          width: circle ? height : (width as any),
          height,
          borderRadius: finalRadius,
          backgroundColor: baseBg,
        },
        style,
      ]}
    >
      {!reduced && (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              transform: [{ translateX }],
            },
          ]}
        >
          <LinearGradient
            colors={['transparent', shimmerColor, 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}
    </View>
  );
}

/** قالب شاشة اليوم الهيكلي الجاهز */
export function TodayCardSkeleton() {
  return (
    <View style={styles.cardSkeleton}>
      <View style={styles.row}>
        <Skeleton circle height={48} />
        <View style={styles.col}>
          <Skeleton width="60%" height={16} />
          <View style={{ height: 6 }} />
          <Skeleton width="40%" height={12} />
        </View>
      </View>
      <View style={{ height: 16 }} />
      <Skeleton width="100%" height={10} borderRadius={radii.full} />
    </View>
  );
}

const styles = StyleSheet.create({
  skeletonBase: {
    overflow: 'hidden',
  },
  cardSkeleton: {
    padding: 16,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.2)',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  col: {
    flex: 1,
  },
});
