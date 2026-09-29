/**
 * i18n/core.ts — نواة الترجمة **النقية** (بلا React ولا React Native).
 *
 * لماذا ملف منفصل: كود الأعمال (محرّك الحضور، محرّك التميمة، توليد ملفات
 * التقويم) يحتاج نصًا مترجمًا لكنه يُختبر ويُنفّذ في بيئة Node خالصة
 * (`.test-build`). استيراد `i18n/index.tsx` كان يسحب `react-native` إلى
 * اختبارات Node فينكسر التشغيل — فصار المنطق النقي هنا، والواجهة في index.tsx
 * تعيد تصديره فلا يتغير أي استدعاء قائم.
 */
import { ar, DictKey } from './ar';
import { en } from './en';

export type Lang = 'ar' | 'en';

export const dicts: Record<Lang, Record<DictKey, string>> = { ar, en };

/**
 * اللغة الحالية على مستوى الوحدة — تُستخدم من أماكن ليست مكوّنات React
 * (محرّك الإشعارات، محرّك التميمة، أدوات مساعدة) فتبقى قابلة للترجمة.
 */
let currentLang: Lang = 'ar';

/** تُنادَى من مزوّد i18n كلما غيّر المستخدم اللغة. */
export function setCurrentLang(lang: Lang): void {
  currentLang = lang;
}

/** اللغة الحالية — لمنطق غير واجهي يحتاج اختيار حقل عربي/إنجليزي من البيانات. */
export function getLang(): Lang {
  return currentLang;
}

/** ترجمة من خارج مكوّنات React (نفس قواميس الواجهة بلا نسخة ثانية). */
export function tStatic(key: DictKey, vars?: Record<string, string | number>): string {
  let out: string = dicts[currentLang][key] ?? ar[key] ?? key;
  if (vars) {
    for (const k of Object.keys(vars)) out = out.replaceAll(`{${k}}`, String(vars[k]));
  }
  return out;
}

export type { DictKey };
