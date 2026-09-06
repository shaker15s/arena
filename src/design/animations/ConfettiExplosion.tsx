/**
 * design/animations/ConfettiExplosion.tsx — انفجار احتفالي بقصاصات الزينة الملونة (Confetti Explosion)
 * حركة خفيفة ومرنة مصممة لشاشات التكريم، الشارات، وإصدار الشهادات
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, StyleSheet, View } from 'react-native';
import { isReducedMotion } from '../motion';

const CONFETTI_COLORS = [
  '#F59E0B', // Amber
  '#007AFF', // Brand Blue
  '#10B981', // Emerald
  '#EC4899', // Pink
  '#8B5CF6', // Purple
  '#FBBF24', // Gold
  '#EF4444', // Red
];

interface Particle {
  id: number;
  x: Animated.Value;
  y: Animated.Value;
  rotate: Animated.Value;
  scale: Animated.Value;
  opacity: Animated.Value;
  color: string;
  size: number;
  shape: 'rect' | 'circle';
}

export function ConfettiExplosion({ count = 28 }: { count?: number }) {
  const particles = useRef<Particle[]>(
    Array.from({ length: count }).map((_, i) => ({
      id: i,
      x: new Animated.Value(0),
      y: new Animated.Value(0),
      rotate: new Animated.Value(0),
      scale: new Animated.Value(0),
      opacity: new Animated.Value(1),
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      size: Math.floor(Math.random() * 6) + 6,
      shape: i % 3 === 0 ? 'circle' : 'rect',
    })),
  ).current;

  useEffect(() => {
    if (isReducedMotion()) return;

    const anims = particles.map((p, idx) => {
      // زاوية الانفجار والمسافة العشوائية
      const angle = (idx / count) * 2 * Math.PI + (Math.random() * 0.4 - 0.2);
      const distance = Math.floor(Math.random() * 110) + 70;
      const targetX = Math.cos(angle) * distance;
      const targetY = Math.sin(angle) * distance + 50; // جاذبية إضافية للأسفل

      return Animated.parallel([
        Animated.timing(p.scale, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(p.x, {
          toValue: targetX,
          duration: 900,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(p.y, {
          toValue: targetY,
          duration: 1100,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(p.rotate, {
          toValue: Math.random() > 0.5 ? 4 : -4,
          duration: 1100,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.delay(650),
          Animated.timing(p.opacity, {
            toValue: 0,
            duration: 450,
            useNativeDriver: true,
          }),
        ]),
      ]);
    });

    Animated.parallel(anims).start();
  }, [particles, count]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={styles.centerAnchor}>
        {particles.map((p) => {
          const spin = p.rotate.interpolate({
            inputRange: [-4, 4],
            outputRange: ['-720deg', '720deg'],
          });

          return (
            <Animated.View
              key={p.id}
              style={[
                styles.particle,
                {
                  width: p.size,
                  height: p.shape === 'rect' ? p.size * 1.6 : p.size,
                  borderRadius: p.shape === 'circle' ? 999 : 2,
                  backgroundColor: p.color,
                  opacity: p.opacity,
                  transform: [
                    { translateX: p.x },
                    { translateY: p.y },
                    { scale: p.scale },
                    { rotate: spin },
                  ],
                },
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centerAnchor: {
    position: 'absolute',
    top: '40%',
    left: '50%',
    width: 0,
    height: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  particle: {
    position: 'absolute',
  },
});
