/**
 * features/auth — F1: Onboarding → الترحيب → OTP → إكمال الملف.
 * تصميم Apple Liquid Glass + أنيميشنات سلسة.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useApp, IDS } from '../../data/store';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import { Btn, Card, FadeIn, Input, Row, Spacer, Txt } from '../../design/components';
import { radii, spacing } from '../../design/tokens';
import { easing, isReducedMotion } from '../../design/motion';

// ───────────────────────────── Onboarding ─────────────────────────────

const SLIDES: Array<{ icon: keyof typeof Ionicons.glyphMap; title: string; body: string; from: string; to: string }> = [
  { icon: 'calendar', title: 'onboarding.o1Title', body: 'onboarding.o1Body', from: '#007AFF', to: '#5856D6' },
  { icon: 'qr-code', title: 'onboarding.o2Title', body: 'onboarding.o2Body', from: '#30D158', to: '#34C759' },
  { icon: 'trophy', title: 'onboarding.o3Title', body: 'onboarding.o3Body', from: '#FF9F0A', to: '#FF3B30' },
];

export function OnboardingScreen({ navigation }: any) {
  const [index, setIndex] = useState(0);
  const { t } = useI18n();
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const slideAnim = useRef(new Animated.Value(1)).current;
  const iconScale = useRef(new Animated.Value(0.8)).current;
  const iconOpacity = useRef(new Animated.Value(0)).current;

  const go = (i: number) => {
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: 0, duration: isReducedMotion() ? 100 : 160, useNativeDriver: true }),
      Animated.timing(iconOpacity, { toValue: 0, duration: 100, useNativeDriver: true }),
    ]).start(() => {
      setIndex(i);
      iconScale.setValue(0.6);
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 1, duration: isReducedMotion() ? 100 : 300, useNativeDriver: true }),
        Animated.spring(iconScale, { toValue: 1, damping: 12, stiffness: 100, useNativeDriver: true }),
        Animated.timing(iconOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start();
    });
  };

  useEffect(() => {
    Animated.parallel([
      Animated.spring(iconScale, { toValue: 1, damping: 12, stiffness: 100, useNativeDriver: true }),
      Animated.timing(iconOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]).start();
  }, []);

  const slide = SLIDES[index];
  const isLast = index === SLIDES.length - 1;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + 10, paddingBottom: insets.bottom + 24, paddingHorizontal: spacing.s6 }}>
      {/* Background decorative orb */}
      <View style={{
        position: 'absolute', top: -100, left: -80,
        width: 350, height: 350, borderRadius: 175,
        backgroundColor: isDark ? `${slide.from}08` : `${slide.from}0A`,
      }} />

      <Row between center>
        <Row center gap={8}>
          <LinearGradient
            colors={[theme.brandGradientFrom, theme.brandGradientTo]}
            style={{ width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="map" size={20} color="#fff" />
          </LinearGradient>
          <Txt variant="h3">مسار</Txt>
        </Row>
        <Pressable onPress={() => navigation.replace('Welcome')} style={{ padding: 10 }}>
          <Txt variant="caption" color={theme.textMuted}>{t('common.skip')}</Txt>
        </Pressable>
      </Row>

      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Animated.View style={{ opacity: slideAnim, transform: [{ translateY: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) }], alignItems: 'center', gap: 28 }}>
          {/* Icon circle with gradient */}
          <Animated.View style={{ opacity: iconOpacity, transform: [{ scale: iconScale }] }}>
            <LinearGradient
              colors={[slide.from + '20', slide.to + '15']}
              style={{
                width: Math.min(220, width * 0.5),
                height: Math.min(220, width * 0.5),
                borderRadius: 60,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1,
                borderColor: slide.from + '30',
              }}
            >
              <Ionicons name={slide.icon} size={100} color={slide.from} />
            </LinearGradient>
          </Animated.View>

          <View style={{ gap: 10, alignItems: 'center', marginTop: 8 }}>
            <Txt variant="h1" align="center">{t(slide.title as any)}</Txt>
            <Txt variant="body" color={theme.textSecondary} align="center" style={{ maxWidth: 340, paddingHorizontal: 8 }}>{t(slide.body as any)}</Txt>
          </View>
        </Animated.View>
      </View>

      <View style={{ gap: 24 }}>
        {/* Dots */}
        <Row center gap={8} style={{ justifyContent: 'center' }}>
          {SLIDES.map((_, i) => (
            <View key={i} style={{
              height: 8, width: i === index ? 28 : 8, borderRadius: 4,
              backgroundColor: i === index ? theme.brand : isDark ? 'rgba(120,120,128,0.3)' : 'rgba(120,120,128,0.15)',
            }} />
          ))}
        </Row>
        <Btn
          title={isLast ? t('onboarding.startNow') : t('common.next')}
          size="lg"
          full
          onPress={() => (isLast ? navigation.replace('Welcome') : go(index + 1))}
        />
      </View>
    </View>
  );
}

