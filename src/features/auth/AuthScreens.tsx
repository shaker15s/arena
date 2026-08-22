/**
 * features/auth — F1: Onboarding (3 سلايدز) → الترحيب → OTP → إكمال الملف.
 * Passwordless بالكامل + «تجربة سريعة» بشخصيات جاهزة للديمو + دخول الجهات للتحقق.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp, IDS } from '../../data/store';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import { Avatar, Btn, Card, FadeIn, Input, Row, Spacer, Txt } from '../../design/components';
import { radii, spacing } from '../../design/tokens';
import { easing, isReducedMotion } from '../../design/motion';

// ───────────────────────────── Onboarding ─────────────────────────────

const SLIDES: Array<{ icon: keyof typeof Ionicons.glyphMap; title: string; body: string; bg: string }> = [
  { icon: 'calendar', title: 'onboarding.o1Title', body: 'onboarding.o1Body', bg: '#8B5CF6' },
  { icon: 'qr-code', title: 'onboarding.o2Title', body: 'onboarding.o2Body', bg: '#14B8A6' },
  { icon: 'trophy', title: 'onboarding.o3Title', body: 'onboarding.o3Body', bg: '#F59E0B' },
];

export function OnboardingScreen({ navigation }: any) {
  const [index, setIndex] = useState(0);
  const { t } = useI18n();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const slideAnim = useRef(new Animated.Value(1)).current;
  const scrollRef = useRef<any>(null);

  const go = (i: number) => {
    Animated.timing(slideAnim, { toValue: 0, duration: isReducedMotion() ? 100 : 160, useNativeDriver: true }).start(() => {
      setIndex(i);
      Animated.timing(slideAnim, { toValue: 1, duration: isReducedMotion() ? 100 : 260, useNativeDriver: true }).start();
    });
  };
  const slide = SLIDES[index];
  const isLast = index === SLIDES.length - 1;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + 10, paddingBottom: insets.bottom + 24, paddingHorizontal: spacing.s6 }}>
      <Row between center>
        <Row center gap={8}>
          <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: theme.brand, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="map" size={19} color="#fff" />
          </View>
          <Txt variant="h3">مسار</Txt>
        </Row>
        <Pressable onPress={() => navigation.replace('Welcome')} style={{ padding: 10 }}>
          <Txt variant="caption" color={theme.textMuted}>{t('common.skip')}</Txt>
        </Pressable>
      </Row>

      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Animated.View style={{ opacity: slideAnim, transform: [{ translateY: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) }], alignItems: 'center', gap: 26 }}>
          <View style={{
            width: Math.min(220, width * 0.5), height: Math.min(220, width * 0.5), borderRadius: 60,
            backgroundColor: slide.bg + '22', alignItems: 'center', justifyContent: 'center',
            borderWidth: 2, borderColor: slide.bg + '44',
          }}>
            <Ionicons name={slide.icon} size={110} color={slide.bg} />
          </View>
          <View style={{ gap: 10, alignItems: 'center' }}>
            <Txt variant="h1" align="center">{t(slide.title as any)}</Txt>
            <Txt variant="body" color={theme.textSecondary} align="center" style={{ maxWidth: 340 }}>{t(slide.body as any)}</Txt>
          </View>
        </Animated.View>
      </View>

      <View style={{ gap: 22 }}>
        <Row center gap={6} style={{ justifyContent: 'center' }}>
          {SLIDES.map((_, i) => (
            <View key={i} style={{ height: 7, width: i === index ? 26 : 7, borderRadius: 4, backgroundColor: i === index ? theme.brand : theme.line }} />
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
  const { theme } = useTheme();
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
    { id: IDS.omar, label: t('auth.tryOmar'), icon: 'school' as const },
    { id: IDS.sara, label: t('auth.trySara'), icon: 'person' as const },
    { id: IDS.mahmoud, label: t('auth.tryMahmoud'), icon: 'shield-checkmark' as const },
    { id: IDS.admin, label: t('auth.tryAdmin'), icon: 'key' as const },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ flex: 1, padding: spacing.s6, paddingTop: insets.top + 20 }}>
        <FadeIn index={0}>
          <View style={{ width: 72, height: 72, borderRadius: 21, backgroundColor: theme.brand, alignItems: 'center', justifyContent: 'center', shadowColor: theme.brand, shadowOpacity: 0.4, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } }}>
            <Ionicons name="map" size={38} color="#fff" />
          </View>
        </FadeIn>
        <Spacer size={18} />
        <FadeIn index={1}>
          <Txt variant="display">{t('auth.welcomeTitle')}</Txt>
          <Spacer size={8} />
          <Txt variant="body" color={theme.textSecondary}>{t('auth.welcomeBody')}</Txt>
        </FadeIn>
        <Spacer size={24} />
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
        <Spacer size={16} />
        <FadeIn index={3}>
          <Btn title={t('auth.sendCode')} size="lg" full loading={loading} onPress={submit} icon="paper-plane" />
        </FadeIn>
        <Spacer size={12} />
        <FadeIn index={4}>
          <Pressable onPress={() => navigation.navigate('Verify')} style={{ alignSelf: 'center', padding: 8 }}>
            <Row center gap={6}>
              <Ionicons name="ribbon-outline" size={16} color={theme.certGold} />
              <Txt variant="caption" color={theme.textSecondary}>{t('auth.verifyCertCta')}</Txt>
            </Row>
          </Pressable>
        </FadeIn>

        <View style={{ flex: 1 }} />

        {/* تجربة سريعة — شخصيات جاهزة للديمو */}
        <FadeIn index={6}>
          <Card glass>
            <Txt variant="caption" color={theme.textSecondary} style={{ marginBottom: 10 }}>
              ⚡ {t('auth.quickTryTitle')}
            </Txt>
            <Row wrap gap={8}>
              {personas.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => quickLogin(p.id)}
                  style={({ pressed }) => ({
                    flexDirection: 'row', alignItems: 'center', gap: 7,
                    backgroundColor: theme.brandSoft, borderRadius: radii.pill,
                    paddingHorizontal: 13, paddingVertical: 9,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Ionicons name={p.icon} size={14} color={theme.brand} />
                  <Txt variant="caption" color={theme.brand}>{p.label}</Txt>
                </Pressable>
              ))}
            </Row>
          </Card>
        </FadeIn>
        <Spacer size={10} />
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
  const { theme } = useTheme();
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

  // لصق الكود التجريبي تلقائيًا (الديمو) — يسهّل الفلو الذهبي
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
    // 'existing' → المخزن يحدّث الجلسة والملاحة تنتقل تلقائيًا
  };

  const setDigit = (i: number, v: string) => {
    const digits = v.replace(/[^\d]/g, '');
    // دعم لصق كامل
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
      <Pressable onPress={() => navigation.goBack()} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="chevron-forward" size={22} color={theme.text} />
      </Pressable>
      <Spacer size={26} />
      <Txt variant="display">{t('auth.otpTitle')}</Txt>
      <Spacer size={8} />
      <Txt variant="body" color={theme.textSecondary}>{t('auth.otpBody')} {phone}</Txt>
      <Spacer size={14} />
      {demoCode ? (
        <Card color={theme.brandSoft} style={{ alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 14 }}>
          <Row center gap={8}>
            <Ionicons name="information-circle" size={16} color={theme.brand} />
            <Txt variant="caption" color={theme.brand}>{t('auth.otpDemoHint')}</Txt>
            <Txt variant="h3" color={theme.brand} style={{ letterSpacing: 4 }}>{demoCode}</Txt>
          </Row>
        </Card>
      ) : null}
      <Spacer size={26} />
      <Animated.View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, transform: [{ translateX: shakeAnim }] }}>
        {code.map((d, i) => (
          <View key={`${i}-${shake}`} style={{
            width: 50, height: 60, borderRadius: 14, borderWidth: 2,
            borderColor: d ? theme.brand : error ? theme.danger : theme.line,
            backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center',
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
      {error ? <Txt variant="caption" color={theme.danger} style={{ marginTop: 10 }}>{error}</Txt> : null}
      <Spacer size={26} />
      <Btn title={t('auth.verify')} size="lg" full loading={loading} onPress={() => submit()} />
      <Spacer size={18} />
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
        fontSize: 24, fontFamily: 'IBMPlexSansArabic_700Bold', color: themeText,
        ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as object : {}),
      }}
    />
  );
}

