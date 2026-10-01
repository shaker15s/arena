/**
 * features/reports — التقارير التفصيلية (خطة الإصلاح D5).
 *
 * • LectureReportScreen: تقرير بعد كل محاضرة —
 *   للطالب: حضوري، نقاطي، ما أُنجز، تغذيتي، «اليوم الكامل».
 *   للمنظّم: KPIs، متوسطات الرضا، التحديات المُبلَّغة (مجهولة الهوية)، التقرير.
 * • CourseReportScreen: تقرير بعد كل كورس —
 *   للطالب: نسبة الإتمام، محاور الإتقان، التقييمات، النقاط، الشهادة.
 *   للمنظّم: الدفعات، الحضور، الرضا، التقارير المفقودة.
 *
 * البيانات عبر RPCs الخادمية (get_lecture_report / get_course_report) مع
 * RLS — الطالب لا يرى إلا نفسه، والمنظّم تجميعات مجهولة الهوية.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { getCourseReport, getLectureReport, CourseReportResult, LectureReportResult } from '../../data/actions';
import { useApp } from '../../data/store';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import {
  AutoGrid, Btn, Card, Empty, FadeIn, Header, ProgressBar, Row, Screen,
  SkeletonList, Spacer, Stars, StatRing, Tag, Txt,
} from '../../design/components';
import { Icon } from '../../design/icons';
import { spacing, layout } from '../../design/tokens';
import { formatDate } from '../../shared/format';

// ───────────────────────────── تقرير المحاضرة ─────────────────────────────

function MetricCard({ label, value, icon, color }: { label: string; value: string | number; icon: string; color: string }) {
  const { theme } = useTheme();
  return (
    <Card style={{ flex: 1, minWidth: layout.minColumn.stat, alignItems: 'center', gap: spacing.s2, paddingVertical: spacing.s4 }}>
      <Icon name={icon as any} size={22} color={color} />
      <Txt variant="numberCard" color={color}>{value}</Txt>
      <Txt variant="caption" color={theme.textMuted} align="center">{label}</Txt>
    </Card>
  );
}

export function LectureReportScreen({ navigation, route }: any) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const { user } = useApp();
  const sessionId: string | undefined = route?.params?.sessionId;

  const [data, setData] = useState<LectureReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setError('');
    try {
      const result = await getLectureReport(sessionId);
      setData(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) return null;

  const attLabel = (status: string) => {
    switch (status) {
      case 'present': return { label: t('report.attPresent'), color: theme.success, bg: theme.successSoft };
      case 'late': return { label: t('report.attLate'), color: theme.warn, bg: theme.warnSoft };
      case 'absent': return { label: t('report.attAbsent'), color: theme.danger, bg: theme.dangerSoft };
      case 'excused': return { label: t('report.attExcused'), color: theme.info, bg: theme.infoSoft };
      default: return { label: t('report.attUnmarked'), color: theme.textMuted, bg: theme.brandSoft };
    }
  };

  return (
    <Screen label={t('report.lectureTitle')}>
      <Header
        title={t('report.lectureTitle')}
        subtitle={data?.session.title}
        back={() => navigation.goBack()}
      />
      <ScrollView
        contentContainerStyle={{ padding: spacing.s5, gap: spacing.s4, maxWidth: 860, width: '100%', alignSelf: 'center' }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
      >
        {loading ? (
          <SkeletonList count={3} />
        ) : error || !data ? (
          <Empty
            emoji="⚠️"
            title={t('report.loadFailed')}
            body={error || t('report.loadFailedBody')}
            cta={t('common.retry')}
            onCta={() => { setLoading(true); void load(); }}
          />
        ) : (
          <>
            {/* معلومات المحاضرة */}
            <FadeIn>
              <Card>
                <Row between>
                  <View style={{ flex: 1 }}>
                    <Txt variant="bodyMed" heading="h2">{data.session.title}</Txt>
                    <Txt variant="caption" color={theme.textMuted}>
                      {data.session.course_title} · {t('report.lectureN', { n: String(data.session.seq) })} · {formatDate(new Date(data.session.starts_at).getTime(), lang)}
                    </Txt>
                  </View>
                  <Icon name="document-text" size={26} color={theme.brand} />
                </Row>
              </Card>
            </FadeIn>

            {data.viewer === 'student' && data.student ? (
              <>
                {/* حضوري + نقاطي + اليوم الكامل */}
                <FadeIn index={1}>
                  <AutoGrid>
                    <Card style={{ flex: 1, minWidth: layout.minColumn.stat, alignItems: 'center', gap: spacing.s2, paddingVertical: spacing.s4 }}>
                      <Tag {...attLabel(data.student.attendance)} />
                      <Txt variant="caption" color={theme.textMuted}>{t('report.myAttendance')}</Txt>
                    </Card>
                    <MetricCard label={t('report.myPoints')} value={data.student.points} icon="star" color={theme.accent} />
                    <Card style={{ flex: 1, minWidth: layout.minColumn.stat, alignItems: 'center', gap: spacing.s2, paddingVertical: spacing.s4 }}>
                      <Icon name={data.student.has_feedback ? 'checkmark-circle' : 'chatbubble-ellipses'} size={22}
                        color={data.student.has_feedback ? theme.success : theme.warn} />
                      <Txt variant="caption" color={theme.textMuted} align="center">
                        {data.student.has_feedback ? t('report.feedbackDone') : t('report.feedbackPending')}
                      </Txt>
                    </Card>
                  </AutoGrid>
                </FadeIn>

                {/* ماذا تعلّمنا */}
                {(data.content.objectives.length > 0 || data.content.summary || data.report?.done) ? (
                  <FadeIn index={2}>
                    <Card>
                      <Txt variant="bodyMed" heading="h3">{t('report.whatWeLearned')}</Txt>
                      <Spacer size={spacing.s2} />
                      {data.report?.done ? (
                        <Row gap={spacing.s2}>
                          <Icon name="checkmark-done" size={18} color={theme.success} />
                          <Txt variant="body" style={{ flex: 1 }}>{data.report.done}</Txt>
                        </Row>
                      ) : null}
                      {data.content.objectives.map((obj, i) => (
                        <Row key={i} gap={spacing.s2}>
                          <Icon name="arrow-forward-circle" size={16} color={theme.brand} />
                          <Txt variant="body" style={{ flex: 1 }}>{obj}</Txt>
                        </Row>
                      ))}
                      {data.content.summary ? (
                        <Txt variant="body" color={theme.textSecondary}>{data.content.summary}</Txt>
                      ) : null}
                    </Card>
                  </FadeIn>
                ) : null}

                {/* تغذيتي */}
                {data.student.feedback ? (
                  <FadeIn index={3}>
                    <Card>
                      <Txt variant="bodyMed" heading="h3">{t('report.myFeedback')}</Txt>
                      <Spacer size={spacing.s2} />
                      <Row gap={spacing.s4} wrap>
                        <View><Txt variant="caption" color={theme.textMuted}>{t('feedback.understanding')}</Txt><Stars value={data.student.feedback.understanding} /></View>
                        <View><Txt variant="caption" color={theme.textMuted}>{t('feedback.pace')}</Txt><Stars value={data.student.feedback.pace} /></View>
                        <View><Txt variant="caption" color={theme.textMuted}>{t('feedback.clarity')}</Txt><Stars value={data.student.feedback.clarity} /></View>
                      </Row>
                      {data.student.feedback.comment ? (
                        <>
                          <Spacer size={spacing.s2} />
                          <Txt variant="body" color={theme.textSecondary}>"{data.student.feedback.comment}"</Txt>
                        </>
                      ) : null}
                    </Card>
                  </FadeIn>
                ) : (
                  <FadeIn index={3}>
                    <Card>
                      <Txt variant="bodyMed" heading="h3">{t('report.feedbackPending')}</Txt>
                      <Txt variant="body" color={theme.textMuted}>{t('report.feedbackPendingBody')}</Txt>
                      <Spacer size={spacing.s3} />
                      <Btn
                        title={t('feedback.submit')}
                        icon="chatbubble-ellipses"
                        onPress={() => navigation.navigate('LectureFeedback', { sessionId: data.session.id })}
                      />
                    </Card>
                  </FadeIn>
                )}

                {/* توصيات */}
                <FadeIn index={4}>
                  <Card>
                    <Txt variant="bodyMed" heading="h3">{t('report.recommendations')}</Txt>
                    <Spacer size={spacing.s2} />
                    {data.student.feedback && data.student.feedback.understanding < 4 ? (
                      <Row gap={spacing.s2}>
                        <Icon name="refresh" size={18} color={theme.warn} />
                        <Txt variant="body" style={{ flex: 1 }}>{t('report.recReview')}</Txt>
                      </Row>
                    ) : null}
                    {!data.student.has_feedback ? (
                      <Row gap={spacing.s2}>
                        <Icon name="chatbubble-ellipses" size={18} color={theme.brand} />
                        <Txt variant="body" style={{ flex: 1 }}>{t('report.recFeedback')}</Txt>
                      </Row>
                    ) : null}
                    {data.student.has_feedback && data.student.feedback && data.student.feedback.understanding >= 4 ? (
                      <Row gap={spacing.s2}>
                        <Icon name="trending-up" size={18} color={theme.success} />
                        <Txt variant="body" style={{ flex: 1 }}>{t('report.recGreat')}</Txt>
                      </Row>
                    ) : null}
                  </Card>
                </FadeIn>
              </>
            ) : data.manager ? (
              <>
                {/* KPIs للمنظّم */}
                <FadeIn index={1}>
                  <AutoGrid>
                    <MetricCard label={t('report.present')} value={data.manager.present} icon="people" color={theme.success} />
                    <MetricCard label={t('report.late')} value={data.manager.late} icon="time" color={theme.warn} />
                    <MetricCard label={t('report.absent')} value={data.manager.absent} icon="person-remove" color={theme.danger} />
                    <MetricCard label={t('report.excused')} value={data.manager.excused} icon="document" color={theme.info} />
                  </AutoGrid>
                </FadeIn>

                <FadeIn index={2}>
                  <Card>
                    <Txt variant="bodyMed" heading="h3">{t('report.satisfaction')}</Txt>
                    <Spacer size={spacing.s3} />
                    <Row between>
                      <View style={{ flex: 1 }}>
                        <Txt variant="caption" color={theme.textMuted}>{t('feedback.understanding')}</Txt>
                        <ProgressBar progress={data.manager.avg_understanding / 5} color={theme.brand} />
                      </View>
                      <Txt variant="numberCard">{data.manager.avg_understanding}/5</Txt>
                    </Row>
                    <Spacer size={spacing.s2} />
                    <Row between>
                      <View style={{ flex: 1 }}>
                        <Txt variant="caption" color={theme.textMuted}>{t('feedback.pace')}</Txt>
                        <ProgressBar progress={data.manager.avg_pace / 5} color={theme.accent} />
                      </View>
                      <Txt variant="numberCard">{data.manager.avg_pace}/5</Txt>
                    </Row>
                    <Spacer size={spacing.s2} />
                    <Row between>
                      <View style={{ flex: 1 }}>
                        <Txt variant="caption" color={theme.textMuted}>{t('feedback.clarity')}</Txt>
                        <ProgressBar progress={data.manager.avg_clarity / 5} color={theme.info} />
                      </View>
                      <Txt variant="numberCard">{data.manager.avg_clarity}/5</Txt>
                    </Row>
                    <Spacer size={spacing.s3} />
                    <Txt variant="caption" color={theme.textMuted}>
                      {t('report.feedbackCount', { n: String(data.manager.feedback_count) })}
                      {data.manager.praise_count > 0 ? ` · ${t('report.praiseCount', { n: String(data.manager.praise_count) })}` : ''}
                    </Txt>
                  </Card>
                </FadeIn>

                {data.manager.topics_hard.length > 0 ? (
                  <FadeIn index={3}>
                    <Card>
                      <Txt variant="bodyMed" heading="h3">{t('report.topicsHard')}</Txt>
                      <Txt variant="caption" color={theme.textMuted}>{t('report.topicsHardHint')}</Txt>
                      <Spacer size={spacing.s2} />
                      <Row gap={spacing.s2} wrap>
                        {data.manager.topics_hard.map((topic) => (
                          <Tag key={String(topic)} label={String(topic)} color={theme.warn} bg={theme.warnSoft} icon="help-circle" />
                        ))}
                      </Row>
                    </Card>
                  </FadeIn>
                ) : null}

                {data.manager.comments.length > 0 ? (
                  <FadeIn index={4}>
                    <Card>
                      <Txt variant="bodyMed" heading="h3">{t('report.comments')}</Txt>
                      <Txt variant="caption" color={theme.textMuted}>{t('report.commentsAnon')}</Txt>
                      <Spacer size={spacing.s2} />
                      {data.manager.comments.slice(0, 10).map((c, i) => (
                        <View key={i} style={{ borderRightWidth: 3, borderRightColor: theme.brandSoft, paddingRight: spacing.s3, marginBottom: spacing.s3 }}>
                          <Txt variant="body">{String(c.comment)}</Txt>
                          <Txt variant="micro" color={theme.textMuted}>{formatDate(new Date(String(c.created_at)).getTime(), lang)}</Txt>
                        </View>
                      ))}
                    </Card>
                  </FadeIn>
                ) : null}

                {data.manager.report ? (
                  <FadeIn index={5}>
                    <Card>
                      <Txt variant="bodyMed" heading="h3">{t('report.instructorReport')}</Txt>
                      <Spacer size={spacing.s2} />
                      <Txt variant="body">{String((data.manager.report as any)?.done ?? '')}</Txt>
                      {(data.manager.report as any)?.challenges ? (
                        <Txt variant="body" color={theme.warn}>{t('report.challenges')}: {String((data.manager.report as any).challenges)}</Txt>
                      ) : null}
                    </Card>
                  </FadeIn>
                ) : null}
              </>
            ) : null}
          </>
        )}
        <Spacer size={spacing.s6} />
      </ScrollView>
    </Screen>
  );
}