// ───────────────────────────── الترحيب + الهاتف + التجربة السريعة ─────────────────────────────

export function WelcomeScreen({ navigation }: any) {
  const { t, rtl } = useI18n();
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { requestOtp, quickLogin } = useApp();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    const r = await requestOtp(phone);
    setLoading(false);
    if (!r.ok) {
      setError(t('auth.phoneInvalid'));
      return;
    }
    navigation.navigate('Otp', { phone });
  };

  const personas = [
    { id: IDS.omar, label: t('auth.tryOmar'), icon: 'school' as const, color: '#007AFF' },
    { id: IDS.sara, label: t('auth.trySara'), icon: 'person' as const, color: '#30D158' },
    { id: IDS.mahmoud, label: t('auth.tryMahmoud'), icon: 'shield-checkmark' as const, color: '#FF9F0A' },
    { id: IDS.admin, label: t('auth.tryAdmin'), icon: 'key' as const, color: '#FF3B30' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Background orb */}
      <View style={{
        position: 'absolute', top: -60, right: -80,
        width: 300, height: 300, borderRadius: 150,
        backgroundColor: isDark ? 'rgba(0,122,255,0.05)' : 'rgba(0,122,255,0.03)',
      }} />

      <View style={{ flex: 1, padding: spacing.s6, paddingTop: insets.top + 24 }}>
        <FadeIn index={0}>
          <LinearGradient
            colors={[theme.brandGradientFrom, theme.brandGradientTo]}
            style={{
              width: 76, height: 76, borderRadius: 23,
              alignItems: 'center', justifyContent: 'center',
              shadowColor: theme.brand,
              shadowOpacity: 0.35,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: 10 },
              elevation: 14,
            }}
          >
            <Ionicons name="map" size={40} color="#fff" />
          </LinearGradient>
        </FadeIn>
        <Spacer size={22} />
        <FadeIn index={1}>
          <Txt variant="display">{t('auth.welcomeTitle')}</Txt>
          <Spacer size={8} />
          <Txt variant="body" color={theme.textSecondary}>{t('auth.welcomeBody')}</Txt>
        </FadeIn>
        <Spacer size={28} />
        <FadeIn index={2}>
          <Input
            label={t('common.phone')}
            value={phone}
            onChange={(v) => { setPhone(v.replace(/[^\d]/g, '')); setError(''); }}
            placeholder={t('auth.phonePlaceholder')}
            keyboardType="phone-pad"
            icon="call"
            error={error || undefined}
            maxLength={11}
          />
        </FadeIn>
        <Spacer size={18} />
        <FadeIn index={3}>
          <Btn title={t('auth.sendCode')} size="lg" full loading={loading} onPress={submit} icon="paper-plane" />
        </FadeIn>
        <Spacer size={14} />
        <FadeIn index={4}>
          <Pressable onPress={() => navigation.navigate('Verify')} style={{ alignSelf: 'center', padding: 8 }}>
            <Row center gap={6}>
              <Ionicons name="ribbon-outline" size={16} color={theme.certGold} />
              <Txt variant="caption" color={theme.textSecondary}>{t('auth.verifyCertCta')}</Txt>
            </Row>
          </Pressable>
        </FadeIn>

        <View style={{ flex: 1 }} />

        {/* تجربة سريعة — شخصيات جاهزة */}
        <FadeIn index={6}>
          <Card glass>
            <Txt variant="caption" color={theme.textSecondary} style={{ marginBottom: 12 }}>
              ⚡ {t('auth.quickTryTitle')}
            </Txt>
            <Row wrap gap={8}>
              {personas.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => quickLogin(p.id)}
                  style={({ pressed }) => ({
                    flexDirection: 'row', alignItems: 'center', gap: 8,
                    backgroundColor: isDark ? 'rgba(120,120,128,0.24)' : 'rgba(120,120,128,0.12)',
                    borderRadius: radii.pill,
                    paddingHorizontal: 14, paddingVertical: 10,
                    opacity: pressed ? 0.7 : 1,
                    transform: [{ scale: pressed ? 0.96 : 1 }],
                  })}
                >
                  <Ionicons name={p.icon} size={14} color={p.color} />
                  <Txt variant="caption" color={theme.text}>{p.label}</Txt>
                </Pressable>
              ))}
            </Row>
          </Card>
        </FadeIn>
        <Spacer size={12} />
        <Txt variant="micro" color={theme.textMuted} align="center">
          {t('common.demoBanner')}
        </Txt>
      </View>
    </View>
  );
}

