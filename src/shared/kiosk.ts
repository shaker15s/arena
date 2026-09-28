/**
 * shared/kiosk.ts — مقاومة النوم وملء الشاشة لشاشة العرض/الكشك (FUNC-06).
 *
 * القياس المطلوب من الخطة: تشغيل شاشة العرض 8 ساعات متواصلة بلا انقطاع.
 * لذلك لا يكفي نداء KeepAwake مرة واحدة:
 *
 *  • **الويب — W3C Screen Wake Lock API**: القفل يُحرَّر تلقائيًا عند إخفاء
 *    الصفحة (تبديل تبويب/قفل الجهاز)، والمواصفة تُلزم بإعادة الطلب عند عودة
 *    `visibilitychange` ⇒ نُعيد الطلب ونراقب `onrelease`.
 *  • **الموبايل — expo-keep-awake**: يُعاد التأكيد دوريًا (بعض أنظمة OEM تسقط
 *    القفل) وعند رجوع التطبيق للمقدّمة عبر `AppState`.
 *
 * كل الدوال آمنة على المنصّات غير المدعومة (ترجع 'unsupported' بلا انفجار).
 */
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

export type WakeLockStatus = 'idle' | 'active' | 'denied' | 'unsupported';

interface Sentinel {
  release: () => Promise<void>;
  released: boolean;
}

type WakeLockCapable = {
  wakeLock?: { request: (type: 'screen') => Promise<Sentinel> };
};

/** يُبقي الشاشة مضاءة طالما `active` — ويُعيد الحالة للعرض في الواجهة. */
export function useWakeLock(active: boolean, tag = 'masar-kiosk'): WakeLockStatus {
  const [status, setStatus] = useState<WakeLockStatus>('idle');

  useEffect(() => {
    if (!active) {
      setStatus('idle');
      return;
    }
    let cancelled = false;
    let sentinel: Sentinel | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;

    const acquireWeb = async () => {
      const nav = typeof navigator === 'undefined' ? undefined : (navigator as unknown as WakeLockCapable);
      if (!nav?.wakeLock) {
        if (!cancelled) setStatus('unsupported');
        return;
      }
      try {
        sentinel = await nav.wakeLock.request('screen');
        if (cancelled) {
          void sentinel.release();
          return;
        }
        setStatus('active');
        sentinel.released = false;
      } catch {
        if (!cancelled) setStatus('denied');
      }
    };

    const acquireNative = async () => {
      try {
        await activateKeepAwakeAsync(tag);
        if (!cancelled) setStatus('active');
      } catch {
        if (!cancelled) setStatus('denied');
      }
    };

    if (Platform.OS === 'web') {
      void acquireWeb();
      const onVisible = () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'visible' && active) {
          void acquireWeb();
        }
      };
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
      return () => {
        cancelled = true;
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
        void sentinel?.release().catch(() => {});
      };
    }

    void acquireNative();
    // إعادة تأكيد دورية: بعض أنظمة Android OEM تُسقط القفل بعد شاشة القفل.
    timer = setInterval(() => { void acquireNative(); }, 4 * 60_000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void acquireNative();
    });
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      sub.remove();
      void deactivateKeepAwake(tag).catch(() => {});
    };
  }, [active, tag]);

  return status;
}

/** ملء الشاشة على الويب (Fullscreen API) — يرجع false إذا رفض المتصفح. */
export async function enterFullscreen(): Promise<boolean> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return false;
  const el = document.documentElement as HTMLElement & { requestFullscreen?: () => Promise<void> };
  try {
    await el.requestFullscreen?.();
    return Boolean(document.fullscreenElement);
  } catch {
    return false;
  }
}

export async function exitFullscreen(): Promise<void> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
  } catch {
    /* لا شيء — بعض المتصفحات تمنع الخروج البرمجي */
  }
}
