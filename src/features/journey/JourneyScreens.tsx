/**
 * features/journey — S14 رحلتي + S15 خريطة الرحلة (التوقيع البصري) + S16 سجل الحضور + S26 تقييم الكورس.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../../data/store';
import {
  attendanceOf, attendancePct, batchOf, courseOf, courseStreak,
  profileOf, rpcSubmitRating, sessionsOfBatch,
} from '../../data/engine';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import {
  Btn, Card, Chip, Empty, FadeIn, Flame, Header, Input, ProgressBar, Row,
  Segmented, Sheet, Spacer, Stars, StatRing, Tag, Txt,
} from '../../design/components';
import { spacing, radii, attendanceColors } from '../../design/tokens';
import { formatDate, formatTime, timePast } from '../../shared/format';
import { Batch, TrainingSession, AttendanceStatus } from '../../data/types';

// ───────────────────────────── S14 رحلتي ─────────────────────────────

export function JourneyScreen({ navigation }: any) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { db, user } = useApp();
  if (!user) return null;

  const myEnrollments = db.enrollments.filter((e) => e.userId === user.id && e.status === 'active');
  const certPct = (() => {
    const r = db.rules.find((x) => x.key === 'certificate.min_attendance_pct');
    return typeof r?.value === 'number' ? r.value : 75;
  })();

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.s3, paddingBottom: 120 }}>
        <Header title={t('journey.title')} />
        <View style={{ paddingHorizontal: spacing.s5, gap: 14 }}>
          {myEnrollments.length === 0 ? (
            <Empty emoji="🗺️" title={t('journey.emptyTitle')} body={t('journey.emptyBody')} cta={t('today.exploreCta')} onCta={() => navigation.navigate('Tabs')} />
          ) : (
            myEnrollments.map((enr, i) => {
              const batch = batchOf(db, enr.batchId);
              const course = batch ? courseOf(db, batch.courseId) : undefined;
              if (!batch || !course) return null;
              const sess = sessionsOfBatch(db, batch.id);
              const closed = sess.filter((s) => s.status === 'closed').length;
              const { pct } = attendancePct(db, user.id, batch.id);
              const streak = courseStreak(db, user.id, batch.id);
              const completed = closed >= course.sessionsCount || batch.status === 'completed';
              const rated = db.ratings.some((r) => r.userId === user.id && r.courseId === course.id);
              return (
                <FadeIn key={batch.id} index={i}>
                  <Card>
                    <Pressable onPress={() => navigation.navigate('JourneyMap', { batchId: batch.id })}>
                      <Row center gap={14}>
                        <StatRing size={74} stroke={7} progress={pct / 100} color={pct >= certPct ? theme.success : course.color}>
                          <Txt variant="h3">{pct}%</Txt>
                        </StatRing>
                        <View style={{ flex: 1, gap: 4 }}>
                          <Txt variant="h3">{course.title}</Txt>
                          <Row center gap={8} wrap>
                            <Tag
                              label={t('journey.sessionXofY', { x: Math.min(closed, course.sessionsCount), y: course.sessionsCount })}
                              color={theme.brand} bg={theme.brandSoft} icon="calendar"
                            />
                            {completed ? <Tag label={t('journey.courseComplete')} color={theme.certGold} bg={theme.warnSoft} icon="trophy" /> : null}
                          </Row>
                          <Row center gap={6}>
                            {pct >= certPct ? (
                              <Tag label={t('today.eligible')} color={theme.success} bg={theme.successSoft} icon="checkmark-circle" />
                            ) : (
                              <Txt variant="micro" color={theme.warn}>{t('today.needMore', { x: Math.max(1, Math.ceil((certPct / 100) * course.sessionsCount) - (db.attendance.filter((a) => a.userId === user.id && a.status !== 'absent' && sess.some((s) => s.id === a.sessionId && s.status === 'closed')).length)) })}</Txt>
                            )}
                            {streak >= 2 ? (
                              <Row center gap={3}>
                                <Flame size={13} />
                                <Txt variant="micro" color={theme.warn}>{t('map.courseStreak', { x: streak })}</Txt>
                              </Row>
                            ) : null}
                          </Row>
                        </View>
                        <Ionicons name="chevron-back" size={18} color={theme.textMuted} />
                      </Row>
                    </Pressable>
                    <Spacer size={10} />
                    <Row gap={8}>
                      <Btn title={t('journey.map')} size="sm" variant="secondary" icon="map" onPress={() => navigation.navigate('JourneyMap', { batchId: batch.id })} />
                      <Btn title={t('journey.history')} size="sm" variant="ghost" icon="list" onPress={() => navigation.navigate('AttendanceHistory', { batchId: batch.id })} />
                      {completed && !rated ? (
                        <Btn title={t('journey.rateCourse')} size="sm" variant="gold" icon="star" onPress={() => navigation.navigate('JourneyMap', { batchId: batch.id, rate: true })} />
                      ) : null}
                    </Row>
                  </Card>
                </FadeIn>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// ───────────────────────────── S15 خريطة الرحلة ─────────────────────────────

const NODE_SIZE = 64;

export function JourneyMapScreen({ route, navigation }: any) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { db, user, mutate, toast } = useApp();
  const batchId: string = route.params.batchId;
  const batch = batchOf(db, batchId);
  const course = batch ? courseOf(db, batch.courseId) : undefined;
  const sessions = batch ? sessionsOfBatch(db, batchId) : [];
  const [rateOpen, setRateOpen] = useState<boolean>(route.params?.rate === true);
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);

  if (!batch || !course || !user) return null;

  const statusOf = (sess: TrainingSession): 'done' | 'late' | 'current' | 'locked' | 'excused' | 'absent' => {
    const att = attendanceOf(db, sess.id, user.id);
    if (sess.status === 'live') return att && att.status !== 'absent' ? (att.status === 'late' ? 'late' : 'done') : 'current';
    if (sess.status === 'scheduled') {
      const prev = sessions.filter((s) => s.seq < sess.seq);
      const prevDone = prev.every((p) => {
        const a = attendanceOf(db, p.id, user.id);
        return p.status === 'closed' && a && a.status !== 'absent';
      });
      return prevDone && sess.seq === prev.length + 1 ? 'current' : 'locked';
    }
    // closed
    if (!att || att.status === 'absent') return 'absent';
    if (att.status === 'excused') return 'excused';
    if (att.status === 'late') return 'late';
    return 'done';
  };

  const nodeMeta = (st: ReturnType<typeof statusOf>) => {
    switch (st) {
      case 'done': return { color: theme.success, icon: 'checkmark' as const, label: t('map.nodeDone') };
      case 'late': return { color: theme.warn, icon: 'time' as const, label: t('map.nodeLate') };
      case 'current': return { color: theme.brand, icon: 'play' as const, label: t('map.nodeCurrent') };
      case 'excused': return { color: theme.info, icon: 'shield' as const, label: t('map.nodeExcused') };
      case 'absent': return { color: '#64748B', icon: 'close' as const, label: t('map.nodeAbsent') };
      default: return { color: theme.textMuted, icon: 'lock-closed' as const, label: t('map.nodeLocked') };
    }
  };

  const instructor = profileOf(db, batch.instructorId);
  const streak = courseStreak(db, user.id, batchId);

  const submitRating = async () => {
    if (!user) return;
    setSending(true);
    const r = await mutate((d) => rpcSubmitRating(d, user.id, course.id, stars, comment.trim() || undefined));
    setSending(false);
    if (r.ok) {
      setRateOpen(false);
      toast(t('journey.ratingThanks'), 'success');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title={course.title} subtitle={`${instructor?.fullName ?? ''} · ${batch.room}`} back={() => navigation.goBack()} right={
        streak >= 2 ? (
          <Row center gap={4}>
            <Flame size={18} />
            <Txt variant="h3" color={theme.warn}>{streak}</Txt>
          </Row>
        ) : undefined
      } />
      <ScrollView contentContainerStyle={{ paddingBottom: 120, paddingTop: 10 }}>
        {/* المسار العمودي المتعرج */}
        <View style={{ alignItems: 'center' }}>
          {sessions.map((sess, i) => {
            const st = statusOf(sess);
            const meta = nodeMeta(st);
            const side = i % 2 === 0 ? -1 : 1;
            return (
              <React.Fragment key={sess.id}>
                {i > 0 ? <Connector color={statusNodePassed(sessions[i - 1]) ? theme.success : theme.line} /> : null}
                <FadeIn index={i}>
                  <View style={{ alignSelf: side < 0 ? 'flex-start' : 'flex-end', marginHorizontal: '12%' as any, flexDirection: side < 0 ? 'row' : 'row-reverse', alignItems: 'center', gap: 14 }}>
                    <NodeBubble sess={sess} meta={meta} status={st} />
                    <View style={{ maxWidth: 170, gap: 3 }}>
                      <Txt variant="micro" color={theme.textMuted}>{t('common.sessions')} {sess.seq}</Txt>
                      <Txt variant="caption" numberOfLines={2}>{sess.title}</Txt>
                      <Row center gap={4}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: meta.color }} />
                        <Txt variant="micro" color={meta.color}>{meta.label}</Txt>
                      </Row>
                      <Txt variant="micro" color={theme.textMuted}>{formatDate(sess.startsAt, lang)}</Txt>
                    </View>
                  </View>
                </FadeIn>
              </React.Fragment>
            );
          })}
          {/* عقدة الشهادة النهائية */}
          <Connector color={theme.line} />
          <FadeIn index={sessions.length}>
            <View style={{ alignItems: 'center', gap: 6 }}>
              <View style={{
                width: NODE_SIZE + 12, height: NODE_SIZE + 12, borderRadius: (NODE_SIZE + 12) / 2,
                backgroundColor: theme.warnSoft, borderWidth: 3, borderColor: theme.certGold,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Ionicons name="trophy" size={36} color={theme.certGold} />
              </View>
              <Txt variant="caption" color={theme.certGold}>{t('map.certNode')}</Txt>
            </View>
          </FadeIn>
        </View>
      </ScrollView>

      {/* S26 — تقييم الكورس */}
      <Sheet visible={rateOpen} onClose={() => setRateOpen(false)} title={t('journey.rateCourse')}>
        <View style={{ gap: 14, alignItems: 'center' }}>
          <Stars value={stars} size={36} onRate={setStars} />
          <View style={{ alignSelf: 'stretch' }}>
            <Input value={comment} onChange={setComment} placeholder={t('excuses.reasonPlaceholder')} multiline />
          </View>
          <Btn title={t('common.send')} full size="lg" loading={sending} onPress={submitRating} icon="star" />
        </View>
      </Sheet>
    </View>
  );

  function statusNodePassed(sess: TrainingSession) {
    const st = statusOf(sess);
    return st === 'done' || st === 'late' || st === 'excused';
  }
}

