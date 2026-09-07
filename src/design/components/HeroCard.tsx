/**
 * design/components/HeroCard.tsx — بطاقة رئيسية (Hero Card)
 * تستخدم لعرض معلومات بارزة مثل رصيد المحفظة.
 * تتميز بتدرج لوني متحرك ومظهر زجاجي أنيق على طراز Apple Liquid Glass.
 * تحترم إعدادات تقليل الحركة (Reduced Motion).
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, ViewStyle, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme';
import { isReducedMotion } from '../motion';
import { radii, spacing } from '../tokens';
import { BorderBeam } from './BorderBeam';

export interface HeroCardProps {
  children: React.ReactNode;
  gradientFrom?: string;
  gradientTo?: string;
  animated?: boolean;
  borderBeam?: boolean;
  style?: ViewStyle;
}

export function HeroCard({
  children,
  gradientFrom,
  gradientTo,
  animated = true,
  borderBeam = false,
  style,
}: HeroCardProps) {
  const { theme } = useTheme();
  const fromColor = gradientFrom ?? theme.brandGradientFrom;
  const toColor = gradientTo ?? theme.brandGradientTo;

  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const reduced = isReducedMotion();

  useEffect(() => {
    if (!animated || reduced) return;

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(overlayOpacity, {
          toValue: 1,
          duration: 3000,
          useNativeDriver: true,
        }),
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: 3000,
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();
    return () => animation.stop();
  }, [animated, reduced, overlayOpacity]);

  return (
    <View style={[styles.container, style]}>
      {/* طبقة التدرج الأساسية */}
      <LinearGradient
        colors={[fromColor, toColor]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* طبقة التدرج المتحركة (عكس الاتجاه) */}
      {animated && !reduced && (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: overlayOpacity }]}>
          <LinearGradient
            colors={[toColor, fromColor]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}

      {/* شعاع الحواف المشع المستوحى من Magic UI */}
      {borderBeam && !reduced && (
        <BorderBeam
          size={160}
          duration={5500}
          borderWidth={2}
          colorFrom={fromColor}
          colorTo={toColor}
          borderRadius={radii.card}
        />
      )}

      {/* المحتوى */}
      <View style={styles.content}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radii.card,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.15,
        shadowRadius: 20,
      },
      android: {
        elevation: 8,
      },
      default: {},
    }),
  },
  content: {
    padding: spacing.lg,
    position: 'relative',
    zIndex: 1,
  },
});
