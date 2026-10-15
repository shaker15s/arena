/** أدوات تنسيق مشتركة — أرقام، تواريخ، أوقات (عربي/إنجليزي). */
import { arabicCount } from './plural';

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
/** الأرقام لاتينية دائمًا في العدادات (توثيق التصميم)، والعربية للنصوص عند الحاجة. */
export function num(n: number): string {
  return String(n);
}
export function numAr(n: number): string {
  return String(n).replace(/\d/g, (d) => AR_DIGITS[Number(d)]);
}

/**
 * A11Y-64: دالة تنسيق أرقام موحّدة (تُخرج أرقامًا لاتينية متناسقة لسهولة القراءة والعدادات).
 */
export function formatNumber(
  n: number,
  lang: 'ar' | 'en' = 'ar',
  options?: Intl.NumberFormatOptions,
): string {
  if (!Number.isFinite(n)) return '0';
  try {
    return new Intl.NumberFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US', options).format(n);
  } catch {
    return String(n);
  }
}

/**
 * A11Y-65: عزل ثنائي الاتجاه (Unicode FSI \u2068 ... PDI \u2069)
 * يمنع انقلاب ترتيب الأرقام/الإيميلات/الرموز الإنجليزية داخل الجمل العربية.
 */
export function bidiIsolate(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  return `\u2068${String(value)}\u2069`;
}

/**
 * FUNC-15: توليد رقم مرجعي قصير للأخطاء بصيغة MSR-XXXXXX (6 محارف أبجدية رقمية).
 */
