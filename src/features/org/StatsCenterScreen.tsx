/**
 * features/org/StatsCenterScreen — مركز الإحصائيات الموحّد (خطة الإصلاح D6).
 *
 * 5 تبويبات: التعلّم · الحضور · التشغيل · الفئات · الجودة.
 * البيانات عبر `get_stats_center` (0035) — المنظّمون يرون نطاق مهامهم،
 * والمشرف/الأدمن يرون المؤسسة كاملة. لا PII في أي بطاقة — أرقام مجمّعة فقط.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { getStatsCenter, StatsCenterResult } from '../../data/actions';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import {
  AutoGrid, Card, Empty, FadeIn, Header, ProgressBar, Row, Screen,
  Segmented, SkeletonList, Spacer, Tag, Txt,
} from '../../design/components';
import { Icon } from '../../design/icons';
import { spacing, layout } from '../../design/tokens';

type Tab = 'learning' | 'attendance' | 'ops' | 'categories' | 'quality';

function StatCard({ label, value, icon, color, hint }: {
  label: string; value: string | number; icon: string; color: string; hint?: string;
}) {
  const { theme } = useTheme();
  return (
    <Card style={{ flex: 1, minWidth: layout.minColumn.stat, gap: spacing.s2, paddingVertical: spacing.s4 }}>
      <Row between>
        <Icon name={icon as any} size={20} color={color} />
        <Txt variant="numberCard" color={color}>{value}</Txt>
      </Row>
      <Txt variant="caption" color={theme.textMuted}>{label}</Txt>
      {hint ? <Txt variant="micro" color={theme.textMuted}>{hint}</Txt> : null}
    </Card>
  );
}

export function StatsCenterScreen({ navigation }: any) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const [tab, setTab] = useState<Tab>('learning');
  const [data, setData] = useState<StatsCenterResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await getStatsCenter());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const attTotal = data ? Math.max(data.attendance.total_marks, 1) : 1;

  return (
    <Screen label={t('stats.title')}>
      <Header
        title={t('stats.title')}
        subtitle={data ? (data.scope === 'org' ? t('stats.scopeOrg') : t('stats.scopeMine')) : undefined}
        back={() => navigation.goBack()}
      />
      <ScrollView
        contentContainerStyle={{ padding: spacing.s5, gap: spacing.s4, maxWidth: 960, width: '100%', alignSelf: 'center' }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
      >
        {loading ? (
          <SkeletonList count={4} />
        ) : error || !data ? (
          <Empty
            emoji="📊"
            title={t('stats.loadFailed')}
            body={error || t('stats.loadFailedBody')}
            cta={t('common.retry')}
            onCta={() => { setLoading(true); void load(); }}
          />
        ) : (
          <>
            <Segmented<Tab>
              value={tab}
              onChange={setTab}
              options={[
                { value: 'learning', label: t('stats.learning'), icon: 'school' },
                { value: 'attendance', label: t('stats.attendance'), icon: 'people' },
                { value: 'ops', label: t('stats.ops'), icon: 'speedometer' },
                { value: 'categories', label: t('stats.categories'), icon: 'people-circle' },
                { value: 'quality', label: t('stats.quality'), icon: 'shield-checkmark' },
              ]}
            />

            {tab === 'learning' ? (
              <FadeIn>
                <AutoGrid>
                  <StatCard label={t('stats.sessionsClosed')} value={data.learning.sessions_closed} icon="checkmark-done" color={theme.brand} />
                  <StatCard label={t('stats.feedbackCount')} value={data.learning.feedback_count} icon="chatbubble-ellipses" color={theme.accent} />
                  <StatCard label={t('feedback.understanding')} value={`${data.learning.avg_understanding}/5`} icon="book" color={theme.success} />
                  <StatCard label={t('feedback.pace')} value={`${data.learning.avg_pace}/5`} icon="speedometer" color={theme.info} />
                  <StatCard label={t('feedback.clarity')} value={`${data.learning.avg_clarity}/5`} icon="eye" color={theme.warn} />
                  <StatCard label={t('stats.avgCourseRating')} value={`${data.learning.avg_course_rating}/5`} icon="star" color={theme.certGold} />
                </AutoGrid>
              </FadeIn>
            ) : null}

            {tab === 'attendance' ? (
              <FadeIn>
                <Card>
                  <Txt variant="bodyMed" heading="h3">{t('stats.attendanceDistribution')}</Txt>
                  <Spacer size={spacing.s3} />
                  {([
                    ['present', data.attendance.present, theme.success],
                    ['late', data.attendance.late, theme.warn],
                    ['absent', data.attendance.absent, theme.danger],
                    ['excused', data.attendance.excused, theme.info],
                  ] as Array<[string, number, string]>).map(([key, value, color]) => (
                    <View key={key} style={{ marginBottom: spacing.s3 }}>
                      <Row between>
                        <Txt variant="body">{t(`stats.att.${key}` as any)}</Txt>
                        <Txt variant="numberCard" color={color}>{value}</Txt>
                      </Row>
                      <ProgressBar progress={value / attTotal} color={color} />
                    </View>
                  ))}
                </Card>
                <Spacer size={spacing.s3} />
                <AutoGrid>
                  <StatCard label={t('stats.totalMarks')} value={data.attendance.total_marks} icon="list" color={theme.brand} />
                  <StatCard
                    label={t('stats.attendanceRate')}
                    value={`${Math.round(((data.attendance.present + data.attendance.late) / attTotal) * 100)}%`}
                    icon="trending-up"
                    color={theme.success}
                  />
                </AutoGrid>
              </FadeIn>
            ) : null}

            {tab === 'ops' ? (
              <FadeIn>
                <AutoGrid>
                  <StatCard label={t('stats.sessionsToday')} value={data.ops.sessions_today} icon="today" color={theme.brand} />
                  <StatCard label={t('stats.sessionsWeek')} value={data.ops.sessions_this_week} icon="calendar" color={theme.info} />
                  <StatCard label={t('stats.liveNow')} value={data.ops.live_now} icon="play-circle" color={theme.danger} />
                  <StatCard label={t('stats.missingReports')} value={data.ops.missing_reports} icon="document-text" color={theme.warn} />
                </AutoGrid>
                {data.ops.needs_attention > 0 ? (
                  <Card>
                    <Row gap={spacing.s2}>
                      <Icon name="alert-circle" size={22} color={theme.warn} />
                      <Txt variant="bodyMed" style={{ flex: 1 }}>
                        {t('stats.needsAttention', { n: String(data.ops.needs_attention) })}
                      </Txt>
                    </Row>
                  </Card>
                ) : (
                  <Card>
                    <Row gap={spacing.s2}>
                      <Icon name="checkmark-circle" size={22} color={theme.success} />
                      <Txt variant="bodyMed" style={{ flex: 1 }}>{t('stats.allClear')}</Txt>
                    </Row>
                  </Card>
                )}
              </FadeIn>
            ) : null}

            {tab === 'categories' ? (
              <FadeIn>
                {Object.keys(data.categories).length === 0 ? (
                  <Empty emoji="🔒" title={t('stats.restricted')} body={t('stats.restrictedBody')} />
                ) : (
                  <AutoGrid>
                    <StatCard label={t('stats.studentsActive')} value={data.categories.students_active ?? 0} icon="school" color={theme.brand} />
                    <StatCard label={t('stats.studentsDisabled')} value={data.categories.students_disabled ?? 0} icon="school-outline" color={theme.textMuted} />
                    <StatCard label={t('stats.volunteers')} value={data.categories.volunteers ?? 0} icon="heart" color={theme.accent} />
                    <StatCard label={t('stats.supervisors')} value={data.categories.supervisors ?? 0} icon="shield-half" color={theme.info} />
                    <StatCard label={t('stats.admins')} value={data.categories.admins ?? 0} icon="key" color={theme.warn} />
                    <StatCard label={t('stats.enrollments')} value={data.categories.enrollments_active ?? 0} icon="people" color={theme.success} />
                  </AutoGrid>
                )}
              </FadeIn>
            ) : null}

            {tab === 'quality' ? (
              <FadeIn>
                <AutoGrid>
                  <StatCard label={t('stats.openSupport')} value={data.quality.open_support} icon="help-buoy" color={theme.info} />
                  <StatCard label={t('stats.clientErrors')} value={data.quality.client_errors_7d} icon="bug" color={theme.danger} />
                  <StatCard label={t('stats.ratingsCount')} value={data.quality.ratings_count} icon="star" color={theme.accent} />
                  <StatCard label={t('stats.avgRating')} value={`${data.quality.avg_rating}/5`} icon="ribbon" color={theme.certGold} />
                </AutoGrid>
                <Card>
                  <Row gap={spacing.s2}>
                    <Icon name={data.quality.client_errors_7d === 0 ? 'checkmark-circle' : 'warning'} size={22}
                      color={data.quality.client_errors_7d === 0 ? theme.success : theme.warn} />
                    <Txt variant="body" style={{ flex: 1 }}>
                      {data.quality.client_errors_7d === 0 ? t('stats.noErrors') : t('stats.hasErrors')}
                    </Txt>
                  </Row>
                </Card>
              </FadeIn>
            ) : null}
          </>
        )}
        <Spacer size={spacing.s6} />
      </ScrollView>
    </Screen>
  );
}
