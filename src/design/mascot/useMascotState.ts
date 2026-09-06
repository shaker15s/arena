/**
 * design/mascot/useMascotState.ts — Rive-style State Machine Hook لتميمة مسار
 * يربط أحداث التطبيق بحالات التميمة والتأثيرات المصاحبة
 * بناءً على خريطة الأحداث في MASAR_ASSETS_RESEARCH.md
 */
import { useCallback, useState } from 'react';
import { CloudMascotMode } from './CloudMascot';

export interface MascotTriggerEvents {
  onCheckInSuccess: (points?: number) => void;
  onNewBadge: (badgeTitle?: string) => void;
  onLevelUp: () => void;
  onStreakSurge: (weeks?: number) => void;
  onStreakBroken: () => void;
  onQRFailure: (reason?: string) => void;
  onLoadingStart: () => void;
  onLoadingEnd: () => void;
  resetToIdle: () => void;
}

export function useMascotState(initialMode: CloudMascotMode = 'idle') {
  const [mode, setMode] = useState<CloudMascotMode>(initialMode);
  const [speechText, setSpeechText] = useState<string | undefined>(undefined);

  const onCheckInSuccess = useCallback((points = 10) => {
    setMode('happy');
    setSpeechText(`حضور موثق! +${points} نقطة أضيفت لرصيدك! 🎉`);
  }, []);

  const onNewBadge = useCallback((badgeTitle = 'شارة جديدة') => {
    setMode('celebrate');
    setSpeechText(`وسام جديد يستحق الفخر: ${badgeTitle}! 🏆`);
  }, []);

  const onLevelUp = useCallback(() => {
    setMode('celebrate');
    setSpeechText('ترقية مستحقة إلى فئة دوري جديدة! 👑');
  }, []);

  const onStreakSurge = useCallback((weeks = 1) => {
    setMode('streak_fire');
    setSpeechText(`لهب الستريك يشتعل للأسبوع ${weeks}! 🔥`);
  }, []);

  const onStreakBroken = useCallback(() => {
    setMode('sad');
    setSpeechText('انقطع الستريك مؤقتاً.. لا تستسلم، يمكنك استعادته! 🌧️');
  }, []);

  const onQRFailure = useCallback((reason?: string) => {
    setMode('sad');
    setSpeechText(reason ?? 'تعذر قراءة الرمز.. جرب الكود الاحتياطي 💙');
  }, []);

  const onLoadingStart = useCallback(() => {
    setMode('thinking');
    setSpeechText('جاري المعالجة والتحقق بأمان.. ⏳');
  }, []);

  const onLoadingEnd = useCallback(() => {
    setMode('idle');
    setSpeechText(undefined);
  }, []);

  const resetToIdle = useCallback(() => {
    setMode('idle');
    setSpeechText(undefined);
  }, []);

  return {
    mode,
    setMode,
    speechText,
    setSpeechText,
    triggers: {
      onCheckInSuccess,
      onNewBadge,
      onLevelUp,
      onStreakSurge,
      onStreakBroken,
      onQRFailure,
      onLoadingStart,
      onLoadingEnd,
      resetToIdle,
    },
  };
}