// ───────────────────────────── OTP 6 خانات ─────────────────────────────

export function OtpScreen({ navigation, route }: any) {
  const { t } = useI18n();
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { verifyOtp, pendingOtp } = useApp();
  const phone: string = route?.params?.phone ?? '';
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [shake, setShake] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [seconds, setSeconds] = useState(30);
  const inputsRef = useRef<Array<any>>([]);
  const shakeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const timer = setInterval(() => setSeconds((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const t1 = setTimeout(() => {
      if (pendingOtp) setCode(pendingOtp.code.split(''));
    }, 700);
    return () => clearTimeout(t1);
  }, [pendingOtp]);

  const doShake = () => {
    setShake((s) => s + 1);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  };

  const submit = async (full?: string) => {
    const value = full ?? code.join('');
    if (value.length !== 6) return;
    setLoading(true);
    const r = await verifyOtp(value);
    setLoading(false);
    if (r.outcome === 'wrong') {
      setError(t('auth.wrongOtp'));
      doShake();
      setCode(['', '', '', '', '', '']);
      inputsRef.current[0]?.focus?.();
    } else if (r.outcome === 'new') {
      navigation.navigate('CompleteProfile');
    }
  };

  const setDigit = (i: number, v: string) => {
    const digits = v.replace(/[^\d]/g, '');
    if (digits.length === 6) {
      setCode(digits.split(''));
      submit(digits);
      return;
    }
    const next = [...code];
    next[i] = digits.slice(-1);
    setCode(next);
    setError('');
    if (digits && i < 5) inputsRef.current[i + 1]?.focus?.();
    if (next.every((d) => d)) submit(next.join(''));
  };

  const demoCode = pendingOtp?.code;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, padding: spacing.s6, paddingTop: insets.top + 16 }}>
      <Pressable onPress={() => navigation.goBack()} style={({ pressed }) => ({
        width: 44, height: 44, borderRadius: 22,
        backgroundColor: isDark ? 'rgba(120,120,128,0.24)' : 'rgba(120,120,128,0.12)',
        alignItems: 'center', justifyContent: 'center',
        opacity: pressed ? 0.7 : 1,
      })}>
        <Ionicons name="chevron-forward" size={22} color={theme.text} />
      </Pressable>
      <Spacer size={28} />
      <Txt variant="display">{t('auth.otpTitle')}</Txt>
      <Spacer size={8} />
      <Txt variant="body" color={theme.textSecondary}>{t('auth.otpBody')} {phone}</Txt>
      <Spacer size={16} />
      {demoCode ? (
        <Card style={{ alignSelf: 'flex-start', paddingVertical: 10, paddingHorizontal: 16, backgroundColor: theme.brandSoft, borderWidth: 0 }}>
          <Row center gap={8}>
            <Ionicons name="information-circle" size={16} color={theme.brand} />
            <Txt variant="caption" color={theme.brand}>{t('auth.otpDemoHint')}</Txt>
            <Txt variant="h3" color={theme.brand} style={{ letterSpacing: 4 }}>{demoCode}</Txt>
          </Row>
        </Card>
      ) : null}
      <Spacer size={30} />
      <Animated.View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, transform: [{ translateX: shakeAnim }] }}>
        {code.map((d, i) => (
          <View key={`${i}-${shake}`} style={{
            width: 52, height: 62, borderRadius: 16,
            borderWidth: 2,
            borderColor: d ? theme.brand : error ? theme.danger : isDark ? 'rgba(84,84,88,0.35)' : 'rgba(120,120,128,0.15)',
            backgroundColor: isDark ? 'rgba(120,120,128,0.12)' : 'rgba(120,120,128,0.06)',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <OTPBox
              value={d}
              onChange={(v: string) => setDigit(i, v)}
              onRef={(r: any) => { inputsRef.current[i] = r; }}
              themeText={theme.text}
              autoFocus={i === 0}
            />
          </View>
        ))}
      </Animated.View>
      {error ? <Txt variant="caption" color={theme.danger} style={{ marginTop: 12 }}>{error}</Txt> : null}
      <Spacer size={30} />
      <Btn title={t('auth.verify')} size="lg" full loading={loading} onPress={() => submit()} />
      <Spacer size={20} />
      <Pressable disabled={seconds > 0} onPress={() => setSeconds(30)} style={{ alignSelf: 'center', padding: 8 }}>
        <Txt variant="caption" color={seconds > 0 ? theme.textMuted : theme.brand}>
          {seconds > 0 ? `${t('auth.resendIn')} ${seconds}` : t('auth.resend')}
        </Txt>
      </Pressable>
    </View>
  );
}

