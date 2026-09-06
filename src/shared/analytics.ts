/**
 * Product analytics without PII (spec §101, §234).
 * Event names are stable English; never attach phone/name/serial.
 */
import { addBreadcrumb } from './telemetry';

export type ProductEvent =
  | 'onboarding_complete'
  | 'course_joined'
  | 'checkin_ok'
  | 'checkin_fail'
  | 'certificate_view'
  | 'certificate_verify';

export function track(event: ProductEvent, props?: Record<string, string | number | boolean>): void {
  const safe: Record<string, string | number | boolean> = {};
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (/phone|email|name|serial|token/i.test(k)) continue;
      safe[k] = v;
    }
  }
  addBreadcrumb('action', event);
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.debug('[analytics]', event, safe);
  }
}
