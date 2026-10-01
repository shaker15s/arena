/**
 * features/feedback — التغذية الراجعة بعد كل محاضرة (خطة الإصلاح D4).
 *
 * تدفق 20 ثانية: 3 مقاييس نجمية (فهم/سرعة/وضوح) ← مزاج واحد ← اختيار المحاور
 * التي تحتاج توضيحًا ← تعليق اختياري ← إطراء المدرّب ← إرسال.
 *
 * • مرة واحدة لكل محاضرة (فريد session_id+user_id) — تعديل مسموح 24 ساعة.
 * • الإرسال عبر `submitOrQueue` → يعمل أوفلاين ويعاد عبر run_command تلقائيًا.
 * • نقاط التغذية الراجعة (points.feedback) تُمنح مرة واحدة — «اليوم الكامل»
 *   يكتمل بتسجيل الحضور + التغذية الراجعة.
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useApp } from '../../data/store';
import { attendanceOf, batchOf, courseOf, feedbackOf, pendingFeedbackFor } from '../../data/engine';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import {
  Btn, Card, Chip, Empty, FadeIn, Header, Input, Row, Screen, Spacer, Stars, Tag, Txt,
} from '../../design/components';
import { Icon } from '../../design/icons';
import { spacing } from '../../design/tokens';
import { formatDate } from '../../shared/format';
import { FeedbackSentiment, TrainingSession } from '../../data/types';

const SENTIMENTS: Array<{ value: FeedbackSentiment; icon: string; key: string }> = [
  { value: 'excited', icon: 'happy', key: 'feedback.sentiment.excited' },
  { value: 'clear', icon: 'checkmark-circle', key: 'feedback.sentiment.clear' },
  { value: 'confused', icon: 'help-circle', key: 'feedback.sentiment.confused' },
  { value: 'tired', icon: 'battery-half', key: 'feedback.sentiment.tired' },
];

function ScoreRow({ label, hint, value, onRate }: {
  label: string; hint: string; value: number; onRate: (v: number) => void;
}) {
  const { theme } = useTheme();
  return (
    <Card>
      <Row between>
        <View style={{ flex: 1 }}>
          <Txt variant="bodyMed" heading="h3">{label}</Txt>
          <Txt variant="caption" color={theme.textMuted}>{hint}</Txt>
        </View>
        <Stars value={value} size={26} onRate={onRate} />
      </Row>
    </Card>
  );
}

export function LectureFeedbackScreen({ navigation, route }: any) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const { db, user, toast, submitOrQueue } = useApp();

  const session: TrainingSession | undefined = useMemo(
    () => db.sessions.find((s) => s.id === route?.params?.sessionId),
    [db.sessions, route?.params?.sessionId],
  );
  const existing = useMemo(
    () => (user && session ? feedbackOf(db, session.id, user.id) : undefined),
    [db, user, session],
  );

  const [understanding, setUnderstanding] = useState(existing?.understanding ?? 0);
  const [pace, setPace] = useState(existing?.pace ?? 0);
  const [clarity, setClarity] = useState(existing?.clarity ?? 0);
  const [sentiment, setSentiment] = useState<FeedbackSentiment | null>(existing?.sentiment ?? null);
  const [comment, setComment] = useState(existing?.comment ?? '');
  const [praise, setPraise] = useState(existing?.praiseInstructor ?? false);
  const [topicsHard, setTopicsHard] = useState<string[]>(existing?.topicsHard ?? []);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  if (!user) return null;

  const batch = session ? batchOf(db, session.batchId) : undefined;
  const course = batch ? courseOf(db, batch.courseId) : undefined;
  const content = session ? db.sessionContent.find((c) => c.sessionId === session.id) : undefined;
  const topics = content?.topics ?? [];

  const toggleTopic = (topic: string) =>
    setTopicsHard((prev) => (prev.includes(topic) ? prev.filter((x) => x !== topic) : [...prev, topic]));

  const submit = async () => {
    if (!session) return;
    if (!understanding || !pace || !clarity) { setError(t('feedback.errScores')); return; }
    if (!sentiment) { setError(t('feedback.errSentiment')); return; }
    setSending(true);
    setError('');
    try {
      const result = await submitOrQueue('submit_session_feedback', {
        session_id: session.id,
        understanding,
        pace,
        clarity,
        sentiment,
        comment: comment.trim(),
        praise_instructor: praise,
        topics_ok: [],
        topics_hard: topicsHard,
      });
      if (result.error) { setError(result.error); return; }
      if (result.status === 'queued') {
        toast(t('feedback.queued'), 'info');
      } else {
        toast(existing ? t('feedback.updated') : t('feedback.sent'), 'success');
      }
      navigation.replace('LectureReport', { sessionId: session.id, justFeedback: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  if (!session) {
    return (
      <Screen label={t('feedback.title')}>
        <Header title={t('feedback.title')} back={() => navigation.goBack()} />
        <Empty emoji="📝" title={t('feedback.missing')} body={t('feedback.missingBody')} />
      </Screen>
    );
  }

  return (
    <Screen label={t('feedback.title')}>
      <Header
        title={t('feedback.title')}
        subtitle={course ? `${course.title} · ${t('feedback.lectureN', { n: String(session.seq) })}` : undefined}
        back={() => navigation.goBack()}
      />
      <ScrollView contentContainerStyle={{ padding: spacing.s5, gap: spacing.s4, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
        <FadeIn>
          <Card>
            <Txt variant="bodyMed" heading="h2">{session.title}</Txt>
            <Spacer size={spacing.s2} />
            <Row gap={spacing.s2} wrap>
              <Tag label={formatDate(session.startsAt, lang)} color={theme.info} bg={theme.infoSoft} icon="calendar" />
              {existing ? (
                <Tag label={t('feedback.editable')} color={theme.warn} bg={theme.warnSoft} icon="create" />
              ) : null}
            </Row>
            {existing ? <Txt variant="caption" color={theme.textMuted} style={{ marginTop: spacing.s2 }}>{t('feedback.editHint')}</Txt> : null}
          </Card>
        </FadeIn>

        <FadeIn index={1}>
          <ScoreRow
            label={t('feedback.understanding')}
            hint={t('feedback.understandingHint')}
            value={understanding}
            onRate={setUnderstanding}
          />
        </FadeIn>
        <FadeIn index={2}>
          <ScoreRow label={t('feedback.pace')} hint={t('feedback.paceHint')} value={pace} onRate={setPace} />
        </FadeIn>
        <FadeIn index={3}>
          <ScoreRow label={t('feedback.clarity')} hint={t('feedback.clarityHint')} value={clarity} onRate={setClarity} />
        </FadeIn>

        <FadeIn index={4}>
          <Card>
            <Txt variant="bodyMed" heading="h3">{t('feedback.sentimentTitle')}</Txt>
            <Spacer size={spacing.s3} />
            <Row gap={spacing.s2} wrap>
              {SENTIMENTS.map((s) => (
                <Chip
                  key={s.value}
                  label={t(s.key as any)}
                  icon={s.icon as any}
                  active={sentiment === s.value}
                  onPress={() => setSentiment(s.value)}
                />
              ))}
            </Row>
          </Card>
        </FadeIn>

        {topics.length > 0 ? (
          <FadeIn index={5}>
            <Card>
              <Txt variant="bodyMed" heading="h3">{t('feedback.topicsTitle')}</Txt>
              <Txt variant="caption" color={theme.textMuted}>{t('feedback.topicsHint')}</Txt>
              <Spacer size={spacing.s3} />
              <Row gap={spacing.s2} wrap>
                {topics.map((topic) => (
                  <Chip
                    key={topic}
                    label={topic}
                    active={topicsHard.includes(topic)}
                    onPress={() => toggleTopic(topic)}
                  />
                ))}
              </Row>
            </Card>
          </FadeIn>
        ) : null}

        <FadeIn index={6}>
          <Card>
            <Input
              label={t('feedback.commentLabel')}
              value={comment}
              onChange={setComment}
              placeholder={t('feedback.commentPlaceholder')}
              multiline
              maxLength={1000}
            />
            <Spacer size={spacing.s3} />
            <Chip
              label={t('feedback.praise')}
              icon="heart"
              active={praise}
              onPress={() => setPraise((v) => !v)}
            />
          </Card>
        </FadeIn>

        {error ? <Txt variant="caption" color={theme.danger}>{error}</Txt> : null}

        <FadeIn index={7}>
          <Btn
            title={existing ? t('feedback.update') : t('feedback.submit')}
            icon="paper-plane"
            size="lg"
            full
            loading={sending}
            onPress={() => void submit()}
            accessibilityHint={t('feedback.submitHint')}
          />
        </FadeIn>
        <Spacer size={spacing.s6} />
      </ScrollView>
    </Screen>
  );
}

/**
 * قائمة التغذية الراجعة المعلّقة — تُستدعى من «اليوم» (بانر) والتنقل السريع.
 */
export function PendingFeedbackList({ navigation }: any) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const { db, user } = useApp();
  const pending = useMemo(() => (user ? pendingFeedbackFor(db, user.id) : []), [db, user]);

  if (!user || pending.length === 0) return null;
  return (
    <View>
      {pending.slice(0, 3).map((s, i) => {
        const att = attendanceOf(db, s.id, user.id);
        return (
          <FadeIn key={s.id} index={i}>
            <Card onPress={() => navigation.navigate('LectureFeedback', { sessionId: s.id })}>
              <Row between>
                <View style={{ flex: 1 }}>
                  <Txt variant="bodyMed">{s.title}</Txt>
                  <Txt variant="caption" color={theme.textMuted}>
                    {formatDate(s.startsAt, lang)}
                    {att ? ` · ${t('feedback.attended')}` : ''}
                  </Txt>
                </View>
                <Icon name="chatbubble-ellipses" size={22} color={theme.accent} />
              </Row>
            </Card>
          </FadeIn>
        );
      })}
    </View>
  );
}
