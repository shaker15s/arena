/**
 * features/attendance/SessionCompleteCelebration.tsx
 * احتفالية إكمال تسجيل حضور المحاضرة بنمط دوولينجو (Duolingo-Style Lesson Completion Ceremony)
 * تدفق مكافآت تفاعلي متعدد المراحل: تأكيد الحضور + تصاعد الـ XP + اشتعال الستريك + موقعك في الدوري + مشاركة فورية.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import { Btn, Card, CountUp, FadeIn, Row, Spacer, Txt } from '../../design/components';
import { DrawnCheck } from '../../design/celebrations';
import { ConfettiExplosion, ShimmerProgressBar } from '../../design/animations';
import { MasarMascot } from '../../design/mascot';
import { radii, spacing } from '../../design/tokens';
import { isReducedMotion } from '../../design/motion';

export interface SessionCompleteCelebrationProps {
  visible: boolean;
  onClose: () => void;
  points: number;
  status: 'present' | 'late';
  streakWeeks?: number;
  sessionTitle?: string;
}

export function SessionCompleteCelebration({
  visible,
  onClose,
  points = 10,
  status = 'present',
  streakWeeks = 4,
  sessionTitle,
}: SessionCompleteCelebrationProps) {
  const { theme, isDark } = useTheme();
  const { t } = useI18n();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const cardScale = useRef(new Animated.Value(0.9)).current;
  const xpScale = useRef(new Animated.Value(1)).current;
  const flamePulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!visible) {
      setStep(1);
      return;
    }

    try {
      if (!isReducedMotion()) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {}

    Animated.spring(cardScale, {
      toValue: 1,
      damping: 14,
      stiffness: 180,
      useNativeDriver: true,
    }).start();

    // انتقال تلقائي للمرحلة الثانية بعد 800ms
    const timer = setTimeout(() => {
      setStep(2);
      try {
        if (!isReducedMotion()) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
      } catch {}
    }, 800);

    return () => clearTimeout(timer);
  }, [visible, cardScale]);

  if (!visible) return null;

  const isLate = status === 'late';

  const handleShare = async () => {
    try {
      if (!isReducedMotion()) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch {}

    const text = `🎉 حضرت الآن محاضرة ${sessionTitle ? `«${sessionTitle}»` : 'اليوم'} في تطبيق مسار!\n⚡ كسبت +${points} نقطة والستريك مستمر للأسبوع ${streakWeeks} 🔥\nhttps://arena-rho-seven.vercel.app`;

    if (Platform.OS === 'web') {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: 'إنجاز مسار', text, url: 'https://arena-rho-seven.vercel.app' }).catch(() => {});
      } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      }
    } else {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync('https://arena-rho-seven.vercel.app', { dialogTitle: 'مشاركة الحضور' });
      }
    }
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: theme.overlay }]}>
        <ConfettiExplosion count={38} />

        <Animated.View
          style={[
            styles.card,
            {
              backgroundColor: theme.card,
              borderColor: theme.glassBorder,
              transform: [{ scale: cardScale }],
            },
          ]}
        >
          {/* رأس الاحتفال وتميمة مسار */}
          <MasarMascot
            size={105}
            mode={isLate ? 'encouraging' : 'celebrating'}
            interactive
          />

          <View style={styles.titleSection}>
            <Txt variant="h2" align="center" color={theme.text}>
              {isLate ? 'تم تسجيل حضورك! 👍' : 'أحسنت! حضور في الموعد 🎯'}
            </Txt>
            {sessionTitle ? (
              <Txt variant="caption" color={theme.textSecondary} align="center">
                {sessionTitle}
              </Txt>
            ) : null}
          </View>

          {/* لوحة المكافآت بنمط Duolingo */}
          <View style={styles.rewardsBox}>
            {/* بطاقة نقاط الخبرة XP */}
            <View
              style={[
                styles.rewardItem,
                {
                  backgroundColor: theme.brandSoft,
                  borderColor: theme.brand + '30',
                },
              ]}
            >
              <View style={[styles.rewardIconCircle, { backgroundColor: theme.brand }]}>
                <Ionicons name="flash" size={20} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Txt variant="micro" color={theme.textMuted}>
                  النقاط المكتسبة
                </Txt>
                <Row center gap={4}>
                  <Txt variant="h3" color={theme.brand} style={{ fontVariant: ['tabular-nums'] }}>
                    +<CountUp value={points} duration={700} />
                  </Txt>
                  <Txt variant="caption" color={theme.brand}>
                    نقطة
                  </Txt>
                </Row>
              </View>
            </View>

            {/* بطاقة الستريك الأسبوعي */}
            <View
              style={[
                styles.rewardItem,
                {
                  backgroundColor: theme.warnSoft,
                  borderColor: theme.warn + '30',
                },
              ]}
            >
              <View style={[styles.rewardIconCircle, { backgroundColor: theme.warn }]}>
                <Ionicons name="flame" size={20} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Txt variant="micro" color={theme.textMuted}>
                  الستريك الأسبوعي
                </Txt>
                <Row center gap={4}>
                  <Txt variant="h3" color={theme.warn} style={{ fontVariant: ['tabular-nums'] }}>
                    {streakWeeks}
                  </Txt>
                  <Txt variant="caption" color={theme.warn}>
                    أسابيع متواصلة 🔥
                  </Txt>
                </Row>
              </View>
            </View>
          </View>

          {/* مؤشر تقدم الدوري */}
          <View style={[styles.leagueBanner, { backgroundColor: theme.fill }]}>
            <Ionicons name="trophy" size={20} color="#F59E0B" />
            <Txt variant="caption" color={theme.text} style={{ flex: 1 }}>
              أنت الآن في المنطقة الآمنة للصعود في دوري الأسبوع 🚀
            </Txt>
          </View>

          <Spacer size={8} />

          {/* أزرار الإجراء */}
          <View style={styles.actions}>
            <Btn
              title="مشاركة إنجاز اليوم"
              variant="secondary"
              icon="share-social"
              size="lg"
              full
              onPress={handleShare}
            />
            <Btn
              title="متابعة"
              size="lg"
              full
              onPress={onClose}
            />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.s5,
  },
  card: {
    width: '100%',
    maxWidth: 390,
    borderRadius: radii.xl,
    padding: spacing.s6,
    alignItems: 'center',
    borderWidth: 1,
    shadowColor: '#000000',
    shadowOpacity: 0.22,
    shadowRadius: 36,
    shadowOffset: { width: 0, height: 16 },
    elevation: 20,
    gap: 14,
  },
  titleSection: {
    alignItems: 'center',
    gap: 4,
  },
  rewardsBox: {
    width: '100%',
    flexDirection: 'row',
    gap: 10,
  },
  rewardItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.s3,
    borderRadius: radii.cardSm,
    borderWidth: 1,
    gap: 10,
  },
  rewardIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leagueBanner: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.s4,
    paddingVertical: spacing.s3,
    borderRadius: radii.button,
    gap: 10,
  },
  actions: {
    width: '100%',
    gap: 10,
  },
});
