import React, { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../../data/store';
import {
  attendancePct, batchStudents, courseOf, isBatchComplete, profileOf, seatCounts, sessionsOfBatch,
} from '../../data/engine';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import {
  Avatar, Card, Chip, Empty, FadeIn, Header, ProgressBar, Row, Segmented, Spacer, Tag, Txt,
} from '../../design/components';
import { spacing } from '../../design/tokens';
import { formatDate, formatTime } from '../../shared/format';

export function CourseManagementScreen({ route, navigation }: any) {
  const { db, user, refresh, syncing } = useApp();
  const { theme } = useTheme();
  const { t, lang } = useI18n();
  const requestedBatchId: string | undefined = route.params?.batchId;
  const requestedCourseId: string | undefined = route.params?.courseId;
  const initialBatch = requestedBatchId ? db.batches.find((b) => b.id === requestedBatchId) : undefined;
  const courseId = requestedCourseId ?? initialBatch?.courseId;
  const course = courseId ? courseOf(db, courseId) : undefined;
  const allowedBatches = useMemo(() => {
    if (!courseId || !user) return [];
    return db.batches
      .filter((batch) => batch.courseId === courseId)
      .filter((batch) => user.role === 'admin' || user.role === 'supervisor' || batch.instructorId === user.id)
      .sort((a, b) => b.startDate - a.startDate);
  }, [courseId, db.batches, user]);
  const [batchId, setBatchId] = useState<string>(requestedBatchId ?? allowedBatches[0]?.id ?? '');
  const [tab, setTab] = useState<'overview' | 'students' | 'sessions'>('overview');

  if (!user || !course) return (
    <View style={{ flex: 1 }}>
      <Header title={t('management.detailsTitle')} back={() => navigation.goBack()} />
      <Empty emoji="🔒" title={t('management.forbidden')} />
    </View>
  );

  const batch = allowedBatches.find((item) => item.id === batchId) ?? allowedBatches[0];
  const allCounts = allowedBatches.reduce((sum, item) => sum + seatCounts(db, item.id).taken, 0);
  const completed = allowedBatches.filter((item) => isBatchComplete(db, item.id)).length;
  const active = allowedBatches.filter((item) => item.status === 'active').length;
  const students = batch ? batchStudents(db, batch.id) : [];
  const sessions = batch ? sessionsOfBatch(db, batch.id) : [];
  const counts = batch ? seatCounts(db, batch.id) : { taken: 0, waitlist: 0 };
  const branch = batch ? db.branches.find((item) => item.id === batch.branchId) : undefined;
  const instructor = batch ? profileOf(db, batch.instructorId) : undefined;

  const statusMeta = (status: string, candidateBatchId?: string) => status === 'active'
    ? { label: t('common.active'), color: theme.success }
    : status === 'completed' && candidateBatchId && isBatchComplete(db, candidateBatchId)
      ? { label: t('common.closedStatus'), color: theme.brand }
      : status === 'completed' ? { label: t('management.incompleteData'), color: theme.danger }
      : status === 'scheduled' ? { label: t('common.scheduledStatus'), color: theme.warn }
      : { label: t('common.archived'), color: theme.textMuted };

  return (
    <View style={{ flex: 1 }}>
      <Header title={course.title} subtitle={t('management.subtitle')} back={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.s5, gap: 14, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={syncing} onRefresh={() => { void refresh(); }} tintColor={theme.brand} />}
      >
        <Card color={course.color + '18'} style={{ borderColor: course.color + '55' }}>
          <Row center gap={12}>
            <View style={{ width: 54, height: 54, borderRadius: 17, backgroundColor: course.color, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="book" size={25} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Txt variant="h2">{course.title}</Txt>
              <Txt variant="caption" color={theme.textSecondary}>{course.field} · {t('explore.sessionsCount', { x: course.sessionsCount })}</Txt>
            </View>
            <Tag label={t(`common.${course.status}` as any)} color={course.color} bg={course.color + '1F'} />
          </Row>
          {course.description ? <Txt variant="body" color={theme.textSecondary} style={{ marginTop: 10 }}>{course.description}</Txt> : null}
        </Card>

        <Row gap={9}>
          <Metric value={String(allowedBatches.length)} label={t('management.groups')} color={theme.brand} />
          <Metric value={String(allCounts)} label={t('management.registrants')} color={theme.success} />
          <Metric value={String(active)} label={t('common.active')} color={theme.warn} />
          <Metric value={String(completed)} label={t('management.completed')} color={theme.teal} />
        </Row>

        {allowedBatches.length === 0 ? (
          <Empty emoji="📭" title={t('management.noGroups')} />
        ) : (
          <>
            <Txt variant="caption" color={theme.textSecondary}>{t('management.pickGroup')}</Txt>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {allowedBatches.map((item, index) => {
                const meta = statusMeta(item.status, item.id);
                return (
                  <Chip
                    key={item.id}
                    label={`${index + 1} · ${meta.label} · ${formatDate(item.startDate, lang)}`}
                    active={item.id === batch?.id}
                    onPress={() => setBatchId(item.id)}
                    icon={isBatchComplete(db, item.id) ? 'checkmark-circle' : 'people'}
                  />
                );
              })}
            </ScrollView>

            <Segmented
              value={tab}
              onChange={(value) => setTab(value as typeof tab)}
              options={[
                { value: 'overview', label: t('management.details'), icon: 'information-circle' },
                { value: 'students', label: `${t('management.registrants')} (${counts.taken})`, icon: 'people' },
                { value: 'sessions', label: `${t('common.sessions')} (${sessions.length})`, icon: 'calendar' },
              ]}
            />

            {batch && tab === 'overview' ? (
              <View style={{ gap: 10 }}>
                <Card>
                  <Row center gap={10}>
                    {instructor ? <Avatar name={instructor.fullName} color={instructor.avatarColor} size={44} /> : null}
                    <View style={{ flex: 1 }}>
                      <Txt variant="micro" color={theme.textMuted}>{t('management.instructor')}</Txt>
                      <Txt variant="bodyMed">{instructor?.fullName ?? t('management.unassigned')}</Txt>
                    </View>
                    <Tag label={statusMeta(batch.status, batch.id).label} color={statusMeta(batch.status, batch.id).color} bg={statusMeta(batch.status, batch.id).color + '1F'} />
                  </Row>
                  <Spacer size={10} />
                  <Info icon="business" label={t('common.branch')} value={branch?.name ?? '—'} />
                  <Info icon="location" label={t('common.room')} value={batch.room || '—'} />
                  <Info icon="calendar" label={t('management.startDate')} value={formatDate(batch.startDate, lang)} />
                  <Info icon="time" label={t('common.schedule')} value={`${batch.schedule.days.map((day) => t(`dayShort.${day}` as any)).join(' + ')} · ${batch.schedule.time} · ${batch.schedule.durationMin} ${t('common.minutes')}`} />
                  <Info icon="key" label={t('management.joinCode')} value={batch.joinCode || '—'} />
                </Card>
                <Card>
                  <Row between>
                    <Txt variant="bodyMed">{t('batchAdm.occupancy')}</Txt>
                    <Txt variant="caption" color={theme.textSecondary}>{counts.taken}/{batch.capacity} · {t('management.waitlist')} {counts.waitlist}</Txt>
                  </Row>
                  <Spacer size={7} />
                  <ProgressBar progress={counts.taken / Math.max(batch.capacity, 1)} color={counts.taken >= batch.capacity ? theme.danger : theme.success} />
                </Card>
                {course.topics.length > 0 ? (
                  <Card>
                    <Txt variant="h3">{t('management.topics')}</Txt>
                    <Spacer size={8} />
                    {course.topics.map((topic, index) => (
                      <Row key={`${topic}-${index}`} center gap={8} style={{ marginBottom: 7 }}>
                        <Tag label={String(index + 1)} color={course.color} bg={course.color + '1F'} />
                        <Txt variant="caption" style={{ flex: 1 }}>{topic}</Txt>
                      </Row>
                    ))}
                  </Card>
                ) : null}
              </View>
            ) : null}

            {batch && tab === 'students' ? (
              students.length === 0 ? (
                <Empty emoji="👥" title={counts.taken === 0 ? t('management.noStudents') : t('management.studentLoadFailed')} />
              ) : students.map((student, index) => {
                const stat = attendancePct(db, student.id, batch.id);
                return (
                  <FadeIn key={student.id} index={Math.min(index, 8)}>
                    <Card onPress={() => navigation.navigate('StudentRecord', { userId: student.id, batchId: batch.id })}>
                      <Row center gap={10}>
                        <Avatar name={student.fullName} color={student.avatarColor} size={42} />
                        <View style={{ flex: 1 }}>
                          <Txt variant="bodyMed">{student.fullName}</Txt>
                          <Txt variant="micro" color={theme.textMuted}>{student.phone || student.email || t('management.noContact')}</Txt>
                        </View>
                        <Tag label={`${stat.pct}% ${t('management.attendance')}`} color={stat.pct >= 75 ? theme.success : theme.warn} bg={stat.pct >= 75 ? theme.successSoft : theme.warnSoft} />
                      </Row>
                    </Card>
                  </FadeIn>
                );
              })
            ) : null}

            {batch && tab === 'sessions' ? (
              sessions.length === 0 ? <Empty emoji="🗓️" title={t('management.noSessions')} /> : sessions.map((session) => {
                const attendance = db.attendance.filter((item) => item.sessionId === session.id);
                const honored = attendance.filter((item) => item.status !== 'absent').length;
                return (
                  <Card key={session.id}>
                    <Row center gap={10}>
                      <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: course.color + '1F', alignItems: 'center', justifyContent: 'center' }}>
                        <Txt variant="bodyMed" color={course.color}>{session.seq}</Txt>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Txt variant="bodyMed">{session.title}</Txt>
                        <Txt variant="micro" color={theme.textMuted}>{formatDate(session.startsAt, lang)} · {formatTime(session.startsAt, lang)}</Txt>
                      </View>
                      <Tag label={session.status === 'closed' ? `${t('management.closed')} · ${honored}/${counts.taken}` : session.status === 'live' ? t('management.live') : t('common.scheduledStatus')} color={session.status === 'closed' ? theme.textMuted : session.status === 'live' ? theme.success : theme.warn} bg={theme.bg} />
                    </Row>
                  </Card>
                );
              })
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Metric({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <Card style={{ flex: 1, padding: 10, alignItems: 'center' }}>
      <Txt variant="h2" color={color}>{value}</Txt>
      <Txt variant="micro" align="center">{label}</Txt>
    </Card>
  );
}

function Info({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  const { theme } = useTheme();
  return (
    <Row center gap={8} style={{ marginTop: 8 }}>
      <Ionicons name={icon} size={15} color={theme.brand} />
      <Txt variant="micro" color={theme.textMuted}>{label}</Txt>
      <Txt variant="caption" style={{ flex: 1 }}>{value}</Txt>
    </Row>
  );
}
