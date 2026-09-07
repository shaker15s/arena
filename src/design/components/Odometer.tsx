/**
 * design/components/Odometer.tsx — عداد أرقام متحرك (Odometer)
 * يعرض الأرقام مع حركة عدّ سلسة من القيمة السابقة إلى الجديدة.
 * يحترم إعدادات تقليل الحركة (Reduced Motion).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleProp, TextStyle } from 'react-native';
import { isReducedMotion } from '../motion';
import { springs, typography } from '../tokens';

export interface OdometerProps {
  value: number;
  style?: StyleProp<TextStyle>;
  variant?: keyof typeof typography;
  color?: string;
  suffix?: string;
  prefix?: string;
  /** عدد المنازل العشرية (0 لعدد صحيح) */
  decimals?: number;
}

export function Odometer({
  value,
  style,
  variant = 'h2',
  color,
  suffix = '',
  prefix = '',
  decimals,
}: OdometerProps) {
  const reduced = isReducedMotion();
  const [displayValue, setDisplayValue] = useState(reduced ? value : 0);
  const animatedValue = useRef(new Animated.Value(reduced ? value : 0)).current;

  useEffect(() => {
    if (reduced) {
      setDisplayValue(value);
      animatedValue.setValue(value);
      return;
    }

    const listenerId = animatedValue.addListener(({ value: v }) => {
      setDisplayValue(v);
    });

    Animated.spring(animatedValue, {
      toValue: value,
      useNativeDriver: false,
      damping: springs.default.damping,
      stiffness: springs.default.stiffness,
      mass: springs.default.mass,
    }).start();

    return () => {
      animatedValue.removeListener(listenerId);
    };
  }, [value, animatedValue, reduced]);

  const dp = decimals ?? (Number.isInteger(value) ? 0 : 2);
  const formatted = dp === 0 ? Math.round(displayValue) : displayValue.toFixed(dp);

  const typo = typography[variant] ?? typography.h2;

  return (
    <Animated.Text
      numberOfLines={1}
      allowFontScaling
      maxFontSizeMultiplier={1.4}
      style={[
        {
          fontSize: typo.fontSize,
          lineHeight: typo.lineHeight,
          fontFamily: typo.fontFamily,
          color,
          fontVariant: ['tabular-nums'],
          includeFontPadding: false,
        },
        style,
      ]}
    >
      {prefix}{formatted}{suffix}
    </Animated.Text>
  );
}
