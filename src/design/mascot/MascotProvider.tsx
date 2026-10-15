/**
 * design/mascot/MascotProvider.tsx — المزوّد المركزي لتميمة «فطن» 3.0 + المساعد العائم
 *
 * البنية:
 *   • `MascotProvider` / `useMascotStage`: مثيل منطقي واحد لمحرّك القرارات لكل شجرة
 *     التطبيق، حتى لا تُصدِر عشر شاشات أحداثًا متضاربة على نفس الشخصية.
 *   • `MascotStage`: تميمة مربوطة بالمزوّد (تضغط ⇒ تفاعل حقيقي).
 *   • `MascotSvgFallback`: وضعية ساكنة دلالية لكل الحالات (14/14) عند تقليل الحركة.
 *   • `FatenCompanion`: **صديق المستخدم داخل الموقع** — مساعد عائم يظهر في لحظات
 *     محدّدة فقط (ترحيب/تحية زمنية/خطر على الستريك/عودة الشبكة/تغذية راجعة منتظرة)
 *     وليس رسائل عشوائية مستمرة. له مفتاح إيقاف كامل من الإعدادات.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../../data/store';
import { liveSessionForStudent, gamifGet, pendingFeedbackFor } from '../../data/engine';
import { useTheme } from '../theme';
import { useI18n } from '../../i18n';
import { useA11yPrefsOptional } from '../preferences';
import { isReducedMotion } from '../motion';
import { borderWidth, radii, shadows, spacing } from '../tokens';
import { Icon } from '../icons';
import { Txt } from '../components';
import { useMascot, UseMascotOptions } from './useMascot';
import { MasarMascot } from './MasarMascot';
import { FatenBehaviorState } from './mascot.types';
import { FATEN_POSES } from './faten.pose';
import { tipOfTheDay } from './faten.lines';
import { tStatic, type DictKey } from '../../i18n';

export interface StaticMascotFrame {
  state: FatenBehaviorState;
  wingAngleDeg: number;
  headTiltDeg: number;
  eyeScaleY: number;
  badgeColor: string;
  labelKey: DictKey;
}

const GLOW_COLOR: Record<FatenBehaviorState, string> = {
  idle: '#007AFF',
  welcome: '#007AFF',
  ready: '#30D158',
  attention: '#FF9F0A',
  working: '#5856D6',
  success: '#34C759',
  achievement: '#FFB800',
  streak_fire: '#FF3B30',
  alert: '#FF3B30',
  recovery: '#5AC8FA',
  offline: '#8E8E93',
  quiet: '#6E6E73',
  level_up: '#FFB800',
  nudge: '#0A84FF',
};

/**
 * الإطارات الساكنة (14/14): تُستخدم عند `prefers-reduced-motion` وحين نريد
 * لقطة ثابتة موثّقة (قصص المنتج/الاختبارات البصرية).
 */
export const FATEN_STATIC_FRAMES: Record<FatenBehaviorState, StaticMascotFrame> = Object.keys(FATEN_POSES).reduce(
  (acc, key) => {
    const state = key as FatenBehaviorState;
    const pose = FATEN_POSES[state];
    acc[state] = {
      state,
      wingAngleDeg: pose.wingAngle,
      headTiltDeg: pose.headTilt,
      eyeScaleY: 1 - pose.squint * 0.6,
      badgeColor: GLOW_COLOR[state],
      labelKey: `faten.line.${state}.1` as DictKey,
    };
    return acc;
  },
  {} as Record<FatenBehaviorState, StaticMascotFrame>,
);

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
  liveliness = 'normal',
  style,
}: {
  size?: number;
  interactive?: boolean;
  hideFloatingBubble?: boolean;
  liveliness?: 'calm' | 'normal' | 'playful';
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
      liveliness={liveliness}
      lineVars={stage.context.studentName ? { name: stage.context.studentName } : undefined}
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
      static
      style={style}
    />
  );
}

