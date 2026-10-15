/**
 * design/mascot/MasarMascot.tsx — تميمة مسار التفاعلية («صقر مسار — فطن») 3.0
 *
 * ما الذي تغيّر عن 2.0 (وهو جوهر هذه النسخة):
 *  1. **رسم حقيقي للصقر** (FatenArt) — تشريح صقري: قرص وجهي، قبعة داكنة، شريط
 *     وجنة، منقار معقوف، عرف، أجنحة ثلاثية الطبقات، وذيل مروحي. (كان شكلًا رمزيًا.)
 *  2. **حالات وأمزجة بلا حدود**: 14 حالة، كل واحدة لها وضعية تشريحية كاملة
 *     (وضع العين، ميل الحاجب، فتح المنقار، رفع العرف، التوهج، الأكسسوار)
 *     — نفس مبدأ دوولينجو: تُقرأ المشاعر من الشخصية قبل النص.
 *  3. **أنيميشن بأربع طبقات**: تنفّس/طفو، ميل رأس طبيعي، رمش غير منتظم،
 *     رفرفة جناح بضربة واحدة عند تغيّر الحالة، وتفاعل لمسي (Squash & Stretch).
 *  4. **فقاعة حديث Apple-ية** بظهور فيزيائي (Spring) وذيل متجه للشخصية.
 *  5. **صفر نص عربي مضمّن**: كل جملة من القاموسين (تعريب كامل + RTL سليم).
 *  6. **أداء**: كل الحركات على `useNativeDriver` (عدا الرسم المُنفصل)، وإعادة رسم
 *     الرسم SVG تحدث فقط في اللحظات المنفصلة (رمش/رفرفة) لا في كل إطار.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  GestureResponderEvent,
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Txt } from '../components';
import { useTheme } from '../theme';
import { borderWidth, radii, shadows, spacing } from '../tokens';
import { isReducedMotion } from '../motion';
import { useI18n, type DictKey } from '../../i18n';
import { FatenBehaviorState } from './mascot.types';
import { mascotTokens } from './mascot.tokens';
import { FatenArt } from './FatenArt';
import { FATEN_DARK, FATEN_LIGHT } from './faten.palette';
import { FATEN_BASE_POSE, FatenEyeMode, FatenPose, poseOf } from './faten.pose';
import { pickFatenLine, tipOfTheDay } from './faten.lines';

export type MascotMode =
  | 'greeting'
  | 'streak_fire'
  | 'celebrating'
  | 'encouraging'
  | 'scanner'
  | 'idle'
  | 'happy'
  | 'celebrate'
  | 'sad'
  | 'thinking'
  | FatenBehaviorState;

export type MascotLiveliness = 'calm' | 'normal' | 'playful';

export interface MasarMascotProps {
  size?: number;
  mode?: MascotMode;
  behavior?: FatenBehaviorState;
  interactive?: boolean;
  /** نص حديث مفروض من الخارج (يتجاهل محرّك الجمل) */
  speechText?: string;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  onQuoteChange?: (quote: string) => void;
  hideFloatingBubble?: boolean;
  colorMode?: 'light' | 'dark';
  /** متغيّرات السياق المستخدمة في نص الجملة (الاسم/الستريك/الشارة…) */
  lineVars?: Record<string, string | number>;
  /** ترحيب تلقائي عند الظهور */
  autoGreet?: boolean;
  /** مستوى الحيوية — `calm` للشاشات الكثيفة */
  liveliness?: MascotLiveliness;
  /** موضع الفقاعة */
  bubblePlacement?: 'top' | 'bottom';
  /** أعلن الجملة لقارئ الشاشة (يُستحسن في اللحظات المهمة فقط) */
  announceSpeech?: boolean;
  /** تركيب الوضعية الثابتة فقط (بلا أي حركة) */
  static?: boolean;
  a11yLabel?: string;
}

function normalizeToBehavior(input?: MascotMode | FatenBehaviorState): FatenBehaviorState {
  switch (input) {
    case 'greeting':
    case 'welcome':
      return 'welcome';
    case 'celebrating':
    case 'celebrate':
    case 'achievement':
      return 'achievement';
    case 'happy':
    case 'success':
      return 'success';
    case 'encouraging':
    case 'sad':
    case 'recovery':
      return 'recovery';
    case 'thinking':
    case 'working':
      return 'working';
    case 'streak_fire':
      return 'streak_fire';
    case 'attention':
      return 'attention';
    case 'alert':
      return 'alert';
    case 'ready':
      return 'ready';
    case 'offline':
      return 'offline';
    case 'quiet':
      return 'quiet';
    case 'level_up':
      return 'level_up';
    case 'nudge':
      return 'nudge';
    default:
      return 'idle';
  }
}

