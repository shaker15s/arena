/**
 * features/attendance — S17 الماسح + S18 لحظة النجاح.
 * F3 الكامل: رمز دوّار (يتجدد كل 25 ث) + كود 6 أرقام احتياطي + Idempotency
 * + خريطة أخطاء عربية هادئة + كونفيتي + هابتك.
 * الكاميرا متصلة فعليًا عبر expo-camera، والتحقق والتسجيل يتمان داخل RPC
 * ذرّي على الخادم؛ لا يثق المسار بمعرّف مستخدم أو توقيت قادم من العميل.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useApp } from '../../data/store';
import { liveSessionForStudent } from '../../data/engine';
import { checkInWithToken, type CheckInResponse } from '../../data/actions';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import { Btn, Card, FadeIn, Input, Row, Spacer, Txt } from '../../design/components';
import { CelebrationModal } from '../../design/celebrations';
import { spacing, radii } from '../../design/tokens';
import { easing, isReducedMotion } from '../../design/motion';

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
  const { db, user, refresh, online } = useApp();
  const [permission, requestPermission] = useCameraPermissions();
  const [code, setCode] = useState('');
  const [pasted, setPasted] = useState('');
  const [loading, setLoading] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState<{ msg: string; icon: keyof typeof Ionicons.glyphMap } | null>(null);
  const [success, setSuccess] = useState<{ points: number; status: 'present' | 'late'; already: boolean; badges: number } | null>(null);

  const liveSess = user ? liveSessionForStudent(db, user.id) : undefined;

  // خط ليزر متحرك داخل الإطار
  const laser = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (isReducedMotion()) {
      laser.setValue(0.5);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(laser, { toValue: 1, duration: 1400, easing: easing.inOut, useNativeDriver: true }),
        Animated.timing(laser, { toValue: 0, duration: 1400, easing: easing.inOut, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [laser]);

  const interpret = (r: CheckInResponse) => {
    switch (r.kind) {
      case 'ok':
        haptic('success');
        setSuccess({ points: r.points ?? 0, status: r.status ?? 'present', already: false, badges: 0 });
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
      case 'rate_limited':
        haptic('error');
        setError({ msg: t('scanner.rateLimited'), icon: 'hourglass' });
        break;
      default:
        haptic('error');
        setError({ msg: t('scanner.invalid'), icon: 'close' });
    }
  };

  const doCheck = async (payload: string) => {
    if (!user || !online || loading || !payload.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await checkInWithToken(payload.trim());
      interpret(result);
      if (result.kind === 'ok' || result.kind === 'already') await refresh();
      else setTimeout(() => setScanned(false), 1200);
    } catch (e) {
      haptic('error');
      setError({ msg: (e as Error).message || t('scanner.invalid'), icon: 'cloud-offline' });
      setTimeout(() => setScanned(false), 1200);
    } finally {
      setLoading(false);
    }
  };

  const onBarcodeScanned = ({ data }: BarcodeScanningResult) => {
    if (scanned || loading) return;
    setScanned(true);
    void doCheck(data);
  };

  const frameSize = 220;

  return (
    <View style={{ flex: 1, backgroundColor: '#0A0E1A' }}>
      <View style={{ flex: 1, paddingTop: insets.top + 12, paddingHorizontal: spacing.s5 }}>
        <Row between center>
          <Txt variant="h2" color="#F1F5F9">{t('scanner.title')}</Txt>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} hitSlop={8} onPress={() => navigation.goBack()} style={{ width: 44, height: 44, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="close" size={22} color="#F1F5F9" />
          </Pressable>
        </Row>

        <Spacer size={10} />
        <Txt variant="caption" color="#94A3B8" align="center">{t('scanner.hint')}</Txt>

        {/* إطار الماسح */}
        <View style={{ alignItems: 'center', marginVertical: 24 }}>
          <View style={{ width: frameSize, height: frameSize, borderRadius: 28, borderWidth: 3, borderColor: theme.brand, backgroundColor: `${theme.brand}14`, overflow: 'hidden', justifyContent: 'center' }}>
            {permission?.granted ? (
              <CameraView
                style={{ position: 'absolute', inset: 0 }}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={scanned ? undefined : onBarcodeScanned}
              />
            ) : (
              <Ionicons name="camera-outline" size={72} color="rgba(255,255,255,0.22)" style={{ alignSelf: 'center' }} />
            )}
            {/* زوايا الإطار */}
            {[
              { top: 8, left: 8, borderTopWidth: 5, borderLeftWidth: 5, borderTopLeftRadius: 12 },
              { top: 8, right: 8, borderTopWidth: 5, borderRightWidth: 5, borderTopRightRadius: 12 },
              { bottom: 8, left: 8, borderBottomWidth: 5, borderLeftWidth: 5, borderBottomLeftRadius: 12 },
              { bottom: 8, right: 8, borderBottomWidth: 5, borderRightWidth: 5, borderBottomRightRadius: 12 },
            ].map((s, i) => (
              <View pointerEvents="none" key={i} style={[{ position: 'absolute', zIndex: 2, width: 34, height: 34, borderColor: theme.brandGradientTo }, s]} />
            ))}
            <Animated.View pointerEvents="none" style={{
              position: 'absolute', zIndex: 2, left: 16, right: 16, height: 3, borderRadius: 2,
              backgroundColor: theme.teal,
              shadowColor: theme.teal, shadowOpacity: 0.9, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
              top: laser.interpolate({ inputRange: [0, 1], outputRange: [16, frameSize - 20] }),
            }} />
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

        {!permission?.granted ? (
          <FadeIn index={0}>
            <Btn
              title={t('scanner.enableCamera')}
              onPress={() => { void requestPermission(); }}
              full
              variant="gold"
              icon="camera"
            />
          </FadeIn>
        ) : loading ? (
          <Txt variant="caption" color="#94A3B8" align="center">{t('scanner.verifying')}</Txt>
        ) : null}
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
