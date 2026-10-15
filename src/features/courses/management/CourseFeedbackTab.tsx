/**
 * features/courses/management/CourseFeedbackTab.tsx — تبويب «التغذية الراجعة» للمنظّم
 *
 * لماذا: كان المنظّم يضطر لفتح تقرير كل محاضرة على حدة ليعرف رأي الطلاب. هنا
 * **نظرة واحدة** على الكورس كاملًا: متوسطات الفهم/الإيقاع/الوضوح، توزيع الانطباع،
 * الثناء على المدرّب، المحاور التي تحتاج توضيحًا، المحاضرات بلا تقرير، والتقييمات.
 *
 * الخصوصية: كل شيء **مجهول الهوية** (لا أسماء ولا معرّفات) — نفس ما تعيده
 * `get_course_feedback` في السيرفر، والمرآة المحلية في `courseFeedback()`.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { courseFeedback, profileOf } from '../../../data/engine';
import { useApp } from '../../../data/store';
import { useTheme } from '../../../design/theme';
import { useI18n } from '../../../i18n';
import { Avatar, Card, Empty, ProgressBar, Row, Spacer, Tag, Txt } from '../../../design/components';
import { Icon } from '../../../design/icons';
import { radii, spacing } from '../../../design/tokens';
import { formatDate } from '../../../shared/format';
import type { FeedbackSentiment } from '../../../data/types';

const SENTIMENT_META: Record<FeedbackSentiment, { key: string; icon: 'happy' | 'bulb' | 'help-circle' | 'battery-half'; tone: 'success' | 'brand' | 'warn' | 'danger' }> = {
  excited: { key: 'feedback.sentiment.excited', icon: 'happy', tone: 'success' },
  clear: { key: 'feedback.sentiment.clear', icon: 'bulb', tone: 'brand' },
  confused: { key: 'feedback.sentiment.confused', icon: 'help-circle', tone: 'warn' },
  tired: { key: 'feedback.sentiment.tired', icon: 'battery-half', tone: 'danger' },
};

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  const { theme } = useTheme();
  return (
    <View style={{ gap: 5, flex: 1, minWidth: 120 }}>
      <Row between center>
        <Txt variant="micro" color={theme.textSecondary}>{label}</Txt>
        <Txt variant="caption" bold color={color}>{value > 0 ? value.toFixed(1) : '—'}</Txt>
      </Row>
      <ProgressBar progress={value / 5} height={6} color={color} />
    </View>
  );
}

export function CourseFeedbackTab({ db, courseId }: { db: ReturnType<typeof useApp>['db']; courseId: string }) {
  const { theme } = useTheme();
  const { t, lang } = useI18n();
  const [openSession, setOpenSession] = useState<string | null>(null);

  const view = useMemo(() => courseFeedback(db, courseId), [db, courseId]);

  const toneColor = (tone: 'success' | 'brand' | 'warn' | 'danger') =>
    tone === 'success' ? theme.success : tone === 'brand' ? theme.brand : tone === 'warn' ? theme.warn : theme.danger;

  if (view.totals.responses === 0) {
    return (
      <Empty
        emoji="📝"
        title={t('management.noFeedbackTitle')}
        body={t('management.noFeedbackBody')}
      />
    );
  }

  const withFeedback = view.sessions.filter((s) => s.responses > 0);

  return (
    <View style={{ gap: spacing.s3 }}>
      {/* الملخص العام */}
      <Card color={theme.brandSoft} style={{ borderColor: theme.brand + '33' }}>
        <Row between center>
          <View style={{ flex: 1, gap: 3 }}>
            <Txt variant="caption" color={theme.textSecondary}>{t('management.feedbackOverview')}</Txt>
            <Txt variant="h2" color={theme.brand}>
              {t('management.feedbackResponses', { x: view.totals.responses })}
            </Txt>
            <Txt variant="micro" color={theme.textMuted}>
              {t('management.feedbackCoverage', {
                x: view.totals.sessionsWithFeedback,
                y: view.totals.sessionsTotal,
              })}
            </Txt>
          </View>
          <View style={[styles.bigScore, { backgroundColor: '#fff', borderColor: theme.brand + '33' }]}>
            <Txt variant="h2" color={theme.brand}>{view.totals.avgUnderstanding.toFixed(1)}</Txt>
            <Txt variant="micro" color={theme.textMuted}>{t('feedback.understanding')}</Txt>
          </View>
        </Row>
        <Spacer size={spacing.s3} />
        <Row gap={spacing.s3} wrap>
          <ScoreBar label={t('feedback.understanding')} value={view.totals.avgUnderstanding} color={theme.brand} />
          <ScoreBar label={t('feedback.pace')} value={view.totals.avgPace} color={theme.teal} />
          <ScoreBar label={t('feedback.clarity')} value={view.totals.avgClarity} color={theme.success} />
        </Row>
        <Spacer size={spacing.s3} />
        <Row gap={spacing.s2} wrap>
          {Object.entries(SENTIMENT_META).map(([key, meta]) => {
            const count = view.sentiments[key as FeedbackSentiment] ?? 0;
            if (count === 0) return null;
            return (
              <Tag
                key={key}
                label={`${t(meta.key as any)} · ${count}`}
                color={toneColor(meta.tone)}
                bg={toneColor(meta.tone) + '1F'}
                icon={meta.icon}
              />
            );
          })}
          {view.totals.praiseCount > 0 ? (
            <Tag
              label={t('management.praiseCount', { x: view.totals.praiseCount })}
              color={theme.certGold}
              bg={theme.warnSoft}
              icon="heart"
            />
          ) : null}
        </Row>
      </Card>

      {/* تنبيهات تحتاج فعلًا */}
      {view.totals.missingReports > 0 ? (
        <Card color={theme.warnSoft} style={{ borderColor: theme.warn + '44' }}>
          <Row center gap={spacing.s3}>
            <Icon name="alert-circle" size={22} color={theme.warn} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="bodyMed" color={theme.warn}>{t('management.missingReportsTitle')}</Txt>
              <Txt variant="micro" color={theme.textSecondary}>
                {t('management.missingReportsBody', { x: view.totals.missingReports })}
              </Txt>
            </View>
          </Row>
        </Card>
      ) : null}

      {view.topicsHard.length > 0 ? (
        <Card style={{ borderColor: theme.danger + '33' }}>
          <Row center gap={spacing.s2}>
            <Icon name="school" size={18} color={theme.danger} />
            <Txt variant="h3">{t('management.hardTopicsTitle')}</Txt>
          </Row>
          <Spacer size={spacing.s2} />
          <Txt variant="micro" color={theme.textMuted}>{t('management.hardTopicsBody')}</Txt>
          <Spacer size={spacing.s2} />
          <Row gap={spacing.s2} wrap>
            {view.topicsHard.slice(0, 12).map((topic) => (
              <Tag
                key={topic.topic}
                label={`${topic.topic} · ${topic.count}`}
                color={theme.danger}
                bg={theme.danger + '1A'}
              />
            ))}
          </Row>
        </Card>
      ) : null}

      {/* تفصيل المحاضرات */}
      <Row between center style={{ marginHorizontal: 4 }}>
        <Txt variant="h3">{t('management.perSessionFeedback')}</Txt>
        <Tag label={String(withFeedback.length)} color={theme.brand} bg={theme.brandSoft} />
      </Row>

      {withFeedback.map((sess) => {
        const open = openSession === sess.sessionId;
        const weak = sess.avgUnderstanding > 0 && sess.avgUnderstanding < 3.5;
        return (
          <Card key={sess.sessionId} style={{ borderColor: weak ? theme.warn + '55' : theme.line }}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              accessibilityLabel={`${sess.title} — ${t('management.feedbackResponses', { x: sess.responses })}`}
              onPress={() => setOpenSession(open ? null : sess.sessionId)}
            >
              <Row between center gap={spacing.s2}>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Txt variant="bodyMed" numberOfLines={2}>{`${sess.seq}. ${sess.title}`}</Txt>
                  <Txt variant="micro" color={theme.textMuted}>
                    {formatDate(sess.startsAt, lang)} · {t('management.feedbackResponses', { x: sess.responses })}
                  </Txt>
                </View>
                <Row center gap={spacing.s1}>
                  {!sess.hasReport ? <Icon name="document-outline" size={15} color={theme.warn} /> : null}
                  <Icon name={open ? 'chevron-up' : 'chevron-down'} size={17} color={theme.textMuted} />
                </Row>
              </Row>
              <Spacer size={spacing.s2} />
              <Row gap={spacing.s3} wrap>
                <ScoreBar label={t('feedback.understanding')} value={sess.avgUnderstanding} color={weak ? theme.warn : theme.brand} />
                <ScoreBar label={t('feedback.clarity')} value={sess.avgClarity} color={theme.success} />
              </Row>
            </Pressable>

            {open ? (
              <View style={{ marginTop: spacing.s3, gap: spacing.s2 }}>
                <Row gap={spacing.s2} wrap>
                  {Object.entries(SENTIMENT_META).map(([key, meta]) => {
                    const count = sess.sentiments[key as FeedbackSentiment] ?? 0;
                    if (count === 0) return null;
                    return (
                      <Tag
                        key={key}
                        label={`${t(meta.key as any)} · ${count}`}
                        color={toneColor(meta.tone)}
                        bg={toneColor(meta.tone) + '1F'}
                        icon={meta.icon}
                      />
                    );
                  })}
                  {sess.praiseCount > 0 ? (
                    <Tag label={t('management.praiseCount', { x: sess.praiseCount })} color={theme.certGold} bg={theme.warnSoft} icon="heart" />
                  ) : null}
                </Row>

                {sess.topicsHard.length > 0 ? (
                  <View style={{ gap: 4 }}>
                    <Txt variant="micro" bold color={theme.textSecondary}>{t('management.hardTopicsTitle')}</Txt>
                    <Row gap={spacing.s2} wrap>
                      {sess.topicsHard.map((topic) => (
                        <Tag key={topic} label={topic} color={theme.danger} bg={theme.danger + '1A'} />
                      ))}
                    </Row>
                  </View>
                ) : null}

                {sess.comments.length > 0 ? (
                  <View style={{ gap: spacing.s2 }}>
                    <Txt variant="micro" bold color={theme.textSecondary}>{t('management.anonymousComments')}</Txt>
                    {sess.comments.slice(0, 6).map((c, i) => {
                      const meta = SENTIMENT_META[c.sentiment];
                      return (
                        <View key={`${sess.sessionId}-c-${i}`} style={[styles.comment, { backgroundColor: theme.fill, borderColor: theme.line }]}>
                          <Row center gap={spacing.s2}>
                            <Icon name={meta.icon} size={14} color={toneColor(meta.tone)} />
                            <Txt variant="micro" color={theme.textMuted}>{formatDate(c.createdAt, lang)}</Txt>
                          </Row>
                          <Txt variant="caption" style={{ marginTop: 4 }}>{c.comment}</Txt>
                        </View>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            ) : null}
          </Card>
        );
      })}

      {/* التقييمات النصية للكورس */}
      {view.ratings.count > 0 ? (
        <Card>
          <Row between center>
            <Txt variant="h3">{t('management.avgStudentRating')}</Txt>
            <Row center gap={spacing.s2}>
              <Txt variant="h2" color={theme.certGold}>{view.ratings.avg.toFixed(1)}</Txt>
              <Txt variant="micro" color={theme.textMuted}>{t('management.reviewCount', { x: view.ratings.count })}</Txt>
            </Row>
          </Row>
          <Spacer size={spacing.s3} />
          {[5, 4, 3, 2, 1].map((star) => {
            const count = view.ratings.distribution[star] ?? 0;
            const pct = view.ratings.count > 0 ? count / view.ratings.count : 0;
            return (
              <Row key={star} center gap={spacing.s2} style={{ marginBottom: 6 }}>
                <Txt variant="micro" color={theme.textMuted} style={{ width: 44 }}>{`${star} ★`}</Txt>
                <View style={{ flex: 1 }}>
                  <ProgressBar progress={pct} height={5} color={theme.certGold} />
                </View>
                <Txt variant="micro" color={theme.textMuted} style={{ width: 28, textAlign: 'right' }}>{count}</Txt>
              </Row>
            );
          })}
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bigScore: {
    minWidth: 84,
    borderRadius: radii.lg,
    borderWidth: 1,
    paddingVertical: spacing.s2,
    paddingHorizontal: spacing.s3,
    alignItems: 'center',
    gap: 2,
  },
  comment: {
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.s3,
  },
});
