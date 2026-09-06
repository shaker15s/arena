// src/shared/location.ts — قراءة موقع الجهاز لتفعيل geofence اختياري.
//
// الخادم هو حدّ الفرض الوحيد: يفرض geofence فقط على المجموعات المفعّلة
// (geofence_enabled=true) بالاعتماد على إحداثيات يمرّرها العميل. هذه الوحدة
// تجرّد قراءة الموقع عبر `expo-location` مع سلوك آمن عند غياب الإذن:
//   - إذن مرفوض/غير متاح → null → الخادم يردّ `location_required` على المجموعات
//     المفعّلة فقط (لا يتأثر أي مسار آخر).
//   - على الويب نستخدم Geolocation API للمتصفح عند توفره.
import { Platform } from 'react-native';

export interface DevicePosition {
  lat: number;
  lng: number;
  /** دقة القراءة بالأمتار — تفيد في تشخيص رفض `offsite` الكاذب. */
  accuracy?: number;
}

export type LocationPermissionState = 'granted' | 'denied' | 'undetermined' | 'unavailable';

/** مهلة قصوى لقراءة الموقع حتى لا يتجمّد مسار الحضور خلف GPS بطيء. */
const READ_TIMEOUT_MS = 6000;
/** تخزين مؤقت قصير: نفس القراءة تُعاد خلال هذه المدة بدل استنزاف GPS. */
const CACHE_TTL_MS = 15000;

let cached: { at: number; pos: DevicePosition } | null = null;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, ms);
    p.then(
      (v) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(v);
        }
      },
      () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(null);
        }
      },
    );
  });
}

function loadExpoLocation(): any | null {
  try {
    // require كسول: لو الحزمة غير مثبّتة في بيئة ما لا ينكسر التطبيق.
    return require('expo-location');
  } catch {
    return null;
  }
}

/** حالة إذن الموقع الحالية دون طلبه — تُستخدم لعرض إرشاد للمستخدم. */
export async function getLocationPermissionState(): Promise<LocationPermissionState> {
  if (Platform.OS === 'web') {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return 'unavailable';
    try {
      const perms = (navigator as any).permissions;
      if (!perms?.query) return 'undetermined';
      const status = await perms.query({ name: 'geolocation' as PermissionName });
      if (status.state === 'granted') return 'granted';
      if (status.state === 'denied') return 'denied';
      return 'undetermined';
    } catch {
      return 'undetermined';
    }
  }
  const Location = loadExpoLocation();
  if (!Location) return 'unavailable';
  try {
    const { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
    if (status === 'granted') return 'granted';
    if (status === 'denied' && !canAskAgain) return 'denied';
    return status === 'denied' ? 'denied' : 'undetermined';
  } catch {
    return 'unavailable';
  }
}

async function readWeb(): Promise<DevicePosition | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
  return withTimeout(
    new Promise<DevicePosition | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? undefined }),
        () => resolve(null),
        { enableHighAccuracy: false, timeout: READ_TIMEOUT_MS, maximumAge: CACHE_TTL_MS },
      );
    }),
    READ_TIMEOUT_MS + 500,
  );
}

async function readNative(): Promise<DevicePosition | null> {
  const Location = loadExpoLocation();
  if (!Location) return null;
  try {
    const current = await Location.getForegroundPermissionsAsync();
    let status = current.status;
    if (status !== 'granted' && current.canAskAgain !== false) {
      status = (await Location.requestForegroundPermissionsAsync()).status;
    }
    if (status !== 'granted') return null;
    const pos = await withTimeout<any>(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      READ_TIMEOUT_MS,
    );
    if (!pos) {
      // fallback: آخر موقع معروف أسرع بكثير من قفل GPS جديد.
      const last = await withTimeout<any>(Location.getLastKnownPositionAsync({ maxAge: 60_000 }), 1500);
      if (!last) return null;
      return { lat: last.coords.latitude, lng: last.coords.longitude, accuracy: last.coords.accuracy ?? undefined };
    }
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? undefined };
  } catch {
    return null;
  }
}

/**
 * يقرأ موقع الجهاز. يعيد null عند رفض الإذن أو تعذّر القراءة — والخادم يقرّر
 * حينها (يقبل إن كان geofence مغلقًا، ويردّ `location_required` إن كان مفعّلًا).
 */
export async function getDevicePosition(): Promise<DevicePosition | null> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.pos;
  const pos = Platform.OS === 'web' ? await readWeb() : await readNative();
  if (pos) cached = { at: Date.now(), pos };
  return pos;
}

/** تفريغ الكاش — يُستدعى بعد فشل `offsite` ليعيد قراءة حقيقية جديدة. */
export function clearPositionCache(): void {
  cached = null;
}