function OTPBox({ value, onChange, onRef, themeText, autoFocus }: any) {
  const { TextInput } = require('react-native');
  return (
    <TextInput
      ref={onRef}
      value={value}
      onChangeText={onChange}
      keyboardType="numeric"
      maxLength={6}
      autoFocus={autoFocus}
      style={{
        width: '100%', height: '100%', textAlign: 'center',
        fontSize: 26, fontFamily: 'IBMPlexSansArabic_700Bold', color: themeText,
        ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as object : {}),
      }}
    />
  );
}

// ───────────────────────────── إكمال الملف ─────────────────────────────

export function CompleteProfileScreen({ navigation }: any) {
  const { t } = useI18n();
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { db, completeProfile } = useApp();
  const [name, setName] = useState('');
  const [branchId, setBranchId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (name.trim().split(/\s+/).length < 2) { setError(t('complete.fullNamePlaceholder')); return; }
    if (!branchId) { setError(t('complete.chooseBranch')); return; }
    setLoading(true);
    await completeProfile(name.trim(), branchId);
    setLoading(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, padding: spacing.s6, paddingTop: insets.top + 16 }}>
      {/* Progress bar */}
      <Row gap={6}>
        {[1, 2, 3].map((i) => (
          <View key={i} style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: i <= 3 ? theme.brand : isDark ? 'rgba(84,84,88,0.3)' : 'rgba(120,120,128,0.12)' }} />
        ))}
      </Row>
      <Spacer size={26} />
      <Txt variant="display">{t('complete.title')}</Txt>
      <Spacer size={22} />
      <View style={{ alignSelf: 'center', marginBottom: 20 }}>
        <View style={{
          width: 100, height: 100, borderRadius: 50,
          backgroundColor: isDark ? 'rgba(120,120,128,0.24)' : 'rgba(120,120,128,0.12)',
          alignItems: 'center', justifyContent: 'center',
          borderWidth: 2, borderColor: theme.brand, borderStyle: 'dashed',
        }}>
          <Ionicons name="camera" size={36} color={theme.brand} />
        </View>
        <Txt variant="micro" color={theme.textMuted} align="center" style={{ marginTop: 8 }}>{t('complete.avatarHint')}</Txt>
      </View>
      <Input label={t('complete.fullName')} value={name} onChange={setName} placeholder={t('complete.fullNamePlaceholder')} icon="person" />
      <Spacer size={18} />
      <Txt variant="caption" color={theme.textSecondary} style={{ marginBottom: 10 }}>{t('complete.chooseBranch')}</Txt>
      <View style={{ gap: 10 }}>
        {db.branches.map((b) => {
          const active = branchId === b.id;
          return (
            <Pressable key={b.id} onPress={() => setBranchId(b.id)}>
              <Card style={{
                backgroundColor: active ? theme.brandSoft : undefined,
                borderColor: active ? theme.brand : isDark ? 'rgba(84,84,88,0.35)' : 'rgba(255,255,255,0.5)',
              }}>
                <Row center gap={12}>
                  <View style={{
                    width: 40, height: 40, borderRadius: 12,
                    backgroundColor: active ? theme.brandSoft : isDark ? 'rgba(120,120,128,0.24)' : 'rgba(120,120,128,0.12)',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={20} color={active ? theme.brand : theme.textMuted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt variant="bodyMed">{b.name}</Txt>
                    <Txt variant="caption" color={theme.textSecondary}>{b.governorate}</Txt>
                  </View>
                </Row>
              </Card>
            </Pressable>
          );
        })}
      </View>
      {error ? <Txt variant="caption" color={theme.danger} style={{ marginTop: 10 }}>{error}</Txt> : null}
      <Spacer size={16} />
      <Row center gap={8}>
        <Ionicons name="medal" size={16} color={theme.certGold} />
        <Txt variant="caption" color={theme.textSecondary}>{t('complete.welcomeBadge')}</Txt>
      </Row>
      <View style={{ flex: 1 }} />
      <Btn title={t('complete.finish')} size="lg" full loading={loading} onPress={submit} />
      <Spacer size={insets.bottom} />
    </View>
  );
}
