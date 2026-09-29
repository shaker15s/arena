/**
 * design/icons.tsx — مكوّن الأيقونة الموحّد (A11Y-30).
 *
 * المشكلة التي يحلّها (مؤكدة بالكود): 179 استخدامًا مباشرًا لـ `<Ionicons>` في التطبيق،
 * ثلاثة منها فقط كانت `accessible={false}` — أي أن قارئ الشاشة كان ينطق عشرات
 * الأيقونات الزخرفية ("button"، "star"، فراغات) في كل شاشة.
 *
 * القاعدة المعمارية:
 *   • **الافتراضي: زخرفية وصامتة** (`accessible={false}` + `aria-hidden`).
 *   • أيقونة تحمل معلومة → تُمرَّر لها `label` فتصبح عنصرًا مقروءًا بدور `image`.
 *   • الأيقونة داخل زر لا تحتاج label (الزر نفسه يحمله) → اتركها زخرفية.
 *
 * ملاحظات تنفيذ:
 *   • أيقونات RN تُرسم كنص (glyph) — لذلك نضبط أيضًا `importantForAccessibility`
 *     على أندرويد لمنع نطق المحرف، و`aria-hidden` على الويب.
 *   • لا SVG ولا مكتبة جديدة: نبقي `@expo/vector-icons` (Ionicons، رخصة MIT)
 *     مع تغليف مركزي واحد يمكن تبديل مزوّده لاحقًا بقرار ADR-ICONS.
 */
import React from 'react';
import { Platform, StyleProp, TextStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

export type IconName = keyof typeof Ionicons.glyphMap;

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  /** نص وصفي — وجوده يحوّل الأيقونة إلى عنصر يحمل معلومة (لا تُخفى). */
  label?: string;
  /** تلميح لما سيحدث عند التفاعل (اختياري). */
  hint?: string;
  /** تجاوز صريح: `true` = زخرفية دائمًا، `false` = مقروءة دائمًا (تحتاج label). */
  decorative?: boolean;
  style?: StyleProp<TextStyle>;
  /** حد أدنى لمساحة اللمس (Apple HIG = 44، WCAG 2.5.8 = 24). */
  hitSlop?: number;
}

const webHidden = Platform.OS === 'web' ? ({ 'aria-hidden': true } as unknown as object) : null;
const webRole = (role: string) => (Platform.OS === 'web' ? ({ role } as unknown as object) : null);

export function Icon({
  name,
  size = 20,
  color,
  label,
  hint,
  decorative,
  style,
  hitSlop,
}: IconProps) {
  const isDecorative = decorative ?? !label;
  const a11yProps = isDecorative
    ? {
        accessible: false,
        importantForAccessibility: 'no-hide-descendants' as const,
        ...(webHidden ?? {}),
      }
    : {
        accessible: true,
        accessibilityRole: 'image' as const,
        accessibilityLabel: label,
        accessibilityHint: hint,
        ...(webRole('img') ?? {}),
      };

  return (
    <Ionicons
      name={name}
      size={size}
      color={color}
      style={style}
      hitSlop={hitSlop}
      {...(a11yProps as object)}
    />
  );
}

/**
 * أيقونة تفاعلية مستقلة (بلا نص مرئي) — تضمن دورًا واسمًا ومساحة لمس صحيحة.
 * تُستخدم في الرؤوس/الشريط العلوي مثل: جرس الإشعارات، تفعيل الفلاش، رجوع.
 */
export function IconButton({
  name,
  label,
  hint,
  size = 22,
  color,
  onPress,
  disabled,
  style,
}: {
  name: IconName;
  /** إلزامي: الزر بلا نص مرئي، فيجب أن يحمل اسمًا مقروءًا. */
  label: string;
  hint?: string;
  size?: number;
  color?: string;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  const { Pressable } = require('react-native') as typeof import('react-native');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={10}
      style={[
        {
          width: 44,
          height: 44,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.4 : 1,
        },
        Platform.OS === 'web' ? ({ cursor: onPress && !disabled ? 'pointer' : 'default' } as object) : null,
        style as object,
      ]}
    >
      <Icon name={name} size={size} color={color} decorative />
    </Pressable>
  );
}
