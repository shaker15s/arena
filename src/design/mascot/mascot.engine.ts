/**
 * design/mascot/mascot.engine.ts — محرك القرارات والسلوك لشخصية «فطن»
 * يطبق هرمية الأولويات، ميزانية المحادثة، وتفصيل الردود بحسب سياق الطالب الحقيقي
 */

import {
  FatenBehaviorState,
  MASCOT_PRIORITY,
  MascotContext,
  MascotEvent,
  MascotReaction,
} from './mascot.types';

export function resolveMascotReaction(
  event: MascotEvent,
  context: MascotContext
): MascotReaction {
  switch (event.type) {
    case 'SESSION_LIVE': {
      if (event.alreadyChecked || context.alreadyCheckedIn) {
        return {
          state: 'success',
          priority: MASCOT_PRIORITY.SUCCESS,
          messageKey: 'mascot.session_attended',
          messageFallback: 'حضورك موثق اليوم بنجاح يا بطل! نقاطك واستمرارك محفوظين 🦅',
          hapticPattern: 'success',
          durationMs: 4000,
          pointsToCTA: false,
        };
      }
      return {
        state: 'attention',
        priority: MASCOT_PRIORITY.ACTION_REQUIRED,
        messageKey: 'mascot.session_live_action',
        messageFallback: `محاضرة ${event.courseTitle} بدأت الآن! سجّل حضورك وثبّت نقاطك`,
        hapticPattern: 'medium',
        actionHint: 'scan_now',
        pointsToCTA: true,
      };
    }

    case 'SESSION_UPCOMING': {
      const timeStr = event.startsInMinutes <= 60
        ? `خلال ${event.startsInMinutes} دقيقة`
        : `اليوم`;
      const roomStr = event.room ? ` في ${event.room}` : '';
      return {
        state: 'ready',
        priority: MASCOT_PRIORITY.CONTEXTUAL,
        messageKey: 'mascot.session_upcoming',
        messageFallback: `جلستك القادمة (${event.courseTitle}) ${timeStr}${roomStr}.. جهّز نفسك!`,
        hapticPattern: 'light',
        durationMs: 3500,
      };
    }

    case 'CHECKIN_STARTED': {
      return {
        state: 'working',
        priority: MASCOT_PRIORITY.ACTION_REQUIRED,
        messageKey: 'mascot.checking_in',
        messageFallback: 'لحظة واحدة.. أتحقق من بيانات الحضور والأمان 🔍',
        hapticPattern: 'light',
      };
    }

    case 'CHECKIN_SUCCESS': {
      return {
        state: 'achievement',
        priority: MASCOT_PRIORITY.SUCCESS,
        messageKey: 'mascot.checkin_success',
        messageFallback: `كفو! تم توثوق حضورك وإضافة +${event.points} نقطة بنجاح 🎉`,
        hapticPattern: 'success',
        durationMs: 5000,
      };
    }

    case 'CHECKIN_ALREADY_DONE': {
      return {
        state: 'success',
        priority: MASCOT_PRIORITY.SUCCESS,
        messageKey: 'mascot.checkin_already_done',
        messageFallback: 'أنت مسجل حضورك بالفعل في هذه الجلسة ✓ — لا حاجة للمسح مجدداً',
        hapticPattern: 'success',
        durationMs: 4000,
      };
    }

    case 'CHECKIN_FAILED': {
      return {
        state: 'recovery',
        priority: MASCOT_PRIORITY.CRITICAL_ERROR,
        messageKey: 'mascot.checkin_failed',
        messageFallback: event.reason || 'تعذر تأكيد الحضور، يرجى إعادة المحاولة مع المنظم',
        hapticPattern: 'warning',
        durationMs: 4500,
      };
    }

    case 'OUTSIDE_GEOFENCE': {
      const dist = event.distanceMeters ? ` (${event.distanceMeters}م)` : '';
      return {
        state: 'recovery',
        priority: MASCOT_PRIORITY.ACTION_REQUIRED,
        messageKey: 'mascot.outside_geofence',
        messageFallback: `أنت خارج نطاق القاعة التدريبية${dist}.. اقترب قليلاً ثم أعد المحاولة 📍`,
        hapticPattern: 'warning',
        durationMs: 4000,
      };
    }

    case 'PERMISSION_REQUIRED': {
      const permName = event.permission === 'camera' ? 'الكاميرا' : 'الموقع الجغرافي';
      return {
        state: 'recovery',
        priority: MASCOT_PRIORITY.ACTION_REQUIRED,
        messageKey: 'mascot.permission_required',
        messageFallback: `نحتاج إذن ${permName} للتحقق من حضورك بأمان`,
        hapticPattern: 'warning',
        durationMs: 4000,
      };
    }

    case 'STREAK_AT_RISK': {
      return {
        state: 'alert',
        priority: MASCOT_PRIORITY.ACTION_REQUIRED,
        messageKey: 'mascot.streak_at_risk',
        messageFallback: 'سلسلة التزامك في خطر! سجّل حضورك اليوم للحفاظ على الستريك 🔥',
        hapticPattern: 'warning',
        durationMs: 5000,
        pointsToCTA: true,
      };
    }

    case 'STREAK_SAFE': {
      return {
        state: 'streak_fire',
        priority: MASCOT_PRIORITY.ACHIEVEMENT,
        messageKey: 'mascot.streak_safe',
        messageFallback: `سلسلة خارقة! مستمر منذ ${event.weeks} أسابيع دون انقطاع ⚡`,
        hapticPattern: 'success',
        durationMs: 4000,
      };
    }

    case 'NEAR_BADGE': {
      return {
        state: 'ready',
        priority: MASCOT_PRIORITY.ACHIEVEMENT,
        messageKey: 'mascot.near_badge',
        messageFallback: `اقتربت من شارة "${event.badgeTitle}"! باقي لك ${event.remainingNeeded} فقط 🏅`,
        hapticPattern: 'light',
        durationMs: 4000,
      };
    }

    case 'BADGE_UNLOCKED': {
      return {
        state: 'achievement',
        priority: MASCOT_PRIORITY.ACHIEVEMENT,
        messageKey: 'mascot.badge_unlocked',
        messageFallback: `إنجاز جديد! حصلت على شارة "${event.badgeTitle}" 🎖️`,
        hapticPattern: 'success',
        durationMs: 5000,
      };
    }

    case 'LEVEL_UP': {
      return {
        state: 'achievement',
        priority: MASCOT_PRIORITY.ACHIEVEMENT,
        messageKey: 'mascot.level_up',
        messageFallback: `ترقية مستحقة! انتقلت إلى دوري "${event.tier}" 🚀`,
        hapticPattern: 'success',
        durationMs: 5000,
      };
    }

    case 'CERTIFICATE_READY': {
      return {
        state: 'achievement',
        priority: MASCOT_PRIORITY.ACHIEVEMENT,
        messageKey: 'mascot.certificate_ready',
        messageFallback: `مبارك! استوفيت متطلبات شهادة "${event.courseTitle}" 📜`,
        hapticPattern: 'success',
        durationMs: 6000,
      };
    }

    case 'OFFLINE_ENTERED': {
      return {
        state: 'offline',
        priority: MASCOT_PRIORITY.CONTEXTUAL,
        messageKey: 'mascot.offline_active',
        messageFallback: 'أنت في وضع عدم الاتصال.. يمكنك تسجيل الحضور وسنرفعه تلقائياً عند عودة الشبكة 💾',
        hapticPattern: 'light',
        durationMs: 4000,
      };
    }

    case 'ONLINE_RESTORED': {
      return {
        state: 'welcome',
        priority: MASCOT_PRIORITY.CONTEXTUAL,
        messageKey: 'mascot.online_restored',
        messageFallback: 'عادت الشبكة! تم مزامنة بياناتك وسجلاتك مع السيرفر بنجاح 🌐',
        hapticPattern: 'light',
        durationMs: 3000,
      };
    }

    case 'QUIET_REQUESTED': {
      return {
        state: 'quiet',
        priority: MASCOT_PRIORITY.IDLE,
        messageFallback: '',
        durationMs: 0,
      };
    }

    case 'USER_INTERACTION': {
      return resolveUserInteractionReaction(context);
    }

    case 'RESET_IDLE':
    default: {
      return resolveDefaultIdleReaction(context);
    }
  }
}

