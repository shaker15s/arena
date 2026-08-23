/** أدوات تنسيق مشتركة — أرقام، تواريخ، أوقات (عربي/إنجليزي). */

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
/** الأرقام لاتينية دائمًا في العدادات (توثيق التصميم)، والعربية للنصوص عند الحاجة. */
export function num(n: number): string {
  return String(n);
}
export function numAr(n: number): string {
  return String(n).replace(/\d/g, (d) => AR_DIGITS[Number(d)]);
}

const MONTHS_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];
const MONTHS_EN = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function formatDate(ts: number, lang: 'ar' | 'en'): string {
  const d = new Date(ts);
  const months = lang === 'ar' ? MONTHS_AR : MONTHS_EN;
  if (lang === 'ar') return `${d.getDate()} ${months[d.getMonth()]}`;
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

export function formatTime(ts: number, lang: 'ar' | 'en'): string {
  const d = new Date(ts);
  let h = d.getHours();
  const m = d.getMinutes();
  const period = h >= 12 ? (lang === 'ar' ? 'م' : 'PM') : lang === 'ar' ? 'ص' : 'AM';
  h = h % 12 === 0 ? 12 : h % 12;
  const mm = m < 10 ? `0${m}` : `${m}`;
  return lang === 'ar' ? `${h}:${mm} ${period}` : `${h}:${mm} ${period}`;
}

export function timePast(ts: number, lang: 'ar' | 'en'): string {
  const mins = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (mins < 1) return lang === 'ar' ? 'الآن' : 'now';
  if (mins < 60) return lang === 'ar' ? `منذ ${mins} د` : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return lang === 'ar' ? `منذ ${hrs} س` : `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return lang === 'ar' ? `منذ ${days} يوم` : `${days}d ago`;
}

/** بداية الأسبوع: الأحد 00:00 (توصية الوثيقة — توقيت القاهرة) */
export function weekStartOf(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = الأحد
  d.setDate(d.getDate() - day);
  return d.getTime();
}

export function monthKeyOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}`;
}

export function sameDay(a: number, b: number): boolean {
  const d1 = new Date(a);
  const d2 = new Date(b);
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

export function formatDuration(ms: number, lang: 'ar' | 'en'): string {
  const totalMin = Math.max(0, Math.ceil(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return lang === 'ar' ? `${m} دقيقة` : `${m} min`;
  if (m === 0) return lang === 'ar' ? `${h} ساعة` : `${h} hr`;
  return lang === 'ar' ? `${h} س ${m} د` : `${h}h ${m}m`;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * مُولّد معرّفات — UUID v4 حقيقي حتى تكون كل السجلات الجديدة صالحة
 * للكتابة مباشرة في أعمدة UUID داخل Postgres/Supabase.
 * الوسيط `prefix` مُهمَل ومحفوظ فقط لتوافق النداءات القديمة.
 */
export function uid(_prefix = 'id'): string {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  // بديل حتمي الشكل (RFC 4122 v4) للبيئات القديمة
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** هاش حتمي للاختبارات والحسابات المحلية فقط؛ ليس توقيعًا أمنيًا. */
export function hashStr(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const out = (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
  return out;
}
