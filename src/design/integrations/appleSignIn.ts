/**
 * design/integrations/appleSignIn.ts — مواصفات زر «Sign in with Apple» الرسمية
 * + مقياس موحّد لأزرار شاشة الدخول (Google/Apple).
 *
 * الأرقام هنا مقتبسة حرفيًا من دليل Apple (Human Interface Guidelines →
 * Technologies → Sign in with Apple → Buttons) وليست اجتهادًا بصريًا:
 *
 *  • الحد الأدنى للزر: 140pt عرضًا × 30pt ارتفاعًا، والهامش حوله = 1/10 ارتفاعه.
 *  • «لا تجعل زر Apple أصغر من بقية أزرار الدخول» ⇒ ارتفاعنا 56pt = نفس أزرارنا الأخرى.
 *  • في الزر المخصّص: حجم خط العنوان = 43% من ارتفاع الزر (أي الارتفاع = 233% من
 *    حجم الخط). 56 × 0.43 = 24.08 ⇒ 24px، وهو نفس مقاس `typography.h1` لدينا،
 *    فالتزمنا بالمقاسين معًا بلا قيمة خارج طبقة التصميم.
 *  • نصف قطر الزوايا يُضبط ليطابق بقية أزرار التطبيق (radii.button).
 *  • الأنماط: أسود على خلفية فاتحة · أبيض على خلفية داكنة · أبيض بحدود إذا كانت
 *    الخلفية الفاتحة لا تعطي تباينًا كافيًا.
 *
 * على iOS نستخدم زر النظام `ASAuthorizationAppleIDButton` (مضمون المطابقة
 * والترجمة التلقائية ونص VoiceOver)، وهذا الملف يخدم الويب/أندرويد ويوثّق
 * نفس المواصفات في مكان واحد.
 *
 * المصادر:
 *  - https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple
 *  - https://developer.apple.com/design/human-interface-guidelines/buttons
 */
import { radii, sizes, typography } from '../tokens';

/** الأسود/الأبيض مفروضان من Apple في زر الدخول — لا يُشتقان من ثيم التطبيق. */
export const APPLE_BLACK = '#000000';
export const APPLE_WHITE = '#FFFFFF';

/**
 * المقياس الموحّد لكل أزرار الدخول (Google/Apple) — مصدر الحقيقة الوحيد
 * لارتفاع ونصف قطر أزرار شاشة الدخول، ومبني على `sizes.ctaButton` (معيار HIG
 * للأزرار التفاعلية) مع 4px إضافية للوصول إلى 56pt وهو الارتفاع المعتمد لدينا.
 */
export const AUTH_CTA = {
  height: sizes.ctaButton + 4,
  radius: radii.button,
} as const;

export const APPLE_SIGN_IN = {
  /** الحد الأدنى الرسمي للزر */
  minWidth: 140,
  minHeight: 30,
  /** الهامش حول الزر = 1/10 من ارتفاعه (HIG) */
  marginRatio: 0.1,
  /** حجم خط العنوان = 43% من ارتفاع الزر (HIG) */
  titleRatio: 0.43,
  /** ارتفاع الزر = نفس أزرار الدخول الأخرى في مسار (HIG: لا أصغر منها) */
  height: AUTH_CTA.height,
  radius: AUTH_CTA.radius,
} as const;

/** حجم خط العنوان في الزر المخصّص: 43% من الارتفاع (يساوي typography.h1 = 24). */
export const APPLE_TITLE_FONT_SIZE = Math.round(APPLE_SIGN_IN.height * APPLE_SIGN_IN.titleRatio);

/** الهامش الأدنى المطلوب حول الزر (يُستخدم في التخطيط لا في الزر نفسه). */
export const APPLE_BUTTON_MARGIN = Math.ceil(APPLE_SIGN_IN.height * APPLE_SIGN_IN.marginRatio);

/** السمة اللونية المعتمدة حسب خلفية الشاشة (HIG: الأسود للفاتح، الأبيض للداكن). */
export function appleSignInPalette(isDark: boolean): {
  background: string;
  foreground: string;
  border: string;
} {
  return isDark
    ? { background: APPLE_WHITE, foreground: APPLE_BLACK, border: 'transparent' }
    : { background: APPLE_BLACK, foreground: APPLE_WHITE, border: 'transparent' };
}

/** خط العنوان الرسمي للزر المخصّص (نفس مقاس 43% مضمونًا عبر التوكنز). */
export const APPLE_TITLE_TYPOGRAPHY = typography.h1;
