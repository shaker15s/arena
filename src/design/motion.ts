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

/**
 * تصنيف وميزانية الحركة المعيارية الموحدة (Directive §15, §18, §19):
 * M0: منعدمة / بدون حركة (Reduce Motion) = 0ms
 * M1: تفاعلات دقيقة / Micro (80–140ms — tooltips, toggles, icon press)
 * M2: استجابة لمسية / Interaction (160–300ms — taps, cards, small state feedback)
 * M3: انتقالات هيكلية / Transition (250–380ms — sheets, page slides, modal entrance)
 * M4: احتفالات وإنجازات / Celebration (400–700ms — badge unlock, confetti, streak flame)
 *
 * جميع الحركات مصممة لتكون قابلة للمقاطعة (Interruptible) وتُلغى تلقائيًا عند Reduce Motion.
 */
export const motionHierarchy = {
  M0: 0,
  M1: 120, // 80–140ms
  M2: 220, // 160–300ms
  M3: 320, // 250–380ms
  M4: 550, // 400–700ms
} as const;

export const M0 = motionHierarchy.M0;
export const M1 = motionHierarchy.M1;
export const M2 = motionHierarchy.M2;
export const M3 = motionHierarchy.M3;
export const M4 = motionHierarchy.M4;

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