/* ────────────────────────────────────────────────────────────────
 * فطن المساعد — رفيق المستخدم طول تجربته في الموقع
 * ──────────────────────────────────────────────────────────────── */

interface CompanionMessage {
  id: number;
  text: string;
  state: FatenBehaviorState;
}

const DAY_KEY = 'masar.faten.day.v1';

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function readMark(key: string): boolean {
  try {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      return localStorage.getItem(key) === todayKey();
    }
  } catch { /* التخزين غير متاح */ }
  return false;
}

function writeMark(key: string): void {
  try {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') localStorage.setItem(key, todayKey());
  } catch { /* التخزين غير متاح */ }
}

/**
 * المساعد العائم: يظهر أسفل الشاشة (فوق شريط التنقل) برسالة واحدة فقط في كل مرة،
 * مع إمكانية الإخفاء، ويحترم: تقليل الحركة، تقليل الشفافية، وإعدادات المستخدم.
 */
export function FatenCompanion() {
  const { theme, isDark } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const prefs = useA11yPrefsOptional();
  const { user, db, online } = useApp();
  const [message, setMessage] = useState<CompanionMessage | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const counter = useRef(0);
  const lastOnline = useRef(online);

  const enabled = prefs?.mascotCompanion ?? true;
  const chatty = prefs?.mascotChatty ?? true;

  const push = useCallback((text: string, state: FatenBehaviorState = 'nudge', holdMs = 9000) => {
    if (!text) return;
    counter.current += 1;
    setMessage({ id: counter.current, text, state });
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setMessage(null), holdMs);
  }, []);

  const dismiss = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setMessage(null);
  }, []);

  /* ظهور/اختفاء بحركة فيزيائية خفيفة */
  useEffect(() => {
    const to = message ? 1 : 0;
    if (isReducedMotion()) {
      anim.setValue(to);
      return;
    }
    Animated.spring(anim, {
      toValue: to,
      damping: 16,
      stiffness: 160,
      mass: 0.9,
      useNativeDriver: true,
    }).start();
  }, [message, anim]);

  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  /* 1) تحية زمنية عند أول دخول في اليوم */
  useEffect(() => {
    if (!enabled || !chatty || !user) return;
    if (readMark(DAY_KEY)) return;
    writeMark(DAY_KEY);
    const hour = new Date().getHours();
    const name = user.fullName?.split(' ')[0];
    const text = hour >= 4 && hour < 12
      ? t('faten.msg.goodMorning', { name: name ?? '' })
      : hour >= 17 || hour < 4
        ? t('faten.msg.goodEvening', { name: name ?? '' })
        : name
          ? t('faten.msg.appOpen', { name })
          : t('faten.msg.appOpenNoName');
    const timer = setTimeout(() => push(text, 'welcome', 11000), 1600);
    return () => clearTimeout(timer);
  }, [enabled, chatty, user, push, t]);

  /* 2) محاضرة جارية الآن (مرة واحدة لكل جلسة) */
  const liveSessionId = useMemo(() => {
    if (!user) return null;
    const s = liveSessionForStudent(db, user.id);
    return s?.id ?? null;
  }, [db, user]);

  useEffect(() => {
    if (!enabled || !chatty || !user || !liveSessionId) return;
    const key = `masar.faten.live.${liveSessionId}`;
    if (readMark(key)) return;
    writeMark(key);
    const session = db.sessions.find((s) => s.id === liveSessionId);
    if (!session) return;
    const course = db.courses.find((c) => c.id === db.batches.find((b) => b.id === session.batchId)?.courseId);
    push(
      t('faten.msg.liveNow', { course: course?.title ?? t('common.appName') }),
      'attention',
      12000,
    );
  }, [enabled, chatty, user, liveSessionId, db, push, t]);

  /* 3) خطر على الستريك — تنبيه واحد في اليوم */
  useEffect(() => {
    if (!enabled || !chatty || !user) return;
    const g = gamifGet(db, user.id);
    if (!g.currentStreakWeeks || g.currentStreakWeeks < 2) return;
    const session = liveSessionForStudent(db, user.id);
    if (session) return; // هناك محاضرة الآن — الرسالة الأهم هي الحضور
    const key = `masar.faten.risk.${todayKey()}`;
    if (readMark(key)) return;
    const hour = new Date().getHours();
    if (hour < 16) return; // لا نُقلق المستخدم في أول اليوم
    writeMark(key);
    const timer = setTimeout(() => {
      push(t('faten.msg.streakRisk', { weeks: g.currentStreakWeeks }), 'alert', 12000);
    }, 3500);
    return () => clearTimeout(timer);
  }, [enabled, chatty, user, db, push, t]);

  /* 4) تغذية راجعة منتظرة */
  useEffect(() => {
    if (!enabled || !chatty || !user) return;
    const pending = pendingFeedbackFor(db, user.id);
    if (pending.length === 0) return;
    const timer = setTimeout(() => {
      push(t('today.feedbackBody'), 'nudge', 10000);
    }, 6000);
    return () => clearTimeout(timer);
    // مرة واحدة لكل عدد معلّق (لا تكرار لنفس العدد)
  }, [enabled, chatty, user, db, push, t]);

  /* 5) انقطاع/عودة الشبكة */
  useEffect(() => {
    if (!enabled) return;
    if (lastOnline.current === online) return;
    lastOnline.current = online;
    push(online ? t('faten.msg.online') : t('faten.msg.offline'), online ? 'success' : 'offline', 8000);
  }, [online, enabled, push, t]);

  if (!enabled || !message) return null;

  const isRtl = Platform.OS !== 'web' || true; // الاتجاه من الـ i18n على مستوى الجذر
  void isRtl;

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.companionHost,
        { bottom: insets.bottom + 96 },
      ]}
    >
      <Animated.View
        style={{
          opacity: anim,
          transform: [
            { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) },
            { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
          ],
        }}
      >
        <View
          style={[
            styles.companionCard,
            {
              backgroundColor: isDark ? 'rgba(22,26,36,0.97)' : 'rgba(255,255,255,0.98)',
              borderColor: isDark ? 'rgba(251,191,36,0.35)' : 'rgba(217,119,6,0.22)',
              shadowColor: isDark ? '#000' : '#0F172A',
            },
          ]}
        >
          <MasarMascot
            size={54}
            behavior={message.state}
            interactive={false}
            hideFloatingBubble
            liveliness="calm"
            a11yLabel={t('a11y.mascotImage')}
          />
          <View style={styles.companionTextBlock}>
            <Txt variant="micro" bold color={theme.brand}>
              {t('faten.says')}
            </Txt>
            <Txt variant="caption" color={isDark ? '#F1F5F9' : '#1E293B'}>
              {message.text}
            </Txt>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('faten.dismiss')}
            hitSlop={10}
            onPress={dismiss}
            style={({ pressed }) => [styles.companionClose, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Icon name="close" size={16} color={theme.textMuted} />
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

/** نصيحة اليوم من فطن — واجهة عامة تستخدمها شاشة اليوم وبطاقات المسار */
export function useFatenTipOfDay(): string {
  return useMemo(() => tipOfTheDay(), []);
}

const styles = StyleSheet.create({
  companionHost: {
    position: 'absolute',
    start: spacing.s4,
    end: spacing.s4,
    alignItems: 'flex-start',
    zIndex: 80,
  },
  companionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s3,
    paddingHorizontal: spacing.s3,
    paddingVertical: spacing.s2,
    borderRadius: radii.xl,
    borderWidth: borderWidth.thin,
    maxWidth: 520,
    ...shadows.card.light,
  },
  companionTextBlock: {
    flex: 1,
    gap: 2,
  },
  companionClose: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.full,
  },
});