export function msrErrorCode(seed?: string): string {
  const raw = seed && seed.trim().length > 0 ? hashStr(seed).toUpperCase() : uid().replace(/-/g, '').toUpperCase();
  const clean = raw.replace(/[^A-Z0-9]/g, '').padEnd(6, '0').slice(0, 6);
  return `MSR-${clean}`;
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

/**
 * مفتاح الشهر بصيغة `YYYY-MM` (مع صفر بادئ) — **يجب** أن يطابق السيرفر
 * الذي يكتب `to_char(now(),'YYYY-MM')` في kudos_quotas وغيرها.
 * الصيغة القديمة `2026-8` بلا padding كانت تجعل عدّاد الكوتا في الواجهة
 * صفرًا دائمًا لأن المفتاحين لا يتطابقان أبدًا.
 */
export function monthKeyOf(ts: number): string {
  const d = new Date(ts);
  const m = d.getMonth() + 1;
  return `${d.getFullYear()}-${m < 10 ? `0${m}` : m}`;
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
  if (lang === 'ar') {
    // صيغ الجمع العربية الصحيحة (٠/١/٢/٣-١٠/١١+) عبر arabicCount — كانت «5 دقيقة».
    if (h === 0) {
      return arabicCount(m, { zero: '0 دقيقة', one: 'دقيقة واحدة', two: 'دقيقتين', few: `${m} دقائق`, many: `${m} دقيقة` });
    }
    if (m === 0) {
      return arabicCount(h, { zero: '0 ساعة', one: 'ساعة واحدة', two: 'ساعتين', few: `${h} ساعات`, many: `${h} ساعة` });
    }
    return `${arabicCount(h, { zero: '0', one: 'ساعة واحدة', two: 'ساعتان', few: `${h} ساعات`, many: `${h} ساعة` })} و${arabicCount(m, { zero: '0', one: 'دقيقة واحدة', two: 'دقيقتان', few: `${m} دقائق`, many: `${m} دقيقة` })}`;
  }
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h}h ${m}m`;
}

/**
 * تسمية اليوم النسبية للمستقبل: النهاردة / بكرة / بعد N أيام.
 * كان التطبيق يكتب «3 أغسطس» فقط، فلا يعرف المستخدم إن كانت المحاضرة اليوم
 * أم بعد أسبوع — وهي شكوى مباشرة من المستخدمين.
 */
export function relativeDayLabel(ts: number, lang: 'ar' | 'en', now: number = Date.now()): string {
  const days = Math.round((startOfLocalDay(ts) - startOfLocalDay(now)) / 86_400_000);
  if (days === 0) return lang === 'ar' ? 'النهاردة' : 'Today';
  if (days === 1) return lang === 'ar' ? 'بكرة' : 'Tomorrow';
  if (days === 2) return lang === 'ar' ? 'بعد بكرة' : 'In 2 days';
  if (days === -1) return lang === 'ar' ? 'امبارح' : 'Yesterday';
  if (days < 0) return lang === 'ar' ? `من ${Math.abs(days)} أيام` : `${Math.abs(days)} days ago`;
  if (days <= 10) return lang === 'ar' ? `بعد ${days} أيام` : `In ${days} days`;
  return lang === 'ar' ? `بعد أسبوعين` : 'In over a week';
}

/** بداية اليوم المحلي (نفس مرجع كل الشاشات — توقيت الجهاز). */
export function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * «كل قد إيه؟» للزمن القادم — بالدقائق والساعات المنطقية لا بالأرقام الخام.
 * كان الخطأ: `Math.round((startsAt - now)/60000)` تُطبع كما هي فيظهر
 * «بعد 4320 دقيقة» لمحاضرة بعد ثلاثة أيام. القاعدة هنا:
 *   أقل من ساعة ⇒ دقائق · أقل من يوم ⇒ ساعات (+دقائق كما يلزم) · غير ذلك ⇒ تسمية يوم نسبية.
 */
export function startsIn(ts: number, lang: 'ar' | 'en', now: number = Date.now()): string {
  const diff = ts - now;
  if (diff <= 0) {
    const late = Math.abs(diff);
    if (late < 60 * 60_000) {
      const m = Math.max(1, Math.round(late / 60_000));
      return lang === 'ar' ? `بدأت من ${m} دقيقة` : `Started ${m} min ago`;
    }
    return lang === 'ar' ? 'بدأت خلاص' : 'already started';
  }
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return lang === 'ar' ? 'بعد لحظات' : 'any second';
  if (minutes === 1) return lang === 'ar' ? 'بعد دقيقة' : 'in 1 min';
  if (minutes < 60) return lang === 'ar' ? `بعد ${minutes} دقيقة` : `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (diff < 86_400_000) {
    if (lang === 'ar') {
      const hLabel = arabicCount(hours, { zero: '0', one: 'ساعة', two: 'ساعتين', few: `${hours} ساعات`, many: `${hours} ساعة` });
      if (rem === 0) return `بعد ${hLabel}`;
      return `بعد ${hLabel} و${arabicCount(rem, { zero: '0', one: 'دقيقة', two: 'دقيقتين', few: `${rem} دقائق`, many: `${rem} دقيقة` })}`;
    }
    return rem === 0 ? `in ${hours} hr` : `in ${hours}h ${rem}m`;
  }
  return relativeDayLabel(ts, lang, now);
}

/** سطر يوم+وقت جاهز للعرض: «النهاردة · 5:30 م» أو «بعد 3 أيام · 5:30 م». */
export function dayTimeLabel(ts: number, lang: 'ar' | 'en', now: number = Date.now()): string {
  return `${relativeDayLabel(ts, lang, now)} · ${formatTime(ts, lang)}`;
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

/**
 * استخراج الاسم الأول بذكاء مع تجاوز الألقاب الشائعة (دكتور، مهندس، أستاذ، شيخ، Dr.، Eng.، Mr.).
 */
export function getFirstName(fullName?: string | null): string {
  if (!fullName) return '';
  const cleaned = fullName.trim().replace(/^(د\.|م\.|أ\.|دكتور|دكتورة|مهندس|مهندسة|أستاذ|أستاذة|شيخ|dr\.|eng\.|mr\.|ms\.|mrs\.)\s+/i, '');
  const parts = cleaned.split(/\s+/);
  return parts[0] || fullName.split(/\s+/)[0] || '';
}
