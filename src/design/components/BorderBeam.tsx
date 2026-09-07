/**
 * design/components/BorderBeam.tsx — مكون شعاع الحواف المشع (Border Beam)
 * مستوحى من مكتبة Magic UI (https://magicui.design/docs/components/border-beam)
 * مرخص تحت ترخيص MIT.
 *
 * الميزات:
 * 1. شعاع لوني انسيابي يطوف على حواف البطاقة بسلاسة فيزيائية.
 * 2. قياس ديناميكي لأبعاد أي حاوية (onLayout) بدون الحاجة لتحديد الحجم يدويًا.
 * 3. احترام كامل لإعدادات تقليل الحركة (prefers-reduced-motion) — يتعطل تلقائيًا لمنع التشتيت.
 * 4. توافق تام مع اللمس ولوحة المفاتيح: pointerEvents="none" ليمر اللمس بسلاسة للأزرار الداخلية.
 * 5. أداء ناعم عبر SVG strokeDashoffset بدون حجب مسار الـ JS.
 */
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  LayoutChangeEvent,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { isReducedMotion } from '../motion';
import { radii } from '../tokens';

const AnimatedRect = Animated.createAnimatedComponent(Rect);

export interface BorderBeamProps {
  /** حجم/طول شعاع الضوء بالبكسل (الافتراضي 140) */
  size?: number;
  /** مدة الدورة الكاملة بالمللي ثانية (الافتراضي 6000ms لدوران هادئ وفخم) */
  duration?: number;
  /** سمك حدود الشعاع (الافتراضي 2) */
  borderWidth?: number;
  /** لون بداية الشعاع */
  colorFrom?: string;
  /** لون نهاية الشعاع */
  colorTo?: string;
  /** زاوية انحناء الإطار (مطابقة لـ radii.card أو المحددة) */
  borderRadius?: number;
  /** عكس اتجاه الدوران */
  reverse?: boolean;
  /** تأخير البدء بالمللي ثانية */
  delay?: number;
  style?: ViewStyle;
}

export function BorderBeam({
  size = 140,
  duration = 6000,
  borderWidth = 2,
  colorFrom = '#38BDF8',
  colorTo = '#A855F7',
  borderRadius = radii.card,
  reverse = false,
  delay = 0,
  style,
}: BorderBeamProps) {
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const anim = useRef(new Animated.Value(0)).current;
  const rawId = useId();
  const gradId = `beam_grad_${rawId.replace(/:/g, '_')}`;

  const reduced = isReducedMotion();

  const handleLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0 && (width !== dimensions.width || height !== dimensions.height)) {
      setDimensions({ width: Math.round(width), height: Math.round(height) });
    }
  };

  // حساب محيط المستطيل ذو الزوايا المنحنية بدقة
  const perimeter = useMemo(() => {
    const { width, height } = dimensions;
    if (width <= 0 || height <= 0) return 0;
    const r = Math.min(borderRadius, Math.min(width, height) / 2);
    // المحيط = محيط الأضلاع المستقيمة + محيط الأقواس الأربعة (2*pi*r)
    return Math.max(1, Math.round(2 * (width + height) - r * (8 - 2 * Math.PI)));
  }, [dimensions, borderRadius]);

  useEffect(() => {
    if (reduced || perimeter <= 0) return;

    anim.setValue(0);
    const animation = Animated.loop(
      Animated.timing(anim, {
        toValue: 1,
        duration,
        easing: Easing.linear,
        useNativeDriver: false,
        delay,
      })
    );

    animation.start();
    return () => animation.stop();
  }, [anim, duration, delay, reduced, perimeter]);

  if (reduced) return null;

  const { width, height } = dimensions;
  const strokeDash = Math.min(size, Math.max(10, perimeter * 0.45));
  const strokeGap = Math.max(1, perimeter - strokeDash);

  const dashOffset = anim.interpolate({
    inputRange: [0, 1],
    outputRange: reverse ? [-perimeter, 0] : [0, -perimeter],
  });

  return (
    <View
      onLayout={handleLayout}
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          borderRadius,
          overflow: 'hidden',
          zIndex: 5,
        },
        style,
      ]}
    >
      {width > 0 && height > 0 && perimeter > 0 ? (
        <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor={colorFrom} stopOpacity={0} />
              <Stop offset="40%" stopColor={colorFrom} stopOpacity={0.8} />
              <Stop offset="60%" stopColor={colorTo} stopOpacity={1} />
              <Stop offset="100%" stopColor={colorTo} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <AnimatedRect
            x={borderWidth / 2}
            y={borderWidth / 2}
            width={Math.max(0, width - borderWidth)}
            height={Math.max(0, height - borderWidth)}
            rx={borderRadius}
            ry={borderRadius}
            fill="none"
            stroke={`url(#${gradId})`}
            strokeWidth={borderWidth}
            strokeDasharray={`${strokeDash} ${strokeGap}`}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
          />
        </Svg>
      ) : null}
    </View>
  );
}
