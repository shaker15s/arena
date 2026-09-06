/**
 * design/mascot/CloudMascot.tsx — تميمة السحابة التفاعلية لـ Masär (Cloud Mascot)
 * مبنية وفق مواصفات MASAR_ASSETS_RESEARCH.md (Rive State Machine Architecture)
 * تدعم 6 حالات تعبيرية حقيقية:
 * 1. idle: هدوء وتنفس عائم ورمش لطيف
 * 2. happy: ابتسامة عريضة مع لمعان العينين ووجنتين متوردتين (حضور ناجح)
 * 3. celebrate: قفزة احتفالية ووسام ذهبي وهالة إنجاز (بادج جديد / ترقية ليج)
 * 4. sad: سحابة ممطرة خافتة وملامح حزينة (غياب / فشل QR / انقطاع ستريك)
 * 5. thinking: نظرة تأمل ونقاط تفكير متحركة (تحميل / معالجة الرمز)
 * 6. streak_fire: لهب ديناميكي مشتعل وهالة طاقة نارية (ستريك مشتعل)
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

export type CloudMascotMode =
  | 'idle'
  | 'happy'
  | 'celebrate'
  | 'sad'
  | 'thinking'
  | 'streak_fire';

export interface CloudMascotProps {
  size?: number;
  mode?: CloudMascotMode;
  interactive?: boolean;
  speechText?: string;
  showSpeechBubble?: boolean;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}

const CLOUD_PHRASES: Record<CloudMascotMode, string[]> = {
  idle: [
    'أهلاً بك في مسار! جاهز للبدء؟ ☁️✨',
    'يوم جديد، خطوة جديدة نحو هدفك! 🎯',
    'معاً نحو قمة التدريب والإنجاز! 🚀',
  ],
  happy: [
    'أحسنت يا بطل! تم توثيق حضورك بنجاح! 🎉',
    'حضور ممتاز ونقاط جديدة في رصيدك! ⭐',
    'التزامك اليوم خطوة رائعة لغدك! 🌟',
  ],
  celebrate: [
    'مبروووك! وسام إنجاز جديد يضاف لسجلك! 🏆',
    'أنت أسطورة هذا الأسبوع في مسار! 🏅',
    'ترقية مستحقة وتألق في صدارة الدوري! 👑',
  ],
  sad: [
    'لا تقلق! العثرات بداية طريق النجاح 🌧️',
    'يمكنك تدارك الأمر وتقديم عذر مقبول 💙',
    'سنستعيد الستريك معاً في الجلسة القادمة! 🛡️',
  ],
  thinking: [
    'لحظات.. جاري التحقق وتأكيد البيانات ⏳',
    'ندقق الرمز ونحدث سجلك التدريبي.. 🔍',
    'مسار يعالج طلبك بأمان فائق.. ⚡',
  ],
  streak_fire: [
    'الستريك مشتعل بنار الحماس والإصرار! 🔥',
    'استمرارية أسطورية لا تعرف التراجع! ⚡',
    'حافظ على لهب الالتزام ودرع الستريك! 🛡️',
  ],
};

export function CloudMascot({
  size = 140,
  mode = 'idle',
  interactive = true,
  speechText,
  showSpeechBubble = false,
  style,
  onPress,
}: CloudMascotProps) {
  const reduced = isReducedMotion();

  // حركة التنفس العائم
  const breatheAnim = useRef(new Animated.Value(0)).current;
  // حركة القفز التفاعلي عند النقر
  const bounceAnim = useRef(new Animated.Value(1)).current;
  // رمش العينين
  const blinkAnim = useRef(new Animated.Value(1)).current;
  // لهب الستريك أو لمعان الاحتفال
  const auraAnim = useRef(new Animated.Value(0)).current;

  const [currentBubbleText, setCurrentBubbleText] = useState<string | null>(
    speechText ?? null
  );
  const [bubbleVisible, setBubbleVisible] = useState<boolean>(
    Boolean(speechText) || showSpeechBubble
  );

  useEffect(() => {
    if (speechText) {
      setCurrentBubbleText(speechText);
      setBubbleVisible(true);
    }
  }, [speechText]);

  // دورة التنفس العائم
  useEffect(() => {
    if (reduced) return;

    const breatheLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breatheAnim, {
          toValue: 1,
          duration: mode === 'streak_fire' ? 1200 : 2000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(breatheAnim, {
          toValue: 0,
          duration: mode === 'streak_fire' ? 1200 : 2000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    breatheLoop.start();

    return () => breatheLoop.stop();
  }, [breatheAnim, mode, reduced]);

  // دورة لمعان الهالة
  useEffect(() => {
    if (reduced) return;

    const auraLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(auraAnim, {
          toValue: 1,
          duration: mode === 'streak_fire' ? 800 : 1500,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(auraAnim, {
          toValue: 0,
          duration: mode === 'streak_fire' ? 800 : 1500,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    auraLoop.start();

    return () => auraLoop.stop();
  }, [auraAnim, mode, reduced]);

  // دورة رمش العينين الطبيعي
  useEffect(() => {
    if (reduced || mode === 'sad') return;

    const blinkInterval = setInterval(() => {
      Animated.sequence([
        Animated.timing(blinkAnim, {
          toValue: 0.1,
          duration: 110,
          useNativeDriver: true,
        }),
        Animated.timing(blinkAnim, {
          toValue: 1,
          duration: 120,
          useNativeDriver: true,
        }),
      ]).start();
    }, 3800);

    return () => clearInterval(blinkInterval);
  }, [blinkAnim, mode, reduced]);

  const handlePress = (e: GestureResponderEvent) => {
    if (!interactive) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

    // قفزة تفاعلية نابضية
    Animated.sequence([
      Animated.spring(bounceAnim, {
        toValue: 1.15,
        friction: 3,
        tension: 180,
        useNativeDriver: true,
      }),
      Animated.spring(bounceAnim, {
        toValue: 1,
        friction: 4,
        tension: 140,
        useNativeDriver: true,
      }),
    ]).start();

    // اختيار عبارة تحفيزية عشوائية
    const phrases = CLOUD_PHRASES[mode] || CLOUD_PHRASES.idle;
    const randomPhrase = phrases[Math.floor(Math.random() * phrases.length)];
    setCurrentBubbleText(randomPhrase);
    setBubbleVisible(true);

    if (onPress) onPress();
  };

  const translateY = breatheAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, mode === 'streak_fire' ? -7 : -5],
  });

  return (
    <View style={[styles.container, style]}>
      {/* فقاعة الكلمات التحفيزية التفاعلية */}
      {bubbleVisible && currentBubbleText ? (
        <Animated.View style={styles.bubbleWrapper}>
          <View style={styles.bubbleCard}>
            <Txt variant="caption" style={styles.bubbleText}>
              {currentBubbleText}
            </Txt>
          </View>
          <View style={styles.bubbleArrow} />
        </Animated.View>
      ) : null}

      <Pressable onPress={handlePress} disabled={!interactive}>
        <Animated.View
          style={{
            transform: [{ translateY }, { scale: bounceAnim }],
          }}
        >
          <Svg width={size} height={size * 0.85} viewBox="0 0 200 170" fill="none">
            <Defs>
              {/* تدرجات السحابة الأساسية */}
              <LinearGradient id="cloudBodyGradDefault" x1="100" y1="20" x2="100" y2="150" gradientUnits="userSpaceOnUse">
                <Stop offset="0%" stopColor="#FFFFFF" />
                <Stop offset="100%" stopColor="#E0F2FE" />
              </LinearGradient>
              <LinearGradient id="cloudBodyGradSad" x1="100" y1="20" x2="100" y2="150" gradientUnits="userSpaceOnUse">
                <Stop offset="0%" stopColor="#94A3B8" />
                <Stop offset="100%" stopColor="#64748B" />
              </LinearGradient>
              <LinearGradient id="cloudBodyGradStreak" x1="100" y1="20" x2="100" y2="150" gradientUnits="userSpaceOnUse">
                <Stop offset="0%" stopColor="#FFFBEB" />
                <Stop offset="100%" stopColor="#FEF3C7" />
              </LinearGradient>

              {/* تدرج هالة الستريك النارية */}
              <LinearGradient id="streakFireGrad" x1="100" y1="0" x2="100" y2="170" gradientUnits="userSpaceOnUse">
                <Stop offset="0%" stopColor="#F59E0B" stopOpacity="0.8" />
                <Stop offset="50%" stopColor="#EF4444" stopOpacity="0.6" />
                <Stop offset="100%" stopColor="#B91C1C" stopOpacity="0" />
              </LinearGradient>

              {/* تدرج هالة الاحتفال */}
              <LinearGradient id="celebrateAura" x1="100" y1="10" x2="100" y2="160" gradientUnits="userSpaceOnUse">
                <Stop offset="0%" stopColor="#FBBF24" stopOpacity="0.7" />
                <Stop offset="100%" stopColor="#10B981" stopOpacity="0" />
              </LinearGradient>

              {/* تدرج قطرات المطر لحالة sad */}
              <LinearGradient id="rainGrad" x1="0" y1="0" x2="0" y2="1" gradientUnits="userSpaceOnUse">
                <Stop offset="0%" stopColor="#38BDF8" />
                <Stop offset="100%" stopColor="#0284C7" />
              </LinearGradient>
            </Defs>

            {/* ظل السحابة الناعم السفلي */}
            <Ellipse cx="100" cy="158" rx="65" ry="8" fill="#0F172A" fillOpacity="0.12" />

            {/* هالة اللهب لحالة الستريك */}
            {mode === 'streak_fire' ? (
              <G id="fireAura">
                <Path
                  d="M100 8 C118 25 142 35 152 65 C162 95 148 135 125 152 C105 165 95 165 75 152 C52 135 38 95 48 65 C58 35 82 25 100 8 Z"
                  fill="url(#streakFireGrad)"
                />
                <Path
                  d="M100 24 C112 36 128 44 135 66 C142 88 132 118 116 130 C104 140 96 140 84 130 C68 118 58 88 65 66 C72 44 88 36 100 24 Z"
                  fill="#F59E0B"
                  fillOpacity="0.4"
                />
              </G>
            ) : null}

            {/* هالة الاحتفال الذهبية */}
            {mode === 'celebrate' ? (
              <Circle cx="100" cy="90" r="78" fill="url(#celebrateAura)" />
            ) : null}

            {/* جسم السحابة الأساسي (المنحنيات الناعمة) */}
            <G id="cloudBody">
              {/* الفقاعات المكونة للسحابة */}
              <Circle cx="100" cy="76" r="42" fill={mode === 'sad' ? 'url(#cloudBodyGradSad)' : mode === 'streak_fire' ? 'url(#cloudBodyGradStreak)' : 'url(#cloudBodyGradDefault)'} />
              <Circle cx="64" cy="98" r="34" fill={mode === 'sad' ? 'url(#cloudBodyGradSad)' : mode === 'streak_fire' ? 'url(#cloudBodyGradStreak)' : 'url(#cloudBodyGradDefault)'} />
              <Circle cx="136" cy="98" r="34" fill={mode === 'sad' ? 'url(#cloudBodyGradSad)' : mode === 'streak_fire' ? 'url(#cloudBodyGradStreak)' : 'url(#cloudBodyGradDefault)'} />
              <Circle cx="86" cy="116" r="30" fill={mode === 'sad' ? 'url(#cloudBodyGradSad)' : mode === 'streak_fire' ? 'url(#cloudBodyGradStreak)' : 'url(#cloudBodyGradDefault)'} />
              <Circle cx="114" cy="116" r="30" fill={mode === 'sad' ? 'url(#cloudBodyGradSad)' : mode === 'streak_fire' ? 'url(#cloudBodyGradStreak)' : 'url(#cloudBodyGradDefault)'} />

              {/* خط التحديد الخارجي الأنيق */}
              <Path
                d="M60 132 C42 132 28 118 28 100 C28 84 39 71 54 68 C58 48 76 34 100 34 C122 34 140 48 145 67 C159 70 172 83 172 100 C172 118 158 132 140 132 Z"
                fill="none"
                stroke={mode === 'sad' ? '#475569' : mode === 'streak_fire' ? '#F59E0B' : '#BAE6FD'}
                strokeWidth={mode === 'streak_fire' ? 3 : 2}
              />
            </G>

            {/* الوجنتان المتوردتان في الحالات السعيدة والاحتفالية */}
            {mode === 'happy' || mode === 'celebrate' || mode === 'idle' ? (
              <G id="cheeks">
                <Ellipse cx="68" cy="106" rx="8" ry="5" fill="#F43F5E" fillOpacity="0.35" />
                <Ellipse cx="132" cy="106" rx="8" ry="5" fill="#F43F5E" fillOpacity="0.35" />
              </G>
            ) : null}

            {/* تعابير الوجه حسب الحالة (Expression Switcher) */}
            {mode === 'sad' ? (
              /* حالة الحزن: عيون مائلة وفم مقلوب وقطرات مطر */
              <G id="sadExpression">
                <Path d="M72 96 Q80 92 88 98" stroke="#334155" strokeWidth="3.5" strokeLinecap="round" fill="none" />
                <Path d="M128 96 Q120 92 112 98" stroke="#334155" strokeWidth="3.5" strokeLinecap="round" fill="none" />
                <Path d="M92 118 Q100 110 108 118" stroke="#334155" strokeWidth="3" strokeLinecap="round" fill="none" />
                <Path d="M68 140 Q64 148 64 152 A4 4 0 0 0 72 152 Q72 148 68 140 Z" fill="url(#rainGrad)" />
                <Path d="M100 144 Q96 152 96 156 A4 4 0 0 0 104 156 Q104 152 100 144 Z" fill="url(#rainGrad)" />
                <Path d="M132 138 Q128 146 128 150 A4 4 0 0 0 136 150 Q136 146 132 138 Z" fill="url(#rainGrad)" />
              </G>
            ) : mode === 'happy' ? (
              /* حالة السعادة: عيون ضاحكة مقوسة وفم مبتسم عريض */
              <G id="happyExpression">
                <Path d="M72 96 Q80 86 88 96" stroke="#0369A1" strokeWidth="4" strokeLinecap="round" fill="none" />
                <Path d="M112 96 Q120 86 128 96" stroke="#0369A1" strokeWidth="4" strokeLinecap="round" fill="none" />
                <Path d="M88 108 Q100 126 112 108" stroke="#0369A1" strokeWidth="3.5" strokeLinecap="round" fill="#F43F5E" />
                <Polygon points="100,50 102,56 108,58 102,60 100,66 98,60 92,58 98,56" fill="#F59E0B" />
              </G>
            ) : mode === 'celebrate' ? (
              /* حالة الاحتفال: عيون نجمية وتاج أو وسام ذهبي */
              <G id="celebrateExpression">
                <Polygon points="80,90 82,95 87,95 83,98 84,103 80,100 76,103 77,98 73,95 78,95" fill="#0284C7" />
                <Polygon points="120,90 122,95 127,95 123,98 124,103 120,100 116,103 117,98 113,95 118,95" fill="#0284C7" />
                <Path d="M88 110 Q100 128 112 110" stroke="#0369A1" strokeWidth="3.5" strokeLinecap="round" fill="#F43F5E" />
                <G transform="translate(100, 134)">
                  <Circle cx="0" cy="0" r="10" fill="#F59E0B" stroke="#B45309" strokeWidth="1.5" />
                  <Polygon points="0,-4 1,-1 4,-1 2,1 3,4 0,2 -3,4 -2,1 -4,-1 -1,-1" fill="#FEF3C7" />
                </G>
                <Circle cx="44" cy="56" r="3" fill="#10B981" />
                <Rect x="156" y="52" width="5" height="5" rx="1" fill="#F59E0B" transform="rotate(25 158 54)" />
                <Circle cx="162" cy="80" r="2.5" fill="#EC4899" />
                <Rect x="36" y="86" width="4" height="4" rx="1" fill="#6366F1" transform="rotate(-20 38 88)" />
              </G>
            ) : mode === 'thinking' ? (
              /* حالة التفكير: عيون تنظر للأعلى ونقاط فكرة */
              <G id="thinkingExpression">
                <Circle cx="80" cy="92" r="5" fill="#0369A1" />
                <Circle cx="82" cy="90" r="1.8" fill="#FFFFFF" />
                <Circle cx="120" cy="92" r="5" fill="#0369A1" />
                <Circle cx="122" cy="90" r="1.8" fill="#FFFFFF" />
                <Ellipse cx="100" cy="112" rx="4" ry="3" fill="#0369A1" />
                <Circle cx="146" cy="46" r="4" fill="#93C5FD" fillOpacity="0.8" />
                <Circle cx="158" cy="34" r="6" fill="#60A5FA" fillOpacity="0.85" />
                <Circle cx="174" cy="22" r="8" fill="#3B82F6" fillOpacity="0.9" />
              </G>
            ) : mode === 'streak_fire' ? (
              /* حالة لهب الستريك: عيون العزم وشعلة متقدة */
              <G id="streakFireExpression">
                <Path d="M72 94 L86 98" stroke="#9A3412" strokeWidth="4" strokeLinecap="round" />
                <Circle cx="80" cy="100" r="4.5" fill="#7C2D12" />
                <Path d="M128 94 L114 98" stroke="#9A3412" strokeWidth="4" strokeLinecap="round" />
                <Circle cx="120" cy="100" r="4.5" fill="#7C2D12" />
                <Path d="M92 114 Q100 118 108 114" stroke="#9A3412" strokeWidth="3" strokeLinecap="round" fill="none" />
                <Path d="M100 50 C106 58 112 62 108 72 C104 68 102 68 100 72 C98 68 96 68 92 72 C88 62 94 58 100 50 Z" fill="#EF4444" />
                <Path d="M100 58 C103 62 106 65 104 71 C102 69 101 69 100 71 C99 69 98 69 96 71 C94 65 97 62 100 58 Z" fill="#FBBF24" />
              </G>
            ) : (
              /* حالة الهدوء الافتراضية (idle) */
              <G id="idleExpression">
                <G style={{ transform: [{ scaleY: blinkAnim }] } as any}>
                  <Circle cx="80" cy="96" r="4.5" fill="#0369A1" />
                  <Circle cx="82" cy="94" r="1.6" fill="#FFFFFF" />
                  <Circle cx="120" cy="96" r="4.5" fill="#0369A1" />
                  <Circle cx="122" cy="94" r="1.6" fill="#FFFFFF" />
                </G>
                <Path d="M92 110 Q100 118 108 110" stroke="#0369A1" strokeWidth="3" strokeLinecap="round" fill="none" />
              </G>
            )}
          </Svg>
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleWrapper: {
    alignItems: 'center',
    marginBottom: spacing.xs,
    maxWidth: 240,
    zIndex: 10,
  },
  bubbleCard: {
    backgroundColor: '#0F172A',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: '#38BDF8',
    shadowColor: '#0284C7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  bubbleText: {
    color: '#F8FAFC',
    textAlign: 'center',
    lineHeight: 20,
  },
  bubbleArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#0F172A',
  },
});
