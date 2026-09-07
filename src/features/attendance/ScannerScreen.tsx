/**
 * features/attendance — S17 الماسح الذكي المعاد تصميمه بالكامل (Full-bleed Camera Viewfinder)
 * وفق متطلبات الإخراج البصري الفائق (2026):
 * 1. Full-bleed Scanner تملأ الكاميرا الشاشة بالكامل مع طبقة تعتيم وفتحة معاينة مركزية.
 * 2. أقواس زوايا متحركة (Corner Brackets) تتنفس بانسيابية.
 * 3. حلقة عد تنازلي متجددة كل 25 ثانية مع فلاش عند التجدد.
 * 4. إدخال الكود الاحتياطي الستة أرقام عبر 6 مربعات زجاجية منفصلة (OTP Boxes).
 * 5. حالة رفض الكاميرا مدعومة بتميمة مسار وزر زجاجي كبير لطلب الإذن.
 * 6. اهتزاز ديناميكي عند الخطأ (Error Shake) وتنبيه Toast عائم.
 * 7. زر زجاجي دائري لتشغيل فلاش الكاميرا.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  Easing,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import Svg, { Circle } from 'react-native-svg';
import { useApp } from '../../data/store';
import { liveSessionForStudent } from '../../data/engine';
import { checkInWithToken, type CheckInResponse } from '../../data/actions';
import { track } from '../../shared/analytics';
import { clearPositionCache, getDevicePosition, getLocationPermissionState } from '../../shared/location';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import {
  Btn,
  FadeIn,
  IconGlassButton,
  Row,
  Spacer,
  Toast,
  Txt,
} from '../../design/components';
import { SessionCompleteCelebration } from './SessionCompleteCelebration';
import { MasarMascot } from '../../design/mascot';
import { spacing, radii, sizes } from '../../design/tokens';
import { isReducedMotion } from '../../design/motion';

async function haptic(kind: 'success' | 'error' | 'warning') {
  if (Platform.OS === 'web') return;
  try {
    const Haptics = require('expo-haptics');
    if (kind === 'success') await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else if (kind === 'error') await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    else await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  } catch {}
}

export function ScannerScreen({ navigation }: any) {
  const { t } = useI18n();
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const { db, user, refresh, online } = useApp();
  const [permission, requestPermission] = useCameraPermissions();

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [torch, setTorch] = useState(false);
  const [toast, setToast] = useState<{ visible: boolean; type: 'error' | 'warning' | 'success'; title: string; msg?: string }>({
    visible: false,
    type: 'error',
    title: '',
  });
  const [success, setSuccess] = useState<{ points: number; status: 'present' | 'late'; already: boolean } | null>(null);

  const liveSess = user ? liveSessionForStudent(db, user.id) : undefined;
  const reduced = isReducedMotion();

  // حجم إطار المعاينة
  const frameSize = Math.round(Math.max(220, Math.min(290, Math.min(winW, winH) * 0.68)));
  const ringRadius = frameSize / 2 + 10;
  const ringCircumference = 2 * Math.PI * ringRadius;

  // الحركات:
  // 1. خط الليزر
  const laserAnim = useRef(new Animated.Value(0)).current;
  // 2. تنفس أقواس الزوايا
  const bracketAnim = useRef(new Animated.Value(1)).current;
  // 3. حلقة الـ 25 ثانية
  const countdownAnim = useRef(new Animated.Value(0)).current;
  // 4. اهتزاز الخطأ
  const shakeAnim = useRef(new Animated.Value(0)).current;
  // 5. اهتزاز مربعات OTP
  const otpShakeAnim = useRef(new Animated.Value(0)).current;
  // 6. فلاش النجاح
  const flashAnim = useRef(new Animated.Value(0)).current;
  // مرجع حقل كود الطوارئ
  const inputRef = useRef<TextInput>(null);

  // إعادة فحص إذن الكاميرا تلقائياً عند العودة للتطبيق من الإعدادات
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void requestPermission();
      }
    });
    return () => sub.remove();
  }, [requestPermission]);

  // حلقة خط الليزر
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(laserAnim, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(laserAnim, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [laserAnim, reduced]);

  // تنفس أقواس الزوايا
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bracketAnim, { toValue: 1.05, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(bracketAnim, { toValue: 0.98, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [bracketAnim, reduced]);

  // حلقة العد التنازلي لرمز الـ 25 ثانية
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(countdownAnim, { toValue: 1, duration: 25000, easing: Easing.linear, useNativeDriver: false }),
        Animated.timing(countdownAnim, { toValue: 0, duration: 0, useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [countdownAnim, reduced]);

  const triggerOtpShake = () => {
    if (reduced) return;
    otpShakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(otpShakeAnim, { toValue: -12, duration: 60, useNativeDriver: true }),
      Animated.timing(otpShakeAnim, { toValue: 12, duration: 60, useNativeDriver: true }),
      Animated.timing(otpShakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(otpShakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(otpShakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  };

  const triggerErrorShake = (title: string, msg?: string) => {
    haptic('error');
    setToast({ visible: true, type: 'error', title, msg });
    triggerOtpShake();
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: -12, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 12, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  };

  const interpret = (r: CheckInResponse) => {
    switch (r.kind) {
      case 'ok':
        haptic('success');
        track('checkin_ok', { status: r.status ?? 'present' });
        Animated.sequence([
          Animated.timing(flashAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
          Animated.timing(flashAnim, { toValue: 0, duration: 240, useNativeDriver: true }),
        ]).start(() => {
          setSuccess({ points: r.points ?? 0, status: r.status ?? 'present', already: false });
        });
        break;
      case 'already':
        haptic('warning');
        setSuccess({ points: 0, status: 'present', already: true });
        break;
      case 'expired':
        triggerErrorShake(t('scanner.expired'), 'انتهت صلاحية الرمز الدوّار، يرجى مسح الرمز المحدث.');
        break;
      case 'too_late':
        triggerErrorShake(t('scanner.tooLate'), 'انقضت نافذة تسجيل الحضور لهذه الجلسة.');
        break;
      case 'no_session':
        triggerErrorShake(t('scanner.noSession'), 'لا توجد جلسة نشطة لهذه المجموعة حالياً.');
        break;
      case 'not_enrolled':
        triggerErrorShake(t('scanner.notEnrolled'), 'أنت غير مسجل في هذه المجموعة التدريبية.');
        break;
      case 'rate_limited':
        triggerErrorShake(t('scanner.rateLimited'), 'يرجى الانتظار قليلاً قبل المحاولة مجدداً.');
        break;
      default:
        triggerErrorShake(t('scanner.invalid'), 'تأكد من مسح رمز QR مسار الصحيح.');
    }
  };

  const doCheck = async (payload: string) => {
    if (!user || !online || loading || !payload.trim()) return;
    setLoading(true);
    try {
      const pos = await getDevicePosition();
      const result = await checkInWithToken(payload.trim(), pos?.lat, pos?.lng);
      interpret(result);
      if (result.kind === 'ok' || result.kind === 'already') await refresh();
      else setTimeout(() => setScanned(false), 1200);
    } catch (e) {
      triggerErrorShake((e as Error).message || t('scanner.invalid'));
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

  // حلقة تفرغ العد التنازلي
  const strokeDashoffset = countdownAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, ringCircumference],
  });

  const toggleTorch = async () => {
    const next = !torch;
    setTorch(next);
    if (Platform.OS === 'web') {
      try {
        const video = document.querySelector('video');
        if (video && (video as any).srcObject) {
          const stream = (video as any).srcObject as MediaStream;
          const track = stream.getVideoTracks()[0];
          if (track) {
            const capabilities = (track.getCapabilities?.() as any) || {};
            if (capabilities.torch) {
              await (track.applyConstraints as any)({
                advanced: [{ torch: next }],
              });
            }
          }
        }
      } catch {}
    }
  };

  return (
    <View style={styles.rootContainer}>
      {/* 1. الكاميرا بكامل الشاشة (Full-bleed) */}
      {permission?.granted ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
          flash={torch ? 'on' : 'off'}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={scanned ? undefined : onBarcodeScanned}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#090D16' }]} />
      )}

      {/* 2. طبقة فلاش النجاح الأخضر */}
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: '#10B981',
            opacity: flashAnim,
            zIndex: 100,
          },
        ]}
      />

      {/* 3. توست الخطأ أو التحذير */}
      <Toast
        visible={toast.visible}
        type={toast.type}
        title={toast.title}
        message={toast.msg}
        onDismiss={() => setToast((prev) => ({ ...prev, visible: false }))}
      />

      {/* 4. محتوى الواجهة العائم فوق الكاميرا */}
      <View style={[styles.overlayContainer, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.md }]}>
        {/* الهيدر مع أزرار التحكم الزجاجية */}
        <Row between center style={styles.headerRow}>
          <IconGlassButton
            icon={<Ionicons name="close" size={22} color="#FFF" />}
            onPress={() => navigation.goBack()}
            accessibilityLabel={t('common.close')}
          />

          <View style={styles.sessionStatusTag}>
            {liveSess ? (
              <Row center gap={6}>
                <View style={styles.liveIndicatorDot} />
                <Txt variant="micro" bold color="#10B981">
                  {liveSess.title}
                </Txt>
              </Row>
            ) : (
              <Txt variant="micro" color="#94A3B8">
                {t('scanner.title')}
              </Txt>
            )}
          </View>

          {permission?.granted ? (
            <IconGlassButton
              icon={<Ionicons name={torch ? 'flashlight' : 'flashlight-outline'} size={20} color={torch ? '#F59E0B' : '#FFF'} />}
              onPress={() => void toggleTorch()}
              accessibilityLabel="إضاءة الفلاش"
            />
          ) : (
            <View style={{ width: 44 }} />
          )}
        </Row>

        {/* جسم الشاشة: إطار الفحص أو طلب الإذن */}
        {permission?.granted ? (
          <View style={styles.centerViewfinderWrapper}>
            {/* إطار الفحص والأقواس المتنفسة وحلقة الـ 25 ثانية */}
            <Animated.View
              style={[
                styles.viewfinderBox,
                {
                  width: frameSize,
                  height: frameSize,
                  transform: [{ translateX: shakeAnim }, { scale: bracketAnim }],
                },
              ]}
            >
              {/* حلقة العد التنازلي الخارجية للـ 25 ثانية */}
              <View style={styles.countdownRingWrapper}>
                <Svg width={frameSize + 28} height={frameSize + 28} viewBox={`0 0 ${frameSize + 28} ${frameSize + 28}`}>
                  <Circle
                    cx={(frameSize + 28) / 2}
                    cy={(frameSize + 28) / 2}
                    r={ringRadius}
                    stroke="rgba(255, 255, 255, 0.15)"
                    strokeWidth={3}
                    fill="none"
                  />
                  <Circle
                    cx={(frameSize + 28) / 2}
                    cy={(frameSize + 28) / 2}
                    r={ringRadius}
                    stroke={loading ? '#38BDF8' : theme.brand}
                    strokeWidth={3.5}
                    strokeDasharray={`${ringCircumference} ${ringCircumference}`}
                    strokeDashoffset={strokeDashoffset as any}
                    strokeLinecap="round"
                    fill="none"
                    transform={`rotate(-90 ${(frameSize + 28) / 2} ${(frameSize + 28) / 2})`}
                  />
                </Svg>
              </View>

              {/* أقواس الزوايا الأربعة البيضاء المتنفسة */}
              <View style={[styles.cornerBracket, styles.topLeftBracket]} />
              <View style={[styles.cornerBracket, styles.topRightBracket]} />
              <View style={[styles.cornerBracket, styles.bottomLeftBracket]} />
              <View style={[styles.cornerBracket, styles.bottomRightBracket]} />

              {/* خط الليزر المتحرك */}
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.laserLine,
                  {
                    top: laserAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [12, frameSize - 16],
                    }),
                    backgroundColor: loading ? '#38BDF8' : '#007AFF',
                    shadowColor: loading ? '#38BDF8' : '#007AFF',
                  },
                ]}
              />

              {loading && (
                <View style={styles.loadingBackdrop}>
                  <ActivityIndicator size="large" color="#FFF" />
                  <Spacer size={8} />
                  <Txt variant="caption" bold color="#FFF">
                    {t('scanner.verifying')}
                  </Txt>
                </View>
              )}
            </Animated.View>

            <Spacer size={16} />
            <Txt variant="caption" color="#CBD5E1" align="center" style={styles.hintText}>
              وجّه الكاميرا نحو رمز QR المعروض في قاعة التدريب
            </Txt>
          </View>
        ) : (
          /* حالة طلب إذن الكاميرا: صقر مسار فطن في وضع التوجيه والإرشاد */
          <View style={styles.permissionDeniedCard}>
            <MasarMascot
              size={115}
              behavior="recovery"
              interactive
              speechText="نحتاج إذن الكاميرا لمسح رمز الحضور الذكي 📷"
            />
            <Spacer size={20} />
            <Txt variant="h2" bold color="#FFFFFF" align="center">
              إذن الكاميرا مطلوب
            </Txt>
            <Spacer size={8} />
            <Txt variant="bodyMed" color="#E2E8F0" align="center" style={{ lineHeight: 22 }}>
              لتسجيل حضورك الفوري، يحتاج التطبيق للوصول إلى الكاميرا لمسح الرمز بدقة وأمان.
            </Txt>
            <Spacer size={24} />
            <Btn
              title="منح إذن الكاميرا الآن"
              size="lg"
              icon="camera"
              onPress={() => {
                if (Platform.OS === 'web') {
                  void requestPermission();
                } else {
                  Linking.openSettings().catch(() => {
                    void requestPermission();
                  });
                }
              }}
              style={{ width: '100%', maxWidth: 280 }}
            />
          </View>
        )}

        {/* 5. إدخال الكود اليدوي الاحتياطي (6 أرقام OTP Boxes) */}
        <View style={styles.manualCodeContainer}>
          <Txt variant="caption" bold color="#FFFFFF" align="center" style={{ marginBottom: 10, fontSize: 13 }}>
            تعذّرت الكاميرا؟ أدخل كود الطوارئ (6 أرقام):
          </Txt>

          {/* مربعات OTP الزجاجية المنفصلة مع دعم النقر والاهتزاز عند الخطأ */}
          <Animated.View style={{ transform: [{ translateX: otpShakeAnim }], position: 'relative', marginVertical: 4 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إدخال كود الطوارئ 6 أرقام"
              onPress={() => inputRef.current?.focus()}
              style={styles.otpBoxesRow}
            >
              {Array.from({ length: 6 }).map((_, idx) => {
                const digit = code[idx] || '';
                const isCurrent = code.length === idx;
                return (
                  <View
                    key={idx}
                    style={[
                      styles.otpBox,
                      isCurrent && styles.otpBoxActive,
                      digit !== '' && styles.otpBoxFilled,
                    ]}
                  >
                    <Txt variant="h3" bold color="#FFF" style={styles.otpDigit}>
                      {digit}
                    </Txt>
                  </View>
                );
              })}
            </Pressable>

            {/* حقل إدخال يغطي فقط منطقة مربعات الـ OTP لضمان استجابة اللمس والكيبورد */}
            <TextInput
              ref={inputRef}
              value={code}
              onChangeText={(v) => {
                const cleaned = v.replace(/[^\d]/g, '').slice(0, 6);
                setCode(cleaned);
                if (cleaned.length === 6) {
                  void doCheck(cleaned);
                }
              }}
              keyboardType="number-pad"
              maxLength={6}
              style={styles.hiddenInput}
              autoFocus={false}
            />
          </Animated.View>

          <Spacer size={12} />
          <Row center gap={10}>
            <Btn
              title={t('scanner.submit')}
              onPress={() => doCheck(code)}
              loading={loading}
              disabled={code.length !== 6 || !online}
              style={{ flex: 1 }}
            />
          </Row>
        </View>
      </View>

      {/* S18 — احتفالية إتمام المحاضرة بنمط دوولينجو */}
      <SessionCompleteCelebration
        visible={success != null}
        onClose={() => {
          setSuccess(null);
          navigation.goBack();
        }}
        points={success?.points ?? 10}
        status={success?.status ?? 'present'}
        streakWeeks={user ? db.gamification.find((g) => g.userId === user.id)?.currentStreakWeeks : 4}
        already={success?.already ?? false}
        sessionTitle={liveSess?.title}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  rootContainer: {
    flex: 1,
    backgroundColor: '#070B14',
  },
  overlayContainer: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
  },
  headerRow: {
    width: '100%',
    zIndex: 10,
  },
  sessionStatusTag: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  liveIndicatorDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#10B981',
  },
  centerViewfinderWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewfinderBox: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    borderRadius: 24,
  },
  countdownRingWrapper: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cornerBracket: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderColor: '#FFFFFF',
    zIndex: 5,
  },
  topLeftBracket: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 14,
  },
  topRightBracket: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 14,
  },
  bottomLeftBracket: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 14,
  },
  bottomRightBracket: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 14,
  },
  laserLine: {
    position: 'absolute',
    left: 10,
    right: 10,
    height: 3,
    borderRadius: 2,
    zIndex: 6,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.95,
    shadowRadius: 10,
    elevation: 6,
  },
  loadingBackdrop: {
    ...(StyleSheet.absoluteFill as any),
    backgroundColor: 'rgba(15, 23, 42, 0.78)',
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  hintText: {
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  permissionDeniedCard: {
    alignItems: 'center',
    padding: spacing.xl,
    marginHorizontal: spacing.md,
    backgroundColor: '#0F172A',
    borderRadius: radii.xl,
    borderWidth: 1.5,
    borderColor: 'rgba(56, 189, 248, 0.4)',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  manualCodeContainer: {
    width: '100%',
    padding: spacing.md,
    borderRadius: radii.xl,
    backgroundColor: '#0F172A',
    borderWidth: 1.5,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  otpBoxesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginVertical: 4,
  },
  otpBox: {
    width: 44,
    height: 52,
    borderRadius: radii.md,
    backgroundColor: 'rgba(30, 41, 59, 0.95)',
    borderWidth: 1.5,
    borderColor: 'rgba(148, 163, 184, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpBoxActive: {
    borderColor: '#38BDF8',
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    shadowColor: '#38BDF8',
    shadowOpacity: 0.5,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  otpBoxFilled: {
    borderColor: 'rgba(255, 255, 255, 0.7)',
    backgroundColor: 'rgba(30, 41, 59, 1)',
  },
  otpDigit: {
    fontVariant: ['tabular-nums'],
    fontSize: 22,
    lineHeight: 28,
  },
  hiddenInput: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    opacity: 0.01,
  },
});
