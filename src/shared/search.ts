/**
 * shared/search.ts — بحث عربي/لاتيني مُطبَّع (FUNC-07).
 *
 * لماذا: الطلاب يكتبون «احمد» بلا همزة، و«أحمَد» بتشكيل، و«محمّد» بشدّة،
 * و«فاطمه» بتاء مبسوطة، وكثيرًا ما يكتبون «عبدالله» موصولة. البحث الساذج
 * (`includes`) يفشل في كل هذه الحالات ⇒ الطالب يظن أن البيانات غير موجودة.
 *
 * المنهج: توحيد الشكل (Unicode NFKD) ثم إزالة كل علامات التشكيل، ثم طيّ
 * الألف والهمزة والياء والتاء المبسوطة والألف المقصورة والكاف/الياء الفارسية،
 * ثم تحويل الأرقام العربية-الهندية إلى ASCII — بلا أي تغيير على البيانات المخزّنة.
 *
 * المراجع:
 *  • Unicode Standard Annex #15 (Normalization Forms) — NFKD يفكّ الصيغ
 *    التقديمية العربية (ﻻ، ﺃ…) إلى حروفها الأساسية + علامات تركيب.
 *  • ICU / CLDR Arabic collation & «Arabic Search Normalization» المعتاد في
 *    أنظمة البحث العربية (Google/Solr ArabicNormalizationFilter): طيّ الهمزات،
 *    التاء المربوطة، الألف المقصورة، إزالة التشكيل والتطويل.
 */
const COMBINING_MARKS = /\p{Mn}|\p{Me}|\p{Mc}/gu;
const TATWEEL = /\u0640/g;
const ARABIC_INDIC = /[\u0660-\u0669]/g;
const EXTENDED_ARABIC_INDIC = /[\u06F0-\u06F9]/g;
const NON_WORD = /[^\p{L}\p{N}\s]/gu;

/**
 * تطبيع نص للبحث: لا يُستعمل للعرض ولا للتخزين — للبحث فقط.
 * أمثلة مؤكَّدة باختبارات في `scripts/search.test.ts`.
 */
export function normalizeArabic(input: string): string {
  return input
    .normalize('NFKD') // يفكّ الهمزات والصيغ التقديمية إلى حروف + علامات تركيب
    .replace(COMBINING_MARKS, '') // ⇒ إزالة التشكيل والهمزات المركّبة معًا
    .replace(TATWEEL, '') // ـ التطويل
    .toLowerCase()
    .replace(/\u0629/g, '\u0647') // ة → ه  (فاطمة = فاطمه)
    .replace(/[\u0649\u064A\u06CC]/g, '\u064A') // ى/ی → ي
    .replace(/\u06A9/g, '\u0643') // ک فارسية → ك
    .replace(ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(EXTENDED_ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(NON_WORD, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** نفس التطبيع مع إزالة المسافات — يجعل «عبدالله» = «عبد الله». */
function compact(normalized: string): string {
  return normalized.replace(/\s+/g, '');
}

export function matchesSearch(haystack: string, needle: string): boolean {
  const q = normalizeArabic(needle);
  if (!q) return true;
  const h = normalizeArabic(haystack);
  if (h.includes(q) || compact(h).includes(compact(q))) return true;
  // كلمات الاستعلام كلها موجودة بأي ترتيب («أحمد محمود» = «محمود أحمد»)
  const tokens = q.split(' ').filter((t) => t.length > 1);
  if (tokens.length > 1) {
    const hc = compact(h);
    return tokens.every((tk) => hc.includes(compact(tk)));
  }
  return false;
}

export function matchesAny(fields: Array<string | null | undefined>, needle: string): boolean {
  return fields.some((f) => f && matchesSearch(f, needle));
}

/**
 * درجة ملاءمة (0 = لا تطابق). الأكبر أفضل — لترتيب النتائج:
 * مطابقة تامة > يبدأ بها > بداية كلمة > داخل الكلمة.
 */
export function searchScore(haystack: string, needle: string): number {
  const q = normalizeArabic(needle);
  if (!q) return 0;
  const h = normalizeArabic(haystack);
  if (!h) return 0;
  const cq = compact(q);
  const ch = compact(h);
  if (ch === cq) return 100;
  if (h.startsWith(q) || ch.startsWith(cq)) return 80;
  if (h.split(' ').some((w) => w.startsWith(q))) return 60;
  if (h.includes(q) || ch.includes(cq)) return 40;
  const tokens = q.split(' ').filter((t) => t.length > 1);
  if (tokens.length > 1 && tokens.every((tk) => ch.includes(compact(tk)))) return 30;
  return 0;
}

export function scoreFields(fields: Array<string | null | undefined>, needle: string): number {
  let best = 0;
  for (const f of fields) {
    if (!f) continue;
    const s = searchScore(f, needle);
    if (s > best) best = s;
  }
  return best;
}

/**
 * ترتيب نتائج بحسب الملاءمة مع الاحتفاظ بالترتيب الأصلي عند التساوي.
 * @param fields دالة ترجع الحقول القابلة للبحث لكل عنصر.
 */
export function rankSearch<T>(
  items: T[],
  needle: string,
  fields: (item: T) => Array<string | null | undefined>,
): T[] {
  if (!normalizeArabic(needle)) return items;
  return items
    .map((item, index) => ({ item, index, score: scoreFields(fields(item), needle) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((r) => r.item);
}
