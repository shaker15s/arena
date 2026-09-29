/**
 * لغة الحركة الموحدة للتطبيق (DS-08) — نظام واحد فقط:
 *
 *   • الانتقالات والتفاعلات = **springs** (tokens) عبر `Animated.spring` —
 *     الإحساس الفيزيائي الطبيعي المناسب لـ React Native.
 *   • الحلقات المستمرة (نبض اللهيب، لمعان الهيكل) تستدعي `Easing` من
 *     react-native مباشرة — ليست «نظام حركة» بل دورة مستمرة بلا هدف.
 *
 * حُذف النظامان الموازيان `easing` (نمط Material) و`appleEasing` (نمط Apple)
 * لأن الاختيار العشوائي بين أربعة أنظمة كان يجعل كل شاشة تتحرك بإحساس مختلف.
 * القيم قصيرة ومقصودة، وتُلغى الحركة الزائدة تلقائيًا عند تفعيل Reduce Motion.
 */
import { AccessibilityInfo, Platform } from 'react-native';

export const duration = {
  instant: 90,
  micro: 140,
  fast: 220,
  standard: 300,
  emphatic: 480,
  celebration: 700,
} as const;

export function staggerDelay(index: number, baseDelay = 45): number {
  // القوائم الطويلة لا يجب أن تجعل العنصر رقم 100 ينتظر عدة ثوانٍ.
  return Math.min(Math.max(index, 0), 8) * baseDelay;
}

import { springs } from './tokens';
export { springs };

export const spring = {
  gentle: { ...springs.default, useNativeDriver: true },
  snappy: { ...springs.snappy, useNativeDriver: true },
  playful: { ...springs.bouncy, useNativeDriver: true },
} as const;

/**
 * مقياس ضغط العناصر (DS-03) — كانت 0.96 و0.97 و0.98 حسب المكوّن لنفس التأثير.
 * قاعدة واحدة: كلما كبر السطح قلّ تصغير الضغطة.
 */
export const pressScale = {
  /** صفوف ومساحات واسعة */
  subtle: 0.98,
  /** بطاقات وأزرار قياسية */
  default: 0.97,
  /** عناصر صغيرة (الشِقاقات/Chips) */
  strong: 0.96,
} as const;

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
