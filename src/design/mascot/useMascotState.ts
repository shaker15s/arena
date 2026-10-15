/**
 * design/mascot/useMascotState.ts — Rive-style State Machine Hook لتميمة مسار
 * يربط أحداث التطبيق بحالات التميمة والتأثيرات المصاحبة.
 *
 * تحديث 3.0: كل جملة تأتي من محرّك حديث فطن (`faten.lines`) والقواميس العربية
 * والإنجليزية — حُذف كل نص مضمّن كان يعرض العربية لمستخدم إنجليزي.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { CloudMascotMode } from './CloudMascot';
import { FatenBehaviorState } from './mascot.types';

/** أوسع من CloudMascotMode: كل حالات فطن الـ14 متاحة لهذه الماكينة */
export type MascotVmMode = CloudMascotMode | FatenBehaviorState;
import { pickFatenLine } from './faten.lines';

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

export function useMascotState(initialMode: MascotVmMode = 'idle') {
  const [mode, setMode] = useState<MascotVmMode>(initialMode);
  const [speechText, setSpeechText] = useState<string | undefined>(undefined);
  const lastState = useRef<FatenBehaviorState>('idle');

  /** يختار جملة جديدة من المحرّك ويضبط الحالة المرئية */
  const say = useCallback((state: FatenBehaviorState, vars: Record<string, string | number> = {}) => {
    lastState.current = state;
    setMode(state);
    setSpeechText(pickFatenLine(state, vars as never));
  }, []);

  const onCheckInSuccess = useCallback((points = 10) => {
    say('success', { points });
  }, [say]);

  const onNewBadge = useCallback((badgeTitle?: string) => {
    say('achievement', { badge: badgeTitle ?? '' });
  }, [say]);

  const onLevelUp = useCallback(() => {
    say('level_up');
  }, [say]);

  const onStreakSurge = useCallback((weeks = 1) => {
    say('streak_fire', { weeks });
  }, [say]);

  const onStreakBroken = useCallback(() => {
    say('recovery');
  }, [say]);

  const onQRFailure = useCallback((reason?: string) => {
    setMode('recovery');
    setSpeechText(reason ?? pickFatenLine('recovery'));
  }, []);

  const onLoadingStart = useCallback(() => {
    say('working');
  }, [say]);

  const onLoadingEnd = useCallback(() => {
    setMode('idle');
    setSpeechText(undefined);
  }, []);

  const resetToIdle = useCallback(() => {
    setMode('idle');
    setSpeechText(undefined);
  }, []);

  const triggers = useMemo(() => ({
    onCheckInSuccess,
    onNewBadge,
    onLevelUp,
    onStreakSurge,
    onStreakBroken,
    onQRFailure,
    onLoadingStart,
    onLoadingEnd,
    resetToIdle,
  }), [
    onCheckInSuccess, onNewBadge, onLevelUp, onStreakSurge,
    onStreakBroken, onQRFailure, onLoadingStart, onLoadingEnd, resetToIdle,
  ]);

  return {
    mode,
    setMode,
    speechText,
    setSpeechText,
    triggers,
  };
}
