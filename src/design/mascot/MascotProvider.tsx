/**
 * design/mascot/MascotProvider.tsx — المزوّد المركزي لتميمة «فطن» (M2 + M3)
 *
 * • MascotProvider + useMascotStage: يضمن مثيلًا منطقيًا واحدًا لمحرك القرارات
 *   وميزانية الحديث والاهتزازات عبر التطبيق.
 * • MascotStage: يعرض التميمة المرتبطة بالمزوّد المركزي.
 * • MascotSvgFallback: يوفّر التوصيف الساكن لكل الحالات الـ12 (12/12) في وضع
 *   تقليل الحركة (prefers-reduced-motion) مع بديل نصي دلالي لقارئ الشاشة.
 */
import React, { createContext, useContext } from 'react';
import { ViewStyle, StyleProp } from 'react-native';
import { FatenBehaviorState } from './mascot.types';
import { useMascot, UseMascotOptions } from './useMascot';
import { MasarMascot } from './MasarMascot';
import { tStatic, type DictKey } from '../../i18n';

export interface StaticMascotFrame {
  state: FatenBehaviorState;
  wingAngleDeg: number;
  headTiltDeg: number;
  eyeScaleY: number;
  badgeColor: string;
  labelKey: DictKey;
}

/** M3: 12/12 إطارًا ساكنًا صريحًا لكل حالة من حالات «فطن» عند تفعيل تقليل الحركة. */
export const FATEN_STATIC_FRAMES: Record<FatenBehaviorState, StaticMascotFrame> = {
  idle: { state: 'idle', wingAngleDeg: 0, headTiltDeg: 0, eyeScaleY: 1, badgeColor: '#007AFF', labelKey: 'mascot.p.idle.1' },
  welcome: { state: 'welcome', wingAngleDeg: -14, headTiltDeg: -4, eyeScaleY: 1, badgeColor: '#007AFF', labelKey: 'mascot.p.welcome.1' },
  ready: { state: 'ready', wingAngleDeg: -8, headTiltDeg: -3, eyeScaleY: 1.05, badgeColor: '#30D158', labelKey: 'mascot.p.ready.1' },
  attention: { state: 'attention', wingAngleDeg: -18, headTiltDeg: 0, eyeScaleY: 1.1, badgeColor: '#FF9F0A', labelKey: 'mascot.p.attention.1' },
  working: { state: 'working', wingAngleDeg: -6, headTiltDeg: 6, eyeScaleY: 0.88, badgeColor: '#5856D6', labelKey: 'mascot.p.working.1' },
  success: { state: 'success', wingAngleDeg: -22, headTiltDeg: -5, eyeScaleY: 1.08, badgeColor: '#34C759', labelKey: 'mascot.p.success.1' },
  achievement: { state: 'achievement', wingAngleDeg: -28, headTiltDeg: -6, eyeScaleY: 1.12, badgeColor: '#FFB800', labelKey: 'mascot.p.achievement.1' },
  streak_fire: { state: 'streak_fire', wingAngleDeg: -24, headTiltDeg: -4, eyeScaleY: 1.1, badgeColor: '#FF3B30', labelKey: 'mascot.p.streak_fire.1' },
  recovery: { state: 'recovery', wingAngleDeg: 6, headTiltDeg: 5, eyeScaleY: 0.92, badgeColor: '#5AC8FA', labelKey: 'mascot.p.recovery.1' },
  alert: { state: 'alert', wingAngleDeg: -16, headTiltDeg: 0, eyeScaleY: 1.14, badgeColor: '#FF3B30', labelKey: 'mascot.p.alert.1' },
  offline: { state: 'offline', wingAngleDeg: 8, headTiltDeg: 4, eyeScaleY: 0.82, badgeColor: '#8E8E93', labelKey: 'mascot.p.offline.1' },
  quiet: { state: 'quiet', wingAngleDeg: 10, headTiltDeg: 6, eyeScaleY: 0.2, badgeColor: '#6E6E73', labelKey: 'mascot.p.quiet.1' },
};

type MascotController = ReturnType<typeof useMascot>;

const MascotCtx = createContext<MascotController | null>(null);

export function MascotProvider({
  children,
  options,
}: {
  children: React.ReactNode;
  options?: UseMascotOptions;
}) {
  const controller = useMascot(options);
  return <MascotCtx.Provider value={controller}>{children}</MascotCtx.Provider>;
}

export function useMascotStage(): MascotController {
  const ctx = useContext(MascotCtx);
  const fallback = useMascot();
  return ctx ?? fallback;
}

export function MascotStage({
  size = 96,
  interactive = true,
  hideFloatingBubble = false,
  style,
}: {
  size?: number;
  interactive?: boolean;
  hideFloatingBubble?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const stage = useMascotStage();
  return (
    <MasarMascot
      size={size}
      behavior={stage.behavior}
      speechText={stage.speech}
      interactive={interactive}
      hideFloatingBubble={hideFloatingBubble}
      onPress={stage.triggerTap}
      style={style}
    />
  );
}

export function MascotSvgFallback({
  state = 'idle',
  size = 88,
  style,
}: {
  state?: FatenBehaviorState;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const frame = FATEN_STATIC_FRAMES[state] ?? FATEN_STATIC_FRAMES.idle;
  return (
    <MasarMascot
      size={size}
      behavior={frame.state}
      speechText={tStatic(frame.labelKey)}
      interactive={false}
      hideFloatingBubble
      style={style}
    />
  );
}
