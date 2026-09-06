/**
 * design/animations/ShimmerProgressBar.tsx — شريط تقدم إشعاعي بتأثير وميض ناعم (Shimmer Progress Bar)
 * مصمم لعرض نسبة الحضور والتقدم نحو الشهادة والاستحقاق
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { radii } from '../tokens';
import { isReducedMotion } from '../motion';

export interface ShimmerProgressBarProps {
  progress: number; // 0 to 1
  height?: number;
  gradientColors?: readonly [string, string, ...string[]];
  trackColor?: string;
}

export function ShimmerProgressBar({
  progress,
  height = 10,
  gradientColors = ['#007AFF', '#38BDF8'],
  trackColor = 'rgba(0, 0, 0, 0.08)',
}: ShimmerProgressBarProps) {
  const clampedProgress = Math.min(1, Math.max(0, progress));
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isReducedMotion()) return;

    const loop = Animated.loop(
      Animated.timing(shimmerAnim, {
        toValue: 1,
        duration: 1800,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );

    loop.start();
    return () => loop.stop();
  }, [shimmerAnim]);

  const shimmerTranslate = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-120, 240],
  });

  return (
    <View style={[styles.track, { height, backgroundColor: trackColor }]}>
      <View style={[styles.fill, { width: `${clampedProgress * 100}%` }]}>
        <LinearGradient
          colors={gradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
        {/* وميض اللمعان المتحرك */}
        <Animated.View
          style={[
            styles.shimmer,
            {
              transform: [{ translateX: shimmerTranslate }],
            },
          ]}
        >
          <LinearGradient
            colors={['rgba(255, 255, 255, 0)', 'rgba(255, 255, 255, 0.45)', 'rgba(255, 255, 255, 0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    borderRadius: radii.pill,
    overflow: 'hidden',
    position: 'relative',
  },
  fill: {
    height: '100%',
    borderRadius: radii.pill,
    overflow: 'hidden',
    position: 'relative',
  },
  shimmer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 80,
  },
});
