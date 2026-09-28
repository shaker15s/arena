/**
 * design/a11y/roving.ts — تنقّل لوحة المفاتيح بمجموعات الاختيار (A11Y-14).
 *
 * يوفر نمط «Roving tabindex» + أسهم ←/→/↑/↓ + Home/End لمجموعات الاختيار
 * (Segmented، التقييم بالنجوم، أي مجموعة role=tablist/radiogroup).
 *
 * قواعد التنفيذ (WAI-ARIA Authoring Practices):
 *  • ترتيب واحد فقط للأسهم يعمل في RTL وLTR: السهم في اتجاه القراءة يتقدّم،
 *    والعكس يرجع — أي في RTL السهم الأيسر يتقدّم بصريًا للعنصر التالي.
 *  • Home/End يقفزان إلى الأول/الأخير.
 *  • العنصر النشط فقط يأخذ ترتيب جدولة 0، والبقية -1 (لا تدخل Tab إلا مرة واحدة).
 *  • التغيير يستدعي `onMove(index)` فيُحدَّث النموذج (selection follows focus).
 *
 * على الجوال لا تفعل شيئًا (القارئ يستخدم التمرير واللمس).
 */
import { useEffect, useRef } from 'react';
import { I18nManager, Platform } from 'react-native';

type KeyLike = {
  key: string;
  preventDefault: () => void;
  currentTarget: unknown;
};

/** يحسب فهرس الهدف وفق مفتاح السهم مع احترام اتجاه الواجهة. */
export function arrowTargetIndex(
  key: string,
  currentIndex: number,
  count: number,
  rtl: boolean,
): number | null {
  if (count <= 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  const isForwardKey = rtl ? key === 'ArrowLeft' : key === 'ArrowRight';
  const isBackwardKey = rtl ? key === 'ArrowRight' : key === 'ArrowLeft';
  const vertical = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0;
  if (!isForwardKey && !isBackwardKey && vertical === 0) return null;
  const step = isForwardKey || vertical === 1 ? 1 : -1;
  return (currentIndex + step + count) % count;
}

export function useRovingKeys({
  count,
  onMove,
}: {
  count: number;
  /** يُنادى بالفهرس الجديد عند تغييره بالكيبورد. */
  onMove: (index: number) => void;
}) {
  const refs = useRef<Array<HTMLElement | null>>([]);
  const moveRef = useRef(onMove);
  moveRef.current = onMove;

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const cleanups: Array<() => void> = [];
    for (const node of refs.current) {
      if (!node || typeof node.addEventListener !== 'function') continue;
      const handler = (event: KeyboardEvent) => {
        const current = refs.current.indexOf(event.currentTarget as HTMLElement);
        if (current < 0) return;
        const next = arrowTargetIndex(event.key, current, count, I18nManager.isRTL);
        if (next == null) return;
        event.preventDefault();
        moveRef.current?.(next);
        refs.current[next]?.focus?.();
      };
      node.addEventListener('keydown', handler as EventListener);
      cleanups.push(() => node.removeEventListener('keydown', handler as EventListener));
    }
    return () => cleanups.forEach((fn) => fn());
  }, [count]);

  return refs;
}

/** ترتيب جدولة الأزرار: العنصر النشط 0 والبقية -1 (Roving tabindex). */
export function rovingTabIndex(index: number, activeIndex: number) {
  if (Platform.OS !== 'web') return {};
  return { tabIndex: index === activeIndex ? 0 : -1 } as unknown as object;
}

/** مفتاح كيبورد خام للويب فقط (RNW يمرّر onKeyDown للعنصر الأصلي عند الدعم). */
export function webKeyHandler(handler: (event: KeyLike) => void) {
  if (Platform.OS !== 'web') return {};
  return { onKeyDown: handler as unknown } as object;
}
