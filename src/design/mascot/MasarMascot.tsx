/**
 * design/mascot/MasarMascot.tsx — تميمة مسار التفاعلية («صقر مسار - فطن») 2.0
 * منظومة السلوك الحركي الهادئ الموحد لعام 2026
 * - تنفس فيزيائي متباعد (4200ms)
 * - إيماءات ذات ضربة واحدة (One-Shot Gestures) بدون حلقات رفرفة لانهائية
 * - خلو تام من تداخل الـ Pressables والـ Double Haptics
 * - تنظيف آمن للمؤقتات (clearTimeout)
 */
import React, { useEffect, useRef, useState } from 'react';
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
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  Polygon,
  Stop,
} from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { Txt } from '../components';
import { radii, spacing } from '../tokens';
import { isReducedMotion } from '../motion';
import { FatenBehaviorState } from './mascot.types';
import { mascotTokens } from './mascot.tokens';

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

export interface MasarMascotProps {
  size?: number;
  mode?: MascotMode;
  behavior?: FatenBehaviorState;
  interactive?: boolean;
  speechText?: string;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  onQuoteChange?: (quote: string) => void;
  hideFloatingBubble?: boolean;
  colorMode?: 'light' | 'dark';
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
    default:
      return 'idle';
  }
}

const CHEERFUL_PHRASES: Record<FatenBehaviorState, string[]> = {
  welcome: [
    '«إنما العلم بالتعلم، وإنما الحلم بالتحلم» — النبي محمد ﷺ',
    '«من سلك طريقاً يلتمس فيه علماً سهّل الله له به طريقاً إلى الجنة» — النبي محمد ﷺ',
    '«سر المضي قدماً هو البدء» — مارك توين',
    '«ابدأ حيث أنت، استخدم ما تملك، وافعل ما تستطيع» — آرثر آش',
    '«العالم كتاب، ومن لا يتعلم لا يقرأ منه سوى صفحة واحدة» — القديس أوغسطينوس',
    '«كل صباح يولد أمل جديد وفرصة لبناء مسارك» — رالف والدو إمرسون',
    '«اطلبوا العلم من المهد إلى اللحد» — أثر عربي أصيل',
    'أهلاً بك يا بطل في مسار! جاهز لإنجاز اليوم؟ 🚀',
  ],
  streak_fire: [
    '«على قدر أهل العزم تأتي العزائم، وتأتي على قدر الكرام المكارم» — المتنبي',
    '«التدريب يصنع الأبطال، والانضباط يجعلهم أساطير» — محمد علي كلاي',
    '«الالتزام اليومي البسيط يولد نتائج مذهلة مع مرور الأيام» — جيمس كلير',
    '«وما نيل المطالب بالتمني، ولكن تؤخذ الدنيا غلاباً» — أحمد شوقي',
    '«الاستمرارية تثقب الصخر.. التزامك يصنع المعجزات» — حكمة عربية',
    '«قوة الإرادة هي الفرق الحقيقي بين النجاح والتميز» — ابن خلدون',
    '«المثابرة سر كل عظمة في التاريخ» — سامويل جونسون',
    'الستريك مشتعل! استمرارك يصنع الفارق 🛡️🔥',
  ],
  achievement: [
    '«إذا غامَرْتَ في شَرَفٍ مَرُومِ، فَلا تَقنَعْ بما دونَ النّجومِ» — المتنبي',
    '«التعليم هو أقوى سلاح يمكنك استخدامه لتغيير العالم» — نيلسون مانديلا',
    '«النجاح ليس صدفة، بل هو تعلّم وتضحية وحب لما تصنعه» — بيليه',
    '«كل إنجاز عظيم كان في بدايته مجرد قرار بالمحاولة» — غاندي',
    '«قيمة كل امرئ ما يحسنه ويتقنه» — الإمام علي بن أبي طالب',
    '«المستقبل ينتمي لأولئك الذين يؤمنون بجمال أحلامهم» — إليانور روزفلت',
    '«من جدّ وجد، ومن زرع حصد» — مثل عربي أصيل',
    'مبروووك! إنجاز يستحق الفخر.. أنت أسطورة مسار اليوم! 🌟🏆',
  ],
  success: [
    '«العلم كالشجرة، وثمرته العمل والالتزام» — الإمام الغزالي',
    '«لا تخف من التقدم ببطء، بل خف فقط من الوقوف ساكناً» — حكمة صينية',
    '«أحسنت صنعاً! حضورك اليوم لبنة جديدة في قصر نجاحك» — مثل عربي',
    '«لا تحقرن من المعروف شيئاً، كل خطوة تدريب تقربك لقمة هدفك» — النبي محمد ﷺ',
    '«الجهد المتواصل — وليس الذكاء أو القوة — هو مفتاح إطلاق طاقاتنا» — ونستون تشرشل',
    'تم توثيق حضورك وحفظ نقاطك بأمان في مسار! 🦅✨',
  ],
  recovery: [
    '«السقوط ليس فشلاً، الفشل أن تبقى حيث سقطت» — سقراط',
    '«إن مع العسر يسراً.. لا بأس، غداً بداية أقوى بإذن الله» — القرآن الكريم',
    '«النجاح هو الانتقال من تعثر إلى تعثر دون فقدان الحماس» — ونستون تشرشل',
    '«ما لا يكسرك يجعلك أقوى وأكثر حكمة» — فريدريك نيتشه',
    '«احرص على ما ينفعك، واستعن بالله ولا تعجز» — النبي محمد ﷺ',
    '«العقبات هي تلك الأشياء المخيفة التي تراها عندما تصرف عينيك عن هدفك» — هنري فورد',
    '«لا يكلف الله نفساً إلا وسعها.. استعد للجلسة القادمة بقلب واثق» — القرآن الكريم',
    'عثرة اليوم بداية قفزة الغد! فطن معك خطوة بخطوة 💚',
  ],
  attention: [
    '«الوقت كالسيف، إن لم تقطعه قطعك» — الإمام الشافعي',
    '«من لم يذق مرّ التعلم ساعةً، تجرّع ذلّ الجهل طول حياته» — الإمام الشافعي',
    '«أفضل وقت لغرس شجرة كان قبل عشرين عاماً، والوقت الثاني الأفضل هو الآن» — حكمة مأثورة',
    'المحاضرة بدأت الآن في القاعة! سجّل حضورك وثبّت نقاطك ⚡🎯',
  ],
  working: [
    '«إن الله يحب إذا عمل أحدكم عملاً أن يتقنه» — النبي محمد ﷺ',
    '«التدقيق والتوثيق أساس الأمان والإتقان» — مثل عربي',
    'أتحقق من البيانات والأمان.. نوثق حضورك بأمان 🔍⏳',
  ],
  ready: [
    '«لا تتمنّ أن تكون الأمور أسهل، بل تمنّ أن تكون أنت أفضل» — جيم رون',
    '«الطريق إلى التميز يبدأ بقرار الحضور والانتباه» — أرسطو',
    '«العلم نور يضيء لك دروب المستقبل والعمل» — ابن القيم',
    '«تفاءلوا بالخير تجدوه.. استعد لمحاضرة ممتعة اليوم» — أثر عربي',
    'مستعد للمحاضرة؟ جهّز أدواتك واشحذ همتك! 🎯✨',
  ],
  alert: [
    '«التفريط في البدايات يورث الحسرة في النهايات» — ابن الجوزي',
    '«استثمر ساعتك الحالية، فالأيام تمضي سراعاً» — الحسن البصري',
    'سلسلة التزامك في خطر! بادر بتوثيق حضورك اليوم 🔥⏱️',
  ],
  offline: [
    '«العلم في الصدور لا في السطور.. بياناتك في أمان تام» — أثر عربي',
    'بياناتك محفوظة محلياً بدون إنترنت، وسنرفعها فور عودة الشبكة 💾🌐',
  ],
  quiet: [
    '«مسار.. معاً نصنع قادة الغد ورواد التدريب» — مسار 🦅',
    '«من أراد العلا سهر الليالي وجدّ واجتهد» — الإمام الشافعي',
  ],
  idle: [
    '«أنا لست عبقرياً، لكني فضولي وشغوف ومثابر بشكل دائم» — ألبرت أينشتاين',
    '«ليس اليتيم من مات والده، إن اليتيم يتيم العلم والأدب» — الإمام علي بن أبي طالب',
    '«العلم يبني بيوتاً لا عماد لها، والجهل يهدم بيت العز والشرف» — أحمد شوقي',
    '«الشغف هو الطاقة؛ اشعر بالقوة التي تأتي من تركيزك على ما يثير حماسك» — أوبرا وينفري',
    '«إذا أردت أن تعيش حياة سعيدة فاربطها بهدف نبيل» — ألبرت أينشتاين',
    '«لا تحكم على يومك بما تحصده، بل بما تزرعه من علم وسعي» — روبرت ستيفنسون',
    '«الموهبة تمنحك البداية، لكن الانضباط والمثابرة هما ما يوصلك للنهاية» — مايكل جوردان',
    'معاً نحو قمة التدريب والإنجاز! خطوة بخطوة نحو التميز 🦅✨',
  ],
};

