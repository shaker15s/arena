/**
 * shared/calendar.ts — تصدير مواعيد الجلسات كملف تقويم ICS حقيقي (FUNC-03).
 *
 * المواصفة المنفَّذة: **RFC 5545** (Internet Calendars / iCalendar):
 *  • نهايات أسطر CRLF إلزامية، وطيّ الأسطر عند 75 بايت (Folding) مع مسافة بادئة.
 *  • تهريب `\ ; ,` والأسطر الجديدة داخل النصوص.
 *  • `UID` فريد ثابت لكل جلسة + `DTSTAMP` بصيغة UTC (…Z).
 *  • `VTIMEZONE` باسم `Africa/Cairo` حتى يعرض أي عميل (Google/Apple/Outlook)
 *    الوقت المحلي الصحيح مهما كان توقيت الجهاز — وهذا مربط FUNC-16/FUNC-20.
 *
 * مرجع التوقيت الصيفي المصري: القانون المصري يعمل بالتوقيت الصيفي من **الجمعة
 * الأخيرة من أبريل** إلى **الخميس الأخير من أكتوبر** (أُعيد العمل به صيف 2023)،
 * لذلك القاعدة في VTIMEZONE: BYMONTH=4;BYDAY=-1FR للإزاحة +03:00، و
 * BYMONTH=10;BYDAY=-1TH للعودة إلى +02:00.
 */
import { tStatic } from '../i18n/core';

export const CAIRO_TZ = 'Africa/Cairo';

export interface CalendarEventInput {
  /** معرّف ثابت للجلسة (نفسه بين التصديرات ⇒ لا تتكرر الأحداث عند الاستيراد المتكرر). */
  uid: string;
  title: string;
  /** وقت البداية كطابع زمني UTC (ms). */
  startMs: number;
  durationMinutes: number;
  location?: string;
  description?: string;
  url?: string;
  organizerName?: string;
  /** تنبيه قبل الموعد بالدقائق (افتراضي 60 — مواصفة المنتج). */
  alarmMinutes?: number;
  /** وقت الإنشاء للـDTSTAMP (يُمرَّر للاختبار الحتمي). */
  stampMs?: number;
  timeZone?: string;
}

interface Parts { year: number; month: number; day: number; hour: number; minute: number; second: number }

/** يفكّ لحظة زمنية إلى مكوّنات الجدار الزمني في منطقة محدّدة (بلا مكتبة خارجية). */
export function zonedParts(date: Date, timeZone: string = CAIRO_TZ): Parts {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) if (p.type !== 'literal') map[p.type] = p.value;
  const hour = Number(map.hour === '24' ? '00' : map.hour);
  return {
    year: Number(map.year), month: Number(map.month), day: Number(map.day),
    hour, minute: Number(map.minute), second: Number(map.second),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYYMMDDTHHMMSS` بالتوقيت المحلي للمنطقة — للاستخدام مع TZID. */
export function formatIcsLocal(ms: number, timeZone: string = CAIRO_TZ): string {
  const p = zonedParts(new Date(ms), timeZone);
  return `${p.year}${pad(p.month)}${pad(p.day)}T${pad(p.hour)}${pad(p.minute)}${pad(p.second)}`;
}

/** `YYYYMMDDTHHMMSSZ` بتوقيت UTC — لـ DTSTAMP و UID. */
export function formatIcsUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function escapeIcs(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * طيّ الأسطر عند 75 بايت (RFC 5545 §3.1) مع مسافة بادئة للأسطر المكمّلة.
 * الطيّ يتم على البايتات لا الحروف حتى لا تُقطع حروف عربية متعددة البايت.
 */
export function foldIcsLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let start = 0;
  let limit = 74; // السطر الأول بلا مسافة بادئة
  while (start < line.length) {
    let end = start;
    let count = 0;
    while (end < line.length) {
      const size = Buffer.byteLength(line[end], 'utf8');
      if (count + size > limit) break;
      count += size;
      end += 1;
    }
    out.push((start === 0 ? '' : ' ') + line.slice(start, end));
    start = end;
    limit = 74; // المسافة البادئة تُحسب بايتًا واحدًا
  }
  return out.join('\r\n');
}

const VTIMEZONE_CAIRO = [
  'BEGIN:VTIMEZONE',
  'TZID:Africa/Cairo',
  'X-LIC-LOCATION:Africa/Cairo',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0300',
  'TZNAME:EEST',
  'DTSTART:19700424T000000',
  'RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=-1FR',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0300',
  'TZOFFSETTO:+0200',
  'TZNAME:EET',
  'DTSTART:19701030T000000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1TH',
  'END:STANDARD',
  'END:VTIMEZONE',
];

/** يبني ملف ICS صالحًا لجلسة تدريبية واحدة (أو عدة جلسات عبر `buildIcs`). */
export function buildIcs(events: CalendarEventInput[], calendarName?: string): string {
  const name = calendarName ?? tStatic('calendar.name');
  const tz = events[0]?.timeZone ?? CAIRO_TZ;
  const stamp = events[0]?.stampMs ?? Date.now();
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Masar//Training Sessions//AR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcs(name)}`,
    ...(tz === CAIRO_TZ ? VTIMEZONE_CAIRO : []),
  ];

  for (const e of events) {
    const endMs = e.startMs + e.durationMinutes * 60_000;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@masar.app`,
      `DTSTAMP:${formatIcsUtc(stamp)}`,
      `DTSTART;TZID=${tz}:${formatIcsLocal(e.startMs, tz)}`,
      `DTEND;TZID=${tz}:${formatIcsLocal(endMs, tz)}`,
      `SUMMARY:${escapeIcs(e.title)}`,
      `STATUS:CONFIRMED`,
      'SEQUENCE:0',
    );
    if (e.location) lines.push(`LOCATION:${escapeIcs(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeIcs(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    if (e.organizerName) lines.push(`ORGANIZER;CN=${escapeIcs(e.organizerName)}:mailto:noreply@masar.app`);
    const alarm = e.alarmMinutes ?? 60;
    if (alarm > 0) {
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `TRIGGER:-PT${alarm}M`,
        `DESCRIPTION:${escapeIcs(e.title)}`,
        'END:VALARM',
      );
    }
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

/** رابط «أضف إلى تقويم Google» — بديل فوري على الويب بلا تنزيل ملف. */
export function googleCalendarUrl(e: CalendarEventInput): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${formatIcsUtc(e.startMs)}/${formatIcsUtc(e.startMs + e.durationMinutes * 60_000)}`,
    details: e.description ?? '',
    location: e.location ?? '',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** اسم ملف آمن للجلسة. */
export function icsFilename(title: string, startMs: number): string {
  const day = formatIcsUtc(startMs).slice(0, 8);
  const safe = title.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 48);
  return `${safe}-${day}.ics`;
}
