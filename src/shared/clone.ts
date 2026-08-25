/**
 * shared/clone.ts — نسخ عميق آمن عبر المنصات (MOB-01).
 *
 * `structuredClone` هي واجهة ويب وليست جزءًا من معيار ECMAScript، وHermes
 * (محرك React Native/Expo Go) لا تنفّذها — فكانت المسارات التي تعتمد عليها
 * (mutate في store.tsx و applyRealtimePatch في remote.ts) معرّضة للانهيار
 * على الموبايل بـ"Property 'structuredClone' does not exist".
 *
 * نستخدم structuredClone عندما يكون متاحًا، وإلا نقع إلى نسخ يدوي متكرر
 * يحافظ على قيم `undefined` (لأن JSON.stringify يسقطها).
 */

/** هل n كائن "صافي" قابل للتوسيع؟ */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * نسخ عميق حتمي. يحافظ على `undefined` و `null` و Arrays/objects متداخلة.
 * أي قيمة غير قابلة للنسخ (دوال/Date) تُعاد كما هي — لا نحتاجها هنا.
 */
export function deepClone<T>(value: T): T {
  // إن كان المتصفح/المحرك يدعمها نستخدمها (الأسرع والأضمن).
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch { /* نقع إلى اليدوي */ }
  }
  return cloneManual(value) as T;
}

function cloneManual(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneManual);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      out[key] = cloneManual(value[key]);
    }
    return out;
  }
  // primitives, null, undefined, Date, functions → تُعاد كما هي
  return value;
}
