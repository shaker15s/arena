/**
 * shared/export.ts — تصدير التقارير كملف CSV حقيقي.
 * الويب: تنزيل مباشر. الموبايل: مشاركة عبر ورقة المشاركة الأصلية.
 */
import { Platform, Share } from 'react-native';

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
    const res = await Share.share({ title: filename, message: csv });
    return res.action !== Share.dismissedAction;
  } catch {
    return false;
  }
}
