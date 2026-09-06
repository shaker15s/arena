/**
 * design/illustrations/OnboardingSlide3Illustration.tsx
 * رسم توضيحي فكتور مخصص للشريحة الثالثة (D1):
 * متدرب يحتفل بشهادة ذهبية متوهجة قابلة للتحقق العام مع أوسمة ونجوم ولمعان.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, View, ViewStyle } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient as SvgGradient,
  Path,
  Polygon,
  Rect,
  Stop,
} from 'react-native-svg';
import { isReducedMotion } from '../motion';

interface Props {
  size?: number;
  style?: ViewStyle;
}

export function OnboardingSlide3Illustration({ size = 260, style }: Props) {
  const celebrateAnim = useRef(new Animated.Value(0)).current;
  const shimmerAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isReducedMotion()) return;
    const celebrateLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(celebrateAnim, {
          toValue: 1,
          duration: 2800,
          useNativeDriver: true,
        }),
        Animated.timing(celebrateAnim, {
          toValue: 0,
          duration: 2800,
          useNativeDriver: true,
        }),
      ])
    );

    const shimmerLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1.12,
          duration: 1400,
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 1400,
          useNativeDriver: true,
        }),
      ])
    );

    celebrateLoop.start();
    shimmerLoop.start();
    return () => {
      celebrateLoop.stop();
      shimmerLoop.stop();
    };
  }, [celebrateAnim, shimmerAnim]);

  const certTranslateY = celebrateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -6],
  });

  return (
    <View
      accessibilityLabel="متدرب يحتفل حاملاً شهادة إنجاز ذهبية فاخرة مع درع التحقق العام ونقاط التميز"
      accessible={true}
      style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}
    >
      <Svg width={size} height={size} viewBox="0 0 320 320" fill="none">
        <Defs>
          {/* هالة الخلفية الذهبية والكهرمانية */}
          <SvgGradient id="bgGlow3" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor="#F59E0B" stopOpacity="0.25" />
            <Stop offset="50%" stopColor="#FFB800" stopOpacity="0.15" />
            <Stop offset="100%" stopColor="#D97706" stopOpacity="0.0" />
          </SvgGradient>

          {/* تدرج ورق الشهادة الذهبية */}
          <SvgGradient id="certPaperGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor="#FFFDF7" />
            <Stop offset="100%" stopColor="#FEF7E6" />
          </SvgGradient>

          {/* تدرج إطار الشهادة الذهبي الفاخر */}
          <SvgGradient id="goldBorderGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor="#F59E0B" />
            <Stop offset="50%" stopColor="#FDE047" />
            <Stop offset="100%" stopColor="#D97706" />
          </SvgGradient>

          {/* تدرج ختم الشهادة والميدالية */}
          <SvgGradient id="medalGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor="#F59E0B" />
            <Stop offset="100%" stopColor="#B45309" />
          </SvgGradient>

          {/* تدرج ملابس المتدرب الفخورة */}
          <SvgGradient id="studentJacketGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor="#1E293B" />
            <Stop offset="100%" stopColor="#0F172A" />
          </SvgGradient>

          <SvgGradient id="faceGrad3" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#F5D0A9" />
            <Stop offset="100%" stopColor="#DEB185" />
          </SvgGradient>
        </Defs>

        {/* هالة الخلفية الكهرمانية اللامعة */}
        <Circle cx="160" cy="160" r="140" fill="url(#bgGlow3)" />
        <Circle cx="80" cy="80" r="32" fill="#F59E0B" fillOpacity="0.08" />
        <Circle cx="250" cy="240" r="40" fill="#FFB800" fillOpacity="0.08" />

        {/* ظل القاعدة */}
        <Path
          d="M60 280 C110 294 210 294 260 280 C240 272 80 272 60 280 Z"
          fill="#000000"
          fillOpacity="0.06"
        />

        {/* جسم المتدرب في الخلفية وهو يرفع الشهادة بفخر */}
        <G id="celebratingStudent">
          {/* الجاكيت */}
          <Path
            d="M96 270 C92 230 106 200 128 186 C138 180 150 176 160 176 C170 176 182 180 192 186 C214 200 228 230 224 270 Z"
            fill="url(#studentJacketGrad)"
          />
          {/* ياقة القميص البيضاء */}
          <Path d="M148 180 L160 196 L172 180 Z" fill="#FFFFFF" />
          <Path d="M158 188 L160 216" stroke="#007AFF" strokeWidth="2.5" strokeLinecap="round" />

          {/* الرقبة والرأس */}
          <Rect x="151" y="152" width="18" height="26" rx="5" fill="url(#faceGrad3)" />
          <Circle cx="160" cy="126" r="32" fill="url(#faceGrad3)" />
          <Circle cx="128" cy="128" r="6.5" fill="#DEB185" />
          <Circle cx="192" cy="128" r="6.5" fill="#DEB185" />

          {/* قبعة التخرج أو تسريحة شعر أنيقة */}
          <Path
            d="M126 122 C125 98 142 88 160 88 C178 88 195 98 194 122 C186 112 176 108 160 108 C144 108 134 112 126 122 Z"
            fill="#2A2018"
          />
          {/* ملامح الاحتفال السعيدة */}
          <Path d="M146 122 C148 125 152 125 154 122" stroke="#422006" strokeWidth="2.2" strokeLinecap="round" />
          <Path d="M166 122 C168 125 172 125 174 122" stroke="#422006" strokeWidth="2.2" strokeLinecap="round" />
          {/* ابتسامة الإنجاز العريضة */}
          <Path d="M151 135 Q160 144 169 135" stroke="#422006" strokeWidth="2.4" strokeLinecap="round" fill="none" />
        </G>

        {/* الشهادة الذهبية الموثقة المرفوعة للأمام */}
        <G id="goldenCertificate" transform="translate(68, 120)">
          {/* ظل الشهادة المتوهج */}
          <Rect x="6" y="8" width="172" height="122" rx="16" fill="#D97706" fillOpacity="0.18" />

          {/* لوحة الشهادة */}
          <Rect
            x="4"
            y="4"
            width="176"
            height="126"
            rx="14"
            fill="url(#certPaperGrad)"
            stroke="url(#goldBorderGrad)"
            strokeWidth="3.5"
          />

          {/* إطار داخلي رفيع أنيق */}
          <Rect
            x="12"
            y="12"
            width="160"
            height="110"
            rx="9"
            fill="none"
            stroke="#D97706"
            strokeWidth="1"
            strokeDasharray="4 2"
            opacity="0.45"
          />

          {/* شريط عنوان الشهادة ووسم مسار */}
          <Rect x="48" y="24" width="88" height="7" rx="3.5" fill="#78350F" />
          <Rect x="62" y="36" width="60" height="5" rx="2.5" fill="#B45309" />

          {/* أسطر بيانات الشهادة الفاخرة */}
          <Rect x="26" y="52" width="132" height="4" rx="2" fill="#D97706" opacity="0.35" />
          <Rect x="36" y="62" width="112" height="4" rx="2" fill="#D97706" opacity="0.35" />
          <Rect x="46" y="72" width="92" height="4" rx="2" fill="#D97706" opacity="0.35" />

          {/* ختم التوثيق الذهبي في أسفل اليمين */}
          <G id="goldSeal" transform="translate(136, 92)">
            <Circle cx="0" cy="0" r="16" fill="url(#medalGrad)" />
            <Circle cx="0" cy="0" r="12" fill="#FEF08A" stroke="#B45309" strokeWidth="1" />
            <Polygon points="0,-7 2,-2 7,-2 3,2 5,7 0,4 -5,7 -3,2 -7,-2 -2,-2" fill="#B45309" />
            {/* شريطان متدليان من الختم */}
            <Path d="M-6 12 L-10 24 L-4 22 L-2 24 Z" fill="#B45309" />
            <Path d="M2 12 L0 24 L5 22 L8 24 Z" fill="#D97706" />
          </G>

          {/* توقيع التوثيق الرقمي في أسفل اليسار */}
          <Path d="M28 98 Q36 88 44 98 T60 98" stroke="#78350F" strokeWidth="1.8" strokeLinecap="round" fill="none" />
          <Rect x="28" y="104" width="40" height="3" rx="1.5" fill="#92400E" opacity="0.5" />
        </G>

        {/* نجوم ولمعان احتفالي حول الشهادة */}
        {/* نجمة 1 */}
        <Polygon points="45,95 48,102 55,103 50,108 51,115 45,111 39,115 40,108 35,103 42,102" fill="#F59E0B" />
        {/* نجمة 2 */}
        <Polygon points="275,110 277,115 282,116 278,120 279,125 275,122 271,125 272,120 268,116 273,115" fill="#FFB800" />
        {/* نجمة 3 صغيرة */}
        <Polygon points="260,75 261,78 264,79 262,81 263,84 260,82 257,84 258,81 256,79 259,78" fill="#F59E0B" />

        {/* يد المتدرب اليمين ماسكة بالشهادة */}
        <Circle cx="82" cy="214" r="9" fill="#DEB185" />
        {/* يد المتدرب اليسار ماسكة بالشهادة */}
        <Circle cx="238" cy="214" r="9" fill="#DEB185" />
      </Svg>

      {/* درع التحقق العام الطافي (Public Verifiable Badge) */}
      <Animated.View
        style={{
          position: 'absolute',
          top: 24,
          right: 14,
          transform: [{ translateY: certTranslateY }, { scale: shimmerAnim }],
        }}
      >
        <Svg width={108} height={44} viewBox="0 0 108 44" fill="none">
          <Rect x="2" y="2" width="104" height="40" rx="20" fill="#0F172A" stroke="#F59E0B" strokeWidth="1.8" />
          {/* أيقونة درع التحقق الموثوق */}
          <Path
            d="M22 13 C22 13 28 12 32 10 C36 12 42 13 42 13 C42 22 36 28 32 31 C28 28 22 22 22 13 Z"
            fill="#FEF3C7"
            stroke="#F59E0B"
            strokeWidth="1.6"
          />
          <Path d="M28 20 L31 23 L37 17" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

          {/* نص التوثيق العام */}
          <Rect x="48" y="16" width="46" height="5" rx="2.5" fill="#F8FAFC" />
          <Rect x="48" y="25" width="32" height="4" rx="2" fill="#F59E0B" />
        </Svg>
      </Animated.View>
    </View>
  );
}
