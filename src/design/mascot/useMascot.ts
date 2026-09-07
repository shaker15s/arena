/**
 * design/mascot/useMascot.ts — خطاف إدارة وتنسيق سلوك شخصية «فطن» الموحدة
 * يدير هرمية الأولويات، المؤقتات الآمنة، ميزانية المحادثة، وإلغاء الاهتزاز المزدوج
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import {
  FatenBehaviorState,
  MASCOT_PRIORITY,
  MascotContext,
  MascotEvent,
  MascotReaction,
} from './mascot.types';
import { resolveMascotReaction } from './mascot.engine';
import { isReducedMotion } from '../motion';

export interface UseMascotOptions {
  initialContext?: Partial<MascotContext>;
  onReactionChange?: (reaction: MascotReaction) => void;
}

const DEFAULT_CONTEXT: MascotContext = {
  isOnline: true,
  hasActiveSession: false,
  alreadyCheckedIn: false,
  streakWeeks: 0,
  attendancePct: 0,
};

export function useMascot(options: UseMascotOptions = {}) {
  const [context, setContextState] = useState<MascotContext>({
    ...DEFAULT_CONTEXT,
    ...options.initialContext,
  });

  const [reaction, setReaction] = useState<MascotReaction>(() =>
    resolveMascotReaction({ type: 'RESET_IDLE' }, { ...DEFAULT_CONTEXT, ...options.initialContext })
  );

  const [speech, setSpeech] = useState<string>(reaction.messageFallback || '');

  // مراجع آمنة للمؤقتات لتجنب تراكم الـ Timers وتداخل الأحداث
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const lastHapticTimeRef = useRef<number>(0);
  const lastEventRef = useRef<MascotEvent | null>(null);

  // تحديث السياق مع الحفاظ على التفاعل الحالي إذا كانت الأولوية أعلى
  const updateContext = useCallback((partial: Partial<MascotContext>) => {
    setContextState((prev) => {
      const next = { ...prev, ...partial };
      return next;
    });
  }, []);

  // تنفيذ نمط الاهتزاز مع حد فاصل (300ms Cooldown) لمنع الاهتزاز المزدوج
  const executeHaptic = useCallback((pattern?: MascotReaction['hapticPattern']) => {
    if (!pattern || pattern === 'none') return;
    const now = Date.now();
    if (now - lastHapticTimeRef.current < 300) return;
    lastHapticTimeRef.current = now;

    try {
      switch (pattern) {
        case 'light':
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          break;
        case 'medium':
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          break;
        case 'success':
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          break;
        case 'warning':
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          break;
      }
    } catch {
      // safe fallback if Haptics unavailable on web/unsupported
    }
  }, []);

  // إرسال حدث إلى محرك فطن لحل رد الفعل
  const emit = useCallback(
    (event: MascotEvent) => {
      lastEventRef.current = event;
      const nextReaction = resolveMascotReaction(event, context);

      // مقارنة الأولوية: إذا كان الحدث الحالي ذو أولوية أقل من التفاعل النشط غير المنتهي، لا نقطعه
      setReaction((currentReaction) => {
        // إذا كان هناك تفاعل ذو أولوية حرجة أو نجاح حالي وما زال مؤقته جارياً، تحقق من الأولوية
        if (
          timerRef.current &&
          currentReaction.priority > nextReaction.priority &&
          nextReaction.priority < MASCOT_PRIORITY.CRITICAL_ERROR
        ) {
          return currentReaction;
        }

        // إلغاء أي مؤقت سابق بأمان
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }

        // تشغيل الاهتزاز المخصص
        executeHaptic(nextReaction.hapticPattern);

        // تحديث نص الحديث
        setSpeech(nextReaction.messageFallback);

        // جدولة العودة للهدوء إن كان للتفاعل مدة محددة
        if (nextReaction.durationMs && nextReaction.durationMs > 0) {
          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            const idleReaction = resolveMascotReaction({ type: 'RESET_IDLE' }, context);
            setReaction(idleReaction);
            setSpeech(idleReaction.messageFallback || '');
          }, nextReaction.durationMs);
        }

        if (options.onReactionChange) {
          options.onReactionChange(nextReaction);
        }

        return nextReaction;
      });
    },
    [context, executeHaptic, options]
  );

  // التفاعل عند النقر المباشر على فطن
  const triggerTap = useCallback(() => {
    emit({ type: 'USER_INTERACTION' });
  }, [emit]);

  // مسح التفاعل والعودة الفورية للهدوء
  const resetToIdle = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const idleReaction = resolveMascotReaction({ type: 'RESET_IDLE' }, context);
    setReaction(idleReaction);
    setSpeech(idleReaction.messageFallback || '');
  }, [context]);

  // تنظيف المؤقتات عند إلغاء التركيب
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return {
    behavior: reaction.state as FatenBehaviorState,
    reaction,
    speech,
    context,
    updateContext,
    emit,
    triggerTap,
    resetToIdle,
  };
}
