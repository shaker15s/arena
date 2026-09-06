/** Arabic plural forms (spec §231) — 0 / 1 / 2 / 3–10 / 11+. */
export function arabicCount(n: number, forms: { zero: string; one: string; two: string; few: string; many: string }): string {
  const abs = Math.abs(Math.trunc(n));
  if (abs === 0) return forms.zero;
  if (abs === 1) return forms.one;
  if (abs === 2) return forms.two;
  if (abs % 100 >= 3 && abs % 100 <= 10) return forms.few;
  return forms.many;
}
