/** Arabic plural forms (spec §231) — 0 / 1 / 2 / 3–10 / 11+. */
export function arabicCount(n: number, forms: { zero: string; one: string; two: string; few: string; many: string }): string {
  const abs = Math.abs(Math.trunc(n));
  if (abs === 0) return forms.zero;
  if (abs === 1) return forms.one;
  if (abs === 2) return forms.two;
  if (abs % 100 >= 3 && abs % 100 <= 10) return forms.few;
  return forms.many;
}

/** اسم فئة العدد العربية — يُستخدم لاختيار صيغة النص من القاموس بلا كود مكرّر. */
export type PluralForm = 'zero' | 'one' | 'two' | 'few' | 'many';

export function pluralForm(n: number): PluralForm {
  const abs = Math.abs(Math.trunc(n));
  if (abs === 0) return 'zero';
  if (abs === 1) return 'one';
  if (abs === 2) return 'two';
  if (abs % 100 >= 3 && abs % 100 <= 10) return 'few';
  return 'many';
}

/**
 * يترجم صيغة الجمع الصحيحة من القاموس: `tPlural(t, 'day.cardCount', 3)` ⇒
 * يبحث عن `day.cardCount.few` (وهو ما يوافق «3 محاضرات» لا «3 محاضرة»).
 * ولو الصيغة غير موجودة يرجع للصيغة العامة `base`.
 */
export function tPlural(
  t: (key: never, params?: Record<string, string>) => string,
  base: string,
  n: number,
  params: Record<string, string> = {},
): string {
  const key = `${base}.${pluralForm(n)}` as never;
  const text = t(key, { ...params, n: String(n) });
  // القاموس يرجع المفتاح نفسه لو غير موجود ⇒ نرجع للصيغة العامة
  return text === (key as unknown as string) ? t(base as never, { ...params, n: String(n) }) : text;
}