function resolveUserInteractionReaction(context: MascotContext): MascotReaction {
  if (!context.isOnline) {
    return {
      state: 'offline',
      priority: MASCOT_PRIORITY.CONTEXTUAL,
      messageKey: 'mascot.offline_active',
      messageFallback: 'لا تقلق من انقطاع الشبكة، بياناتك وتسجيلاتك محفوظة محلياً بأمان!',
      hapticPattern: 'light',
      durationMs: 3500,
    };
  }

  if (context.hasActiveSession && !context.alreadyCheckedIn) {
    return {
      state: 'attention',
      priority: MASCOT_PRIORITY.ACTION_REQUIRED,
      messageKey: 'mascot.tap_prompt_checkin',
      messageFallback: 'جلستك جارية الآن! لا تفوّت تسجيل الحضور وتأكيد نقاطك',
      hapticPattern: 'medium',
      pointsToCTA: true,
      durationMs: 3500,
    };
  }

  if (context.neededForCert && context.neededForCert > 0) {
    return {
      state: 'ready',
      priority: MASCOT_PRIORITY.CONTEXTUAL,
      messageKey: 'mascot.tap_cert_progress',
      messageFallback: `باقي لك ${context.neededForCert} جلسات لتحقيق نسبة الـ 75% واستحقاق الشهادة 🎓`,
      hapticPattern: 'light',
      durationMs: 3500,
    };
  }

  if (context.streakWeeks && context.streakWeeks > 1) {
    return {
      state: 'streak_fire',
      priority: MASCOT_PRIORITY.ACHIEVEMENT,
      messageKey: 'mascot.tap_streak_praise',
      messageFallback: `فخور بالتزامك! ${context.streakWeeks} أسابيع متتالية من التميز 🔥`,
      hapticPattern: 'light',
      durationMs: 3500,
    };
  }

  return {
    state: 'welcome',
    priority: MASCOT_PRIORITY.CONTEXTUAL,
    messageKey: 'mascot.tap_general_cheer',
    messageFallback: 'معاً في مسار لتحقيق أهدافك التدريبية واكتساب المهارات! 🦅',
    hapticPattern: 'light',
    durationMs: 3000,
  };
}

function resolveDefaultIdleReaction(context: MascotContext): MascotReaction {
  if (!context.isOnline) {
    return {
      state: 'offline',
      priority: MASCOT_PRIORITY.IDLE,
      messageFallback: 'وضع عدم الاتصال',
    };
  }

  if (context.hasActiveSession && !context.alreadyCheckedIn) {
    return {
      state: 'attention',
      priority: MASCOT_PRIORITY.ACTION_REQUIRED,
      messageKey: 'mascot.session_live_action',
      messageFallback: 'جلسة تدريبية جارية الآن — سجّل حضورك',
      pointsToCTA: true,
    };
  }

  return {
    state: 'idle',
    priority: MASCOT_PRIORITY.IDLE,
    messageFallback: '',
  };
}
