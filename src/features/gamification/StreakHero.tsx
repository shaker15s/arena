/**
 * features/gamification/StreakHero.tsx — بطاقة «سلسلتك» (UX-G1)
 *
 * لماذا كرت مستقل؟ لأن الستريك هو أهم مشعر تحفيزي في التطبيق، وكان موزّعًا على
 * أرقام صغيرة في شاشات مختلفة (شريط في اليوم، رقم في المسار، لهب في الدوري) بلا
 * إجابة على السؤال الذي يسأله المستخدم فعلًا: **«هل سلسلتي في خطر الآن؟ ومتى
 * تُحسم؟ وماذا أفعل لأحميها؟»** هذه البطاقة تجيب الثلاثة في نظرة واحدة:
 *
 *   • الرقم الحالي + أطول سلسلة (سياق إنجاز).
 *   • الهدف الأسبوعي (x/y) مع شريط تقدّم متحرك.
 *   • العدّ التنازلي حتى حسم الأسبوع (ساعات/أيام) — المحرّك النفسي الحقيقي.
 *   • الدروع المتاحة (تجميد) وشرحها بلغة بشرية.
 *   • المعلم القادم (4/8/12/26/52 أسبوعًا) وتقدّمك نحوه.
 *   • نقطة أيام الأسبوع السبعة بحالة كل يوم (حضر / غاب / اليوم / قادم).
 *   • رد فعل «فطن» يحمل نبرة المشهد: محتفل / منتبه / داعم.
 */
import React, { useMemo } from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { streakSnapshot } from '../../data/engine';
import { useApp } from '../../data/store';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import { CountUp, ProgressBar, Row, Spacer, Txt } from '../../design/components';
import { MasarMascot, FatenBehaviorState } from '../../design/mascot';
import { Icon } from '../../design/icons';
import { radii, spacing } from '../../design/tokens';
import { useHaptics } from '../../shared/hooks';

export interface StreakHeroProps {
  /** نسخة مضغوطة لشاشة اليوم */
  compact?: boolean;
  /** إجراء أساسي عند الخطر (مثلاً فتح الماسح) */
  onProtect?: () => void;
  style?: StyleProp<ViewStyle>;
}

function fmtCountdown(ms: number, t: (k: any, vars?: Record<string, string | number>) => string): string {
  const totalHours = Math.floor(ms / 3_600_000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days <= 0) return t('streak.hoursLeft', { hours: totalHours });
  return t('streak.daysLeft', { days, hours });
}

