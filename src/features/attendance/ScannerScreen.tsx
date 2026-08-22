/**
 * features/attendance — S17 الماسح + S18 لحظة النجاح.
 * F3 الكامل: رمز دوّار (يتجدد كل 25 ث) + كود 6 أرقام احتياطي + Idempotency
 * + خريطة أخطاء عربية هادئة + كونفيتي + هابتك.
 *
 * ملاحظة نيتف: نقطة توصيل expo-camera موثقة هنا — في الويب يعمل الإدخال
 * اليدوي ونسخ التوكن، وعلى الجهاز تُوصّل الكاميرا بنفس استدعاء rpcCheckIn.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../../data/store';
import { currentQrToken, liveSessionForStudent, rpcCheckIn, CheckInResult } from '../../data/engine';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import { Btn, Card, FadeIn, Input, Row, Spacer, Txt } from '../../design/components';
import { CelebrationModal } from '../../design/celebrations';
import { spacing, radii } from '../../design/tokens';
import { easing } from '../../design/motion';

async function haptic(kind: 'success' | 'error' | 'warning') {
  if (Platform.OS === 'web') return;
  try {
    const Haptics = require('expo-haptics');
    if (kind === 'success') await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else if (kind === 'error') await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    else await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  } catch {
    /* no haptics */
  }
}

