/**
 * design/moments/moments.ts — محرك اللحظات والاحتفالات الموحد لمسار
 * يطبق بصرامة قاعدة: «لا احتفال قبل التحقق من الخادم (No Celebration Before Server ACK)»
 * ويربط التأثير البصري مع ردود فعل «فطن» والاهتزاز اللمسي المخصص
 */

import * as Haptics from 'expo-haptics';
import { MascotEvent } from '../mascot/mascot.types';
import { isReducedMotion } from '../motion';

export type MomentType =
  | 'checkin_success'
  | 'checkin_already'
  | 'streak_surge'
  | 'badge_unlocked'
  | 'level_up'
  | 'certificate_ready';

export interface MomentPayload {
  type: MomentType;
  points?: number;
  streakWeeks?: number;
  badgeTitle?: string;
  tier?: string;
  courseTitle?: string;
  serverAcked: boolean; // فرض التأكيد من الخادم
}

export interface MomentResult {
  triggered: boolean;
  reason?: string;
}

/**
 * إطلاق لحظة احتفالية بعد استلام تأكيد الخادم المؤكد (Server ACK)
 */
export function triggerMoment(
  payload: MomentPayload,
  emitMascot?: (event: MascotEvent) => void
): MomentResult {
  // 1. التحقق الصارم من تأكيد الخادم لمنع الاحتفالات الوهمية أو السابقة لأوانها
  if (!payload.serverAcked) {
    if (__DEV__) {
      console.warn(
        `[MomentsEngine] Celebration blocked for ${payload.type}: Server ACK is required before triggering celebration.`
      );
    }
    return { triggered: false, reason: 'server_ack_missing' };
  }

  // 2. إطلاق نمط الاهتزاز اللمسي المناسب
  try {
    if (!isReducedMotion()) {
      if (payload.type === 'checkin_already') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else if (payload.type === 'checkin_success' || payload.type === 'badge_unlocked' || payload.type === 'level_up') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
    }
  } catch {
    // safe fallback
  }

  // 3. ربط الحدث بشخصية فطن إن وُجد باعث الأحداث
  if (emitMascot) {
    switch (payload.type) {
      case 'checkin_success':
        emitMascot({
          type: 'CHECKIN_SUCCESS',
          points: payload.points ?? 10,
          streakWeeks: payload.streakWeeks,
        });
        break;

      case 'checkin_already':
        emitMascot({
          type: 'CHECKIN_ALREADY_DONE',
        });
        break;

      case 'streak_surge':
        emitMascot({
          type: 'STREAK_SAFE',
          weeks: payload.streakWeeks ?? 1,
        });
        break;

      case 'badge_unlocked':
        emitMascot({
          type: 'BADGE_UNLOCKED',
          badgeTitle: payload.badgeTitle ?? 'شارة مميزة',
        });
        break;

      case 'level_up':
        emitMascot({
          type: 'LEVEL_UP',
          tier: payload.tier ?? 'المتقدم',
        });
        break;

      case 'certificate_ready':
        emitMascot({
          type: 'CERTIFICATE_READY',
          courseTitle: payload.courseTitle ?? 'الدورة التدريبية',
        });
        break;
    }
  }

  return { triggered: true };
}