export function getRandomMascotQuote(behavior: FatenBehaviorState = 'idle'): string {
  const list = CHEERFUL_PHRASES[behavior] || CHEERFUL_PHRASES.idle;
  return list[Math.floor(Math.random() * list.length)];
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
}: MasarMascotProps) {
  const activeBehavior: FatenBehaviorState = normalizeToBehavior(behavior || mode);
  const isScannerMode = mode === 'scanner';

  const [showSpeech, setShowSpeech] = useState(false);
  const [currentPhrase, setCurrentPhrase] = useState('');

  // مراجع آمنة للمؤقتات
  const speechTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null);

  // حركات التميمة الفيزيائية والحركية الغنية
  const floatAnim = useRef(new Animated.Value(0)).current;
  const blinkAnim = useRef(new Animated.Value(1)).current;
  const tapScale = useRef(new Animated.Value(1)).current;
  const speechOpacity = useRef(new Animated.Value(0)).current;
  const flamePulse = useRef(new Animated.Value(1)).current;
  const gestureAnim = useRef(new Animated.Value(0)).current;
  const headTiltAnim = useRef(new Animated.Value(0)).current;
  const bounceAnim = useRef(new Animated.Value(0)).current;
  const sparkleAnim = useRef(new Animated.Value(0)).current;

  // 1. حركة الطفو والتنفس الدورية الهادئة (4200ms Calm Breathing)
  useEffect(() => {
    if (isReducedMotion()) return;

    const floatLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, {
          toValue: -4.5,
          duration: 2100,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(floatAnim, {
          toValue: 0,
          duration: 2100,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    floatLoop.start();
    return () => floatLoop.stop();
  }, [floatAnim]);

  // 2. حركة ميلان الرأس الطبيعية (Companion Falcon Head Tilt)
  useEffect(() => {
    if (isReducedMotion()) return;

    const tiltLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(headTiltAnim, {
          toValue: 1,
          duration: 3000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(headTiltAnim, {
          toValue: -1,
          duration: 3200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(headTiltAnim, {
          toValue: 0,
          duration: 2200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    tiltLoop.start();
    return () => tiltLoop.stop();
  }, [headTiltAnim]);

  // 3. قفزة الاحتفال والشرارات وقت الإنجاز (Celebration Bounce & Sparkles)
  useEffect(() => {
    if (isReducedMotion()) return;

    if (activeBehavior === 'achievement' || activeBehavior === 'success') {
      const celebrationLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(bounceAnim, {
            toValue: -7,
            duration: 340,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(bounceAnim, {
            toValue: 0,
            duration: 340,
            easing: Easing.bounce,
            useNativeDriver: true,
          }),
          Animated.delay(1400),
        ]),
      );
      celebrationLoop.start();

      const sparkleLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(sparkleAnim, {
            toValue: 1,
            duration: 550,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(sparkleAnim, {
            toValue: 0.25,
            duration: 550,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      );
      sparkleLoop.start();

      return () => {
        celebrationLoop.stop();
        sparkleLoop.stop();
      };
    } else {
      bounceAnim.setValue(0);
      sparkleAnim.setValue(0);
    }
  }, [activeBehavior, bounceAnim, sparkleAnim]);

  // 4. حركة رمش العينين الطبيعية كل ~4.5 ثوانٍ
  useEffect(() => {
    if (isReducedMotion()) return;

    const interval = setInterval(() => {
      Animated.sequence([
        Animated.timing(blinkAnim, {
          toValue: 0.1,
          duration: 110,
          useNativeDriver: true,
        }),
        Animated.timing(blinkAnim, {
          toValue: 1,
          duration: 130,
          useNativeDriver: true,
        }),
      ]).start();
    }, 4500);

    return () => clearInterval(interval);
  }, [blinkAnim]);

  // 5. حركة الستريك النارية الهادئة
  useEffect(() => {
    if (isReducedMotion()) return;

    if (activeBehavior === 'streak_fire') {
      const flameLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(flamePulse, {
            toValue: 1.1,
            duration: 800,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(flamePulse, {
            toValue: 0.95,
            duration: 800,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      );
      flameLoop.start();
      return () => flameLoop.stop();
    }
  }, [activeBehavior, flamePulse]);

  // 6. إيماءة لمرة واحدة (One-Shot Gesture) عند تغيير الوضعية أو حدوث تفاعل
  useEffect(() => {
    if (isReducedMotion()) return;

    if (
      activeBehavior === 'welcome' ||
      activeBehavior === 'achievement' ||
      activeBehavior === 'attention' ||
      activeBehavior === 'success'
    ) {
      Animated.sequence([
        Animated.spring(gestureAnim, {
          toValue: 1,
          friction: 5,
          tension: 100,
          useNativeDriver: true,
        }),
        Animated.timing(gestureAnim, {
          toValue: 0,
          duration: 600,
          delay: 400,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [activeBehavior, gestureAnim]);

  // تنظيف كافة المؤقتات عند التدمير
  useEffect(() => {
    return () => {
      if (speechTimerRef.current) clearTimeout(speechTimerRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  // التفاعل عند النقر
  const handlePress = (e?: GestureResponderEvent) => {
    if (onPress) onPress();
    if (!interactive && !onQuoteChange) return;

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}

    Animated.sequence([
      Animated.timing(tapScale, {
        toValue: mascotTokens.physics.tapSquashScale,
        duration: 80,
        useNativeDriver: true,
      }),
      Animated.spring(tapScale, {
        toValue: 1,
        friction: 4,
        tension: 160,
        useNativeDriver: true,
      }),
    ]).start();

    Animated.sequence([
      Animated.timing(gestureAnim, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(gestureAnim, {
        toValue: 0,
        duration: 350,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();

    const list = CHEERFUL_PHRASES[activeBehavior] || CHEERFUL_PHRASES.idle;
    const picked = speechText || list[Math.floor(Math.random() * list.length)];
    setCurrentPhrase(picked);

    if (onQuoteChange) onQuoteChange(picked);

    if (!hideFloatingBubble) {
      if (speechTimerRef.current) clearTimeout(speechTimerRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);

      setShowSpeech(true);
      Animated.timing(speechOpacity, {
        toValue: 1,
        duration: mascotTokens.physics.reactionFadeDurationMs,
        useNativeDriver: true,
      }).start();

      speechTimerRef.current = setTimeout(() => {
        Animated.timing(speechOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start(() => {
          setShowSpeech(false);
        });
      }, 3000);
    }
  };

  const isQuiet = activeBehavior === 'quiet';
  const effectiveSize = isQuiet ? size * 0.75 : size;

  const mascotContent = (
    <Animated.View
      style={{
        transform: [
          { translateY: isQuiet ? 0 : Animated.add(floatAnim, bounceAnim) },
          { scale: tapScale },
          {
            rotate: headTiltAnim.interpolate({
              inputRange: [-1, 0, 1],
              outputRange: ['-2.5deg', '0deg', '2.5deg'],
            }),
          },
        ],
      }}
    >
      <Svg width={effectiveSize} height={effectiveSize * 1.1} viewBox="0 0 160 176" fill="none">
        <Defs>
          <LinearGradient id="falconBodyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#007AFF" />
            <Stop offset="60%" stopColor="#0055D4" />
            <Stop offset="100%" stopColor="#1E3A8A" />
          </LinearGradient>
          <LinearGradient id="falconChestGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0%" stopColor="#FFFFFF" />
            <Stop offset="100%" stopColor="#E0F2FE" />
          </LinearGradient>
          <LinearGradient id="falconBeakGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#FBBF24" />
            <Stop offset="100%" stopColor="#F59E0B" />
          </LinearGradient>
          <LinearGradient id="flameGrad" x1="0%" y1="100%" x2="0%" y2="0%">
            <Stop offset="0%" stopColor="#EF4444" />
            <Stop offset="50%" stopColor="#F97316" />
            <Stop offset="100%" stopColor="#FBBF24" />
          </LinearGradient>
          <LinearGradient id="goldMedalGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#FDE047" />
            <Stop offset="50%" stopColor="#F59E0B" />
            <Stop offset="100%" stopColor="#D97706" />
          </LinearGradient>
        </Defs>

        {/* وضعية النيران المحيطة */}
        {activeBehavior === 'streak_fire' && (
          <G opacity={0.88}>
            <Path
              d="M40 85 C20 60 30 30 50 45 C45 20 70 10 80 30 C90 10 115 20 110 45 C130 30 140 60 120 85 C135 110 115 130 100 120 C90 145 70 145 60 120 C45 130 25 110 40 85 Z"
              fill="url(#flameGrad)"
              opacity={0.35}
            />
            <Path
              d="M50 85 C35 65 45 40 60 52 C58 35 75 25 80 40 C85 25 102 35 100 52 C115 40 125 65 110 85 C120 105 105 118 95 112 C88 128 72 128 65 112 C55 118 40 105 50 85 Z"
              fill="url(#flameGrad)"
              opacity={0.65}
            />
          </G>
        )}

        {/* ظل ناعم */}
        <Ellipse cx="80" cy="168" rx="42" ry="7" fill="rgba(15, 23, 42, 0.12)" />

        {/* أرجل الصقر الذهبية */}
        <G fill="#F59E0B">
          <Path d="M62 148 L62 165 M54 165 L70 165" stroke="#F59E0B" strokeWidth="4.5" strokeLinecap="round" />
          <Path d="M98 148 L98 165 M90 165 L106 165" stroke="#F59E0B" strokeWidth="4.5" strokeLinecap="round" />
        </G>

        {/* جسم الصقر الرئيسي */}
        <Path
          d="M80 30 C45 30 34 56 34 96 C34 135 52 154 80 154 C108 154 126 135 126 96 C126 56 115 30 80 30 Z"
          fill="url(#falconBodyGrad)"
        />

        {/* عرف الصقر الأنيق */}
        <Path
          d="M74 30 C76 12 84 10 88 18 C92 10 100 12 96 30 Z"
          fill={activeBehavior === 'alert' ? '#EA580C' : '#0055D4'}
        />

        {/* صدر الصقر الأبيض */}
        <Path
          d="M80 72 C62 72 52 88 52 118 C52 142 64 150 80 150 C96 150 108 142 108 118 C108 88 98 72 80 72 Z"
          fill="url(#falconChestGrad)"
        />

        {/* ريشات الصدر */}
        <Path d="M72 98 L80 106 L88 98" stroke="#93C5FD" strokeWidth="2.5" strokeLinecap="round" />
        <Path d="M68 116 L80 126 L92 116" stroke="#93C5FD" strokeWidth="2.5" strokeLinecap="round" />

        {/* الجناح الأيسر */}
        <Path
          d="M36 84 C28 96 26 122 42 136 C46 128 48 114 46 98 Z"
          fill="#0055D4"
        />

        {/* الجناح الأيمن */}
        {activeBehavior === 'welcome' ? (
          <Path
            d="M124 84 C138 72 152 74 150 92 C146 106 134 116 118 110 Z"
            fill="#0055D4"
          />
        ) : activeBehavior === 'attention' ? (
          <Path
            d="M124 90 C138 98 148 114 142 126 C136 132 124 126 118 114 Z"
            fill="#0055D4"
          />
        ) : activeBehavior === 'recovery' ? (
          <G>
            <Path
              d="M124 90 C140 82 146 94 138 106 C132 114 122 116 116 108 Z"
              fill="#0055D4"
            />
            <Path d="M142 84 L142 94" stroke="#F59E0B" strokeWidth="4" strokeLinecap="round" />
          </G>
        ) : activeBehavior === 'achievement' ? (
          <Path
            d="M124 80 C140 60 154 62 146 82 C138 98 126 108 116 98 Z"
            fill="#0055D4"
          />
        ) : (
          <Path
            d="M124 84 C132 96 134 122 118 136 C114 128 112 114 114 98 Z"
            fill="#0055D4"
          />
        )}

        {/* نجوم وشرارات الاحتفال والتميز الذهبية */}
        {(activeBehavior === 'achievement' || activeBehavior === 'streak_fire' || activeBehavior === 'success') && (
          <G opacity={0.95}>
            {/* نجمة علوية يمنى */}
            <Polygon points="138,32 140,39 147,41 140,43 138,50 136,43 129,41 136,39" fill="#FBBF24" />
            <Circle cx="138" cy="41" r="2" fill="#FFFFFF" />

            {/* نجمة علوية يسرى */}
            <Polygon points="22,38 24,44 30,46 24,48 22,54 20,48 14,46 20,44" fill="#FDE047" />
            <Circle cx="22" cy="46" r="1.5" fill="#FFFFFF" />

            {/* نجمة سفلية يمنى */}
            <Polygon points="144,108 146,113 151,115 146,117 144,122 142,117 137,115 142,113" fill="#F59E0B" />

            {/* نجمة سفلية يسرى */}
            <Polygon points="18,105 20,109 24,111 20,113 18,117 16,113 12,111 16,109" fill="#FBBF24" />
          </G>
        )}

        {/* العينان التعبيريتان الواسعتان */}
        {activeBehavior === 'achievement' || activeBehavior === 'success' ? (
          <G>
            {/* عين يسرى مبتسمة ومبتهجة */}
            <Path d="M52 70 Q64 56 76 70" stroke="#003580" strokeWidth="4.5" strokeLinecap="round" fill="none" />
            {/* عين يمنى مبتسمة ومبتهجة */}
            <Path d="M84 70 Q96 56 108 70" stroke="#003580" strokeWidth="4.5" strokeLinecap="round" fill="none" />
          </G>
        ) : (
          <G>
            <Circle cx="64" cy="68" r="16" fill="#FFFFFF" />
            <Circle cx="66" cy="68" r="9" fill="#0F172A" />
            <Circle cx="63" cy="64" r="3.5" fill="#FFFFFF" />
            <Circle cx="68" cy="71" r="1.5" fill="#FFFFFF" />

            <Circle cx="96" cy="68" r="16" fill="#FFFFFF" />
            {activeBehavior === 'recovery' ? (
              <Path d="M88 68 Q96 76 104 68" stroke="#0F172A" strokeWidth="4" strokeLinecap="round" fill="none" />
            ) : (
              <>
                <Circle cx="94" cy="68" r="9" fill="#0F172A" />
                <Circle cx="91" cy="64" r="3.5" fill="#FFFFFF" />
                <Circle cx="96" cy="71" r="1.5" fill="#FFFFFF" />
              </>
            )}
          </G>
        )}

        {/* وجنتان متوردتان */}
        <Circle cx="48" cy="78" r="6" fill="#F472B6" opacity={0.4} />
        <Circle cx="112" cy="78" r="6" fill="#F472B6" opacity={0.4} />

        {/* منقار الصقر الذهبي */}
        <Path
          d="M74 76 Q80 72 86 76 Q88 88 80 94 Q72 88 74 76 Z"
          fill="url(#falconBeakGrad)"
        />
        <Path d="M78 75 Q80 74 82 75" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" />

        {/* إكسسوارات حسب الوضعية */}
        {activeBehavior === 'streak_fire' && (
          <G>
            <Path d="M42 46 Q80 40 118 46" stroke="#EF4444" strokeWidth="8" strokeLinecap="round" fill="none" />
            <Circle cx="80" cy="43" r="7" fill="#F59E0B" />
            <Path d="M78 45 C77 42 79 40 80 39 C81 40 83 42 82 45 Z" fill="#EF4444" />
          </G>
        )}

        {activeBehavior === 'achievement' && (
          <G>
            <Path d="M72 118 L80 132 L88 118" stroke="#DC2626" strokeWidth="3" strokeLinecap="round" fill="none" />
            <Circle cx="80" cy="135" r="9" fill="url(#goldMedalGrad)" />
            <Polygon points="80,129 82,133 86,134 83,137 84,141 80,139 76,141 77,137 74,134 78,133" fill="#FFFFFF" />
          </G>
        )}

        {isScannerMode && (
          <G>
            <Circle cx="120" cy="100" r="14" stroke="#38BDF8" strokeWidth="4" fill="rgba(56, 189, 248, 0.2)" />
            <Path d="M128 108 L142 122" stroke="#0284C7" strokeWidth="5" strokeLinecap="round" />
            <Path d="M112 100 L128 100" stroke="#EF4444" strokeWidth="2" strokeDasharray="3,2" />
          </G>
        )}

        {activeBehavior === 'working' && !isScannerMode && (
          <G>
            <Circle cx="80" cy="20" r="4" fill="#38BDF8" opacity={0.8} />
            <Circle cx="94" cy="24" r="3" fill="#38BDF8" opacity={0.6} />
            <Circle cx="106" cy="30" r="2.5" fill="#38BDF8" opacity={0.4} />
          </G>
        )}
      </Svg>
    </Animated.View>
  );

  return (
    <View style={[styles.wrapper, style]}>
      {showSpeech && !hideFloatingBubble && (
        <Animated.View style={[styles.speechBubble, { opacity: speechOpacity }]}>
          <Txt variant="caption" color="#1E293B" align="center">
            {currentPhrase}
          </Txt>
          <View style={styles.speechArrow} />
        </Animated.View>
      )}

      {interactive || onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="التفاعل مع صقر مسار فطن"
          onPress={handlePress}
        >
          {mascotContent}
        </Pressable>
      ) : (
        mascotContent
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  speechBubble: {
    position: 'absolute',
    bottom: '100%',
    marginBottom: spacing.s2,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: spacing.s3,
    paddingVertical: spacing.s2,
    borderRadius: radii.cardSm,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 6,
    zIndex: 99,
    maxWidth: 220,
    borderWidth: 1,
    borderColor: 'rgba(0, 122, 255, 0.15)',
  },
  speechArrow: {
    position: 'absolute',
    bottom: -6,
    alignSelf: 'center',
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#FFFFFF',
  },
});