export function ScannerScreen({ navigation }: any) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { db, user, mutate, online } = useApp();
  const [code, setCode] = useState('');
  const [pasted, setPasted] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ msg: string; icon: keyof typeof Ionicons.glyphMap } | null>(null);
  const [success, setSuccess] = useState<{ points: number; status: 'present' | 'late'; already: boolean; badges: number } | null>(null);

  const liveSess = user ? liveSessionForStudent(db, user.id) : undefined;

  // خط ليزر متحرك داخل الإطار
  const laser = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(laser, { toValue: 1, duration: 1400, easing: easing.inOut, useNativeDriver: true }),
        Animated.timing(laser, { toValue: 0, duration: 1400, easing: easing.inOut, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [laser]);

  const interpret = (r: CheckInResult) => {
    switch (r.kind) {
      case 'ok':
        haptic('success');
        setSuccess({ points: r.points, status: r.status, already: false, badges: r.newBadges.length });
        break;
      case 'already':
        haptic('warning');
        setSuccess({ points: 0, status: 'present', already: true, badges: 0 });
        break;
      case 'expired':
        haptic('warning');
        setError({ msg: t('scanner.expired'), icon: 'time' });
        break;
      case 'too_late':
        haptic('error');
        setError({ msg: t('scanner.tooLate'), icon: 'lock-closed' });
        break;
      case 'no_session':
        haptic('error');
        setError({ msg: t('scanner.noSession'), icon: 'search' });
        break;
      case 'not_enrolled':
        haptic('error');
        setError({ msg: t('scanner.noSession'), icon: 'search' });
        break;
      default:
        haptic('error');
        setError({ msg: t('scanner.invalid'), icon: 'close' });
    }
  };

  const doCheck = async (payload: string) => {
    if (!user || !online || loading) return;
    setLoading(true);
    setError(null);
    const r = await mutate((d) => rpcCheckIn(d, user.id, payload));
    setLoading(false);
    interpret(r);
  };

  const simulateScan = async () => {
    if (!liveSess) {
      setError({ msg: t('scanner.noSession'), icon: 'search' });
      return;
    }
    await doCheck(currentQrToken(liveSess, Date.now()));
  };

  const frameSize = 220;

  return (
    <View style={{ flex: 1, backgroundColor: '#0A0E1A' }}>
      <View style={{ flex: 1, paddingTop: insets.top + 12, paddingHorizontal: spacing.s5 }}>
        <Row between center>
          <Txt variant="h2" color="#F1F5F9">{t('scanner.title')}</Txt>
          <Pressable onPress={() => navigation.goBack()} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="close" size={22} color="#F1F5F9" />
          </Pressable>
        </Row>

        <Spacer size={10} />
        <Txt variant="caption" color="#94A3B8" align="center">{t('scanner.hint')}</Txt>

        {/* إطار الماسح */}
        <View style={{ alignItems: 'center', marginVertical: 24 }}>
          <View style={{ width: frameSize, height: frameSize, borderRadius: 28, borderWidth: 3, borderColor: '#4F46E5', backgroundColor: 'rgba(79,70,229,0.08)', overflow: 'hidden', justifyContent: 'center' }}>
            {/* زوايا الإطار */}
            {[
              { top: 8, left: 8, borderTopWidth: 5, borderLeftWidth: 5, borderTopLeftRadius: 12 },
              { top: 8, right: 8, borderTopWidth: 5, borderRightWidth: 5, borderTopRightRadius: 12 },
              { bottom: 8, left: 8, borderBottomWidth: 5, borderLeftWidth: 5, borderBottomLeftRadius: 12 },
              { bottom: 8, right: 8, borderBottomWidth: 5, borderRightWidth: 5, borderBottomRightRadius: 12 },
            ].map((s, i) => (
              <View key={i} style={[{ position: 'absolute', width: 34, height: 34, borderColor: '#8B5CF6' }, s]} />
            ))}
            <Animated.View style={{
              position: 'absolute', left: 16, right: 16, height: 3, borderRadius: 2,
              backgroundColor: '#14B8A6',
              shadowColor: '#14B8A6', shadowOpacity: 0.9, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
              top: laser.interpolate({ inputRange: [0, 1], outputRange: [16, frameSize - 20] }),
            }} />
            <Ionicons name="qr-code-outline" size={90} color="rgba(255,255,255,0.14)" style={{ alignSelf: 'center' }} />
          </View>
          <Spacer size={8} />
          {liveSess ? (
            <Row center gap={6}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981' }} />
              <Txt variant="micro" color="#10B981">{t('common.liveStatus')}</Txt>
            </Row>
          ) : (
            <Txt variant="micro" color="#F59E0B">{t('scanner.noSession')}</Txt>
          )}
        </View>

        {/* محاكاة المسح */}
        <FadeIn index={0}>
          <Btn
            title={t('scanner.simulate')}
            onPress={simulateScan}
            loading={loading}
            full
            variant="gold"
            icon="scan"
            disabled={!online || !liveSess}
          />
        </FadeIn>
        <Spacer size={16} />

        {/* الكود اليدوي */}
        <FadeIn index={1}>
          <Card color="rgba(255,255,255,0.06)" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
            <Txt variant="caption" color="#94A3B8" style={{ marginBottom: 8 }}>{t('scanner.codePlaceholder')}</Txt>
            <Row gap={10} center>
              <View style={{ flex: 1 }}>
                <CodeInput value={code} onChange={(v) => { setCode(v.replace(/[^\d]/g, '').slice(0, 6)); setError(null); }} />
              </View>
              <Btn title={t('scanner.submit')} onPress={() => doCheck(code)} loading={loading} disabled={code.length !== 6 || !online} />
            </Row>
            <Spacer size={10} />
            <Input value={pasted} onChange={(v) => setPasted(v)} placeholder={t('scanner.paste')} icon="clipboard" />
            {pasted.trim().length > 8 ? (
              <>
                <Spacer size={8} />
                <Btn title={t('scanner.submit')} size="sm" variant="secondary" icon="checkmark" onPress={() => doCheck(pasted.trim())} />
              </>
            ) : null}
          </Card>
        </FadeIn>

        {!online ? (
          <>
            <Spacer size={10} />
            <Txt variant="caption" color="#F59E0B" align="center">{t('scanner.offline')}</Txt>
          </>
        ) : null}

        {error ? (
          <FadeIn index={0}>
            <Spacer size={14} />
            <Card color="rgba(239,68,68,0.12)" style={{ borderColor: 'rgba(239,68,68,0.35)' }}>
              <Row center gap={10}>
                <Ionicons name={error.icon} size={26} color="#EF4444" />
                <Txt variant="body" color="#FCA5A5" style={{ flex: 1 }}>{error.msg}</Txt>
              </Row>
            </Card>
          </FadeIn>
        ) : null}
      </View>

      {/* S18 — لحظة النجاح */}
      <CelebrationModal
        visible={success != null}
        onClose={() => {
          setSuccess(null);
          navigation.goBack();
        }}
        title={success?.already ? t('scanner.already') : t('scanner.success')}
        subtitle={
          success?.already
            ? undefined
            : success ? (success.status === 'present' ? t('scanner.presentTag') : t('scanner.lateTag')) + (success.badges > 0 ? ` · ${t('achievements.newBadge')}` : '') : undefined
        }
        points={success && !success.already ? success.points : undefined}
        streakSafe
      />
    </View>
  );
}

function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { TextInput } = require('react-native');
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      keyboardType="numeric"
      maxLength={6}
      placeholder="••••••"
      placeholderTextColor="#5B6478"
      style={{
        backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12,
        paddingVertical: 12, paddingHorizontal: 14, fontSize: 22, letterSpacing: 8,
        color: '#F1F5F9', fontFamily: 'IBMPlexSansArabic_700Bold', textAlign: 'center',
        ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as object : {}),
      }}
    />
  );
}