// ───────────────────────────── إكمال الملف ─────────────────────────────

export function CompleteProfileScreen({ navigation }: any) {
  const { t } = useI18n();
  const { theme } = useTheme();
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
      {/* شريط تقدم 3 خطوات */}
      <Row gap={6}>
        {[1, 2, 3].map((i) => (
          <View key={i} style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: i <= 3 ? theme.brand : theme.line }} />
        ))}
      </Row>
      <Spacer size={24} />
      <Txt variant="display">{t('complete.title')}</Txt>
      <Spacer size={20} />
      <View style={{ alignSelf: 'center', marginBottom: 18 }}>
        <View style={{
          width: 96, height: 96, borderRadius: 48, backgroundColor: theme.brandSoft,
          alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: theme.brand, borderStyle: 'dashed',
        }}>
          <Ionicons name="camera" size={34} color={theme.brand} />
        </View>
        <Txt variant="micro" color={theme.textMuted} align="center" style={{ marginTop: 6 }}>{t('complete.avatarHint')}</Txt>
      </View>
      <Input label={t('complete.fullName')} value={name} onChange={setName} placeholder={t('complete.fullNamePlaceholder')} icon="person" />
      <Spacer size={16} />
      <Txt variant="caption" color={theme.textSecondary} style={{ marginBottom: 8 }}>{t('complete.chooseBranch')}</Txt>
      <View style={{ gap: 10 }}>
        {db.branches.map((b) => {
          const active = branchId === b.id;
          return (
            <Pressable key={b.id} onPress={() => setBranchId(b.id)}>
              <Card color={active ? theme.brandSoft : undefined} style={{ borderColor: active ? theme.brand : theme.line }}>
                <Row center gap={10}>
                  <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={20} color={active ? theme.brand : theme.textMuted} />
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
      {error ? <Txt variant="caption" color={theme.danger} style={{ marginTop: 8 }}>{error}</Txt> : null}
      <Spacer size={14} />
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
