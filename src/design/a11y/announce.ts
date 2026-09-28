/**
 * design/a11y/announce.ts — طبقة إعلانات قارئ الشاشة (A11Y-32).
 *
 * المشكلة (مؤكدة): `accessibilityLiveRegion` كان مستخدمًا في **موضع واحد** فقط
 * في التطبيق كله (Toast). أي أن «تم تسجيل حضورك»، «فشل التحقق»، «تعذّر الحفظ»
 * لم يكن قارئ الشاشة يعلم بها إلا إذا اكتشفها المستخدم بنفسه.
 *
 * القاعدة: كل **نتيجة عملية** (نجاح/فشل/تحذير) يجب أن تمرّ من هنا.
 *   • `polite`  → تقدّم/حفظ/تحميل (لا يقاطع).
 *   • `assertive` → فشل يستوجب تصحيحًا فوريًا.
 */
import { AccessibilityInfo, Platform } from 'react-native';

export type AnnouncePriority = 'polite' | 'assertive';

let lastSpoken = '';
let lastSpokenAt = 0;
/** منع تكرار نفس الرسالة في أقل من ثانيتين (قارئ الشاشة لا يحب التكرار). */
const DEDUPE_MS = 2000;

/**
 * إعلان رسالة لقارئ الشاشة.
 * @param message النص المُعلن (بلا رموز — جملة منطوقة).
 * @param priority `assertive` للفشل، `polite` للتقدّم (الافتراضي).
 */
export function announce(message: string, priority: AnnouncePriority = 'polite'): void {
  const text = (message ?? '').trim();
  if (!text) return;
  const now = Date.now();
  if (text === lastSpoken && now - lastSpokenAt < DEDUPE_MS) return;
  lastSpoken = text;
  lastSpokenAt = now;

  try {
    // على الويب: منطقة حيّة مخفية تُحدَّث — تعمل مع كل قارئات الشاشة بلا استثناء.
    if (Platform.OS === 'web') {
      if (typeof document === 'undefined') return;
      const id = 'masar-live-region';
      let region = document.getElementById(id) as HTMLElement | null;
      if (!region) {
        region = document.createElement('div');
        region.id = id;
        region.setAttribute('aria-live', priority);
        region.setAttribute('aria-atomic', 'true');
        region.setAttribute('role', 'status');
        Object.assign(region.style, {
          position: 'absolute',
          width: '1px',
          height: '1px',
          margin: '-1px',
          padding: '0',
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap',
          border: '0',
        } as CSSStyleDeclaration);
        document.body.appendChild(region);
      }
      region.setAttribute('aria-live', priority);
      region.textContent = '';
      // إعادة الكتابة في الإطار التالي تضمن إعلان النص المتكرّر نفسه.
      window.setTimeout(() => {
        region!.textContent = text;
      }, 30);
      return;
    }

    // على الجوال: الواجهة الأصلية تُعيد التشغيل حسب الأولوية.
    if (priority === 'assertive' && Platform.OS === 'android') {
      AccessibilityInfo.announceForAccessibilityWithOptions?.(text, { queue: false });
      return;
    }
    AccessibilityInfo.announceForAccessibility(text);
  } catch {
    /* الرصد/الإعلان لا يُسقط التطبيق أبدًا */
  }
}

/** فشل يستوجب تصحيحًا فوريًا. */
export function announceError(message: string): void {
  announce(message, 'assertive');
}

/** نجاح/تقدّم بلا مقاطعة. */
export function announceSuccess(message: string): void {
  announce(message, 'polite');
}

/**
 * مُغلّف نتيجة عملية — نصوص النجاح/الفشل لكل تدفّق حسّاس.
 * يُستخدم في الحضور، الحفظ، الشهادات، والتسجيل لضمان وحدة النبرة والنص.
 */
export function announceResult(
  kind: 'success' | 'error' | 'info',
  message: string,
): void {
  if (kind === 'error') announceError(message);
  else announce(message, 'polite');
}
