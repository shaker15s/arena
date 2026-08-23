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

/** ينزّل/يشارك ملف CSV — يرجع true لو تمت العملية */
export async function saveCsv(filename: string, csv: string): Promise<boolean> {
  try {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
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
    file.write(csv);
    await Sharing.shareAsync(file.uri, {
      mimeType: 'text/csv',
      dialogTitle: filename,
      UTI: 'public.comma-separated-values-text',
    });
    return true;
  } catch {
    return false;
  }
}
