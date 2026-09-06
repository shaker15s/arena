/**
 * design/mascot/MasarMascot.tsx — تميمة مسار التفاعلية («صقر مسار - فطن»)
 * تصميم متجه حديث 2026 مستوحى من نظام شخصيات Duolingo التفاعلي
 * يدعم 5 وضعيات شعورية، تنفس عائم، رمش العينين، والتفاعل باللمس مع فقاعة كلمات تحفيزية.
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
  Rect,
  Stop,
} from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { Txt } from '../components';
import { radii, spacing } from '../tokens';
import { isReducedMotion } from '../motion';

export type MascotMode = 'greeting' | 'streak_fire' | 'celebrating' | 'encouraging' | 'scanner';

export interface MasarMascotProps {
  size?: number;
  mode?: MascotMode;
  interactive?: boolean;
  speechText?: string;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}

const CHEERFUL_PHRASES: Record<MascotMode, string[]> = {
  greeting: [
    'أهلاً بك يا بطل في مسار! 🚀',
    'يوم جديد، إنجاز عظيم! ⭐',
    'جاهز لمحاضرة اليوم؟ 🎯',
    'خطوة بخطوة نحو التميز! ✨',
  ],
  streak_fire: [
    'الستريك مشتعل! استمر يا بطل! 🔥',
    'التزامك يصنع الفارق! 🛡️',
    'نيران الحماس لا تنطفئ! 💪',
    'حافظ على درع الستريك! ⚡',
  ],
  celebrating: [
    'مبروووك! إنجاز يستحق الفخر! 🏆',
    'أنت أسطورة مسار اليوم! 🌟',
    'شهادة مستحقة عن جدارة! 🏅',
    'إلى مزيد من التألق! 🎉',
  ],
  encouraging: [
    'لا بأس، المحاضرة القادمة فرصتك! 💚',
    'عثرة اليوم بداية قفزة الغد! 🌈',
    'معذور والستريك في أمان! 🕊️',
    'ثقتنا فيك كبيرة دائماً! 👏',
  ],
  scanner: [
    'وجّه الكاميرا نحو الرمز وسجل حضورك! 📷',
    'الرمز يتغير كل 25 ثانية — امسح الآن! ⏱️',
    'حضورك السريع = نقاط إضافية! ⚡',
    'مستعد للمحاضرة؟ امسح وابدأ! 🔍',
  ],
};

export function MasarMascot({
  size = 110,
  mode = 'greeting',
  interactive = true,
  speechText,
  style,
  onPress,
}: MasarMascotProps) {
  const [showSpeech, setShowSpeech] = useState(false);
  const [currentPhrase, setCurrentPhrase] = useState('');

  // حركات التميمة
  const floatAnim = useRef(new Animated.Value(0)).current;
  const blinkAnim = useRef(new Animated.Value(1)).current;
  const tapScale = useRef(new Animated.Value(1)).current;
  const speechOpacity = useRef(new Animated.Value(0)).current;
  const flamePulse = useRef(new Animated.Value(1)).current;
  const wingWave = useRef(new Animated.Value(0)).current;

  // 1. حركة الطفو والتنفس الدورية (Floating Breathing Loop)
  useEffect(() => {
    if (isReducedMotion()) return;

    const floatLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, {
          toValue: -6,
          duration: 1400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(floatAnim, {
          toValue: 0,
          duration: 1400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    floatLoop.start();
    return () => floatLoop.stop();
  }, [floatAnim]);

  // 2. حركة رمش العينين الطبيعية (Blinking Eyes Loop)
  useEffect(() => {
    if (isReducedMotion()) return;

    const interval = setInterval(() => {
      Animated.sequence([
        Animated.timing(blinkAnim, {
          toValue: 0.1,
          duration: 120,
          useNativeDriver: true,
        }),
        Animated.timing(blinkAnim, {
          toValue: 1,
          duration: 140,
          useNativeDriver: true,
        }),
      ]).start();
    }, 3800);

    return () => clearInterval(interval);
  }, [blinkAnim]);

  // 3. حركة الستريك المشتعل أو التلويح
  useEffect(() => {
    if (isReducedMotion()) return;

    if (mode === 'streak_fire') {
      const flameLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(flamePulse, {
            toValue: 1.15,
            duration: 600,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(flamePulse, {
            toValue: 0.92,
            duration: 600,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      );
      flameLoop.start();
      return () => flameLoop.stop();
    } else if (mode === 'greeting' || mode === 'celebrating') {
      const waveLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(wingWave, {
            toValue: 1,
            duration: 400,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(wingWave, {
            toValue: 0,
            duration: 400,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      );
      waveLoop.start();
      return () => waveLoop.stop();
    }
  }, [mode, flamePulse, wingWave]);

  // التفاعل باللمس
  const handlePress = (e: GestureResponderEvent) => {
    if (onPress) onPress();
    if (!interactive) return;

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}

    // حركة هزة مرحة
    Animated.sequence([
      Animated.timing(tapScale, {
        toValue: 0.88,
        duration: 90,
        useNativeDriver: true,
      }),
      Animated.spring(tapScale, {
        toValue: 1.12,
        friction: 3,
        tension: 180,
        useNativeDriver: true,
      }),
      Animated.spring(tapScale, {
        toValue: 1,
        friction: 4,
        tension: 140,
        useNativeDriver: true,
      }),
    ]).start();

    // اختيار نص تحفيزي عشوائي وإظهار الفقاعة
    const phrases = CHEERFUL_PHRASES[mode];
    const picked = speechText || phrases[Math.floor(Math.random() * phrases.length)];
    setCurrentPhrase(picked);
    setShowSpeech(true);

    Animated.timing(speechOpacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();

    setTimeout(() => {
      Animated.timing(speechOpacity, {
        toValue: 0,
        duration: 350,
        useNativeDriver: true,
      }).start(() => setShowSpeech(false));
    }, 2800);
  };

  const wingRotation = wingWave.interpolate({
    inputRange: [0, 1],
    outputRange: ['-8deg', '18deg'],
  });

  return (
    <View style={[styles.wrapper, style]}>
      {/* فقاعة الحديث التفاعلية (Speech Bubble) */}
      {showSpeech && (
        <Animated.View style={[styles.speechBubble, { opacity: speechOpacity }]}>
          <Txt variant="caption" color="#1E293B" align="center">
            {currentPhrase}
          </Txt>
          <View style={styles.speechArrow} />
        </Animated.View>
      )}

      {/* التميمة ذات الحركة الفيزيائية */}
      <Pressable onPress={handlePress} disabled={!interactive && !onPress}>
        <Animated.View
          style={{
            transform: [
              { translateY: floatAnim },
              { scale: tapScale },
            ],
          }}
        >
          <Svg width={size} height={size * 1.1} viewBox="0 0 160 176" fill="none">
            <Defs>
              {/* تدرجات ألوان صقر مسار */}
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

            {/* وضعية النيران المحيطة (Streak Fire Aura) */}
            {mode === 'streak_fire' && (
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

            {/* ظل ناعم تحت الشخصية */}
            <Ellipse cx="80" cy="168" rx="42" ry="7" fill="rgba(15, 23, 42, 0.12)" />

            {/* أرجل الصقر الذهبية */}
            <G fill="#F59E0B">
              {/* الساق واليمين واليسار */}
              <Path d="M62 148 L62 165 M54 165 L70 165" stroke="#F59E0B" strokeWidth="4.5" strokeLinecap="round" />
              <Path d="M98 148 L98 165 M90 165 L106 165" stroke="#F59E0B" strokeWidth="4.5" strokeLinecap="round" />
            </G>

            {/* جسم الصقر الرئيسي (Falcon Body Shape) */}
            <Path
              d="M80 30 C45 30 34 56 34 96 C34 135 52 154 80 154 C108 154 126 135 126 96 C126 56 115 30 80 30 Z"
              fill="url(#falconBodyGrad)"
            />

            {/* عرف الصقر الأنيق في أعلى الرأس (Falcon Crest) */}
            <Path
              d="M74 30 C76 12 84 10 88 18 C92 10 100 12 96 30 Z"
              fill="#0055D4"
            />

            {/* صدر الصقر الأبيض الناعم (Falcon White Chest) */}
            <Path
              d="M80 72 C62 72 52 88 52 118 C52 142 64 150 80 150 C96 150 108 142 108 118 C108 88 98 72 80 72 Z"
              fill="url(#falconChestGrad)"
            />

            {/* ريشات الصدر المميزة لمسار */}
            <Path d="M72 98 L80 106 L88 98" stroke="#93C5FD" strokeWidth="2.5" strokeLinecap="round" />
            <Path d="M68 116 L80 126 L92 116" stroke="#93C5FD" strokeWidth="2.5" strokeLinecap="round" />

            {/* الجناح الأيسر */}
            <Path
              d="M36 84 C28 96 26 122 42 136 C46 128 48 114 46 98 Z"
              fill="#0055D4"
            />

            {/* الجناح الأيمن (تفاعلي حسب الوضعية) */}
            {mode === 'greeting' ? (
              <Path
                d="M124 84 C138 72 152 74 150 92 C146 106 134 116 118 110 Z"
                fill="#0055D4"
              />
            ) : mode === 'encouraging' ? (
              <G>
                {/* يد ترفع الإبهام */}
                <Path
                  d="M124 90 C140 82 146 94 138 106 C132 114 122 116 116 108 Z"
                  fill="#0055D4"
                />
                <Path d="M142 84 L142 94" stroke="#F59E0B" strokeWidth="4" strokeLinecap="round" />
              </G>
            ) : mode === 'celebrating' ? (
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

            {/* العينان التعبيريتان الواسعتان (Wide Expressive Eyes) */}
            <G>
              {/* بياض العين اليسرى */}
              <Circle cx="64" cy="68" r="16" fill="#FFFFFF" />
              {/* حدقة العين اليسرى */}
              <Circle cx="66" cy="68" r="9" fill="#0F172A" />
              {/* لمعة العين البرّاقة (Specular Highlights) */}
              <Circle cx="63" cy="64" r="3.5" fill="#FFFFFF" />
              <Circle cx="68" cy="71" r="1.5" fill="#FFFFFF" />

              {/* بياض العين اليمنى */}
              <Circle cx="96" cy="68" r="16" fill="#FFFFFF" />
              {/* حدقة العين اليمنى (تغمز في وضعية التشجيع) */}
              {mode === 'encouraging' ? (
                <Path d="M88 68 Q96 76 104 68" stroke="#0F172A" strokeWidth="4" strokeLinecap="round" fill="none" />
              ) : (
                <>
                  <Circle cx="94" cy="68" r="9" fill="#0F172A" />
                  <Circle cx="91" cy="64" r="3.5" fill="#FFFFFF" />
                  <Circle cx="96" cy="71" r="1.5" fill="#FFFFFF" />
                </>
              )}
            </G>

            {/* رموش وخدود وردية لطيفة (Pink Cheeks) */}
            <Circle cx="48" cy="78" r="6" fill="#F472B6" opacity={0.4} />
            <Circle cx="112" cy="78" r="6" fill="#F472B6" opacity={0.4} />

            {/* منقار الصقر الذهبي الجميل (Golden Curved Beak) */}
            <Path
              d="M74 76 Q80 72 86 76 Q88 88 80 94 Q72 88 74 76 Z"
              fill="url(#falconBeakGrad)"
            />
            {/* لمعة المنقار */}
            <Path d="M78 75 Q80 74 82 75" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" />

            {/* إكسسوارات حسب الوضعية */}
            {mode === 'streak_fire' && (
              /* عصبة رأس رياضية حمراء ورمز النار */
              <G>
                <Path d="M42 46 Q80 40 118 46" stroke="#EF4444" strokeWidth="8" strokeLinecap="round" fill="none" />
                <Circle cx="80" cy="43" r="7" fill="#F59E0B" />
                <Path d="M78 45 C77 42 79 40 80 39 C81 40 83 42 82 45 Z" fill="#EF4444" />
              </G>
            )}

            {mode === 'celebrating' && (
              /* وسام ذهبي معلق وشريط أحمر */
              <G>
                <Path d="M72 118 L80 132 L88 118" stroke="#DC2626" strokeWidth="3" strokeLinecap="round" fill="none" />
                <Circle cx="80" cy="135" r="9" fill="url(#goldMedalGrad)" />
                <Polygon points="80,129 82,133 86,134 83,137 84,141 80,139 76,141 77,137 74,134 78,133" fill="#FFFFFF" />
              </G>
            )}

            {mode === 'scanner' && (
              /* عدسة ليزرية ذكية ومسار مسح */
              <G>
                <Circle cx="120" cy="100" r="14" stroke="#38BDF8" strokeWidth="4" fill="rgba(56, 189, 248, 0.2)" />
                <Path d="M128 108 L142 122" stroke="#0284C7" strokeWidth="5" strokeLinecap="round" />
                <Path d="M112 100 L128 100" stroke="#EF4444" strokeWidth="2" strokeDasharray="3,2" />
              </G>
            )}
          </Svg>
        </Animated.View>
      </Pressable>
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