/** ثواني الرمش بحسب الحيوية — فطن لا يرمش كالآلة */
const BLINK_RANGE: Record<MascotLiveliness, [number, number]> = {
  calm: [4200, 7600],
  normal: [3200, 6200],
  playful: [2400, 4600],
};

const LOOK_RANGE: Record<MascotLiveliness, [number, number]> = {
  calm: [12000, 20000],
  normal: [8000, 15000],
  playful: [5200, 10000],
};

/** الجملة الافتراضية للحالة (تُختار من محرّك الحديث) */
export function getRandomMascotQuote(
  behavior: FatenBehaviorState = 'idle',
  vars: Record<string, string | number> = {},
): string {
  return pickFatenLine(behavior, vars as never, { avoidContextVars: true });
}

export function MasarMascot({
  size = 110,
  mode,
  behavior,
  interactive = false,
  speechText,
  style,
  onPress,
  onQuoteChange,
  hideFloatingBubble = false,
  colorMode = 'light',
  lineVars,
  autoGreet = false,
  liveliness = 'normal',
  bubblePlacement = 'top',
  announceSpeech = false,
  static: staticRendering = false,
  a11yLabel,
}: MasarMascotProps) {
  const { t } = useI18n();
  const { isDark } = useTheme();
  const activeBehavior = normalizeToBehavior(behavior || mode);
  const reduced = isReducedMotion() || staticRendering;
  const level = reduced ? 'calm' : liveliness;

  const palette = isDark || colorMode === 'dark' ? FATEN_DARK : FATEN_LIGHT;

  const [speech, setSpeech] = useState('');
  const [showSpeech, setShowSpeech] = useState(false);
  const [blinkFrames, setBlinkFrames] = useState<FatenEyeMode | null>(null);
  const [flapBoost, setFlapBoost] = useState(0);
  const [lookOffset, setLookOffset] = useState(0);

  const bubbleAnim = useRef(new Animated.Value(0)).current;
  const floatAnim = useRef(new Animated.Value(0)).current;
  const tiltAnim = useRef(new Animated.Value(0)).current;
  const tapScale = useRef(new Animated.Value(1)).current;
  const bounceAnim = useRef(new Animated.Value(0)).current;
  const shiverAnim = useRef(new Animated.Value(0)).current;
  const speechTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lookTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  const pose = poseOf(activeBehavior);
  const effectivePose: FatenPose = useMemo(() => {
    if (flapBoost === 0 && lookOffset === 0) return pose;
    return {
      ...pose,
      wingAngle: pose.wingAngle + flapBoost,
      tailWag: pose.tailWag + (flapBoost < 0 ? -2 : 2),
      headTilt: pose.headTilt + lookOffset,
    };
  }, [pose, flapBoost, lookOffset]);

  /* ── الطبقة 1: تنفّس وطفو هادئ (Native Driver) ── */
  useEffect(() => {
    if (reduced) {
      floatAnim.setValue(0);
      return undefined;
    }
    const duration = level === 'playful' ? 1700 : level === 'calm' ? 2600 : 2100;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, { toValue: -4.5, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(floatAnim, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [floatAnim, reduced, level]);

  /* ── الطبقة 2: ميل الرأس الطبيعي (كما تفعل الصقور الحقيقية) ── */
  useEffect(() => {
    if (reduced) {
      tiltAnim.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(tiltAnim, { toValue: 1, duration: 2900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(tiltAnim, { toValue: -1, duration: 3100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(tiltAnim, { toValue: 0, duration: 2100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [tiltAnim, reduced]);

  /* ── الطبقة 3: رمش غير منتظم + نظرات حوالين (Living Character) ── */
  useEffect(() => {
    if (reduced) return undefined;
    const [min, max] = BLINK_RANGE[level];
    const schedule = () => {
      const delay = min + Math.random() * (max - min);
      blinkTimer.current = setTimeout(() => {
        if (!mounted.current) return;
        setBlinkFrames('squint');
        setTimeout(() => {
          if (!mounted.current) return;
          setBlinkFrames('closed');
          setTimeout(() => {
            if (!mounted.current) return;
            setBlinkFrames(null);
            schedule();
          }, 90);
        }, 70);
      }, delay);
    };
    schedule();
    return () => {
      if (blinkTimer.current) clearTimeout(blinkTimer.current);
    };
  }, [reduced, level]);

  useEffect(() => {
    if (reduced) return undefined;
    const [min, max] = LOOK_RANGE[level];
    const schedule = () => {
      lookTimer.current = setTimeout(() => {
        if (!mounted.current) return;
        setLookOffset(Math.random() > 0.5 ? 3 : -3);
        setTimeout(() => {
          if (mounted.current) setLookOffset(0);
          schedule();
        }, 1400);
      }, min + Math.random() * (max - min));
    };
    schedule();
    return () => {
      if (lookTimer.current) clearTimeout(lookTimer.current);
    };
  }, [reduced, level]);

  /* ── الطبقة 4: رفرفة/ضربة واحدة عند تغيّر الحالة + قفزة الاحتفال ── */
  useEffect(() => {
    if (reduced) return undefined;
    const celebratory = activeBehavior === 'achievement' || activeBehavior === 'success'
      || activeBehavior === 'level_up' || activeBehavior === 'streak_fire';
    const boost = celebratory ? -14 : activeBehavior === 'welcome' || activeBehavior === 'attention' ? -10 : -6;
    setFlapBoost(boost);
    const timer = setTimeout(() => {
      if (mounted.current) setFlapBoost(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [activeBehavior, reduced]);

  useEffect(() => {
    if (reduced) return undefined;
    if (activeBehavior === 'achievement' || activeBehavior === 'level_up' || activeBehavior === 'success') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(bounceAnim, { toValue: -8, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(bounceAnim, { toValue: 0, duration: 340, easing: Easing.bounce, useNativeDriver: true }),
          Animated.delay(1200),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    bounceAnim.setValue(0);
    return undefined;
  }, [activeBehavior, bounceAnim, reduced]);

  useEffect(() => {
    if (reduced) {
      shiverAnim.setValue(0);
      return undefined;
    }
    if (activeBehavior === 'working') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(shiverAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
          Animated.timing(shiverAnim, { toValue: -1, duration: 220, useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    shiverAnim.setValue(0);
    return undefined;
  }, [activeBehavior, shiverAnim, reduced]);

  /* ── فقاعة الحديث: ظهور فيزيائي + إخفاء تلقائي ── */
  const speak = useCallback((text: string, holdMs = 4200) => {
    if (!text) return;
    setSpeech(text);
    setShowSpeech(true);
    onQuoteChange?.(text);
    if (reduced) {
      bubbleAnim.setValue(1);
    } else {
      bubbleAnim.setValue(0);
      Animated.spring(bubbleAnim, {
        toValue: 1,
        damping: 13,
        stiffness: 190,
        mass: 0.7,
        useNativeDriver: true,
      }).start();
    }
    if (speechTimer.current) clearTimeout(speechTimer.current);
    speechTimer.current = setTimeout(() => {
      if (!mounted.current) return;
      if (reduced) {
        setShowSpeech(false);
        bubbleAnim.setValue(0);
        return;
      }
      Animated.timing(bubbleAnim, { toValue: 0, duration: 220, useNativeDriver: true })
        .start(() => { if (mounted.current) setShowSpeech(false); });
    }, holdMs);
  }, [bubbleAnim, onQuoteChange, reduced]);

  /* تنظيف كل المؤقتات عند التفكيك */
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (speechTimer.current) clearTimeout(speechTimer.current);
      if (blinkTimer.current) clearTimeout(blinkTimer.current);
      if (lookTimer.current) clearTimeout(lookTimer.current);
    };
  }, []);

  /* نص مفروض من الخارج */
  const externalSpeech = speechText;
  const lastExternal = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (externalSpeech && externalSpeech !== lastExternal.current) {
      lastExternal.current = externalSpeech;
      speak(externalSpeech, 5200);
    }
    if (!externalSpeech) lastExternal.current = undefined;
  }, [externalSpeech, speak]);

  /* ترحيب/نصيحة تلقائية عند الظهور */
  useEffect(() => {
    if (!autoGreet || hideFloatingBubble || speechText) return undefined;
    const timer = setTimeout(() => {
      const tip = activeBehavior === 'nudge' || activeBehavior === 'idle'
        ? tipOfTheDay()
        : pickFatenLine(activeBehavior, lineVars as never);
      speak(tip || pickFatenLine(activeBehavior, lineVars as never), 5600);
    }, 700);
    return () => clearTimeout(timer);
    // يعمل مرة واحدة لكل جلسة ظهور
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGreet, hideFloatingBubble]);

  const handlePress = useCallback((_event?: GestureResponderEvent) => {
    onPress?.();
    if (!interactive && !onPress && !onQuoteChange) return;

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } catch { /* الاهتزاز غير متاح على الويب */ }

    if (!reduced) {
      Animated.sequence([
        Animated.timing(tapScale, { toValue: mascotTokens.physics.tapSquashScale, duration: 80, useNativeDriver: true }),
        Animated.spring(tapScale, { toValue: 1, friction: 4, tension: 170, useNativeDriver: true }),
      ]).start();
      setFlapBoost(pose.wingAngle - 26);
      setTimeout(() => { if (mounted.current) setFlapBoost(0); }, 420);
    }

    const line = speechText
      ?? (activeBehavior === 'idle'
        ? tipOfTheDay()
        : pickFatenLine(activeBehavior, lineVars as never, { avoidContextVars: true }))
      ?? getRandomMascotQuote(activeBehavior);
    if (line) speak(line, 5200);
  }, [activeBehavior, interactive, lineVars, onPress, onQuoteChange, pose.wingAngle, reduced, speak, speechText, tapScale]);

  const isQuiet = activeBehavior === 'quiet';
  const effectiveSize = isQuiet ? size * 0.82 : size;

  const transform = reduced
    ? [{ scale: tapScale }]
    : [
        { translateY: Animated.add(floatAnim, bounceAnim) },
        { translateX: shiverAnim.interpolate({ inputRange: [-1, 1], outputRange: [-0.8, 0.8] }) },
        { scale: tapScale },
        { rotate: tiltAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-2.4deg', '0deg', '2.4deg'] }) },
      ];

  const art = (
    <Animated.View style={{ transform }}>
      <FatenArt
        size={effectiveSize}
        pose={effectivePose}
        palette={palette}
        eyeMode={blinkFrames ?? undefined}
      />
    </Animated.View>
  );

  const bubbleVisible = showSpeech && !hideFloatingBubble && Boolean(speech);
  const bubble = bubbleVisible ? (
    <Animated.View
      style={[
        styles.bubble,
        bubblePlacement === 'top' ? styles.bubbleTop : styles.bubbleBottom,
        {
          backgroundColor: isDark ? 'rgba(24,28,38,0.96)' : 'rgba(255,255,255,0.98)',
          borderColor: isDark ? 'rgba(251,191,36,0.4)' : 'rgba(217,119,6,0.28)',
          shadowColor: isDark ? '#000' : '#0F172A',
          opacity: bubbleAnim,
          transform: [
            { translateY: bubbleAnim.interpolate({ inputRange: [0, 1], outputRange: bubblePlacement === 'top' ? [10, 0] : [-10, 0] }) },
            { scale: bubbleAnim.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) },
          ],
        },
      ]}
    >
      <Txt
        variant="caption"
        color={isDark ? '#F8FAFC' : '#1E293B'}
        align="center"
        style={styles.bubbleText}
      >
        {speech}
      </Txt>
      <View
        pointerEvents="none"
        style={[
          styles.bubbleTail,
          bubblePlacement === 'top' ? styles.tailDown : styles.tailUp,
          { borderTopColor: isDark ? 'rgba(24,28,38,0.96)' : 'rgba(255,255,255,0.98)',
            borderBottomColor: isDark ? 'rgba(24,28,38,0.96)' : 'rgba(255,255,255,0.98)' },
        ]}
      />
    </Animated.View>
  ) : null;

  const label = a11yLabel ?? t('a11y.mascotImage');
  const hint = interactive ? t('a11y.mascotInteract') : undefined;

  if (interactive || onPress) {
    return (
      <View style={[styles.wrapper, style]}>
        {bubble}
        <Pressable
          accessibilityRole="imagebutton"
          accessibilityLabel={label}
          accessibilityHint={hint}
          onPress={handlePress}
          style={styles.pressable}
        >
          {art}
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.wrapper, style]} accessible accessibilityRole="image" accessibilityLabel={label}>
      {bubble}
      {art}
    </View>
  );
}

export default React.memo(MasarMascot);

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  pressable: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubble: {
    position: 'absolute',
    paddingHorizontal: spacing.s4,
    paddingVertical: spacing.s3,
    borderRadius: radii.xl,
    borderWidth: borderWidth.thin,
    zIndex: 40,
    maxWidth: 250,
    minWidth: 120,
    ...shadows.sheet,
  },
  bubbleTop: {
    bottom: '100%',
    marginBottom: spacing.s2,
  },
  bubbleBottom: {
    top: '100%',
    marginTop: spacing.s2,
  },
  bubbleText: {
    lineHeight: 20,
  },
  bubbleTail: {
    position: 'absolute',
    alignSelf: 'center',
    width: 0,
    height: 0,
    borderStartWidth: 7,
    borderEndWidth: 7,
    borderStartColor: 'transparent',
    borderEndColor: 'transparent',
  },
  tailDown: {
    bottom: -7,
    borderTopWidth: 8,
  },
  tailUp: {
    top: -7,
    borderBottomWidth: 8,
  },
});

/** معرّف سريع للمفاتيح المطلوبة خارجيًا (يُستخدم في الاختبارات والتوثيق) */
export type FatenLineKey = DictKey;
