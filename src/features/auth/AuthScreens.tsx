/**
 * features/auth — الدخول بحساب Google ثم إكمال البيانات.
 * لا OTP، لا رقم هاتف في الدخول، لا حسابات تجريبية.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useApp } from '../../data/store';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import { Btn, FadeIn, GlassBtn, Input, Row, SegmentedProgressBar, Spacer, Txt } from '../../design/components';
import { GlassCard } from '../../design/glass';
import { radii, sizes, spacing } from '../../design/tokens';
import { isReducedMotion } from '../../design/motion';
import { markOnboardingSeen } from '../../shared/onboarding';
import { CloudMascot } from '../../design/mascot';

import * as Haptics from 'expo-haptics';
import { BlurView } from 'expo-blur';
import {
  OnboardingSlide1Illustration,
  OnboardingSlide2Illustration,
  OnboardingSlide3Illustration,
} from '../../design/illustrations';

// ───────────────────────────── Onboarding (تفاعلي حديث 2026) ─────────────────────────────

interface OnboardingSlide {
  key: string;
  title: string;
  body: string;
  from: string;
  to: string;
  Illustration: React.ComponentType<{ size?: number }>;
}

const SLIDES: OnboardingSlide[] = [
  {
    key: 'slide1',
    title: 'onboarding.o1Title',
    body: 'onboarding.o1Body',
    from: '#007AFF',
    to: '#5856D6',
    Illustration: OnboardingSlide1Illustration,
  },
  {
    key: 'slide2',
    title: 'onboarding.o2Title',
    body: 'onboarding.o2Body',
    from: '#10B981',
    to: '#007AFF',
    Illustration: OnboardingSlide2Illustration,
  },
  {
    key: 'slide3',
    title: 'onboarding.o3Title',
    body: 'onboarding.o3Body',
    from: '#F59E0B',
    to: '#EA580C',
    Illustration: OnboardingSlide3Illustration,
  },
];

export function OnboardingScreen({ navigation }: any) {
  const [index, setIndex] = useState(0);
  const { t } = useI18n();
  const { theme, isDark, preference, setTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  // مصفوفة الحركات
  const slideAnim = useRef(new Animated.Value(1)).current;
  const illScale = useRef(new Animated.Value(0.92)).current;
  const illOpacity = useRef(new Animated.Value(0)).current;
  const ctaScale = useRef(new Animated.Value(1)).current;
  const orbDrift = useRef(new Animated.Value(0)).current;
  const orbParallax = useRef(new Animated.Value(0)).current;

  // دوران خفيف للكرات في الخلفية (D4)
  useEffect(() => {
    if (isReducedMotion()) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(orbDrift, { toValue: 1, duration: 7500, useNativeDriver: true }),
        Animated.timing(orbDrift, { toValue: 0, duration: 7500, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [orbDrift]);

  const go = (targetIndex: number) => {
    if (!isReducedMotion()) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: 0, duration: isReducedMotion() ? 80 : 150, useNativeDriver: true }),
      Animated.timing(illOpacity, { toValue: 0, duration: 100, useNativeDriver: true }),
    ]).start(() => {
      setIndex(targetIndex);
      illScale.setValue(0.88);
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 1, duration: isReducedMotion() ? 80 : 260, useNativeDriver: true }),
        Animated.spring(illScale, { toValue: 1, damping: 18, stiffness: 140, useNativeDriver: true }),
        Animated.timing(illOpacity, { toValue: 1, duration: 240, useNativeDriver: true }),
        Animated.spring(orbParallax, { toValue: targetIndex, damping: 20, stiffness: 120, useNativeDriver: true }),
      ]).start();
    });
  };

  useEffect(() => {
    Animated.parallel([
      Animated.spring(illScale, { toValue: 1, damping: 18, stiffness: 140, useNativeDriver: true }),
      Animated.timing(illOpacity, { toValue: 1, duration: 450, useNativeDriver: true }),
    ]).start();
  }, [illOpacity, illScale]);

  const slide = SLIDES[index];
  const isLast = index === SLIDES.length - 1;
  const illSize = Math.min(264, width * 0.68);

  const CurrentIllustration = slide.Illustration;

  const pressCtaIn = () => {
    if (isReducedMotion()) return;
    Animated.spring(ctaScale, { toValue: 0.98, damping: 26, stiffness: 320, useNativeDriver: true }).start();
  };

  const pressCtaOut = () => {
    if (isReducedMotion()) return;
    Animated.spring(ctaScale, { toValue: 1, damping: 22, stiffness: 260, useNativeDriver: true }).start();
  };

  const selectTheme = (pref: 'light' | 'dark' | 'system') => {
    if (!isReducedMotion()) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    setTheme(pref);
  };

  return (
    <View
      style={{
        flex: 1,
        width: '100%',
        maxWidth: 820,
        alignSelf: 'center',
        backgroundColor: theme.bg,
        paddingTop: insets.top + 10,
        paddingBottom: insets.bottom + 20,
        paddingHorizontal: spacing.s6,
        overflow: 'hidden',
      }}
    >
      {/* كرات الخلفية المحيطية مع بارالاكس وحركة هادئة (D4 & D6) */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -90,
          right: -70,
          width: 320,
          height: 320,
          borderRadius: 160,
          backgroundColor: slide.from,
          opacity: isDark ? 0.09 : 0.075,
          transform: [
            {
              translateY: orbDrift.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 18],
              }),
            },
            {
              translateX: orbParallax.interpolate({
                inputRange: [0, 2],
                outputRange: [0, -35],
              }),
            },
          ],
        }}
      />
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          bottom: 120,
          left: -80,
          width: 280,
          height: 280,
          borderRadius: 140,
          backgroundColor: slide.to,
          opacity: isDark ? 0.08 : 0.065,
          transform: [
            {
              translateY: orbDrift.interpolate({
                inputRange: [0, 1],
                outputRange: [0, -18],
              }),
            },
            {
              translateX: orbParallax.interpolate({
                inputRange: [0, 2],
                outputRange: [0, 30],
              }),
            },
          ],
        }}
      />

      {/* الشريط العلوي: الشعار وزر التخطي */}
      <Row between center>
        <Row center gap={10}>
          <LinearGradient
            colors={[theme.brandGradientFrom, theme.brandGradientTo]}
            style={{ width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}
          >
            <Image source={require('../../../assets/adaptive-icon.png')} style={{ width: 26, height: 26 }} resizeMode="contain" />
          </LinearGradient>
          <Txt variant="h3">{t('common.appName')}</Txt>
        </Row>
        <GlassBtn
          label={t('common.skip')}
          size="sm"
          onPress={() => {
            void markOnboardingSeen();
            navigation.replace('SignIn');
          }}
        />
      </Row>

      {/* المحتوى الرئيسي: الرسم التوضيحي والنصوص المنمقة */}
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 12 }}>
        <Animated.View
          style={{
            opacity: slideAnim,
            transform: [
              {
                translateY: slideAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [24, 0],
                }),
              },
            ],
            alignItems: 'center',
            gap: 24,
            width: '100%',
          }}
        >
          {/* حاوية الرسم التوضيحي الزجاجية مع عمق ناعم (D1 & D6) */}
          <Animated.View
            style={{
              opacity: illOpacity,
              transform: [{ scale: illScale }],
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <CurrentIllustration size={illSize} />
          </Animated.View>

          {/* النصوص التعبيرية المحدثة (D8) */}
          <View style={{ alignItems: 'center', gap: 10, maxWidth: 520, paddingHorizontal: 8 }}>
            <Txt variant="h1" align="center">
              {t(slide.title as any)}
            </Txt>
            <Txt variant="body" color={theme.textSecondary} align="center" style={{ lineHeight: 24 }}>
              {t(slide.body as any)}
            </Txt>
          </View>

          {/* شريحة معاينة المظهر المفضّل في الشريحة الأخيرة (D5) */}
          {isLast ? (
            <View
              style={{
                alignItems: 'center',
                gap: 10,
                marginTop: 4,
                width: '100%',
                maxWidth: 360,
              }}
            >
              <Txt variant="caption" color={theme.textMuted} bold>
                {t('onboarding.themePreview')}
              </Txt>
              <Row
                center
                gap={8}
                style={{
                  backgroundColor: theme.fill,
                  borderRadius: radii.pill,
                  padding: 4,
                  borderWidth: 1,
                  borderColor: theme.fillBorder,
                }}
              >
                {(
                  [
                    { id: 'light', label: 'onboarding.themeLight', icon: 'sunny-outline' },
                    { id: 'dark', label: 'onboarding.themeDark', icon: 'moon-outline' },
                    { id: 'system', label: 'onboarding.themeAuto', icon: 'phone-portrait-outline' },
                  ] as const
                ).map((opt) => {
                  const isSelected = preference === opt.id;
                  return (
                    <Pressable
                      key={opt.id}
                      accessibilityRole="radio"
                      accessibilityLabel={t(opt.label)}
                      accessibilityState={{ selected: isSelected }}
                      hitSlop={6}
                      onPress={() => selectTheme(opt.id)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        paddingVertical: 6,
                        paddingHorizontal: 14,
                        borderRadius: radii.pill,
                        backgroundColor: isSelected ? (isDark ? theme.brandSoft : theme.card) : 'transparent',
                        shadowColor: isSelected ? '#000' : 'transparent',
                        shadowOpacity: isSelected ? 0.08 : 0,
                        shadowRadius: 4,
                        elevation: isSelected ? 2 : 0,
                      }}
                    >
                      <Ionicons
                        name={opt.icon}
                        size={15}
                        color={isSelected ? theme.accent : theme.textMuted}
                      />
                      <Txt
                        variant="caption"
                        bold={isSelected}
                        color={isSelected ? theme.text : theme.textMuted}
                      >
                        {t(opt.label)}
                      </Txt>
                    </Pressable>
                  );
                })}
              </Row>
            </View>
          ) : null}
        </Animated.View>
      </View>

      {/* الشريط السفلي: شريط التقدم وزر الـ CTA بمقاس 52pt المعتمد */}
      <View style={{ gap: 20 }}>
        {/* شريط التقدم المتفرق بنمط دوولينجو المعتمد بلون البراند الأزرق الموحد */}
        <View style={{ width: '100%', maxWidth: 240, alignSelf: 'center' }}>
          <SegmentedProgressBar
            totalSegments={SLIDES.length}
            currentSegment={index}
            activeColor={theme.brand}
            segmentHeight={6}
            gap={8}
          />
        </View>

        {/* زر الـ CTA المتفاعل (52pt) */}
        <Animated.View style={{ transform: [{ scale: ctaScale }] }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isLast ? t('onboarding.startNow') : t('common.next')}
            hitSlop={6}
            onPressIn={pressCtaIn}
            onPressOut={pressCtaOut}
            onPress={() => {
              if (!isLast) {
                go(index + 1);
                return;
              }
              if (!isReducedMotion()) {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              }
              void markOnboardingSeen();
              navigation.replace('SignIn');
            }}
            style={{
              backgroundColor: theme.brand,
              borderRadius: radii.button,
              minHeight: sizes.ctaButton, // 52pt standard (D3)
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: theme.brand,
              shadowOpacity: 0.24,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 4 },
              elevation: 4,
            }}
          >
            <Txt variant="h3" color={theme.onBrand}>
              {isLast ? t('onboarding.startNow') : t('common.next')}
            </Txt>
          </Pressable>
        </Animated.View>

        {/* الرابط الثانوي المباشر لتسجيل الدخول */}
        <GlassBtn
          label={t('onboarding.haveAccount')}
          size="sm"
          onPress={() => {
            void markOnboardingSeen();
            navigation.replace('SignIn');
          }}
          style={{ alignSelf: 'center' }}
        />
      </View>
    </View>
  );
}

