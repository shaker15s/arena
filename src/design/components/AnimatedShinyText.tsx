/**
 * design/components/AnimatedShinyText.tsx — نص متحرك بلمعان ضوئي هادئ (Shiny Text)
 * مستوحى من Magic UI (https://magicui.design/docs/components/animated-shiny-text)
 * ومكتبة React Bits (https://reactbits.dev/text-animations/shiny-text)
 * مرخص تحت ترخيص MIT.
 *
 * الميزات:
 * 1. وميض ضوئي فخم يتحرك بانسيابية عبر النص دون تغيير الخط أو الألوان الأصلية.
 * 2. يدعم الويب عبر CSS linear-gradient text clip بأداء 60fps أصيل.
 * 3. يدعم الموبايل أصليًا عبر Animated breathing specular shine.
 * 4. يحترم إعدادات تقليل الحركة (prefers-reduced-motion) — يعود لنص ثابت تمامًا فورًا.
 * 5. يحافظ على مقروئية الخط العربي (IBM Plex Sans Arabic) وإمكانية الوصول للشاشات الناطقة.
 */
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Platform,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
} from 'react-native';
import { isReducedMotion } from '../motion';

export interface AnimatedShinyTextProps {
  children: string;
  style?: StyleProp<TextStyle>;
  shimmerColor?: string;
  duration?: number;
  numberOfLines?: number;
  accessibilityRole?: 'text' | 'header';
}

export function AnimatedShinyText({
  children,
  style,
  shimmerColor = '#FBBF24',
  duration = 3200,
  numberOfLines,
  accessibilityRole = 'text',
}: AnimatedShinyTextProps) {
  const reduced = isReducedMotion();
  const shimmerAnim = useRef(new Animated.Value(0.75)).current;

  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById('masar-shiny-keyframes')) {
      const styleTag = document.createElement('style');
      styleTag.id = 'masar-shiny-keyframes';
      styleTag.textContent = `
        @keyframes masarShinyText {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `;
      document.head.appendChild(styleTag);
    }

    if (reduced || Platform.OS === 'web') return;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: duration / 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0.75,
          duration: duration / 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    loop.start();
    return () => loop.stop();
  }, [shimmerAnim, duration, reduced]);

  if (reduced) {
    return (
      <Text
        style={style}
        numberOfLines={numberOfLines}
        accessibilityRole={accessibilityRole}
      >
        {children}
      </Text>
    );
  }

  // على الويب: استخدام التدرج النصي فائق النعومة (Vercel / Magic UI CSS Text Clip)
  if (Platform.OS === 'web') {
    const webStyle: any = {
      backgroundImage: `linear-gradient(115deg, currentColor 20%, ${shimmerColor} 50%, currentColor 80%)`,
      backgroundSize: '220% 100%',
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      animation: `masarShinyText ${duration}ms linear infinite`,
      display: 'inline-block',
    };

    return (
      <View style={{ position: 'relative' }}>
        <Text
          style={[style, webStyle]}
          numberOfLines={numberOfLines}
          accessibilityRole={accessibilityRole}
        >
          {children}
        </Text>
      </View>
    );
  }

  // على أجهزة الموبايل الأصلية: بريق تنفسي نبضي فخم مع الحفاظ على وضوح النص
  return (
    <Animated.View style={{ opacity: shimmerAnim }}>
      <Text
        style={style}
        numberOfLines={numberOfLines}
        accessibilityRole={accessibilityRole}
      >
        {children}
      </Text>
    </Animated.View>
  );
}
