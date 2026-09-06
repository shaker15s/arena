/**
 * Arabic-aware search (spec §71–§72).
 * Normalizes hamza/alef/ya/ta marbuta and strips diacritics.
 * Does not mutate stored data.
 */
export function normalizeArabic(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchesSearch(haystack: string, needle: string): boolean {
  const q = normalizeArabic(needle);
  if (!q) return true;
  const h = normalizeArabic(haystack);
  return h.includes(q);
}

export function matchesAny(fields: Array<string | null | undefined>, needle: string): boolean {
  return fields.some((f) => f && matchesSearch(f, needle));
}
