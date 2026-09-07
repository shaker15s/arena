/**
 * design/components/SpotlightCard.tsx — بطاقة كاشفة تفاعلية (Spotlight Card)
 * مستوحاة من Aceternity UI (https://ui.aceternity.com/components/card-spotlight)
 * ومكتبة React Bits (https://reactbits.dev/components/spotlight-card) و Hover.dev
 * مرخص تحت ترخيص MIT.
 *
 * الميزات:
 * 1. بقعة ضوء ناعمة تتبع مؤشر الماوس على الويب وإصبع اللمس على الموبايل بانسيابية.
 * 2. الحفاظ التام على ألوان وتصميم Apple Liquid Glass والخطوط والمحاذاة الأصلية.
 * 3. إمكانية الوصول الكاملة للوحة المفاتيح (Keyboard Accessible with Focus Ring).
 * 4. احترام تفضيلات تقليل الحركة (prefers-reduced-motion): يتحول تلقائيًا لبطاقة هادئة بدون ضوء متحرك.
 * 5. تمرير الأحداث للروابط والأزرار الداخلية دون أي اعتراض (pointerEvents="none" على طبقة الضوء).
 */
import React, { useRef, useState } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../theme';
import { radii, spacing } from '../tokens';
import { isReducedMotion } from '../motion';

export interface SpotlightCardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  spotlightColor?: string;
  spotlightRadius?: number;
  onPress?: () => void;
  accessibilityLabel?: string;
}

export function SpotlightCard({
  children,
  style,
  spotlightColor,
  spotlightRadius = 260,
  onPress,
  accessibilityLabel,
}: SpotlightCardProps) {
  const { theme, isDark } = useTheme();
  const [pos, setPos] = useState({ x: -500, y: -500 });
  const [isFocused, setIsFocused] = useState(false);
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const cardSize = useRef({ width: 0, height: 0 });

  const reduced = isReducedMotion();
  const activeColor = spotlightColor ?? (isDark ? 'rgba(56, 189, 248, 0.18)' : 'rgba(0, 122, 255, 0.12)');

  const handlePointerMove = (e: any) => {
    if (reduced) return;
    if (Platform.OS === 'web' && e.currentTarget) {
      const rect = e.currentTarget.getBoundingClientRect();
      setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      Animated.timing(opacityAnim, { toValue: 1, duration: 150, useNativeDriver: false }).start();
    }
  };

  const handlePointerLeave = () => {
    if (reduced) return;
    Animated.timing(opacityAnim, { toValue: 0, duration: 250, useNativeDriver: false }).start();
  };

  const handleTouchMove = (e: any) => {
    if (reduced) return;
    const { locationX, locationY } = e.nativeEvent;
    setPos({ x: locationX, y: locationY });
    Animated.timing(opacityAnim, { toValue: 1, duration: 150, useNativeDriver: false }).start();
  };

  const handleTouchEnd = () => {
    if (reduced) return;
    Animated.timing(opacityAnim, { toValue: 0, duration: 300, useNativeDriver: false }).start();
  };

  const cardContent = (
    <View
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        cardSize.current = { width, height };
      }}
      // @ts-ignore — دعم أحداث مؤشر الويب (Web Pointer Events)
      onPointerMove={Platform.OS === 'web' ? handlePointerMove : undefined}
      onPointerLeave={Platform.OS === 'web' ? handlePointerLeave : undefined}
      onTouchMove={Platform.OS !== 'web' ? handleTouchMove : undefined}
      onTouchEnd={Platform.OS !== 'web' ? handleTouchEnd : undefined}
      style={[
        styles.cardShell,
        {
          backgroundColor: theme.glass,
          borderColor: isFocused ? theme.brand : theme.glassBorder,
          borderWidth: isFocused ? 2 : 1,
        },
        style,
      ]}
    >
      {/* طبقة الـ Spotlight الشعاعية التفاعلية */}
      {!reduced && cardSize.current.width > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              opacity: opacityAnim,
              borderRadius: radii.card,
              overflow: 'hidden',
              zIndex: 1,
            },
          ]}
        >
          <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
            <Defs>
              <RadialGradient
                id="spotlightGrad"
                cx={pos.x}
                cy={pos.y}
                r={spotlightRadius}
                gradientUnits="userSpaceOnUse"
              >
                <Stop offset="0%" stopColor={activeColor} stopOpacity={1} />
                <Stop offset="60%" stopColor={activeColor} stopOpacity={0.3} />
                <Stop offset="100%" stopColor={activeColor} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Rect
              x="0"
              y="0"
              width="100%"
              height="100%"
              fill="url(#spotlightGrad)"
            />
          </Svg>
        </Animated.View>
      )}

      {/* محتوى البطاقة الأصلي */}
      <View style={{ zIndex: 2, position: 'relative' }}>
        {children}
      </View>
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        style={({ pressed }) => ({
          transform: [{ scale: pressed ? 0.98 : 1 }],
          outline: 'none',
        } as any)}
      >
        {cardContent}
      </Pressable>
    );
  }

  return cardContent;
}

const styles = StyleSheet.create({
  cardShell: {
    borderRadius: radii.card,
    padding: spacing.s4,
    position: 'relative',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
});
