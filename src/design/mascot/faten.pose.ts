/**
 * design/mascot/faten.pose.ts — نموذج «الوضعية» (Pose) لشخصية فطن.
 *
 * الفكرة المعمارية: الرسم **بيانات لا كود** — نحوّل الحالة الشعورية إلى مجموعة
 * أرقام محدودة (زاوية الجناح، ميل الحاجب، وضع العين، فتح المنقار، رفع العرف،
 * التوهج، الأكسسوار). الرسم نفسه مكوّن نقي يعرف كيف يرسم هذه الأرقام فقط،
 * فيصبح من السهل إضافة حالة جديدة أو تعديل إحساسها دون لمس مسارات الـ SVG.
 */
import { FatenBehaviorState } from './mascot.types';

/** وضع العين — لكل وضعية شكل عين مختلف (نفس ما تفعله الشخصيات في دوولينجو) */
export type FatenEyeMode = 'open' | 'happy' | 'squint' | 'closed' | 'fierce' | 'sparkle';

/** هالة الطاقة خلف الشخصية */
export type FatenGlow = 'brand' | 'success' | 'gold' | 'alert' | 'danger' | 'fire' | 'offline' | 'none';

/** الأكسسوارات — عنصر واحد فقط في المرة (حتى لا تتحول الشخصية إلى «شجرة زينة») */
export type FatenAccessory =
  | 'none'
  | 'flame'      // عرف الستريك الناري
  | 'medal'      // ميدالية إنجاز
  | 'star'       // نجمة ترقية
  | 'check'      // علامة نجاح
  | 'magnifier'  // فحص/تحقق
  | 'alert'      // تنبيه
  | 'shield'     // حماية العذر/الستريك
  | 'wifiOff'    // بلا اتصال
  | 'zzz'        // وضع الهدوء
  | 'sparkle';   // لمعات انتباه

export interface FatenPose {
  /** زاوية الأجنحة بالدرجات — بالسالب تعني «جناح مرفوع/مفتوح» */
  wingAngle: number;
  /** ميل الحاجب — بالسالب ابتسامة ورضا، بالموجب جدية وتركيز */
  browAngle: number;
  eyes: FatenEyeMode;
  /** 0 = عين مفتوحة كاملة، 1 = عين مغلقة تمامًا */
  squint: number;
  /** سالب = فم مضموم مرفوع، موجب = فم مفتوح (دهشة/هتاف) */
  mouthOpen: number;
  /** رفع العرف — 1 مشدود ومتحفز، -1 نائم/منخفض */
  crestPerk: number;
  glow: FatenGlow;
  accessory: FatenAccessory;
  /** ميل ثابت للرأس (الحركة تضيف عليه) */
  headTilt: number;
  /** إزاحة الذيل الرأسية */
  tailWag: number;
  /** اهتزاز خفيف للجسم (العمل/التردد) */
  bodyShiver?: boolean;
}

export const FATEN_BASE_POSE: FatenPose = {
  wingAngle: 0,
  browAngle: 0,
  eyes: 'open',
  squint: 0,
  mouthOpen: 0,
  crestPerk: 0,
  glow: 'brand',
  accessory: 'none',
  headTilt: 0,
  tailWag: 0,
};

/**
 * خريطة الوضعيات: كل حالة شعورية = إعدادات تشريحية واضحة تعبّر عنها بلا نص.
 * (نفس مبدأ دوولينجو: تعرف مشاعر الشخصية من الوضعية وحدها قبل قراءة أي كلمة.)
 */
export const FATEN_POSES: Record<FatenBehaviorState, FatenPose> = {
  idle: {
    ...FATEN_BASE_POSE,
    glow: 'brand',
  },
  welcome: {
    wingAngle: -21, browAngle: -2, eyes: 'happy', squint: 0, mouthOpen: -1,
    crestPerk: 0.9, glow: 'brand', accessory: 'none', headTilt: -2, tailWag: -2,
  },
  ready: {
    wingAngle: -10, browAngle: -2, eyes: 'open', squint: 0.12, mouthOpen: -0.5,
    crestPerk: 0.5, glow: 'success', accessory: 'check', headTilt: -1, tailWag: 0,
  },
  attention: {
    wingAngle: -21, browAngle: 1, eyes: 'open', squint: 0, mouthOpen: 1,
    crestPerk: 1, glow: 'alert', accessory: 'sparkle', headTilt: 0, tailWag: -3,
  },
  working: {
    wingAngle: -6, browAngle: 1, eyes: 'squint', squint: 0.5, mouthOpen: -0.5,
    crestPerk: 0.4, glow: 'brand', accessory: 'magnifier', headTilt: 3, tailWag: 0,
    bodyShiver: true,
  },
  success: {
    wingAngle: -24, browAngle: -3, eyes: 'happy', squint: 0, mouthOpen: -1,
    crestPerk: 1, glow: 'success', accessory: 'check', headTilt: -3, tailWag: -4,
  },
  achievement: {
    wingAngle: -26, browAngle: -3, eyes: 'happy', squint: 0, mouthOpen: 2,
    crestPerk: 1.2, glow: 'gold', accessory: 'medal', headTilt: -4, tailWag: -5,
  },
  streak_fire: {
    wingAngle: -16, browAngle: -1, eyes: 'fierce', squint: 0, mouthOpen: 1,
    crestPerk: 1.3, glow: 'fire', accessory: 'flame', headTilt: -1, tailWag: -3,
  },
  alert: {
    wingAngle: -14, browAngle: 3, eyes: 'open', squint: 0.1, mouthOpen: 0,
    crestPerk: 1, glow: 'alert', accessory: 'alert', headTilt: 0, tailWag: 2,
  },
  recovery: {
    wingAngle: 16, browAngle: 4, eyes: 'squint', squint: 0.35, mouthOpen: -1,
    crestPerk: -0.6, glow: 'danger', accessory: 'shield', headTilt: 4, tailWag: 3,
  },
  offline: {
    wingAngle: 10, browAngle: 2, eyes: 'squint', squint: 0.22, mouthOpen: -0.5,
    crestPerk: -0.4, glow: 'offline', accessory: 'wifiOff', headTilt: 3, tailWag: 0,
  },
  quiet: {
    wingAngle: 4, browAngle: 1, eyes: 'closed', squint: 1, mouthOpen: -0.5,
    crestPerk: -0.9, glow: 'none', accessory: 'zzz', headTilt: 2, tailWag: 0,
  },
  level_up: {
    wingAngle: -28, browAngle: -4, eyes: 'sparkle', squint: 0, mouthOpen: 3,
    crestPerk: 1.4, glow: 'gold', accessory: 'star', headTilt: -5, tailWag: -6,
  },
  nudge: {
    wingAngle: -17, browAngle: -1, eyes: 'open', squint: 0.15, mouthOpen: 0.5,
    crestPerk: 0.8, glow: 'brand', accessory: 'sparkle', headTilt: 5, tailWag: -2,
  },
};

export function poseOf(state: FatenBehaviorState | undefined): FatenPose {
  return FATEN_POSES[state ?? 'idle'] ?? FATEN_POSES.idle;
}
