/**
 * design/mascot/mascot.engine.ts — محرك القرارات والسلوك لشخصية «فطن»
 * يطبق هرمية الأولويات، ميزانية المحادثة، وتفصيل الردود بحسب سياق الطالب الحقيقي
 */

import { tStatic } from '../../i18n/core';
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
          messageFallback: tStatic('mascot.session_attended'),
          hapticPattern: 'success',
          durationMs: 4000,
          pointsToCTA: false,
        };
      }
      return {
        state: 'attention',
        priority: MASCOT_PRIORITY.ACTION_REQUIRED,
        messageKey: 'mascot.session_live_action',
        messageFallback: tStatic('mascot.session_live_action', { course: event.courseTitle }),
        hapticPattern: 'medium',
        actionHint: 'scan_now',
        pointsToCTA: true,
      };
    }

    case 'SESSION_UPCOMING': {
      const timeStr = event.startsInMinutes <= 60
        ? tStatic('mascot.session_upcoming_minutes', { minutes: event.startsInMinutes })
        : tStatic('mascot.session_upcoming_today');
      const roomStr = event.room ? tStatic('mascot.session_upcoming_room', { room: event.room }) : '';
      return {
        state: 'ready',
        priority: MASCOT_PRIORITY.CONTEXTUAL,
        messageKey: 'mascot.session_upcoming',
        messageFallback: tStatic('mascot.session_upcoming', { course: event.courseTitle, time: timeStr, room: roomStr }),
        hapticPattern: 'light',
        durationMs: 3500,
      };
    }

    case 'CHECKIN_STARTED': {
      return {
        state: 'working',
        priority: MASCOT_PRIORITY.ACTION_REQUIRED,
        messageKey: 'mascot.checking_in',
        messageFallback: tStatic('mascot.checking_in'),
        hapticPattern: 'light',
      };
    }

    case 'CHECKIN_SUCCESS': {
      return {
        state: 'achievement',
        priority: MASCOT_PRIORITY.SUCCESS,
        messageKey: 'mascot.checkin_success',
        messageFallback: tStatic('mascot.checkin_success', { points: event.points }),
        hapticPattern: 'success',
        durationMs: 5000,
      };
    }

    case 'CHECKIN_ALREADY_DONE': {
      return {
        state: 'success',
        priority: MASCOT_PRIORITY.SUCCESS,
        messageKey: 'mascot.checkin_already_done',
        messageFallback: tStatic('mascot.checkin_already_done'),
        hapticPattern: 'success',
        durationMs: 4000,
      };
    }

    case 'CHECKIN_FAILED': {
      return {
        state: 'recovery',
        priority: MASCOT_PRIORITY.CRITICAL_ERROR,
        messageKey: 'mascot.checkin_failed',
        messageFallback: event.reason || tStatic('mascot.checkin_failed'),
        hapticPattern: 'warning',
        durationMs: 4500,
      };
    }

    case 'OUTSIDE_GEOFENCE': {
      const dist = event.distanceMeters
        ? tStatic('mascot.outside_geofence_distance', { meters: event.distanceMeters })
        : '';
      return {
        state: 'recovery',
        priority: MASCOT_PRIORITY.ACTION_REQUIRED,
        messageKey: 'mascot.outside_geofence',
        messageFallback: tStatic('mascot.outside_geofence', { distance: dist }),
        hapticPattern: 'warning',
        durationMs: 4000,
      };
    }

    case 'PERMISSION_REQUIRED': {
      const permName = event.permission === 'camera'
        ? tStatic('mascot.permission_camera')
        : tStatic('mascot.permission_location');
      return {
        state: 'recovery',
        priority: MASCOT_PRIORITY.ACTION_REQUIRED,
        messageKey: 'mascot.permission_required',
        messageFallback: tStatic('mascot.permission_required', { permission: permName }),
        hapticPattern: 'warning',
        durationMs: 4000,
      };
    }

    case 'STREAK_AT_RISK': {
      return {
        state: 'alert',
        priority: MASCOT_PRIORITY.ACTION_REQUIRED,
        messageKey: 'mascot.streak_at_risk',
        messageFallback: tStatic('mascot.streak_at_risk'),
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
        messageFallback: tStatic('mascot.streak_safe', { weeks: event.weeks }),
        hapticPattern: 'success',
        durationMs: 4000,
      };
    }

    case 'NEAR_BADGE': {
      return {
        state: 'ready',
        priority: MASCOT_PRIORITY.ACHIEVEMENT,
        messageKey: 'mascot.near_badge',
        messageFallback: tStatic('mascot.near_badge', { badge: event.badgeTitle, remaining: event.remainingNeeded }),
        hapticPattern: 'light',
        durationMs: 4000,
      };
    }

    case 'BADGE_UNLOCKED': {
      return {
        state: 'achievement',
        priority: MASCOT_PRIORITY.ACHIEVEMENT,
        messageKey: 'mascot.badge_unlocked',
        messageFallback: tStatic('mascot.badge_unlocked', { badge: event.badgeTitle }),
        hapticPattern: 'success',
        durationMs: 5000,
      };
    }

    case 'LEVEL_UP': {
      return {
        state: 'achievement',
        priority: MASCOT_PRIORITY.ACHIEVEMENT,
        messageKey: 'mascot.level_up',
        messageFallback: tStatic('mascot.level_up', { tier: event.tier }),
        hapticPattern: 'success',
        durationMs: 5000,
      };
    }

    case 'CERTIFICATE_READY': {
      return {
        state: 'achievement',
        priority: MASCOT_PRIORITY.ACHIEVEMENT,
        messageKey: 'mascot.certificate_ready',
        messageFallback: tStatic('mascot.certificate_ready', { course: event.courseTitle }),
        hapticPattern: 'success',
        durationMs: 6000,
      };
    }

    case 'OFFLINE_ENTERED': {
      return {
        state: 'offline',
        priority: MASCOT_PRIORITY.CONTEXTUAL,
        messageKey: 'mascot.offline_active',
        messageFallback: tStatic('mascot.offline_active'),
        hapticPattern: 'light',
        durationMs: 4000,
      };
    }

    case 'ONLINE_RESTORED': {
      return {
        state: 'welcome',
        priority: MASCOT_PRIORITY.CONTEXTUAL,
        messageKey: 'mascot.online_restored',
        messageFallback: tStatic('mascot.online_restored'),
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
      messageFallback: tStatic('mascot.offline_active'),
      hapticPattern: 'light',
      durationMs: 3500,
    };
  }

  if (context.hasActiveSession && !context.alreadyCheckedIn) {
    return {
      state: 'attention',
      priority: MASCOT_PRIORITY.ACTION_REQUIRED,
      messageKey: 'mascot.tap_prompt_checkin',
      messageFallback: tStatic('mascot.tap_prompt_checkin'),
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
      messageFallback: tStatic('mascot.tap_cert_progress', { sessions: context.neededForCert }),
      hapticPattern: 'light',
      durationMs: 3500,
    };
  }

  if (context.streakWeeks && context.streakWeeks > 1) {
    return {
      state: 'streak_fire',
      priority: MASCOT_PRIORITY.ACHIEVEMENT,
      messageKey: 'mascot.tap_streak_praise',
      messageFallback: tStatic('mascot.tap_streak_praise', { weeks: context.streakWeeks }),
      hapticPattern: 'light',
      durationMs: 3500,
    };
  }

  return {
    state: 'welcome',
    priority: MASCOT_PRIORITY.CONTEXTUAL,
    messageKey: 'mascot.tap_general_cheer',
    messageFallback: tStatic('mascot.tap_general_cheer'),
    hapticPattern: 'light',
    durationMs: 3000,
  };
}

function resolveDefaultIdleReaction(context: MascotContext): MascotReaction {
  if (!context.isOnline) {
    return {
      state: 'offline',
      priority: MASCOT_PRIORITY.IDLE,
      messageFallback: tStatic('mascot.idle_offline'),
    };
  }

  if (context.hasActiveSession && !context.alreadyCheckedIn) {
    return {
      state: 'attention',
      priority: MASCOT_PRIORITY.ACTION_REQUIRED,
      messageKey: 'mascot.session_live_action',
      messageFallback: tStatic('mascot.idle_session_now'),
      pointsToCTA: true,
    };
  }

  return {
    state: 'idle',
    priority: MASCOT_PRIORITY.IDLE,
    messageFallback: '',
  };
}
