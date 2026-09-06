/**
 * design/illustrations/OnboardingSlide2Illustration.tsx
 * رسم توضيحي فكتور مخصص للشريحة الثانية (D1):
 * شاشة هاتف فيها QR code يتوهج مع أيدي تمسك الهاتف وشعاع ليزر مسح متحرك وعداد 25 ثانية.
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

export function OnboardingSlide2Illustration({ size = 260, style }: Props) {
  const scanAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isReducedMotion()) return;
    const scanLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanAnim, {
          toValue: 1,
          duration: 2200,
          useNativeDriver: true,
        }),
        Animated.timing(scanAnim, {
          toValue: 0,
          duration: 2200,
          useNativeDriver: true,
        }),
      ])
    );

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.08,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
      ])
    );

    scanLoop.start();
    pulseLoop.start();
    return () => {
      scanLoop.stop();
      pulseLoop.stop();
    };
  }, [scanAnim, pulseAnim]);

  const laserTranslateY = scanAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 76],
  });

  return (
    <View
      accessibilityLabel="هاتف ذكي ممسوك باليد يمسح رمز الاستجابة السريعة بشعاع ليزر متوهج وعداد 25 ثانية لتسجيل الحضور"
      accessible={true}
      style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}
    >
      <Svg width={size} height={size} viewBox="0 0 320 320" fill="none">
        <Defs>
          {/* هالة المسح الخضراء والزرقاء */}
          <SvgGradient id="bgGlow2" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor="#30D158" stopOpacity="0.22" />
            <Stop offset="60%" stopColor="#007AFF" stopOpacity="0.14" />
            <Stop offset="100%" stopColor="#34C759" stopOpacity="0.0" />
          </SvgGradient>

          {/* تدرج هاتف المسح */}
          <SvgGradient id="phoneBodyGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#2C2C2E" />
            <Stop offset="100%" stopColor="#1C1C1E" />
          </SvgGradient>

          {/* شاشة الكاميرا */}
          <SvgGradient id="viewfinderGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#0F172A" />
            <Stop offset="100%" stopColor="#020617" />
          </SvgGradient>

          {/* شعاع الليزر */}
          <SvgGradient id="laserGrad" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0%" stopColor="#34C759" stopOpacity="0.0" />
            <Stop offset="30%" stopColor="#30D158" stopOpacity="0.95" />
            <Stop offset="50%" stopColor="#6EE7B7" stopOpacity="1" />
            <Stop offset="70%" stopColor="#30D158" stopOpacity="0.95" />
            <Stop offset="100%" stopColor="#34C759" stopOpacity="0.0" />
          </SvgGradient>

          <SvgGradient id="handSkinGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#F5D0A9" />
            <Stop offset="100%" stopColor="#D4A77D" />
          </SvgGradient>
        </Defs>

        {/* هالة الخلفية التقنية */}
        <Circle cx="160" cy="160" r="140" fill="url(#bgGlow2)" />
        <Circle cx="250" cy="80" r="30" fill="#30D158" fillOpacity="0.08" />
        <Circle cx="70" cy="240" r="36" fill="#007AFF" fillOpacity="0.08" />

        {/* جسم الهاتف الذكي المركزي المرفوع */}
        <G id="phoneFrame">
          {/* ظل الهاتف */}
          <Rect x="78" y="44" width="164" height="248" rx="34" fill="#000000" fillOpacity="0.18" />
          {/* إطار الهاتف الميكانيكي */}
          <Rect x="74" y="38" width="172" height="254" rx="36" fill="url(#phoneBodyGrad)" stroke="#3A3A3C" strokeWidth="2.5" />
          {/* شاشة العرض والمسح */}
          <Rect x="84" y="50" width="152" height="230" rx="26" fill="url(#viewfinderGrad)" />

          {/* الكاميرا الأمامية والنوتش العلوي */}
          <Rect x="135" y="56" width="50" height="12" rx="6" fill="#000000" />
          <Circle cx="166" cy="62" r="3" fill="#1E293B" />
        </G>

        {/* محتوى الشاشة: نافذة الكاميرا ورمز QR */}
        <G id="cameraContent">
          {/* زوايا نافذة مسح الكاميرا (Target Brackets) */}
          {/* أعلى اليمين */}
          <Path d="M190 95 H206 V111" stroke="#30D158" strokeWidth="3" strokeLinecap="round" fill="none" />
          {/* أعلى اليسار */}
          <Path d="M130 95 H114 V111" stroke="#30D158" strokeWidth="3" strokeLinecap="round" fill="none" />
          {/* أسفل اليمين */}
          <Path d="M190 185 H206 V169" stroke="#30D158" strokeWidth="3" strokeLinecap="round" fill="none" />
          {/* أسفل اليسار */}
          <Path d="M130 185 H114 V169" stroke="#30D158" strokeWidth="3" strokeLinecap="round" fill="none" />

          {/* رمز الاستجابة السريعة (QR Code Pattern) */}
          <G id="qrCodeMatrix" transform="translate(122, 103)">
            {/* خلفية بيضاء عاكسة خفيفة للـ QR */}
            <Rect x="-2" y="-2" width="80" height="80" rx="10" fill="#FFFFFF" fillOpacity="0.95" />

            {/* مربعات تحديد زوايا الـ QR (Finder Patterns) */}
            {/* زاوية 1 */}
            <Rect x="4" y="4" width="22" height="22" rx="4" stroke="#0F172A" strokeWidth="3.5" fill="none" />
            <Rect x="9" y="9" width="12" height="12" rx="2" fill="#0F172A" />

            {/* زاوية 2 */}
            <Rect x="50" y="4" width="22" height="22" rx="4" stroke="#0F172A" strokeWidth="3.5" fill="none" />
            <Rect x="55" y="9" width="12" height="12" rx="2" fill="#0F172A" />

            {/* زاوية 3 */}
            <Rect x="4" y="50" width="22" height="22" rx="4" stroke="#0F172A" strokeWidth="3.5" fill="none" />
            <Rect x="9" y="55" width="12" height="12" rx="2" fill="#0F172A" />

            {/* مصفوفة البتات الداخلية */}
            <Rect x="32" y="6" width="6" height="6" rx="1" fill="#0F172A" />
            <Rect x="40" y="14" width="6" height="6" rx="1" fill="#0F172A" />
            <Rect x="30" y="24" width="7" height="7" rx="1.5" fill="#30D158" />
            <Rect x="40" y="24" width="6" height="6" rx="1" fill="#0F172A" />

            <Rect x="6" y="32" width="6" height="6" rx="1" fill="#0F172A" />
            <Rect x="16" y="38" width="6" height="6" rx="1" fill="#0F172A" />
            <Rect x="26" y="34" width="6" height="6" rx="1" fill="#0F172A" />
            <Rect x="36" y="36" width="8" height="8" rx="2" fill="#007AFF" />
            <Rect x="48" y="32" width="6" height="6" rx="1" fill="#0F172A" />
            <Rect x="58" y="38" width="6" height="6" rx="1" fill="#0F172A" />

            <Rect x="32" y="48" width="6" height="6" rx="1" fill="#0F172A" />
            <Rect x="42" y="56" width="8" height="8" rx="2" fill="#0F172A" />
            <Rect x="54" y="48" width="6" height="6" rx="1" fill="#0F172A" />
            <Rect x="62" y="58" width="6" height="6" rx="1" fill="#30D158" />
          </G>

          {/* شريط حالة الحضور أسفل الشاشة */}
          <Rect x="100" y="210" width="120" height="34" rx="10" fill="#1E293B" stroke="#334155" strokeWidth="1" />
          <Circle cx="118" cy="227" r="7" fill="#34C759" />
          <Path d="M115 227 L117 229 L122 225" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <Rect x="132" y="222" width="76" height="5" rx="2.5" fill="#F8FAFC" />
          <Rect x="132" y="230" width="48" height="4" rx="2" fill="#94A3B8" />
        </G>

        {/* اليدان الماسكتان بالهاتف */}
        <G id="holdingHands">
          {/* يد يسرى على الجانب الأيسر للهاتف */}
          <Path
            d="M38 270 C38 230 52 195 76 178 C77 186 80 198 80 208 C75 220 72 245 74 270 Z"
            fill="url(#handSkinGrad)"
          />
          <Path d="M72 188 C78 188 84 192 84 198 C84 204 78 208 72 208 Z" fill="#D4A77D" />
          <Path d="M72 208 C78 208 84 212 84 218 C84 224 78 228 72 228 Z" fill="#D4A77D" />
          <Path d="M72 228 C78 228 84 232 84 238 C84 244 78 248 72 248 Z" fill="#D4A77D" />

          {/* يد يمنى على الجانب الأيمن للهاتف */}
          <Path
            d="M282 270 C282 230 268 195 244 178 C243 186 240 198 240 208 C245 220 248 245 246 270 Z"
            fill="url(#handSkinGrad)"
          />
          <Path d="M248 188 C242 188 236 192 236 198 C236 204 242 208 248 208 Z" fill="#D4A77D" />
          <Path d="M248 208 C242 208 236 212 236 218 C236 224 242 228 248 228 Z" fill="#D4A77D" />
          <Path d="M248 228 C242 228 236 232 236 238 C236 244 242 248 248 248 Z" fill="#D4A77D" />
        </G>
      </Svg>

      {/* شعاع المسح الليزري المتحرك داخل الشاشة */}
      <Animated.View
        style={{
          position: 'absolute',
          top: 104,
          left: 110,
          right: 110,
          height: 8,
          transform: [{ translateY: laserTranslateY }],
        }}
      >
        <Svg width={100} height={8} viewBox="0 0 100 8" fill="none">
          <Rect x="0" y="2" width="100" height="4" rx="2" fill="url(#laserGrad)" />
        </Svg>
      </Animated.View>

      {/* وسم مؤشر الـ 25 ثانية التفاعلي الطافي */}
      <Animated.View
        style={{
          position: 'absolute',
          top: 30,
          left: 12,
          transform: [{ scale: pulseAnim }],
        }}
      >
        <Svg width={104} height={42} viewBox="0 0 104 42" fill="none">
          <Rect x="2" y="2" width="100" height="38" rx="19" fill="#0F172A" stroke="#30D158" strokeWidth="1.6" />
          {/* دائرة العداد الدوارة */}
          <Circle cx="21" cy="21" r="11" stroke="#334155" strokeWidth="2.5" fill="none" />
          <Circle cx="21" cy="21" r="11" stroke="#30D158" strokeWidth="2.5" strokeDasharray="50" strokeDashoffset="18" fill="none" strokeLinecap="round" />
          <Circle cx="21" cy="21" r="3" fill="#30D158" />

          {/* نص 25 ثانية */}
          <Rect x="40" y="14" width="48" height="6" rx="3" fill="#F8FAFC" />
          <Rect x="40" y="23" width="34" height="5" rx="2.5" fill="#30D158" />
        </Svg>
      </Animated.View>
    </View>
  );
}