// ───────────────────────────── تقرير الكورس ─────────────────────────────

export function CourseReportScreen({ navigation, route }: any) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const { user } = useApp();
  const courseId: string | undefined = route?.params?.courseId;

  const [data, setData] = useState<CourseReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!courseId) return;
    setError('');
    getCourseReport(courseId)
      .then(setData)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [courseId]);

  if (!user) return null;

  const student = data?.student;
  const total = student ? Math.max(student.sessions_total, 1) : 1;
  const attendancePct = student ? Math.round((student.attended / total) * 100) : 0;

  return (
    <Screen label={t('report.courseTitle')}>
      <Header title={t('report.courseTitle')} subtitle={data?.course.title} back={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: spacing.s5, gap: spacing.s4, maxWidth: 860, width: '100%', alignSelf: 'center' }}>
        {loading ? (
          <SkeletonList count={3} />
        ) : error || !data ? (
          <Empty
            emoji="⚠️"
            title={t('report.loadFailed')}
            body={error || t('report.loadFailedBody')}
            cta={t('common.retry')}
            onCta={() => { setLoading(true); setError(''); getCourseReport(courseId!).then(setData).catch((e) => setError((e as Error).message)).finally(() => setLoading(false)); }}
          />
        ) : student ? (
          <>
            <FadeIn>
              <Card>
                <Row center gap={spacing.s4}>
                  <StatRing size={84} progress={attendancePct / 100} color={theme.brand}>
                    <Txt variant="numberCard">{attendancePct}%</Txt>
                  </StatRing>
                  <View style={{ flex: 1 }}>
                    <Txt variant="bodyMed" heading="h2">{data.course.title}</Txt>
                    <Txt variant="caption" color={theme.textMuted}>
                      {t('report.sessionsAttended', { n: String(student.attended), total: String(student.sessions_total) })}
                    </Txt>
                  </View>
                </Row>
              </Card>
            </FadeIn>

            <FadeIn index={1}>
              <AutoGrid>
                <MetricCard label={t('report.late')} value={student.late} icon="time" color={theme.warn} />
                <MetricCard label={t('report.absent')} value={student.absent} icon="person-remove" color={theme.danger} />
                <MetricCard label={t('report.feedbackGiven')} value={student.feedback_given} icon="chatbubble-ellipses" color={theme.brand} />
                <MetricCard label={t('report.points')} value={student.points} icon="star" color={theme.accent} />
              </AutoGrid>
            </FadeIn>

            {/* محاور الإتقان */}
            <FadeIn index={2}>
              <Card>
                <Txt variant="bodyMed" heading="h3">{t('report.mastery')}</Txt>
                <Txt variant="caption" color={theme.textMuted}>{t('report.masteryHint')}</Txt>
                <Spacer size={spacing.s3} />
                {student.topics_ok.length === 0 && student.topics_hard.length === 0 ? (
                  <Txt variant="body" color={theme.textMuted}>{t('report.masteryEmpty')}</Txt>
                ) : (
                  <>
                    {student.topics_ok.map((topic) => (
                      <Row key={`ok-${topic}`} gap={spacing.s2} style={{ marginBottom: spacing.s2 }}>
                        <Icon name="checkmark-circle" size={18} color={theme.success} />
                        <Txt variant="body" style={{ flex: 1 }}>{String(topic)}</Txt>
                      </Row>
                    ))}
                    {student.topics_hard.map((topic) => (
                      <Row key={`hard-${topic}`} gap={spacing.s2} style={{ marginBottom: spacing.s2 }}>
                        <Icon name="help-circle" size={18} color={theme.warn} />
                        <Txt variant="body" style={{ flex: 1 }}>{String(topic)}</Txt>
                      </Row>
                    ))}
                  </>
                )}
              </Card>
            </FadeIn>

            {/* الشهادات */}
            {student.certificates.length > 0 ? (
              <FadeIn index={3}>
                <Card>
                  <Txt variant="bodyMed" heading="h3">{t('report.certificates')}</Txt>
                  <Spacer size={spacing.s2} />
                  {student.certificates.map((cert) => (
                    <Row key={cert.serial} between>
                      <Row gap={spacing.s2}>
                        <Icon name="ribbon" size={20} color={theme.certGold} />
                        <Txt variant="body">{cert.serial}</Txt>
                      </Row>
                      <Tag
                        label={cert.status === 'active' ? t('report.certActive') : t('report.certRevoked')}
                        color={cert.status === 'active' ? theme.success : theme.danger}
                        bg={cert.status === 'active' ? theme.successSoft : theme.dangerSoft}
                      />
                    </Row>
                  ))}
                </Card>
              </FadeIn>
            ) : null}

            {/* التوصيات */}
            <FadeIn index={4}>
              <Card>
                <Txt variant="bodyMed" heading="h3">{t('report.recommendations')}</Txt>
                <Spacer size={spacing.s2} />
                {student.topics_hard.length > 0 ? (
                  <Row gap={spacing.s2}>
                    <Icon name="refresh" size={18} color={theme.warn} />
                    <Txt variant="body" style={{ flex: 1 }}>{t('report.recTopics')}</Txt>
                  </Row>
                ) : (
                  <Row gap={spacing.s2}>
                    <Icon name="trending-up" size={18} color={theme.success} />
                    <Txt variant="body" style={{ flex: 1 }}>{t('report.recGreat')}</Txt>
                  </Row>
                )}
                <Spacer size={spacing.s3} />
                <Btn title={t('report.rateCourse')} icon="star" variant="secondary"
                  onPress={() => navigation.navigate('CourseDetails', { courseId: data.course.id })} />
              </Card>
            </FadeIn>
          </>
        ) : data.manager ? (
          <>
            <FadeIn>
              <Card>
                <Txt variant="bodyMed" heading="h2">{data.course.title}</Txt>
                <Txt variant="caption" color={theme.textMuted}>
                  {t('report.avgRating')}: {data.manager.avg_rating}/5 · {t('report.ratingsCount', { n: String(data.manager.ratings_count) })}
                </Txt>
              </Card>
            </FadeIn>
            {data.manager.batches.map((b, i) => (
              <FadeIn key={b.batch_id} index={i + 1}>
                <Card>
                  <Row between>
                    <View style={{ flex: 1 }}>
                      <Txt variant="bodyMed">{b.room || t('report.batch')}</Txt>
                      <Txt variant="caption" color={theme.textMuted}>
                        {t('report.enrolled', { n: String(b.enrolled) })} · {t('report.sessions', { n: String(b.sessions) })}
                      </Txt>
                    </View>
                    <Txt variant="numberCard" color={theme.brand}>{b.attendance_pct}%</Txt>
                  </Row>
                  <Spacer size={spacing.s2} />
                  <ProgressBar progress={b.attendance_pct / 100} color={theme.brand} />
                  {b.missing_reports > 0 ? (
                    <Txt variant="caption" color={theme.warn}>
                      {t('report.missingReports', { n: String(b.missing_reports) })}
                    </Txt>
                  ) : null}
                </Card>
              </FadeIn>
            ))}
          </>
        ) : null}
        <Spacer size={spacing.s6} />
      </ScrollView>
    </Screen>
  );
}
