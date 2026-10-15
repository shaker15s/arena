/**
 * features/today/DayCards.tsx — كروت «الملخص» في شاشة اليوم.
 *
 * فُصلت في مكوّنات مستقلّة لسببين:
 *   1. **قابلية الفحص**: يمكن تصييرها في `npm run smoke` على بيانات حقيقية
 *      والتأكد أن الأرقام والنصوص صحيحة (بلا NaN / بلا undefined).
 *   2. **صحّة الحساب**: كل رقم يأتي من `data/agenda.ts` (مصدر واحد) — لا حساب
 *      موازٍ داخل الشاشة يمكن أن ينحرف عنه.
 */
import React from 'react';
import { View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Card, Row, Tag, Txt } from '../../design/components';
import { ShimmerProgressBar } from '../../design/animations';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import { spacing } from '../../design/tokens';
import { Icon } from '../../design/icons';
import { courseOf } from '../../data/engine';
import { daySummary, type AgendaItem } from '../../data/agenda';
import { nearestBadge, type NearestBadge } from '../../data/engine';
import type { Db } from '../../data/types';
import { formatDate, formatTime, relativeDayLabel } from '../../shared/format';
import { tPlural } from '../../shared/plural';

/**
 * «النهاردة» — كام محاضرة، حضرت كام، والباقي إمتى.
 * كل الأرقام من `daySummary` (نفس مصدر التنبيهات والشاشات الأخرى).
 */
export function DaySummaryCard({ db, userId, now, onPress }: {
  db: Db; userId: string; now: number; onPress?: () => void;
}) {
  const { t, lang } = useThemeSafe();
  const { theme } = useTheme();
  const day = daySummary(db, userId, now);

  const chips: Array<{ key: string; label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = [];
  if (day.today.total > 0) {
    // صيغ الجمع العربية الصحيحة: «محاضرة واحدة» / «محاضرتين» / «3 محاضرات» / «11 محاضرة»
    chips.push({ key: 'total', label: tPlural(t as never, 'day.cardCount', day.today.total), color: theme.brand, icon: 'calendar' });
    if (day.today.done > 0) chips.push({ key: 'done', label: tPlural(t as never, 'day.cardAttended', day.today.done), color: theme.success, icon: 'checkmark-circle' });
    const left = day.today.total - day.today.done;
    if (left > 0) chips.push({ key: 'left', label: tPlural(t as never, 'day.cardLeft', left), color: theme.info, icon: 'alarm' });
    if (day.today.liveNow > 0) chips.push({ key: 'live', label: t('day.cardLive'), color: theme.danger, icon: 'radio' });
  }

  return (
    <Card onPress={onPress} accessibilityLabel={t('day.title')} accessibilityHint={t('day.hint')}>
      <Row between center>
        <Txt variant="h3">{t('day.title')}</Txt>
        <Txt variant="caption" color={theme.textMuted}>{formatDate(now, lang)}</Txt>
      </Row>

      {day.today.total > 0 ? (
        <>
          <Row wrap gap={spacing.s2} style={{ marginTop: spacing.s3 }}>
            {chips.map((chip) => (
              <Tag key={chip.key} label={chip.label} color={chip.color} bg={chip.color + '1A'} icon={chip.icon} />
            ))}
          </Row>
          <View style={{ marginTop: spacing.s3, gap: spacing.s2 }}>
            {day.today.items.map((item: AgendaItem) => {
              const attended = Boolean(item.attendance && item.attendance.status !== 'absent');
              const isLive = item.session.status === 'live' && !item.stale;
              const course = courseOf(db, item.batch.courseId);
              return (
                <Row key={item.session.id} between center gap={spacing.s3}>
                  <Row center gap={spacing.s2} style={{ flex: 1 }}>
                    <View style={{
                      width: 6, height: 6, borderRadius: 3,
                      backgroundColor: attended ? theme.success : isLive ? theme.danger : theme.textMuted,
                    }} />
                    <Txt variant="caption" numberOfLines={1} style={{ flex: 1 }}>
                      {course?.title ?? item.session.title}
                    </Txt>
                  </Row>
                  <Txt variant="micro" color={attended ? theme.success : theme.textMuted}>
                    {formatTime(item.startsAt, lang)}
                  </Txt>
                </Row>
              );
            })}
          </View>
        </>
      ) : (
        <View style={{ marginTop: spacing.s2, gap: spacing.s2 }}>
          <Txt variant="body" color={theme.textSecondary}>{t('day.cardEmpty')}</Txt>
          {day.next ? (
            <Row center gap={spacing.s2}>
              <Icon name="arrow-forward" size={14} color={theme.brand} />
              <Txt variant="caption" color={theme.brand}>
                {t('day.cardNextUp', {
                  when: relativeDayLabel(day.next.startsAt, lang, now),
                  time: formatTime(day.next.startsAt, lang),
                })}
              </Txt>
            </Row>
          ) : null}
          {day.laterCount > 0 ? (
            <Txt variant="micro" color={theme.textMuted}>{tPlural(t as never, 'day.cardLater', day.laterCount)}</Txt>
          ) : null}
        </View>
      )}
    </Card>
  );
}

/**
 * أقرب شارة للكسب — «باقي كام بالظبط» لا نسبة مبهمة.
 * لو لا توجد شارة قابلة للكسب (المستخدم كسب كل المتاح) لا يُعرض الكرت أصلًا.
 */
export function NearestBadgeCard({ db, userId, near, onPress }: {
  db: Db; userId: string; near?: NearestBadge | null; onPress?: () => void;
}) {
  const { t, lang } = useThemeSafe();
  const { theme } = useTheme();
  const resolved = near === undefined ? nearestBadge(db, userId) : near;
  if (!resolved) return null;
  const badgeName = lang === 'ar' ? resolved.badge.nameAr : resolved.badge.nameEn;
  return (
    <Card
      onPress={onPress}
      accessibilityLabel={`${t('today.nearestBadge')}: ${badgeName}`}
      accessibilityHint={t('day.badgeHint')}
    >
      <Row center gap={spacing.s4}>
        <View style={{
          width: 56, height: 56, borderRadius: 18,
          backgroundColor: theme.brandSoft,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name={resolved.badge.icon as keyof typeof Ionicons.glyphMap} size={28} color={theme.brand} />
        </View>
        <View style={{ flex: 1, gap: spacing.s2 }}>
          <Row between center>
            <Txt variant="caption" color={theme.textMuted}>{t('today.nearestBadge')}</Txt>
            <Txt variant="caption" color={theme.brand}>
              {resolved.target > 1
                ? t('day.badgeOfTarget', { current: String(resolved.current), target: String(resolved.target) })
                : `${Math.round(resolved.progress * 100)}%`}
            </Txt>
          </Row>
          <Txt variant="bodyMed">{badgeName}</Txt>
          <ShimmerProgressBar progress={resolved.progress} />
          <Txt variant="micro" color={theme.textMuted}>
            {resolved.metric === 'rank'
              ? t('day.badgeRankGoal')
              : t('day.badgeRemainingNoCount', { unit: tPlural(t as never, `day.unit.${resolved.metric}`, resolved.remaining) })}
          </Txt>
        </View>
      </Row>
    </Card>
  );
}

/** غلاف صغير يجمع i18n في مكان واحد (نفس سلوك الشاشات). */
function useThemeSafe() {
  return useI18n();
}
