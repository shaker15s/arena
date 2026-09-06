/**
 * shared/device.ts — بصمة الجهاز المشفرة واكتشاف التحايل وتعدد الحسابات (Anti-Fraud Device Fingerprinting)
 * تعالج ثغرة التحايل عبر أجهزة متعددة أو تسجيل حسابات زملاء من نفس الجهاز الفعلي.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const DEVICE_ID_KEY = 'masar_device_fingerprint_v1';
const RECENT_CHECKINS_KEY = 'masar_recent_checkins_v1';

/**
 * الحصول على بصمة الجهاز الفريدة والمشفرة أو إنشاؤها وتخزينها بأمان.
 */
export async function getDeviceFingerprint(): Promise<string> {
  try {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') {
        let id = localStorage.getItem(DEVICE_ID_KEY);
        if (!id) {
          id = `web_${Date.now()}_${Math.random().toString(36).substring(2, 12)}`;
          localStorage.setItem(DEVICE_ID_KEY, id);
        }
        return id;
      }
      return 'web_anon_session';
    }

    let secureId = await SecureStore.getItemAsync(DEVICE_ID_KEY);
    if (!secureId) {
      secureId = `device_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
      await SecureStore.setItemAsync(DEVICE_ID_KEY, secureId);
    }
    return secureId;
  } catch {
    return 'fallback_device_id';
  }
}

/**
 * فحص مؤشر التحايل: هل تم تسجيل حضور أكثر من 2 مستخدمين مختلفين من هذا الجهاز الفعلي خلال آخر 15 دقيقة؟
 */
export async function checkDeviceFraudFlag(currentUserId: string): Promise<{ suspicious: boolean; count: number }> {
  try {
    const now = Date.now();
    const windowMs = 15 * 60 * 1000; // 15 دقيقة

    let raw: string | null = null;
    if (Platform.OS === 'web') {
      raw = typeof localStorage !== 'undefined' ? localStorage.getItem(RECENT_CHECKINS_KEY) : null;
    } else {
      raw = await SecureStore.getItemAsync(RECENT_CHECKINS_KEY);
    }

    let records: Array<{ userId: string; timestamp: number }> = [];
    if (raw) {
      try {
        records = JSON.parse(raw);
      } catch {}
    }

    // تنظيف السجلات القديمة
    records = records.filter(r => now - r.timestamp < windowMs);

    // إضافة المحاولة الحالية
    records.push({ userId: currentUserId, timestamp: now });

    // حفظ السجلات المحدثة
    const serialized = JSON.stringify(records);
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') localStorage.setItem(RECENT_CHECKINS_KEY, serialized);
    } else {
      await SecureStore.setItemAsync(RECENT_CHECKINS_KEY, serialized);
    }

    // حساب عدد المستخدمين المختلفين
    const distinctUsers = new Set(records.map(r => r.userId));
    const suspicious = distinctUsers.size > 2;

    return { suspicious, count: distinctUsers.size };
  } catch {
    return { suspicious: false, count: 1 };
  }
}
