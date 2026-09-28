/**
 * design/a11y/focus.ts — الطبقة المركزية الوحيدة المسؤولة عن مؤشر التركيز (Focus).
 *
 * لماذا ملف مستقل؟ لأن `outlineStyle:'none'` على الويب يمسح مؤشر تركيز المتصفح
 * فورًا، وهذا يكسر WCAG 2.4.7 (Focus Visible) و2.4.11 (Focus Not Obscured)
 * و2.4.13 (Focus Appearance, AAA). لذلك لا يُسمح بإلغاء الـoutline إلا هنا
 * وبهذا الشرط: كل موضع يستخدم `webInputReset` **يجب** أن يوفّر بديلًا مرئيًا
 * (حدّ + هالة بلون `theme.brand` عند `focused`)، وهو ما تفعله `Input` في
 * `design/components.tsx` (borderWidth 1.5 + shadowRadius 12) و
 * `PillGradientSearchInput` في `design/interactive.tsx` (borderAnim + glow).
 * بوابة `scripts/check-a11y.js` تمنع تكرار هذا النمط خارج هذا الملف.
 *
 * المصدر: WCAG 2.2 SC 2.4.7 / 2.4.11 / 2.4.13 + 1.4.11 (Non-text Contrast ≥ 3:1).
 */
import { Platform } from 'react-native';
import type { ThemeColors } from '../tokens';

/**
 * إعادة ضبط عناصر الإدخال على الويب: إزالة الحدّ/الخلفية الافتراضية للمتصفح
 * مع الحفاظ على مساحة الـoutline (بديل مرئي يُرسم من المكوّن المستدعي).
 * يُستخدم بالبسط: `style={{ ...webInputReset }}`.
 */
export const webInputReset: object =
  Platform.OS === 'web'
    ? ({ outlineStyle: 'none', border: 'none', background: 'transparent' } as object)
    : {};

/**
 * حلقة تركيز موحّدة للعناصر القابلة للتركيز بلوحة المفاتيح على الويب
 * (أزرار، روابط، حقول): سماكة 3px + إزاحة 2px + تباين ≥ 3:1 مع الخلفية
 * بفضل `theme.focusRing` (5.57:1 على الأبيض و3.06:1 على #1C1C1E — مقيَّس في
 * `scripts/check-contrast.js`).
 */
export function focusRing(theme: ThemeColors): object {
  if (Platform.OS !== 'web') return {};
  return {
    outlineStyle: 'solid',
    outlineWidth: 3,
    outlineColor: theme.focusRing,
    outlineOffset: 2,
  } as object;
}