export function StreakHero({ compact = false, onProtect, style }: StreakHeroProps) {
  const { t } = useI18n();
  const { theme, isDark } = useTheme();
  const { db, user } = useApp();
  const { impactLight } = useHaptics();

  const snap = useMemo(
    () => (user ? streakSnapshot(db, user.id) : null),
    [db, user],
  );

  if (!user || !snap) return null;

  const atRisk = snap.status === 'at_risk';
  const justStarted = snap.weeks === 0;
  const mood: FatenBehaviorState = atRisk ? 'alert' : snap.weeks >= 2 ? 'streak_fire' : justStarted ? 'welcome' : 'ready';
  const accent = atRisk ? theme.danger : snap.weeks >= 4 ? theme.warn : theme.brand;

  return (
    <View
      style={[
        styles.wrap,
        {
          borderColor: atRisk ? theme.danger + '55' : theme.fillBorder,
          backgroundColor: isDark ? theme.card : theme.card,
        },
        style,
      ]}
    >
      <LinearGradient
        colors={atRisk
          ? [theme.dangerSoft, 'transparent']
          : [isDark ? 'rgba(245,158,11,0.16)' : 'rgba(251,191,36,0.18)', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <Row center gap={spacing.s3}>
        <MasarMascot size={compact ? 62 : 74} behavior={mood} hideFloatingBubble interactive={false} liveliness="playful" />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="micro" color={theme.textMuted}>{t('streak.title')}</Txt>
          <Row center gap={spacing.s2}>
            <CountUp value={snap.weeks} variant="h1" color={accent} />
            <Txt variant="h3" color={theme.textSecondary}>{t('streak.weeksUnit')}</Txt>
            {snap.weeks > 0 ? <Icon name="flame" size={20} color={accent} /> : null}
          </Row>
          <Txt variant="micro" color={theme.textMuted}>
            {snap.longest > snap.weeks
              ? t('streak.longest', { weeks: snap.longest })
              : t('streak.startToday')}
          </Txt>
        </View>
      </Row>

      <Spacer size={spacing.s3} />

      {/* أيام الأسبوع — نقطة لكل يوم بحالته */}
      <View
        accessibilityRole="text"
        accessibilityLabel={t('streak.weekProgressLabel', { done: snap.honoredThisWeek, goal: snap.weekGoal })}
        style={styles.daysRow}
      >
        {snap.days.map((d) => {
          const color = d.honored
            ? theme.success
            : d.absent
              ? theme.danger
              : d.isToday
                ? theme.brand
                : d.hasSession
                  ? theme.textMuted
                  : theme.line;
          return (
            <View
              key={d.ts}
              style={[
                styles.dayDot,
                {
                  backgroundColor: d.honored || d.absent || d.isToday ? color : 'transparent',
                  borderColor: color,
                  borderWidth: d.honored || d.absent ? 0 : 1.5,
                  opacity: d.isFuture && !d.hasSession ? 0.5 : 1,
                },
              ]}
            >
              {d.honored ? <Icon name="checkmark" size={13} color="#fff" /> : null}
              {d.absent ? <Icon name="close" size={12} color="#fff" /> : null}
              {d.isToday && !d.honored && !d.absent ? (
                <View style={[styles.todayPulse, { backgroundColor: theme.brand }]} />
              ) : null}
            </View>
          );
        })}
      </View>

      <Spacer size={spacing.s3} />

      {/* الهدف الأسبوعي + العدّ التنازلي */}
      <View style={{ gap: spacing.s2 }}>
        <Row between center>
          <Txt variant="caption" color={theme.textSecondary}>
            {t('streak.weekGoal', { done: snap.honoredThisWeek, goal: snap.weekGoal })}
          </Txt>
          <Txt variant="micro" color={atRisk ? theme.danger : theme.textMuted}>
            {fmtCountdown(snap.msLeft, t)}
          </Txt>
        </Row>
        <ProgressBar
          progress={Math.min(1, snap.honoredThisWeek / snap.weekGoal)}
          height={9}
          color={atRisk ? theme.danger : theme.success}
        />
      </View>

      <Spacer size={spacing.s3} />

      {/* الدروع + المعلم القادم */}
      <Row center gap={spacing.s3} wrap>
        <View style={[styles.pill, { backgroundColor: theme.infoSoft }]}>
          <Icon name="snow" size={14} color={theme.info} />
          <Txt variant="micro" color={theme.info}>
            {t('streak.freezes', { held: snap.freezesHeld, max: snap.freezesMax })}
          </Txt>
        </View>
        <View style={[styles.pill, { backgroundColor: theme.warnSoft }]}>
          <Icon name="trophy" size={14} color={theme.warn} />
          <Txt variant="micro" color={theme.warn}>
            {t('streak.nextMilestone', { weeks: snap.milestone.next })}
          </Txt>
        </View>
      </Row>

      {!compact ? (
        <>
          <Spacer size={spacing.s2} />
          <ProgressBar progress={snap.milestone.progress} height={5} color={theme.warn} />
        </>
      ) : null}

      {atRisk && onProtect ? (
        <>
          <Spacer size={spacing.s3} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('streak.protectNow')}
            onPress={() => { impactLight(); onProtect(); }}
            style={({ pressed }) => [
              styles.cta,
              {
                backgroundColor: theme.danger,
                opacity: pressed ? 0.86 : 1,
              },
            ]}
          >
            <Icon name="shield-checkmark" size={16} color="#fff" />
            <Txt variant="caption" bold color="#fff">{t('streak.protectNow')}</Txt>
          </Pressable>
        </>
      ) : null}

      <Spacer size={spacing.s2} />
      <Txt variant="micro" color={theme.textMuted}>
        {atRisk
          ? t('streak.hintRisk', { goal: snap.weekGoal })
          : snap.status === 'kept'
            ? t('streak.hintKept')
            : t('streak.hintTracking', { goal: snap.weekGoal })}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radii.xl,
    borderWidth: 1,
    padding: spacing.s4,
    overflow: 'hidden',
  },
  daysRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.s1,
  },
  dayDot: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayPulse: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s1,
    paddingHorizontal: spacing.s3,
    paddingVertical: 6,
    borderRadius: radii.full,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.s2,
    minHeight: 46,
    borderRadius: radii.lg,
  },
});
