/**
 * design/illustrations/OnboardingSlide1Illustration.tsx
 * رسم توضيحي فكتور مخصص للشريحة الأولى (D1):
 * متدرب حقيقي يمسك الهاتف الذكي مع بطاقة جدول المواعيد الذكي للجلسات.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, View, ViewStyle } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient as SvgGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';
import { isReducedMotion } from '../motion';

interface Props {
  size?: number;
  style?: ViewStyle;
}

export function OnboardingSlide1Illustration({ size = 260, style }: Props) {
  const floatAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isReducedMotion()) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, {
          toValue: 1,
          duration: 3200,
          useNativeDriver: true,
        }),
        Animated.timing(floatAnim, {
          toValue: 0,
          duration: 3200,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [floatAnim]);

  const cardTranslateY = floatAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -8],
  });

  return (
    <View
      accessibilityLabel="متدرب مسار يمسك هاتفه الذكي وبجانبه جدول المواعيد التدريبية المنظم"
      accessible={true}
      style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}
    >
      <Svg width={size} height={size} viewBox="0 0 320 320" fill="none">
        <Defs>
          {/* تدرج هالة الخلفية */}
          <SvgGradient id="bgGlow1" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor="#007AFF" stopOpacity="0.22" />
            <Stop offset="60%" stopColor="#5856D6" stopOpacity="0.12" />
            <Stop offset="100%" stopColor="#007AFF" stopOpacity="0.0" />
          </SvgGradient>

          {/* تدرج ملابس المتدرب */}
          <SvgGradient id="hoodieGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor="#007AFF" />
            <Stop offset="100%" stopColor="#0055D4" />
          </SvgGradient>

          {/* تدرج بشرة المتدرب */}
          <SvgGradient id="skinGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#F5D0A9" />
            <Stop offset="100%" stopColor="#E0B68C" />
          </SvgGradient>

          {/* تدرج هاتف المتدرب */}
          <SvgGradient id="phoneGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor="#1C1C1E" />
            <Stop offset="100%" stopColor="#2C2C2E" />
          </SvgGradient>

          {/* شاشة الهاتف */}
          <SvgGradient id="screenGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#E8F2FF" />
            <Stop offset="100%" stopColor="#C7E0FF" />
          </SvgGradient>
        </Defs>

        {/* هالة خلفية ناعمة */}
        <Circle cx="160" cy="160" r="140" fill="url(#bgGlow1)" />
        <Circle cx="70" cy="90" r="28" fill="#5856D6" fillOpacity="0.08" />
        <Circle cx="260" cy="230" r="42" fill="#007AFF" fillOpacity="0.06" />

        {/* قاعدة/ظل الشخصية */}
        <Path
          d="M60 278 C110 292 210 292 260 278 C240 270 80 270 60 278 Z"
          fill="#000000"
          fillOpacity="0.06"
        />

        {/* جسم المتدرب (الملابس العصرية) */}
        <G id="traineeBody">
          {/* الظهر والكتف */}
          <Path
            d="M92 270 C88 230 100 195 125 180 C136 173 150 170 165 170 C182 170 198 174 208 183 C230 200 238 234 235 270 Z"
            fill="url(#hoodieGrad)"
          />
          {/* ياقة السويت شيرت */}
          <Path
            d="M142 172 C148 184 172 184 178 172 C172 168 148 168 142 172 Z"
            fill="#0043A8"
          />
          {/* أربطة الهودي */}
          <Path d="M152 178 L152 205" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" opacity="0.8" />
          <Path d="M168 178 L168 202" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" opacity="0.8" />
        </G>

        {/* رقبة ورأس المتدرب */}
        <G id="traineeHead">
          {/* الرقبة */}
          <Rect x="150" y="148" width="20" height="26" rx="6" fill="url(#skinGrad)" />
          {/* الرأس والوجه */}
          <Circle cx="160" cy="122" r="34" fill="url(#skinGrad)" />
          {/* الأذن */}
          <Circle cx="126" cy="124" r="7" fill="#E0B68C" />
          <Circle cx="194" cy="124" r="7" fill="#E0B68C" />
          {/* الشعر العربي العصري */}
          <Path
            d="M125 118 C124 92 142 82 160 82 C178 82 196 92 195 118 C188 106 178 102 160 102 C142 102 132 106 125 118 Z"
            fill="#2D2013"
          />
          <Path
            d="M132 94 C146 80 174 80 188 94 C176 86 144 86 132 94 Z"
            fill="#3E2E1E"
          />
          {/* ملامح الوجه البسيطة */}
          <Path d="M144 120 C146 122 150 122 152 120" stroke="#4A3B32" strokeWidth="2" strokeLinecap="round" />
          <Path d="M168 120 C170 122 174 122 176 120" stroke="#4A3B32" strokeWidth="2" strokeLinecap="round" />
          {/* الابتسامة */}
          <Path d="M153 134 Q160 141 167 134" stroke="#4A3B32" strokeWidth="2.2" strokeLinecap="round" fill="none" />
        </G>

        {/* الذراع واليد ممسكة بالهاتف */}
        <G id="traineeArmAndPhone">
          {/* الذراع الأيمن */}
          <Path
            d="M125 210 Q145 235 158 238"
            stroke="url(#hoodieGrad)"
            strokeWidth="24"
            strokeLinecap="round"
          />
          {/* الذراع الأيسر */}
          <Path
            d="M195 210 Q175 235 162 238"
            stroke="url(#hoodieGrad)"
            strokeWidth="24"
            strokeLinecap="round"
          />

          {/* الهاتف الذكي المحمول */}
          <Rect x="144" y="206" width="34" height="60" rx="7" fill="url(#phoneGrad)" />
          {/* شاشة الهاتف */}
          <Rect x="147" y="210" width="28" height="52" rx="4" fill="url(#screenGrad)" />
          {/* خطوط واجهة التطبيق على الشاشة */}
          <Rect x="151" y="216" width="20" height="4" rx="2" fill="#007AFF" />
          <Rect x="151" y="224" width="14" height="3" rx="1.5" fill="#5856D6" opacity="0.6" />
          <Circle cx="161" cy="242" r="8" fill="#34C759" fillOpacity="0.3" />
          <Path d="M158 242 L160 244 L165 239" stroke="#34C759" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />

          {/* أصابع اليدين */}
          <Circle cx="143" cy="235" r="5" fill="#E0B68C" />
          <Circle cx="143" cy="243" r="5" fill="#E0B68C" />
          <Circle cx="178" cy="235" r="5" fill="#E0B68C" />
          <Circle cx="178" cy="243" r="5" fill="#E0B68C" />
        </G>
      </Svg>

      {/* بطاقة المواعيد الطافية (Floating Session Schedule Card) */}
      <Animated.View
        style={{
          position: 'absolute',
          top: 36,
          right: 8,
          transform: [{ translateY: cardTranslateY }],
        }}
      >
        <Svg width={144} height={92} viewBox="0 0 144 92" fill="none">
          {/* ظل البطاقة */}
          <Rect x="4" y="8" width="136" height="80" rx="14" fill="#007AFF" fillOpacity="0.12" />
          {/* جسم البطاقة */}
          <Rect x="2" y="4" width="138" height="82" rx="14" fill="#FFFFFF" stroke="#D1E3FF" strokeWidth="1.2" />

          {/* شريط رأس البطاقة */}
          <Rect x="10" y="12" width="28" height="28" rx="8" fill="#EBF3FF" />
          {/* أيقونة التقويم */}
          <Path
            d="M18 20 H30 M18 24 H28 M21 16 V19 M27 16 V19"
            stroke="#007AFF"
            strokeWidth="2"
            strokeLinecap="round"
          />

          {/* نصوص البطاقة المنمقة */}
          <Rect x="44" y="15" width="60" height="7" rx="3.5" fill="#1C1C1E" />
          <Rect x="44" y="26" width="42" height="5" rx="2.5" fill="#8E8E93" />

          {/* شارة الوقت والجاهزية */}
          <Rect x="10" y="52" width="62" height="22" rx="6" fill="#F0FDF4" stroke="#BBF7D0" strokeWidth="1" />
          <Circle cx="19" cy="63" r="3.5" fill="#22C55E" />
          <Rect x="27" y="60" width="36" height="5" rx="2.5" fill="#15803D" />

          {/* وسم التوقيت */}
          <Rect x="80" y="54" width="48" height="18" rx="5" fill="#FEF3C7" />
          <Rect x="86" y="60" width="36" height="5" rx="2.5" fill="#B45309" />
        </Svg>
      </Animated.View>
    </View>
  );
}
