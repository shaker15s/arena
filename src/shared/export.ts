/**
 * shared/export.ts — تصدير التقارير كملف CSV حقيقي.
 * الويب: تنزيل مباشر. الموبايل: مشاركة عبر ورقة المشاركة الأصلية.
 */
import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** يحوّل صفوفًا إلى CSV مع تهريب صحيح وBOM حتى تفتح العربية سليمة في Excel */
export function toCsv(rows: Array<Array<string | number>>): string {
  const escape = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '\uFEFF' + rows.map((r) => r.map(escape).join(',')).join('\r\n');
}

/**
 * ينزّل/يشارك ملفًا نصيًا — ويب: تنزيل مباشر، موبايل: ورقة المشاركة الأصلية.
 * الأساس المشترك لكل التصديرات (CSV · ICS · JSON).
 */
export async function saveTextFile(
  filename: string,
  content: string,
  mimeType: string,
  uti: string,
): Promise<boolean> {
  try {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    }
    if (!(await Sharing.isAvailableAsync())) return false;
    const safeName = filename.replace(/[^\p{L}\p{N}._-]+/gu, '-');
    const file = new File(Paths.cache, safeName);
    file.write(content);
    await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: filename, UTI: uti });
    return true;
  } catch {
    return false;
  }
}

/** ينزّل/يشارك ملف CSV — يرجع true لو تمت العملية */
export async function saveCsv(filename: string, csv: string): Promise<boolean> {
  return saveTextFile(filename, csv, 'text/csv', 'public.comma-separated-values-text');
}

/**
 * ينزّل/يشارك ملف تقويم ICS (RFC 5545) — يرجع true لو تمت العملية.
 * لاحظ: البايت الأول BOM ليس مطلوبًا هنا؛ بعض عملاء التقويم يتجاهل الملف
 * إذا بدأ بـBOM، لذلك لا نستخدم toCsv هنا.
 */
export async function saveIcs(filename: string, ics: string): Promise<boolean> {
  return saveTextFile(filename, ics, 'text/calendar', 'com.apple.ical.ics');
}
