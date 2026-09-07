/**
 * design/mascot/mascot.types.ts — الأنواع والواجهات المعمارية لشخصية مسار «فطن»
 * منظومة السلوك الحركي والشعوري الموحد لعام 2026
 */

export type FatenBehaviorState =
  | 'idle'           // هدوء وتنفس خفيف
  | 'welcome'        // ترحيب أولي بالزيارة
  | 'ready'          // جاهز ومتحفز لإجراء قادم
  | 'attention'      // توجيه الانتباه نحو عنصر مهم (CTA)
  | 'working'        // معالجة / تحقق / انتظار السيرفر
  | 'success'        // نجاح حقيقي بعد تأكيد الخادم
  | 'achievement'    // فوز بشارة / ترقية في الدوري
  | 'streak_fire'    // لهب الستريك المشتعل
  | 'alert'          // تنبيه مهم بشأن موعد أو خطر على الستريك
  | 'recovery'       // خطأ تقني مع توجيه بنّاء للإصلاح
  | 'offline'        // وضع عدم الاتصال الهادئ
  | 'quiet';         // شاشة كثيفة تتطلب هدوء الشخصية

export type MascotPriority = 0 | 10 | 20 | 30 | 40 | 50;

export const MASCOT_PRIORITY = {
  IDLE: 0,
  CONTEXTUAL: 10,
  ACHIEVEMENT: 20,
  SUCCESS: 30,
  ACTION_REQUIRED: 40,
  CRITICAL_ERROR: 50,
} as const;

export type MascotEvent =
  | { type: 'SESSION_LIVE'; courseTitle: string; minutesLeft?: number; alreadyChecked?: boolean }
  | { type: 'SESSION_UPCOMING'; courseTitle: string; startsInMinutes: number; room?: string }
  | { type: 'CHECKIN_STARTED' }
  | { type: 'CHECKIN_SUCCESS'; points: number; streakWeeks?: number }
  | { type: 'CHECKIN_ALREADY_DONE' }
  | { type: 'CHECKIN_FAILED'; reason: string; retryable?: boolean }
  | { type: 'OUTSIDE_GEOFENCE'; distanceMeters?: number }
  | { type: 'PERMISSION_REQUIRED'; permission: 'camera' | 'location' }
  | { type: 'STREAK_AT_RISK'; hoursLeft?: number }
  | { type: 'STREAK_SAFE'; weeks: number }
  | { type: 'NEAR_BADGE'; badgeTitle: string; remainingNeeded: number }
  | { type: 'BADGE_UNLOCKED'; badgeTitle: string }
  | { type: 'LEVEL_UP'; tier: string }
  | { type: 'CERTIFICATE_READY'; courseTitle: string }
  | { type: 'OFFLINE_ENTERED' }
  | { type: 'ONLINE_RESTORED' }
  | { type: 'USER_INTERACTION' }
  | { type: 'QUIET_REQUESTED' }
  | { type: 'RESET_IDLE' };

export interface MascotReaction {
  state: FatenBehaviorState;
  priority: MascotPriority;
  messageKey?: string;
  messageFallback: string;
  hapticPattern?: 'light' | 'medium' | 'success' | 'warning' | 'none';
  durationMs?: number;
  actionHint?: string;
  pointsToCTA?: boolean;
}

export interface MascotContext {
  studentName?: string;
  streakWeeks?: number;
  isOnline: boolean;
  hasActiveSession?: boolean;
  alreadyCheckedIn?: boolean;
  attendancePct?: number;
  neededForCert?: number;
}