function Connector({ color }: { color: string }) {
  return <View style={{ width: 3, height: 26, backgroundColor: color, borderRadius: 2 }} />;
}

function NodeBubble({ sess, meta, status }: { sess: TrainingSession; meta: { color: string; icon: keyof typeof Ionicons.glyphMap }; status: string }) {
  const { theme } = useTheme();
  return (
    <View style={{
      width: NODE_SIZE, height: NODE_SIZE, borderRadius: NODE_SIZE / 2,
      backgroundColor: status === 'locked' ? theme.card : meta.color,
      borderWidth: status === 'current' ? 3 : 2,
      borderColor: meta.color,
      alignItems: 'center', justifyContent: 'center',
      shadowColor: meta.color, shadowOpacity: status === 'current' ? 0.45 : 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    }}>
      <Ionicons name={meta.icon} size={26} color={status === 'locked' ? theme.textMuted : '#fff'} />
    </View>
  );
}

// ───────────────────────────── S16 سجل الحضور ─────────────────────────────

type Filter = 'all' | AttendanceStatus;

export function AttendanceHistoryScreen({ route, navigation }: any) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { db, user } = useApp();
  const batchId: string | undefined = route.params?.batchId;
  const [filter, setFilter] = useState<Filter>('all');
  if (!user) return null;

  const rows = useMemo(() => {
    return db.attendance
      .filter((a) => a.userId === user.id)
      .map((a) => ({ att: a, sess: db.sessions.find((s) => s.id === a.sessionId)! }))
      .filter((r) => r.sess && (!batchId || r.sess.batchId === batchId))
      .sort((a, b) => b.sess.startsAt - a.sess.startsAt);
  }, [db.attendance, db.sessions, user.id, batchId]);

  const filtered = filter === 'all' ? rows : rows.filter((r) => r.att.status === filter);
  const honored = rows.filter((r) => r.att.status !== 'absent').length;
  const pct = rows.length === 0 ? 0 : Math.round((honored / rows.length) * 100);

  const statusMeta: Record<AttendanceStatus, { color: string; label: string; icon: keyof typeof Ionicons.glyphMap }> = {
    present: { color: theme.success, label: t('history.present'), icon: 'checkmark-circle' },
    late: { color: theme.warn, label: t('history.late'), icon: 'time' },
    excused: { color: theme.info, label: t('history.excused'), icon: 'shield' },
    absent: { color: '#64748B', label: t('history.absent'), icon: 'close-circle' },
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title={t('history.title')} back={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.s5, paddingBottom: 60, gap: 12 }}>
        <FadeIn index={0}>
          <Card>
            <Row between center>
              <View>
                <Txt variant="caption" color={theme.textMuted}>{t('history.commitment')}</Txt>
                <Txt variant="numberHero">{pct}%</Txt>
              </View>
              <Row gap={14}>
                {(['present', 'late', 'excused', 'absent'] as const).map((s) => (
                  <View key={s} style={{ alignItems: 'center', gap: 2 }}>
                    <Txt variant="h3" color={statusMeta[s].color}>{rows.filter((r) => r.att.status === s).length}</Txt>
                    <Txt variant="micro" color={theme.textMuted}>{statusMeta[s].label}</Txt>
                  </View>
                ))}
              </Row>
            </Row>
            <Spacer size={10} />
            <ProgressBar progress={pct / 100} color={theme.success} />
          </Card>
        </FadeIn>

        <FadeIn index={1}>
          <Row gap={8} wrap>
            {(['all', 'present', 'late', 'excused', 'absent'] as const).map((f) => (
              <Chip
                key={f}
                label={f === 'all' ? t('common.all') : statusMeta[f].label}
                active={filter === f}
                onPress={() => setFilter(f)}
              />
            ))}
          </Row>
        </FadeIn>

        {filtered.length === 0 ? (
          <Empty emoji="🗂️" title={t('history.emptyFilter')} />
        ) : (
          filtered.map(({ att, sess }, i) => {
            const batch = batchOf(db, sess.batchId);
            const course = batch ? courseOf(db, batch.courseId) : undefined;
            const meta = statusMeta[att.status];
            const points = att.status === 'present' ? 10 : att.status === 'late' ? 7 : 0;
            return (
              <FadeIn key={sess.id} index={Math.min(i, 6)}>
                <Card>
                  <Row center gap={12}>
                    <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: meta.color + '1F', alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name={meta.icon} size={22} color={meta.color} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Txt variant="bodyMed" numberOfLines={1}>{course?.title ?? ''}</Txt>
                      <Txt variant="caption" color={theme.textSecondary} numberOfLines={1}>{sess.title}</Txt>
                      <Txt variant="micro" color={theme.textMuted}>
                        {formatDate(sess.startsAt, lang)} · {formatTime(sess.startsAt, lang)}
                        {att.method === 'manual' ? ' · يدوي' : ''}
                      </Txt>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Tag label={meta.label} color={meta.color} bg={meta.color + '1F'} />
                      {points > 0 ? <Txt variant="micro" color={theme.success}>+{points}</Txt> : null}
                    </View>
                  </Row>
                </Card>
              </FadeIn>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}
