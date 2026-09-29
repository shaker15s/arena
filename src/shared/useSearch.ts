/**
 * shared/useSearch.ts — بحث فوري بلا تقطيع سلاسة الكتابة (FUNC-07).
 *
 * المشكلة المقيسة: الفلترة كانت تُنفَّذ على كل ضغطة مفتاح (`onChangeText`) في
 * قوائم قد تحمل مئات الصفوف ⇒ تأخّر ملموس في الكتابة على الأجهزة المتوسطة.
 * الحل مُجمَّع من مصدرين رسميين:
 *  • React 19 `useDeferredValue`: يبقي حقل الإدخال متزامنًا ويرجئ تحديث
 *    القائمة الثقيلة (Interaction → deferred render) فلا تُحبس ضغطة المفتاح.
 *  • `useDebounce` الحالي (200ms افتراضيًا): يقلّل عدد مرات الفلترة الفعلية.
 * النتيجة: القائمة النهائية تُحسب مرّة واحدة لكل نص مستقر، والكتابة تبقى سلسة.
 */
import { useDeferredValue, useMemo, useRef } from 'react';
import { useDebounce } from './hooks';
import { rankSearch } from './search';

export function useDeferredSearch<T>(
  query: string,
  items: T[],
  fields: (item: T) => Array<string | null | undefined>,
  debounceMs = 200,
): { results: T[]; isStale: boolean; isSearching: boolean } {
  const debounced = useDebounce(query, debounceMs);
  const deferred = useDeferredValue(debounced);

  // نحفظ دالة الحقول في مرجع حتى لا تُعاد الفلترة لمجرد تغيّر هوية الدالة.
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;

  const results = useMemo(
    () => rankSearch(items, deferred, fieldsRef.current),
    [items, deferred],
  );

  return {
    results,
    isStale: deferred !== query,
    isSearching: query.trim().length > 0,
  };
}