// ───────────────────────────── الدخول بجوجل ─────────────────────────────

function GoogleMark({ size = 20 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name="logo-google" size={size} color="#EA4335" />
    </View>
  );
}

export function SignInScreen({ navigation }: any) {
  const { t } = useI18n();
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { signInWithGoogle, configured, authError } = useApp();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // الوصول لشاشة الدخول يعني أن المستخدم تجاوز الترحيب — لا نعيده إليه لاحقًا.
  useEffect(() => { void markOnboardingSeen(); }, []);

  const submit = async () => {
    setError('');
    setLoading(true);
    try {
      const r = await signInWithGoogle();
      if (!r.ok && r.error && r.error !== 'cancelled') {
        setError(r.error === 'not-configured' ? t('auth.notConfigured') : `${t('auth.googleFailed')}: ${r.error}`);
      }
    } catch (e) {
      setError(`${t('auth.googleFailed')}: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{
        position: 'absolute', top: -60, right: -80,
        width: 320, height: 320, borderRadius: 160,
        backgroundColor: theme.orbPrimary,
      }} />
      <View style={{
        position: 'absolute', bottom: -40, left: -70,
        width: 280, height: 280, borderRadius: 140,
        backgroundColor: theme.orbSecondary,
      }} />

      <View style={{ flex: 1, width: '100%', maxWidth: 580, alignSelf: 'center', padding: spacing.s6, paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }}>
        <FadeIn index={0}>
          <LinearGradient
            colors={[theme.brandGradientFrom, theme.brandGradientTo]}
            style={{
              width: 84, height: 84, borderRadius: 25,
              alignItems: 'center', justifyContent: 'center',
              shadowColor: theme.brand, shadowOpacity: 0.35, shadowRadius: 24,
              shadowOffset: { width: 0, height: 10 }, elevation: 14,
            }}
          >
            <Image source={require('../../../assets/adaptive-icon.png')} style={{ width: 58, height: 58 }} resizeMode="contain" />
          </LinearGradient>
        </FadeIn>
        <Spacer size={16} />
        <FadeIn index={1}>
          <Txt variant="display">{t('auth.welcomeTitle')}</Txt>
          <Spacer size={6} />
          <Txt variant="caption" color={theme.textSecondary}>
            منظومة إدارة التدريب الذكية — حضورك، ستريكك، وشهاداتك في مكان واحد
          </Txt>
        </FadeIn>

        <Spacer size={20} />
        <FadeIn index={2}>
          <View style={{ alignItems: 'center', marginVertical: 8 }}>
            <CloudMascot
              size={110}
              mode="idle"
              interactive
              speechText="أهلاً بك في مسار! سجّل دخولك بحساب Google للمتابعة ✨"
              showSpeechBubble
            />
          </View>
        </FadeIn>

        {/* مميزات الأمان الموثوقة */}
        <FadeIn index={2}>
          <Row center gap={12} style={{ justifyContent: 'center', marginVertical: 12 }}>
            <Row center gap={4}>
              <Ionicons name="shield-checkmark" size={14} color={theme.success} />
              <Txt variant="micro" color={theme.textMuted}>دخول آمن ومشفر</Txt>
            </Row>
            <Row center gap={4}>
              <Ionicons name="flash" size={14} color={theme.accent} />
              <Txt variant="micro" color={theme.textMuted}>حضور فوري</Txt>
            </Row>
            <Row center gap={4}>
              <Ionicons name="ribbon" size={14} color={theme.certGold} />
              <Txt variant="micro" color={theme.textMuted}>شهادات معتمدة</Txt>
            </Row>
          </Row>
        </FadeIn>

        <View style={{ flex: 1 }} />

        {!configured ? (
          <FadeIn index={2}>
            <GlassCard>
              <Row center gap={10}>
                <Ionicons name="warning" size={20} color={theme.warn} />
                <Txt variant="caption" color={theme.textSecondary} style={{ flex: 1 }}>{t('auth.notConfigured')}</Txt>
              </Row>
            </GlassCard>
            <Spacer size={16} />
          </FadeIn>
        ) : null}

        <FadeIn index={3}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('auth.continueGoogle')}
            accessibilityHint={t('auth.googleHint')}
            onPress={submit}
            disabled={loading || !configured}
            style={({ pressed }) => ({
              backgroundColor: isDark ? 'rgba(255,255,255,0.96)' : '#FFFFFF',
              borderRadius: 16,
              paddingVertical: 16,
              minHeight: 56,
              alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10,
              borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(60,60,67,0.12)',
              opacity: !configured ? 0.5 : pressed ? 0.85 : 1,
              transform: [{ scale: pressed ? 0.985 : 1 }],
              shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 18,
              shadowOffset: { width: 0, height: 8 }, elevation: 6,
            })}
          >
            {loading ? <ActivityIndicator color="#1C1C1E" /> : <GoogleMark size={22} />}
            <Txt variant="h3" color="#1C1C1E">{t('auth.continueGoogle')}</Txt>
          </Pressable>
        </FadeIn>

        {error ? (
          <>
            <Spacer size={12} />
            <Txt variant="caption" color={theme.danger} align="center">{error}</Txt>
          </>
        ) : authError ? (
          <>
            <Spacer size={12} />
            <Txt variant="caption" color={theme.danger} align="center">{t('auth.callbackFailed')}</Txt>
            {authError !== 'oauth-callback-failed' ? (
              <Txt variant="caption" color={theme.textMuted} align="center" style={{ marginTop: 4 }}>{authError}</Txt>
            ) : null}
          </>
        ) : null}

        <Spacer size={18} />
        <FadeIn index={4}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('auth.verifyCertCta')} hitSlop={8} onPress={() => navigation.navigate('Verify')} style={{ alignSelf: 'center', padding: 8, minHeight: sizes.touchTarget, justifyContent: 'center' }}>
            <Row center gap={6}>
              <Ionicons name="ribbon-outline" size={16} color={theme.certGold} />
              <Txt variant="caption" color={theme.textSecondary}>{t('auth.verifyCertCta')}</Txt>
            </Row>
          </Pressable>
        </FadeIn>
      </View>
    </View>
  );
}

// ───────────────────────────── إكمال البيانات بعد جوجل ─────────────────────────────

export function CompleteProfileScreen() {
  const { t } = useI18n();
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { db, identity, user, completeProfile, uploadAvatar, logout } = useApp();

  const [name, setName] = useState(user?.fullName || identity?.fullName || '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [avatar, setAvatar] = useState<string | null>(user?.avatarUrl ?? identity?.avatarUrl ?? null);
  const [branchId, setBranchId] = useState<string | null>(user?.branchId ?? null);
  const [gender, setGender] = useState<'m' | 'f'>(user?.gender ?? 'm');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const pickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (res.canceled || !res.assets?.[0]?.uri) return;
    setUploading(true);
    const url = await uploadAvatar(res.assets[0].uri);
    setUploading(false);
    if (url) setAvatar(url);
  };

  const submit = async () => {
    if (name.trim().split(/\s+/).length < 2) { setError(t('complete.nameError')); return; }
    if (!/^01\d{9}$/.test(phone.trim())) { setError(t('complete.phoneError')); return; }
    if (!branchId && user?.role !== 'admin') { setError(t('complete.chooseBranch')); return; }
    setLoading(true);
    const r = await completeProfile({
      fullName: name.trim(),
      phone: phone.trim(),
      avatarUrl: avatar,
      branchId,
      gender,
    });
    setLoading(false);
    if (!r.ok) setError(r.error ?? t('common.errorTitle'));
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ width: '100%', maxWidth: 680, alignSelf: 'center', padding: spacing.s6, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }}
      keyboardShouldPersistTaps="handled"
    >
      <Row between center>
        <Txt variant="display">{t('complete.title')}</Txt>
        <Pressable accessibilityRole="button" accessibilityLabel={t('profile.logout')} hitSlop={10} onPress={() => void logout()} style={{ padding: 8, minWidth: sizes.touchTarget, minHeight: sizes.touchTarget, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="log-out-outline" size={22} color={theme.textMuted} />
        </Pressable>
      </Row>
      <Spacer size={22} />

      {/* الصورة */}
      <View style={{ alignSelf: 'center', marginBottom: 22 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('profile.changeAvatar')} onPress={pickAvatar}>
          <View style={{
            width: 104, height: 104, borderRadius: 52, overflow: 'hidden',
            backgroundColor: theme.fill,
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 2, borderColor: theme.brand,
          }}>
            {uploading ? (
              <ActivityIndicator color={theme.brand} />
            ) : avatar ? (
              <Image source={{ uri: avatar }} style={{ width: '100%', height: '100%' }} />
            ) : (
              <Ionicons name="person" size={44} color={theme.brand} />
            )}
          </View>
          <View style={{
            position: 'absolute', bottom: 0, end: 0,
            width: 32, height: 32, borderRadius: 16, backgroundColor: theme.brand,
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 2, borderColor: theme.bg,
          }}>
            <Ionicons name="camera" size={16} color="#fff" />
          </View>
        </Pressable>
      </View>

      {/* الإيميل من جوجل — للعرض فقط */}
      <GlassCard>
        <Row center gap={12}>
          <Ionicons name="mail" size={18} color={theme.brand} />
          <View style={{ flex: 1 }}>
            <Txt variant="micro" color={theme.textMuted}>{t('common.email')}</Txt>
            <Txt variant="bodyMed">{identity?.email ?? user?.email ?? '—'}</Txt>
          </View>
          <Ionicons name="lock-closed" size={16} color={theme.textMuted} />
        </Row>
      </GlassCard>
      <Spacer size={16} />

      <Input label={t('complete.fullName')} value={name} onChange={setName} placeholder={t('complete.fullNamePlaceholder')} icon="person" />
      <Spacer size={16} />
      <Input
        label={t('common.phone')}
        value={phone}
        onChange={(v) => { setPhone(v.replace(/[^\d]/g, '')); setError(''); }}
        placeholder={t('auth.phonePlaceholder')}
        keyboardType="phone-pad"
        icon="call"
        maxLength={11}
      />
      <Spacer size={16} />

      <Txt variant="caption" color={theme.textSecondary} style={{ marginBottom: 10 }}>{t('common.gender')}</Txt>
      <Row gap={10}>
        {(['m', 'f'] as const).map((g) => {
          const active = gender === g;
          return (
            <Pressable key={g} accessibilityRole="radio" accessibilityState={{ selected: active }} accessibilityLabel={t(g === 'm' ? 'common.male' : 'common.female')} onPress={() => setGender(g)} style={{ flex: 1 }}>
              <GlassCard style={{ backgroundColor: active ? theme.brandSoft : undefined, borderColor: active ? theme.brand : undefined }}>
                <Row center gap={8} style={{ justifyContent: 'center' }}>
                  <Ionicons name={g === 'm' ? 'male' : 'female'} size={18} color={active ? theme.brand : theme.textMuted} />
                  <Txt variant="bodyMed" color={active ? theme.brand : theme.text}>{t(g === 'm' ? 'common.male' : 'common.female')}</Txt>
                </Row>
              </GlassCard>
            </Pressable>
          );
        })}
      </Row>
      <Spacer size={18} />

      <Txt variant="caption" color={theme.textSecondary} style={{ marginBottom: 10 }}>{t('complete.chooseBranch')}</Txt>
      <View style={{ gap: 10 }}>
        {db.branches.map((b) => {
          const active = branchId === b.id;
          return (
            <Pressable key={b.id} accessibilityRole="radio" accessibilityState={{ selected: active }} accessibilityLabel={b.name} onPress={() => setBranchId(b.id)}>
              <GlassCard style={{
                backgroundColor: active ? theme.brandSoft : undefined,
                borderColor: active ? theme.brand : undefined,
              }}>
                <Row center gap={12}>
                  <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={22} color={active ? theme.brand : theme.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Txt variant="bodyMed">{b.name}</Txt>
                    <Txt variant="caption" color={theme.textSecondary}>{b.governorate}</Txt>
                  </View>
                </Row>
              </GlassCard>
            </Pressable>
          );
        })}
        {db.branches.length === 0 ? (
          <GlassCard>
            <Txt variant="caption" color={theme.textSecondary} align="center">{t('complete.noBranches')}</Txt>
          </GlassCard>
        ) : null}
      </View>

      {error ? <Txt variant="caption" color={theme.danger} style={{ marginTop: 12 }}>{error}</Txt> : null}
      <Spacer size={24} />
      <Btn title={t('complete.finish')} size="lg" full loading={loading} onPress={submit} />
    </ScrollView>
  );
}
