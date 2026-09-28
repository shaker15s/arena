/**
 * design/a11y/useFocusTrap.ts — حصر التركيز داخل النوافذ/الألواح (A11Y-12).
 *
 * المشكلة: على الويب لا يحصر `Modal` في react-native-web التركيزَ داخله، فيستطيع
 * المستخدم بالكيبورد أن يخرج إلى محتوى خلف النافذة (WCAG 2.1.2 «لا فخّ كيبورد»
 * بالمفهوم المعاكس: يجب أن يبقى التركيز داخل الحوار، ESC يغلقه، ويعود التركيز
 * لمصدره عند الإغلاق — WAI-ARIA Dialog Pattern).
 *
 * ما تفعله هذه الهوك:
 *  1. عند الفتح: تحفظ العنصر الذي كان مُركَّزًا ثم تنقل التركيز إلى أول عنصر
 *     قابل للتركيز داخل الحوار (وإلا إلى الحاوية نفسها عبر tabindex=-1).
 *  2. Tab / Shift+Tab يدوران داخل الحوار فقط (لا خروج للنهاية).
 *  3. Escape يستدعي `onEscape` (إغلاق).
 *  4. عند الإغلاق: يُعاد التركيز إلى العنصر السابق إن كان ما زال في الصفحة.
 *
 * على الجوال لا نحتاج شيئًا (الـ Modal الأصلي `accessibilityViewIsModal`
 * يحصر قارئ الشاشة تلقائيًا) — الهوك تنتهي بلا أثر.
 */
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useFocusTrap<T = unknown>({
  active,
  onEscape,
}: {
  /** هل الحوار مفتوح الآن؟ */
  active: boolean;
  /** يُنادى عند ضغط Escape */
  onEscape?: () => void;
}) {
  const ref = useRef<T | null>(null);
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    if (Platform.OS !== 'web' || !active) return;
    if (typeof document === 'undefined') return;

    const node = (ref.current as unknown as HTMLElement | null) ?? null;
    if (!node || typeof node.querySelectorAll !== 'function') return;

    const previous = (document.activeElement as HTMLElement | null) ?? null;
    const focusables = () =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );

    const first = focusables()[0];
    if (first) {
      first.focus();
    } else {
      node.setAttribute('tabindex', '-1');
      node.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        escapeRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        node.focus();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      if (event.shiftKey && (activeEl === firstEl || !node.contains(activeEl))) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && (activeEl === lastEl || !node.contains(activeEl))) {
        event.preventDefault();
        firstEl.focus();
      }
    };

    node.addEventListener('keydown', onKeyDown as EventListener, true);
    return () => {
      node.removeEventListener('keydown', onKeyDown as EventListener, true);
      if (previous && previous.isConnected && typeof previous.focus === 'function') {
        previous.focus({ preventScroll: true });
      }
    };
  }, [active]);

  return ref;
}
