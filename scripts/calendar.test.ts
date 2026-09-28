/**
 * scripts/calendar.test.ts — تحقق موضوعي من ملف ICS المُصدَّر (FUNC-03).
 * لا نكتفي بتوليد نص: نفحص بنية RFC 5545 سطرًا سطرًا، ونقارن حسابات التوقيت
 * الصيفي المصري بما تعرفه قاعدة بيانات المناطق الزمنية (Intl/tzdata) — أي
 * تعارض بين قانوننا المكتوب في VTIMEZONE والواقع سيظهر هنا مباشرة.
 */
import {
  CAIRO_TZ, buildIcs, formatIcsLocal, formatIcsUtc, icsFilename, googleCalendarUrl, zonedParts,
} from '../src/shared/calendar';

let passed = 0, failed = 0;
function ok(cond: boolean, name: string) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
}

console.log('\n═ تقويم ICS (RFC 5545) — مسار ═');

const start = Date.UTC(2026, 6, 15, 15, 0, 0); // 18:00 القاهرة صيفًا (+03)
const ics = buildIcs([{
  uid: 'sess-123',
  title: 'أساسيات بايثون، الجلسة 4; متقدم',
  startMs: start,
  durationMinutes: 90,
  location: 'قاعة 2 — المقر الرئيسي',
  description: 'أحضر الحاسب\nوسجّل حضورك بالـQR',
  url: 'https://rtcc-ruby.vercel.app',
  alarmMinutes: 60,
  stampMs: Date.UTC(2026, 6, 1, 12, 0, 0),
}]);

const lines = ics.split('\r\n').filter((l) => l.length > 0);

ok(ics.includes('\r\n') && !/[^\r]\n/.test(ics), 'كل نهايات الأسطر CRLF');
ok(lines[0] === 'BEGIN:VCALENDAR' && lines[lines.length - 1] === 'END:VCALENDAR', 'المغلّف VCALENDAR سليم');
ok((ics.match(/BEGIN:VEVENT/g) ?? []).length === 1 && (ics.match(/END:VEVENT/g) ?? []).length === 1, 'VEVENT واحد متوازن');
ok(ics.includes('BEGIN:VTIMEZONE') && ics.includes('TZID:Africa/Cairo'), 'VTIMEZONE للقاهرة مضمّن');
ok((ics.match(/BEGIN:VTIMEZONE/g) ?? []).length === (ics.match(/END:VTIMEZONE/g) ?? []).length, 'VTIMEZONE متوازن');
ok((ics.match(/BEGIN:VALARM/g) ?? []).length === 1 && ics.includes('TRIGGER:-PT60M'), 'تنبيه قبل ساعة');
ok(ics.includes('DTSTAMP:20260701T120000Z'), 'DTSTAMP بصيغة UTC');
ok(ics.includes('UID:sess-123@masar.app'), 'UID ثابت مبني على معرّف الجلسة');
ok(ics.includes('DTSTART;TZID=Africa/Cairo:20260715T180000'), 'البداية بوقت القاهرة الجداري (18:00)');
ok(ics.includes('DTEND;TZID=Africa/Cairo:20260715T193000'), 'النهاية = البداية + 90 دقيقة');
const unfolded = ics.replace(/\r\n /g, '');
// الفاصلة العربية «،» ليست محرفًا محجوزًا في RFC 5545 فلا تُهرَّب؛ الفاصلة
// اللاتينية والمنقوطة تُهرَّبان إلزاميًا (فحص منفصل أدناه).
ok(unfolded.includes('SUMMARY:أساسيات بايثون، الجلسة 4\\; متقدم'), 'تهريب المنقوطة في العنوان (الفاصلة العربية لا تُهرَّب)');
const escaped = buildIcs([{ uid: 'e1', title: 'A, B; C\\D', startMs: start, durationMinutes: 30, description: 'سطر١\nسطر٢' }]);
ok(escaped.replace(/\r\n /g, '').includes('SUMMARY:A\\, B\\; C\\\\D'), 'تهريب الفاصلة اللاتينية والمنقوطة والشرطة المائلة');
ok(ics.includes('DESCRIPTION:أحضر الحاسب\\nوسجّل حضورك بالـQR'), 'تهريب السطر الجديد في الوصف');

const tooLong = lines.filter((l) => Buffer.byteLength(l, 'utf8') > 75);
ok(tooLong.length === 0, `لا سطر يتجاوز 75 بايت (${tooLong.length} مخالف)`);
ok(ics.replace(/\r\n /g, '').includes('SUMMARY:أساسيات بايثون'), 'الطيّ قابل للفك (مسافة بادئة)');

// ── التوقيت الصيفي المصري مقابل tzdata ──
const offset = (ms: number) => {
  const p = zonedParts(new Date(ms), CAIRO_TZ);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asUtc - ms) / 3_600_000;
};
const jan = Date.UTC(2026, 0, 15, 12, 0, 0);
const jul = Date.UTC(2026, 6, 15, 12, 0, 0);
ok(offset(jan) === 2, 'يناير +02:00 (EET)');
ok(offset(jul) === 3, 'يوليو +03:00 (EEST) — التوقيت الصيفي مفعّل');
ok(formatIcsLocal(Date.UTC(2026, 0, 15, 16, 0, 0)) === '20260115T180000', 'شتاءً: 16:00Z = 18:00 القاهرة');
ok(formatIcsLocal(Date.UTC(2026, 6, 15, 15, 0, 0)) === '20260715T180000', 'صيفًا: 15:00Z = 18:00 القاهرة');

// حدود التحويل: الجمعة الأخيرة من أبريل (2026-04-24) والخميس الأخير من أكتوبر (2026-10-29)
// قياس فعلي من tzdata: التحويل يقع عند 00:00 المحلي من الجمعة الأخيرة من أبريل
// (22:00Z) والحظيرة الجديدة تُطبَّق على اللحظة نفسها — لذلك 21:59Z = +02 و22:00Z = +03.
const justBefore = Date.UTC(2026, 3, 23, 21, 59, 0);
const atSwitch = Date.UTC(2026, 3, 23, 22, 0, 0);
const afterSwitch = Date.UTC(2026, 3, 23, 23, 0, 0);
ok(offset(justBefore) === 2, 'قبل التحويل بدقيقة: +02:00');
ok(offset(atSwitch) === 3, 'لحظة التحويل (24 أبريل 00:00 محليًا): صارت +03:00');
ok(offset(afterSwitch) === 3, 'بعد التحويل: +03:00');
ok(offset(Date.UTC(2026, 9, 29, 21, 0, 0)) === 2, 'نهاية أكتوبر: رجعنا إلى +02:00');
ok(formatIcsUtc(start) === '20260715T150000Z', 'formatIcsUtc يطابق UTC الفعلي');

const url = googleCalendarUrl({ uid: 'x', title: 'جلسة', startMs: start, durationMinutes: 60 });
ok(url.startsWith('https://calendar.google.com/calendar/render?') && url.includes('dates=20260715T150000Z'), 'رابط Google Calendar صالح');
ok(icsFilename('أساسيات بايثون — الجلسة 4', start).startsWith('أساسيات-بايثون'), 'اسم ملف آمن يحفظ العربية');
ok(icsFilename('دورة #1', start).endsWith('.ics'), 'امتداد ICS دائمًا');

console.log(`\n════ التقويم: ${passed} ناجح، ${failed} فاشل ════`);
if (failed > 0) process.exit(1);
