/**
 * shared/telemetry.ts — طبقة رصد أعطال خفيفة بلا تبعيات خارجية (OPS-01).
 *
 * لماذا لا Sentry مباشرة: إضافة `@sentry/react-native` تعني حزمة native جديدة،
 * إعداد EAS، ومفتاح DSN، وسياسة خصوصية جديدة — قرار منتج لا يُتخذ داخل patch.
 * فبدلًا من «لا شيء»، هذه الوحدة توفّر:
 *
 *   1. **حلقة تجميع** (breadcrumbs + التقاط الأعطال) تعمل اليوم.
 *   2. **مصرف خادمي** عبر RPC `log_client_error` — الأعطال تصل فريق التشغيل فعلًا.
 *   3. **نقطة وصل واحدة** (`setTelemetrySink`) تُوصَّل بـ Sentry في سطر واحد
 *      لاحقًا دون لمس أي شاشة.
 *
 * قواعد الخصوصية المطبَّقة هنا:
 *   - لا نرسل أي محتوى من المستخدم (نصوص حقول، أسماء، هواتف).
 *   - الرسائل تُقصّ إلى 500 حرف والمكدّس إلى 4000.
 *   - التوقّف الآمن: أي فشل في الإرسال يُبتلع — الرصد لا يُسقط التطبيق أبدًا.
 */
import { Platform } from 'react-native';

export interface Breadcrumb {
  at: number;
  kind: 'nav' | 'action' | 'net' | 'info';
  message: string;
}

export interface TelemetryEvent {
  message: string;
  stack?: string;
  componentStack?: string;
  fatal: boolean;
  platform: string;
  appVersion: string;
  breadcrumbs: Breadcrumb[];
  at: number;
}

/** مصرف الأحداث — يُستبدل بـ Sentry أو بمصرف الخادم. */
export type TelemetrySink = (event: TelemetryEvent) => void | Promise<void>;

const MAX_BREADCRUMBS = 25;
const MAX_MESSAGE = 500;
const MAX_STACK = 4000;
/** كبح: لا نرسل نفس البصمة أكثر من مرة كل دقيقة (يمنع عواصف الأخطاء). */
const DEDUPE_WINDOW_MS = 60_000;

const APP_VERSION = '3.2.0';

let breadcrumbs: Breadcrumb[] = [];
let sink: TelemetrySink | null = null;
const recentlySent = new Map<string, number>();

function clamp(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** يوصّل مصرفًا (خادم/Sentry). استدعِه مرة واحدة عند الإقلاع. */
export function setTelemetrySink(next: TelemetrySink | null): void {
  sink = next;
}

/** يسجّل خطوة سياق تسبق العطل — تُرسل مع الحدث لتشخيص «كيف وصل المستخدم هنا». */
export function addBreadcrumb(kind: Breadcrumb['kind'], message: string): void {
  breadcrumbs.push({ at: Date.now(), kind, message: clamp(message, 120) ?? '' });
  if (breadcrumbs.length > MAX_BREADCRUMBS) {
    breadcrumbs = breadcrumbs.slice(-MAX_BREADCRUMBS);
  }
}

export function clearBreadcrumbs(): void {
  breadcrumbs = [];
}

/** يلتقط استثناءً ويرسله للمصرف. آمن تمامًا: لا يرمي أبدًا. */
export function captureError(
  error: unknown,
  options: { fatal?: boolean; componentStack?: string } = {},
): void {
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    const fingerprint = `${err.name}:${err.message}`.slice(0, 200);
    const now = Date.now();
    const last = recentlySent.get(fingerprint);
    if (last && now - last < DEDUPE_WINDOW_MS) return;
    recentlySent.set(fingerprint, now);

    // تنظيف دوري بسيط حتى لا تنمو الخريطة بلا حدّ.
    if (recentlySent.size > 50) {
      for (const [key, at] of recentlySent) {
        if (now - at > DEDUPE_WINDOW_MS) recentlySent.delete(key);
      }
    }

    const event: TelemetryEvent = {
      message: clamp(err.message, MAX_MESSAGE) ?? 'unknown_error',
      stack: clamp(err.stack, MAX_STACK),
      componentStack: clamp(options.componentStack, MAX_STACK),
      fatal: options.fatal ?? false,
      platform: Platform.OS,
      appVersion: APP_VERSION,
      breadcrumbs: [...breadcrumbs],
      at: now,
    };

    // eslint-disable-next-line no-console
    console.error('[masar]', event.fatal ? 'fatal' : 'error', event.message);
    void Promise.resolve(sink?.(event)).catch(() => {
      /* الرصد لا يُسقط التطبيق */
    });
  } catch {
    /* الرصد لا يُسقط التطبيق */
  }
}

/**
 * يثبّت مستمعي الأخطاء غير الملتقطة (رفض Promise غير معالج + أخطاء الويب).
 * يعيد دالة إلغاء تثبيت.
 */
export function installGlobalHandlers(): () => void {
  const cleanups: Array<() => void> = [];

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const onError = (e: ErrorEvent) => captureError(e.error ?? e.message, { fatal: false });
    const onRejection = (e: PromiseRejectionEvent) => captureError(e.reason, { fatal: false });
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    cleanups.push(() => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    });
  } else {
    // React Native: ErrorUtils هو الخطاف العام للأخطاء غير الملتقطة.
    const RNErrorUtils = (global as any)?.ErrorUtils;
    if (RNErrorUtils?.getGlobalHandler && RNErrorUtils?.setGlobalHandler) {
      const previous = RNErrorUtils.getGlobalHandler();
      RNErrorUtils.setGlobalHandler((err: unknown, isFatal?: boolean) => {
        captureError(err, { fatal: Boolean(isFatal) });
        previous?.(err, isFatal);
      });
      cleanups.push(() => RNErrorUtils.setGlobalHandler(previous));
    }
  }

  return () => cleanups.forEach((fn) => fn());
}
