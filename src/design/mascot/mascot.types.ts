/**
 * design/mascot/mascot.types.ts — الأنواع والواجهات المعمارية لشخصية مسار «فطن»
 * منظومة السلوك الحركي والشعوري الموحد لعام 2026 (Faten 3.0)
 */

export type FatenBehaviorState =
  | 'idle'           // هدوء وتنفس خفيف
  | 'welcome'        // ترحيب أولي بالزيارة
  | 'ready'          // جاهز ومتحفز لإجراء قادم
  | 'attention'      // توجيه الانتباه نحو عنصر مهم (CTA)
  | 'working'        // معالجة / تحقق / انتظار السيرفر
  | 'success'        // نجاح حقيقي بعد تأكيد الخادم
  | 'achievement'    // فوز بشارة / إنجاز كبير
  | 'streak_fire'    // لهب الستريك المشتعل
  | 'alert'          // تنبيه مهم بشأن موعد أو خطر على الستريك
  | 'recovery'       // خطأ تقني مع توجيه بنّاء للإصلاح
  | 'offline'        // وضع عدم الاتصال الهادئ
  | 'quiet'          // شاشة كثيفة تتطلب هدوء الشخصية
  | 'level_up'       // ترقية مستوى/دوري — أقوى لحظة احتفال
  | 'nudge';         // همسة تذكير ودودة

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
  /* ── فتح التطبيق والحضور اليومي ── */
  | { type: 'APP_OPEN'; name?: string }
  | { type: 'DAILY_TIP' }
  /* ── الجلسات ── */
  | { type: 'SESSION_LIVE'; courseTitle: string; minutesLeft?: number; alreadyChecked?: boolean }
  | { type: 'SESSION_UPCOMING'; courseTitle: string; startsInMinutes: number; room?: string }
  | { type: 'CHECKIN_STARTED' }
  | { type: 'CHECKIN_SUCCESS'; points: number; streakWeeks?: number }
  | { type: 'CHECKIN_ALREADY_DONE' }
  | { type: 'CHECKIN_FAILED'; reason: string; retryable?: boolean }
  | { type: 'OUTSIDE_GEOFENCE'; distanceMeters?: number }
  | { type: 'PERMISSION_REQUIRED'; permission: 'camera' | 'location' }
  /* ── الستريك والجوائز ── */
  | { type: 'STREAK_AT_RISK'; hoursLeft?: number; weeks?: number }
  | { type: 'STREAK_SAFE'; weeks: number }
  | { type: 'NEAR_BADGE'; badgeTitle: string; remainingNeeded: number }
  | { type: 'BADGE_UNLOCKED'; badgeTitle: string }
  | { type: 'LEVEL_UP'; tier: string }
  | { type: 'CERTIFICATE_READY'; courseTitle: string }
  | { type: 'COURSE_COMPLETED'; courseTitle: string }
  | { type: 'KUDOS_RECEIVED'; points: number }
  /* ── التغذية الراجعة والتقارير ── */
  | { type: 'FEEDBACK_SUBMITTED' }
  | { type: 'FEEDBACK_DUE'; count: number }
  | { type: 'REPORT_READY'; title: string }
  /* ── الأعذار والحالات ── */
  | { type: 'EXCUSE_ACCEPTED' }
  | { type: 'EXCUSE_REJECTED'; reason?: string }
  /* ── الاتصال ── */
  | { type: 'OFFLINE_ENTERED' }
  | { type: 'ONLINE_RESTORED' }
  /* ── تحكّم مباشر ── */
  | { type: 'USER_INTERACTION' }
  | { type: 'QUIET_REQUESTED' }
  | { type: 'RESET_IDLE' };

export interface MascotReaction {
  state: FatenBehaviorState;
  priority: MascotPriority;
  messageKey?: string;
  messageFallback: string;
  /** متغيّرات النص المرسلة مع المفتاح القادم (لتعريب نظيف بلا سلاسل مجمّعة) */
  messageVars?: Record<string, string | number>;
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
  /** هل المستخدم منظم/مدرب؟ فتتغيّر نبرة الرسائل والاهتمامات */
  isOrganizer?: boolean;
  /** عدد التغذيات الراجعة المنتظرة */
  pendingFeedback?: number;
  hour?: number;
}
