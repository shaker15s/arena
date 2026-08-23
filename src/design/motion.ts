/**
 * لغة الحركة الموحدة للتطبيق.
 * القيم قصيرة ومقصودة، وتُلغى الحركة الزائدة تلقائيًا عند تفعيل Reduce Motion.
 */
import { AccessibilityInfo, Easing, Platform } from 'react-native';

export const duration = {
  instant: 90,
  micro: 140,
  fast: 220,
  standard: 300,
  emphatic: 480,
  celebration: 700,
} as const;

export const easing = {
  standard: Easing.bezier(0.2, 0.8, 0.2, 1),
  exit: Easing.bezier(0.4, 0, 1, 1),
  linear: Easing.linear,
  inOut: Easing.inOut(Easing.ease),
} as const;

export const appleEasing = {
  out: Easing.bezier(0.23, 1, 0.32, 1),
  drawer: Easing.bezier(0.32, 0.72, 0, 1),
  decelerate: Easing.bezier(0, 0, 0.2, 1),
} as const;

export function staggerDelay(index: number, baseDelay = 45): number {
  // القوائم الطويلة لا يجب أن تجعل العنصر رقم 100 ينتظر عدة ثوانٍ.
  return Math.min(Math.max(index, 0), 8) * baseDelay;
}

export const spring = {
  gentle: { damping: 20, stiffness: 150, mass: 1, useNativeDriver: true },
  snappy: { damping: 24, stiffness: 280, mass: 0.9, useNativeDriver: true },
  playful: { damping: 12, stiffness: 180, mass: 0.9, useNativeDriver: true },
} as const;

export const scalePress = 0.97;

let reducedMotion = Platform.OS === 'web'
  && typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export function setReducedMotion(value: boolean) {
  reducedMotion = value;
}
export function isReducedMotion() {
  return reducedMotion;
}
export function reducedMs(ms: number) {
  return reducedMotion ? Math.min(120, ms) : ms;
}

/**
 * يربط إعداد النظام مرة واحدة بلغة الحركة. يعيد دالة تنظيف للاشتراك.
 * يدعم إعداد iOS/Android وكذلك prefers-reduced-motion على الويب.
 */
export function observeReducedMotion(): () => void {
  let mounted = true;
  void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
    if (mounted) setReducedMotion(enabled);
  }).catch(() => {});

  const nativeSub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
  let media: MediaQueryList | null = null;
  let mediaListener: ((event: MediaQueryListEvent) => void) | null = null;
  if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(media.matches);
    mediaListener = (event) => setReducedMotion(event.matches);
    media.addEventListener?.('change', mediaListener);
  }

  return () => {
    mounted = false;
    nativeSub.remove();
    if (media && mediaListener) media.removeEventListener?.('change', mediaListener);
  };
}
