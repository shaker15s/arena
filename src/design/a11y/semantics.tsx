/**
 * design/a11y/semantics.tsx — البنية الدلالية للشاشات (A11Y-01 → 05).
 *
 * المشكلة (مؤكدة بالكود): صفر `accessibilityRole="header"` وصفر معالم
 * (`main`/`navigation`) في 37 شاشة → مستخدم قارئ الشاشة لا يستطيع التنقل
 * بالعناوين (Headings rotor) ولا القفز إلى المحتوى الرئيسي.
 *
 * الحل: مكوّنات صغيرة تُستخدم في كل شاشة، مع تحويل تلقائي لدلالات الويب:
 *   • `Screen`  → `<main>` (ويب) + خلفية + إعلان دخول الشاشة (اختياري).
 *   • `Section` → عنوان `h2` حقيقي + منطقة (`region`) مرتبطة به.
 *   • `Landmark`→ `navigation` / `banner` / `complementary`.
 *   • `LiveRegion` → منطقة حيّة للإعلانات (Assertive/Polite).
 *   • `SkipLink`  → «تخطَّ إلى المحتوى» (WCAG 2.4.1) — تُعرض أول عنصر في الصفحة.
 */
import React, { useEffect } from 'react';
import { Platform, StyleProp, TextStyle, View, ViewStyle } from 'react-native';
import { Txt } from '../components';
import { radii, spacing } from '../tokens';
import { useTheme } from '../theme';
import { announce } from './announce';

const isWeb = Platform.OS === 'web';

const webOnly = (role: string) => (isWeb ? ({ role } as unknown as object) : null);
const ariaProp = (key: string, value: unknown) =>
  isWeb ? ({ [key]: value } as unknown as object) : null;

export type HeadingLevel = 'h1' | 'h2' | 'h3';
const levelNumber: Record<HeadingLevel, number> = { h1: 1, h2: 2, h3: 3 };

/** خصائص عنوان دلالي — تُدمج في `Txt` نفسه أيضًا (انظر `TxtProps.heading`). */
export function headingProps(level: HeadingLevel) {
  return {
    accessibilityRole: 'header' as const,
    ...ariaProp('aria-level', levelNumber[level]),
    ...ariaProp('role', 'heading'),
  };
}

/**
 * جذر الشاشة: معلم `main` + خلفية الثيم + إعلان اختياري عند الدخول.
 * لا يُغيّر أي تخطيط — يُغلّف ما هو موجود.
 */
export function Screen({
  children,
  style,
  /** اسم الشاشة المنطوق عند الدخول (من i18n). */
  announceOnFocus,
  /** عنوان الشاشة للربط الدلالي (ويب: aria-label على main). */
  label,
  testID,
  id,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  announceOnFocus?: string;
  label?: string;
  testID?: string;
  id?: string;
}) {
  const { theme } = useTheme();

  useEffect(() => {
    if (announceOnFocus) announce(announceOnFocus, 'polite');
    // نعلن عند تغيّر اسم الشاشة فقط.
  }, [announceOnFocus]);

  return (
    <View
      testID={testID}
      nativeID={id}
      style={[{ flex: 1, backgroundColor: theme.bg }, style]}
      {...(webOnly('main') as object)}
      {...(id ? ariaProp('id', id) : {})}
      {...(label ? ariaProp('aria-label', label) : {})}
      {...(id ? { tabIndex: -1 } : {})}
    >
      {children}
    </View>
  );
}

/** قسم بعنوان `h2` حقيقي + `region` مرتبط به (يُقرأ كقسم داخل الشاشة). */
export function Section({
  title,
  children,
  style,
  level = 'h2',
  id,
}: {
  title?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  level?: HeadingLevel;
  id?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <View
      style={style}
      {...(webOnly('region') as object)}
      {...(headingId ? ariaProp('aria-labelledby', headingId) : {})}
    >
      {title ? (
        <Txt
          variant={level === 'h1' ? 'h1' : level === 'h2' ? 'h2' : 'h3'}
          heading={level}
          {...(headingId ? { id: headingId } : {})}
          style={{ marginBottom: spacing.s2 }}
        >
          {title}
        </Txt>
      ) : null}
      {children}
    </View>
  );
}

/** معلم تنقّل/رأس/مكمّل — للويب أساسًا (قارئ الشاشة على الجوال لا يحتاجه). */
export function Landmark({
  kind,
  children,
  style,
  label,
}: {
  kind: 'navigation' | 'banner' | 'complementary' | 'contentinfo';
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  label?: string;
}) {
  return (
    <View
      style={style}
      {...(webOnly(kind) as object)}
      {...(label ? ariaProp('aria-label', label) : {})}
    >
      {children}
    </View>
  );
}

/** منطقة حيّة: كل ما يتغيّر داخلها يُعلن تلقائيًا (أندرويد + ويب). */
export function LiveRegion({
  children,
  assertive,
  style,
}: {
  children: React.ReactNode;
  assertive?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      accessibilityLiveRegion={assertive ? 'assertive' : 'polite'}
      {...ariaProp('aria-live', assertive ? 'assertive' : 'polite')}
      {...ariaProp('aria-atomic', true)}
      style={style}
    >
      {children}
    </View>
  );
}

/**
 * عنوان/نص مقروء لقارئ الشاشة فقط (بلا أثر بصري) — ويب فقط.
 *
 * يُستخدم للشاشات التي لا تحمل عنوانًا مرئيًا كبيرًا (مثل شاشة المسح بملء
 * الشاشة) حتى تبقى بنية `h1` كاملة لكل شاشة (WCAG 1.3.1 / 2.4.6).
 * على الجوال نُعيد `null` لأن الإعلان يتم عبر `Header`/`announce`.
 */
export function VisuallyHidden({
  children,
  heading,
}: {
  children: React.ReactNode;
  heading?: HeadingLevel;
}) {
  if (!isWeb) return null;
  return (
    <Txt
      heading={heading}
      // تقنية clip-rect المعتمدة للقراءة فقط بالشاشة (bootstrap/RNW):
      // clipPath خاصية ويب فقط، لذا تُمرَّر بتحويل نوع صريح.
      style={{
        position: 'absolute',
        width: 1,
        height: 1,
        margin: -1,
        overflow: 'hidden',
        clipPath: 'inset(50%)',
        whiteSpace: 'nowrap',
        borderWidth: 0,
      } as unknown as TextStyle}
    >
      {children}
    </Txt>
  );
}

/**
 * رابط «تخطَّ إلى المحتوى» (WCAG 2.4.1) — ويب فقط.
 * يظهر عند التركيز بالكيبورد ولا يؤثر على التخطيط.
 */
export function SkipLink({ targetId = 'masar-main', label }: { targetId?: string; label: string }) {
  if (!isWeb) return null;
  return (
    <a
      href={`#${targetId}`}
      className="masar-skip-link"
      style={{
        position: 'absolute',
        insetInlineStart: 12,
        top: -60,
        zIndex: 9999,
        padding: '10px 16px',
        borderRadius: radii.md,
        // ألوان الحلقة/الرابط من نفس قيم التوكنز المعتمدة في check-contrast.js
        background: '#0066CC',
        color: '#FFFFFF',
        fontFamily: 'IBMPlexSansArabic_500Medium, IBM Plex Sans Arabic, system-ui, sans-serif',
        fontSize: 15,
        textDecoration: 'none',
        transition: 'top .15s ease-out',
      }}
      onFocus={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.top = '12px';
      }}
      onBlur={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.top = '-60px';
      }}
    >
      {label}
    </a>
  );
}
