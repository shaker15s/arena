/**
 * design/motion.ts — لغة الحركة الموحدة (وثيقة 05 §5.2)
 * كل مدة ومنحنى من الكتالوج — لا حركات عشوائية.
 * ملاحظة تنفيذ: نستخدم Animated الأساسي بنفس الـ presets (يدعم الويب والنيتف)،
 * وعلى الإنتاج النيتفي تُستبدل المحركات بـ Reanimated/Skia بنفس هذه الثوابت.
 */
import { Easing } from 'react-native';

export const duration = {
  micro: 140,
  fast: 220,
  standard: 300,
  emphatic: 480,
  celebration: 700,
} as const;

export const easing = {
  standard: Easing.bezier(0.2, 0.8, 0.2, 1), // Apple-out
  exit: Easing.bezier(0.4, 0, 1, 1),
  linear: Easing.linear,
  inOut: Easing.inOut(Easing.ease),
} as const;

/** Apple-specific advanced easing curves */
export const appleEasing = {
  /** Standard Apple out-curve for UI elements */
  out: Easing.bezier(0.23, 1, 0.32, 1),
  /** Drawer/sheet easing */
  drawer: Easing.bezier(0.32, 0.72, 0, 1),
  /** Decelerate for momentum-based animations */
  decelerate: Easing.bezier(0.0, 0.0, 0.2, 1),
} as const;

/** Stagger delay utility for sequential item animations */
export function staggerDelay(index: number, baseDelay = 50): number {
  return index * baseDelay;
}

export const spring = {
  gentle: { damping: 18, stiffness: 150, useNativeDriver: true },
  snappy: { damping: 22, stiffness: 260, useNativeDriver: true },
  playful: { damping: 9, stiffness: 180, useNativeDriver: true },
} as const;

export const scalePress = 0.96;

// كشف تفضيل الحركة المخفضة (Reduced Motion)
let reducedMotion = false;
export function setReducedMotion(v: boolean) {
  reducedMotion = v;
}
export function isReducedMotion() {
  return reducedMotion;
}
/** مدة محترمة للحركة المخفضة: كل شيء يتحول لـ crossfade 200ms */
export function reducedMs(ms: number) {
  return reducedMotion ? 200 : ms;
}
