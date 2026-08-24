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
import { Btn, FadeIn, Input, Row, Spacer, Txt } from '../../design/components';
import { GlassCard } from '../../design/glass';
import { spacing } from '../../design/tokens';
import { isReducedMotion } from '../../design/motion';

// ───────────────────────────── Onboarding (عناوين فقط) ─────────────────────────────

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
    <View style={{ flex: 1, width: '100%', maxWidth: 820, alignSelf: 'center', backgroundColor: theme.bg, paddingTop: insets.top + 10, paddingBottom: insets.bottom + 24, paddingHorizontal: spacing.s6 }}>
      <View style={{
        position: 'absolute', top: -100, left: -80,
        width: 350, height: 350, borderRadius: 175,
        backgroundColor: isDark ? `${slide.from}12` : `${slide.from}0A`,
      }} />

      <Row between center>
        <Row center gap={8}>
          <LinearGradient
            colors={[theme.brandGradientFrom, theme.brandGradientTo]}
            style={{ width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }}
          >
            <Image source={require('../../../assets/adaptive-icon.png')} style={{ width: 25, height: 25 }} resizeMode="contain" />
          </LinearGradient>
          <Txt variant="h3">{t('common.appName')}</Txt>
        </Row>
        <Pressable onPress={() => navigation.replace('SignIn')} style={{ padding: 10 }}>
          <Txt variant="caption" color={theme.textMuted}>{t('common.skip')}</Txt>
        </Pressable>
      </Row>

      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Animated.View style={{ opacity: slideAnim, transform: [{ translateY: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) }], alignItems: 'center', gap: 28 }}>
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
          <View style={{ alignItems: 'center', gap: 10, maxWidth: 520 }}>
            <Txt variant="h1" align="center">{t(slide.title as any)}</Txt>
            <Txt variant="body" color={theme.textSecondary} align="center">{t(slide.body as any)}</Txt>
          </View>
        </Animated.View>
      </View>

      <View style={{ gap: 24 }}>
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
          onPress={() => (isLast ? navigation.replace('SignIn') : go(index + 1))}
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
  const { signInWithGoogle, configured } = useApp();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    setLoading(true);
    const r = await signInWithGoogle();
    setLoading(false);
    if (!r.ok && r.error && r.error !== 'cancelled') {
      setError(r.error === 'not-configured' ? t('auth.notConfigured') : `${t('auth.googleFailed')}: ${r.error}`);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{
        position: 'absolute', top: -60, right: -80,
        width: 320, height: 320, borderRadius: 160,
        backgroundColor: isDark ? 'rgba(10,132,255,0.10)' : 'rgba(0,122,255,0.05)',
      }} />
      <View style={{
        position: 'absolute', bottom: -40, left: -70,
        width: 280, height: 280, borderRadius: 140,
        backgroundColor: isDark ? 'rgba(175,82,222,0.10)' : 'rgba(88,86,214,0.05)',
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
        <Spacer size={24} />
        <FadeIn index={1}>
          <Txt variant="display">{t('auth.welcomeTitle')}</Txt>
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
            onPress={submit}
            disabled={loading || !configured}
            style={({ pressed }) => ({
              backgroundColor: isDark ? 'rgba(255,255,255,0.96)' : '#FFFFFF',
              borderRadius: 16,
              paddingVertical: 16,
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
        ) : null}

        <Spacer size={18} />
        <FadeIn index={4}>
          <Pressable onPress={() => navigation.navigate('Verify')} style={{ alignSelf: 'center', padding: 8 }}>
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
        <Pressable onPress={() => void logout()} style={{ padding: 8 }}>
          <Ionicons name="log-out-outline" size={22} color={theme.textMuted} />
        </Pressable>
      </Row>
      <Spacer size={22} />

      {/* الصورة */}
      <View style={{ alignSelf: 'center', marginBottom: 22 }}>
        <Pressable onPress={pickAvatar}>
          <View style={{
            width: 104, height: 104, borderRadius: 52, overflow: 'hidden',
            backgroundColor: isDark ? 'rgba(120,120,128,0.24)' : 'rgba(120,120,128,0.12)',
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
            <Pressable key={g} onPress={() => setGender(g)} style={{ flex: 1 }}>
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
            <Pressable key={b.id} onPress={() => setBranchId(b.id)}>
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
