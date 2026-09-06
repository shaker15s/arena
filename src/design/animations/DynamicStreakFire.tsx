/**
 * design/animations/DynamicStreakFire.tsx — لهب الستريك الديناميكي
 * مستوحى من Dynamic Streak Fire في MASAR_ASSETS_RESEARCH.md
 * يوفر لهباً حياً متحركاً بفيزياء التموج والشرر المتطاير مع عداد الأسابيع.
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
import Svg, {
  Defs,
  LinearGradient,
  Path,
  RadialGradient,
  Stop,
  Circle,
} from 'react-native-svg';
import { Txt } from '../components';
import { isReducedMotion } from '../motion';

export interface DynamicStreakFireProps {
  streakWeeks?: number;
  size?: number;
  showBadge?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function DynamicStreakFire({
  streakWeeks = 1,
  size = 72,
  showBadge = true,
  style,
}: DynamicStreakFireProps) {
  const reduced = isReducedMotion();

  // تموج اللهب الخارجي
  const outerFlameAnim = useRef(new Animated.Value(0)).current;
  // تموج قلب اللهب الداخلي
  const innerFlameAnim = useRef(new Animated.Value(0)).current;
  // توهج الهالة الحرارية
  const glowAnim = useRef(new Animated.Value(0)).current;
  // شرارة متطايرة
  const sparkAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) return;

    // تموج اللهب الأساسي
    const flameLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(outerFlameAnim, {
          toValue: 1,
          duration: 750,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(outerFlameAnim, {
          toValue: 0,
          duration: 750,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    // تموج قلب الشعلة السريع
    const innerLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(innerFlameAnim, {
          toValue: 1,
          duration: 500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(innerFlameAnim, {
          toValue: 0,
          duration: 500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    // نبض التوهج
    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    // دوران الشرر
    const sparkLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(sparkAnim, {
          toValue: 1,
          duration: 1300,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(sparkAnim, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );

    flameLoop.start();
    innerLoop.start();
    glowLoop.start();
    sparkLoop.start();

    return () => {
      flameLoop.stop();
      innerLoop.stop();
      glowLoop.stop();
      sparkLoop.stop();
    };
  }, [reduced, outerFlameAnim, innerFlameAnim, glowAnim, sparkAnim]);

  const flameScaleY = outerFlameAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.08],
  });

  const flameRotate = outerFlameAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['-1deg', '1.5deg', '-1deg'],
  });

  const innerScale = innerFlameAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.95, 1.05],
  });

  const glowOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 0.85],
  });

  const sparkTranslateY = sparkAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -18],
  });

  const sparkOpacity = sparkAnim.interpolate({
    inputRange: [0, 0.2, 0.8, 1],
    outputRange: [0, 1, 0.8, 0],
  });

  return (
    <View style={[styles.container, style]}>
      {/* توهج الهالة النارية الخلفية */}
      <Animated.View
        style={[
          styles.glowLayer,
          {
            width: size * 1.3,
            height: size * 1.3,
            borderRadius: (size * 1.3) / 2,
            opacity: glowOpacity,
          },
        ]}
      />

      {/* شرارة نار متطايرة */}
      <Animated.View
        style={[
          styles.spark,
          {
            transform: [{ translateY: sparkTranslateY }],
            opacity: sparkOpacity,
          },
        ]}
      />

      {/* شعلة النار المتحركة */}
      <Animated.View
        style={{
          transform: [{ scaleY: flameScaleY }, { rotate: flameRotate }],
        }}
      >
        <Svg width={size} height={size * 1.2} viewBox="0 0 100 120" fill="none">
          <Defs>
            {/* التدرج الخارجي للهب (أحمر ناري إلى برتقالي) */}
            <LinearGradient id="outerFlameGrad" x1="50" y1="10" x2="50" y2="110" gradientUnits="userSpaceOnUse">
              <Stop offset="0%" stopColor="#EF4444" />
              <Stop offset="45%" stopColor="#F97316" />
              <Stop offset="85%" stopColor="#F59E0B" />
              <Stop offset="100%" stopColor="#DC2626" />
            </LinearGradient>

            {/* تدرج قلب الشعلة المشع (أصفر ذهبي إلى أبيض ساطع) */}
            <LinearGradient id="coreFlameGrad" x1="50" y1="40" x2="50" y2="105" gradientUnits="userSpaceOnUse">
              <Stop offset="0%" stopColor="#FFFFFF" />
              <Stop offset="30%" stopColor="#FEF08A" />
              <Stop offset="75%" stopColor="#FBBF24" />
              <Stop offset="100%" stopColor="#F97316" />
            </LinearGradient>

            {/* إشعاع التوهج الداخلي */}
            <RadialGradient id="innerGlow" cx="50" cy="85" r="40" gradientUnits="userSpaceOnUse">
              <Stop offset="0%" stopColor="#FFFBEB" stopOpacity="0.9" />
              <Stop offset="50%" stopColor="#FDE047" stopOpacity="0.5" />
              <Stop offset="100%" stopColor="#F97316" stopOpacity="0" />
            </RadialGradient>
          </Defs>

          {/* اللهب الخارجي الأساسي */}
          <Path
            d="M50 8 C58 24 74 38 82 58 C90 78 86 98 72 110 C62 118 42 118 30 110 C16 98 12 78 20 58 C26 44 38 28 50 8 Z"
            fill="url(#outerFlameGrad)"
          />

          {/* تجعد جانبي أيمن للشعلة */}
          <Path
            d="M56 22 C66 36 78 48 76 68 C74 54 66 46 56 22 Z"
            fill="#FEF08A"
            fillOpacity="0.6"
          />

          {/* تجعد جانبي أيسر للشعلة */}
          <Path
            d="M44 28 C34 42 24 54 26 72 C28 58 36 50 44 28 Z"
            fill="#EF4444"
            fillOpacity="0.5"
          />

          {/* التوهج الدائري في قاعدة الشعلة */}
          <Circle cx="50" cy="85" r="30" fill="url(#innerGlow)" />

          {/* قلب اللهب المتوهج الداخلي */}
          <Path
            d="M50 42 C55 54 66 65 64 84 C62 96 56 104 50 104 C44 104 38 96 36 84 C34 65 45 54 50 42 Z"
            fill="url(#coreFlameGrad)"
            transform={`scale(${reduced ? 1 : 1.02})`}
          />

          {/* نواة اللهب شديدة السطوع البيضاء */}
          <Path
            d="M50 64 C53 72 58 80 56 92 C54 98 52 100 50 100 C48 100 46 98 44 92 C42 80 47 72 50 64 Z"
            fill="#FFFFFF"
            fillOpacity="0.85"
          />
        </Svg>
      </Animated.View>

      {/* وسم عدد أسابيع الستريك */}
      {showBadge && streakWeeks > 0 ? (
        <View style={styles.badge}>
          <Txt variant="micro" bold style={styles.badgeText}>
            {streakWeeks}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  glowLayer: {
    position: 'absolute',
    backgroundColor: '#F59E0B',
    opacity: 0.5,
    filter: 'blur(14px)' as any,
  },
  spark: {
    position: 'absolute',
    top: 4,
    right: 12,
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#FEF08A',
    zIndex: 5,
  },
  badge: {
    position: 'absolute',
    bottom: -4,
    backgroundColor: '#7C2D12',
    borderColor: '#F59E0B',
    borderWidth: 1.5,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 3,
  },
  badgeText: {
    color: '#FEF3C7',
    fontVariant: ['tabular-nums'],
    fontSize: 11,
    lineHeight: 14,
  },
});
