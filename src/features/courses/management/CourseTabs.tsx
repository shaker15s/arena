import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../design/theme';
import { useI18n } from '../../../i18n';
import {
  Avatar, Btn, Card, Empty, FadeIn, ProgressBar, Row, Spacer, Stars, Tag, Txt,
} from '../../../design/components';
import { formatDate, formatTime } from '../../../shared/format';
import { attendancePct, isBatchComplete, profileOf } from '../../../data/engine';
import { Metric, Info } from './CourseManagementSheets';
import type { Batch, Course, CourseRole, Db, Profile, TrainingSession } from '../../../data/types';
import type { DetailedCourseAnalytics } from '../../../data/actions';

export function CourseOverviewTab({
  db,
  batch,
  course,
  sessions,
  counts,
  instructor,
  branch,
  isCourseManager,
  statusMeta,
  onShowQr,
  onShareLink,
  onBroadcast,
  onCancelBatch,
}: {
  db: Db;
  batch: Batch;
  course: Course;
  sessions: TrainingSession[];
  counts: { taken: number; waitlist: number };
  instructor?: Profile;
  branch?: { id: string; name: string };
  isCourseManager: boolean;
  statusMeta: (status: string, candidateBatchId?: string) => { label: string; color: string };
  onShowQr: () => void;
  onShareLink: () => void;
  onBroadcast: () => void;
  onCancelBatch: () => void;
}) {
  const { theme } = useTheme();
  const { t, lang } = useI18n();

  return (
    <View style={{ gap: 10 }}>
      <Card color={theme.brandSoft} style={{ borderColor: theme.brand + '33' }}>
        <Row center between>
          <View>
            <Txt variant="caption" color={theme.textSecondary}>{t('management.sessionProgress')}</Txt>
            <Txt variant="h2" color={theme.brand}>
              {t('management.sessionCount', { x: sessions.filter((s) => s.status === 'closed').length, y: sessions.length })}
            </Txt>
          </View>
          <Tag
            label={isBatchComplete(db, batch.id) ? t('management.completeCycle') : batch.status === 'active' ? t('management.inTraining') : batch.status === 'cancelled' ? t('common.cancelled') : t('common.scheduledStatus')}
            color={isBatchComplete(db, batch.id) ? theme.brand : batch.status === 'cancelled' ? theme.danger : theme.success}
            bg="#fff"
          />
        </Row>
        <Spacer size={8} />
        <ProgressBar
          progress={sessions.length > 0 ? sessions.filter((s) => s.status === 'closed').length / sessions.length : 0}
          color={theme.brand}
          height={8}
        />
      </Card>

      <Card>
        <Row center gap={10}>
          {instructor ? <Avatar name={instructor.fullName} color={instructor.avatarColor} size={44} /> : null}
          <View style={{ flex: 1 }}>
            <Txt variant="micro" color={theme.textMuted}>{t('management.instructor')}</Txt>
            <Txt variant="bodyMed">{instructor?.fullName ?? t('management.unassigned')}</Txt>
            {instructor?.phone || instructor?.email ? (
              <Txt variant="micro" color={theme.textMuted}>{instructor.phone} {instructor.email ? `· ${instructor.email}` : ''}</Txt>
            ) : null}
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

      {/* كود ورابط الانضمام */}
      <Card color={theme.brandSoft} style={{ borderColor: theme.brand + '44' }}>
        <Row center between>
          <Row center gap={8}>
            <Ionicons name="qr-code" size={20} color={theme.brand} />
            <Txt variant="bodyMed" color={theme.brand}>{t('joinCode.title')}</Txt>
          </Row>
          <Tag label={batch.joinCode} color={theme.brand} bg="#fff" />
        </Row>
        <Spacer size={10} />
        <Row gap={8}>
          <View style={{ flex: 1 }}>
            <Btn title={t('management.showQr')} size="sm" variant="primary" icon="qr-code" onPress={onShowQr} full />
          </View>
          <View style={{ flex: 1 }}>
            <Btn title={t('management.shareLink')} size="sm" variant="secondary" icon="copy" onPress={onShareLink} full />
          </View>
        </Row>
        <Spacer size={8} />
        <Btn
          title={t('management.broadcastStudents')}
          size="sm"
          variant="ghost"
          icon="megaphone"
          onPress={onBroadcast}
          full
        />
        {isCourseManager && batch.status !== 'cancelled' && (
          <Btn
            title={t('management.cancelThisBatch')}
            size="sm"
            variant="danger"
            icon="close-circle"
            style={{ marginTop: 6 }}
            onPress={onCancelBatch}
            full
          />
        )}
      </Card>

      {/* نسبة الإشغال والمقاعد */}
      <Card>
        <Row between>
          <Txt variant="bodyMed">{t('batchAdm.occupancy')}</Txt>
          <Txt variant="caption" color={theme.textSecondary}>{counts.taken}/{batch.capacity} · {t('management.waitlist')} {counts.waitlist}</Txt>
        </Row>
        <Spacer size={7} />
        <ProgressBar progress={counts.taken / Math.max(batch.capacity, 1)} color={counts.taken >= batch.capacity ? theme.danger : theme.success} />
      </Card>

      {/* المحاور */}
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
  );
}

export function CourseSessionsTab({
  db,
  course,
  sessions,
  counts,
  isCourseManager,
  startingSessionId,
  onSelectSession,
  onStartLive,
  onRescheduleSession,
  onCancelSession,
}: {
  db: Db;
  course: Course;
  sessions: TrainingSession[];
  counts: { taken: number; waitlist: number };
  isCourseManager: boolean;
  startingSessionId: string | null;
  onSelectSession: (session: TrainingSession) => void;
  onStartLive: (session: TrainingSession) => void;
  onRescheduleSession: (session: TrainingSession) => void;
  onCancelSession: (session: TrainingSession) => void;
}) {
  const { theme } = useTheme();
  const { t, lang } = useI18n();

  if (sessions.length === 0) {
    return <Empty emoji="🗓️" title={t('management.noSessions')} />;
  }

  return (
    <>
      {sessions.map((session) => {
        const attendance = db.attendance.filter((item) => item.sessionId === session.id);
        const honored = attendance.filter((item) => item.status !== 'absent').length;
        return (
          <Card key={session.id} onPress={() => onSelectSession(session)}>
            <Row center gap={10}>
              <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: course.color + '1F', alignItems: 'center', justifyContent: 'center' }}>
                <Txt variant="bodyMed" color={course.color}>{session.seq}</Txt>
              </View>
              <View style={{ flex: 1 }}>
                <Txt variant="bodyMed">{session.title}</Txt>
                <Txt variant="micro" color={theme.textMuted}>{formatDate(session.startsAt, lang)} · {formatTime(session.startsAt, lang)}</Txt>
              </View>
              <Tag
                label={session.status === 'closed' ? `${t('management.closed')} · ${honored}/${counts.taken}` : session.status === 'live' ? t('management.live') : session.status === 'cancelled' ? t('common.cancelled') : t('common.scheduledStatus')}
                color={session.status === 'closed' ? theme.textMuted : session.status === 'live' ? theme.success : session.status === 'cancelled' ? theme.danger : theme.warn}
                bg={session.status === 'live' ? theme.successSoft : theme.bg}
                icon={session.status === 'closed' ? 'checkmark-circle' : session.status === 'live' ? 'radio' : session.status === 'cancelled' ? 'close-circle' : 'time'}
              />
            </Row>
            {session.status === 'scheduled' ? (
              <Row gap={8} style={{ marginTop: 10 }}>
                <View style={{ flex: 2 }}>
                  <Btn
                    title={t('management.startLive')}
                    size="sm"
                    variant="primary"
                    icon="play"
                    loading={startingSessionId === session.id}
                    onPress={() => onStartLive(session)}
                    full
                  />
                </View>
                {isCourseManager && (
                  <>
                    <View style={{ flex: 1 }}>
                      <Btn
                        title={t('management.reschedule')}
                        size="sm"
                        variant="secondary"
                        icon="calendar"
                        onPress={() => onRescheduleSession(session)}
                        full
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Btn
                        title={t('common.cancel')}
                        size="sm"
                        variant="danger"
                        icon="close"
                        onPress={() => onCancelSession(session)}
                        full
                      />
                    </View>
                  </>
                )}
              </Row>
            ) : null}
          </Card>
        );
      })}
    </>
  );
}

export function CourseStudentsTab({
  db,
  batchId,
  students,
  countsTaken,
  onStudentPress,
}: {
  db: Db;
  batchId: string;
  students: Profile[];
  countsTaken: number;
  onStudentPress: (userId: string, batchId: string) => void;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();

  if (students.length === 0) {
    return <Empty emoji="👥" title={countsTaken === 0 ? t('management.noStudents') : t('management.studentLoadFailed')} />;
  }

  return (
    <>
      {students.map((student, index) => {
        const stat = attendancePct(db, student.id, batchId);
        return (
          <FadeIn key={student.id} index={Math.min(index, 8)}>
            <Card onPress={() => onStudentPress(student.id, batchId)}>
              <Row center gap={10}>
                <Avatar name={student.fullName} color={student.avatarColor} size={42} />
                <View style={{ flex: 1 }}>
                  <Txt variant="bodyMed">{student.fullName}</Txt>
                  <Txt variant="micro" color={theme.textMuted}>
                    {student.phone || t('common.noPhone')} {student.email ? `· ${student.email}` : ''}
                  </Txt>
                </View>
                <Tag label={`${stat.pct}% ${t('management.attendance')}`} color={stat.pct >= 75 ? theme.success : theme.warn} bg={stat.pct >= 75 ? theme.successSoft : theme.warnSoft} />
              </Row>
            </Card>
          </FadeIn>
        );
      })}
    </>
  );
}

export function CourseStaffTab({
  db,
  owner,
  rolesList,
  isCourseManager,
  onAssignStaff,
  onRevokeRole,
}: {
  db: Db;
  owner?: Profile;
  rolesList: CourseRole[];
  isCourseManager: boolean;
  onAssignStaff: () => void;
  onRevokeRole: (cr: CourseRole) => void;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();

  return (
    <View style={{ gap: 10 }}>
      {isCourseManager && (
        <Btn
          title={t('management.assignStaff')}
          variant="primary"
          icon="person-add"
          onPress={onAssignStaff}
        />
      )}
      {owner ? (
        <Card>
          <Row center gap={10}>
            <Avatar name={owner.fullName} color={owner.avatarColor} size={42} />
            <View style={{ flex: 1 }}>
              <Txt variant="bodyMed">{owner.fullName}</Txt>
              <Txt variant="micro" color={theme.textMuted}>{owner.phone} {owner.email ? `· ${owner.email}` : ''}</Txt>
            </View>
            <Tag label={t('management.owner')} color={theme.certGold} bg={theme.certGold + '1F'} icon="star" />
          </Row>
        </Card>
      ) : null}
      {rolesList.length === 0 ? (
        <Empty emoji="🛡️" title={t('management.noStaff')} body={t('management.noStaffBody')} />
      ) : (
        rolesList.map((cr) => {
          const prof = profileOf(db, cr.userId);
          return (
            <Card key={cr.id}>
              <Row center gap={10}>
                <Avatar name={prof?.fullName ?? t('management.member')} color={prof?.avatarColor ?? theme.brand} size={42} />
                <View style={{ flex: 1 }}>
                  <Txt variant="bodyMed">{prof?.fullName ?? t('management.delegated')}</Txt>
                  <Txt variant="micro" color={theme.textMuted}>{prof?.phone} {prof?.email ? `· ${prof.email}` : ''}</Txt>
                </View>
                <Tag
                  label={cr.role === 'organizer' ? t('management.roleOrganizer') : cr.role === 'coordinator' ? t('management.roleCoordinator') : t('management.roleDelegate')}
                  color={theme.brand}
                  bg={theme.brandSoft}
                />
                {isCourseManager && (
                  <Btn
                    title=""
                    size="sm"
                    variant="danger"
                    icon="trash"
                    onPress={() => onRevokeRole(cr)}
                  />
                )}
              </Row>
            </Card>
          );
        })
      )}
    </View>
  );
}

export function CourseAnalyticsTab({
  analytics,
  loadingAnalytics,
}: {
  analytics: DetailedCourseAnalytics | null;
  loadingAnalytics: boolean;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();

  return (
    <View style={{ gap: 12 }}>
      {loadingAnalytics ? (
        <Card style={{ padding: 20, alignItems: 'center' }}>
          <Txt variant="caption" color={theme.textMuted}>{t('management.analyticsLoading')}</Txt>
        </Card>
      ) : analytics ? (
        <>
          <Card glass>
            <Txt variant="h3">{t('management.funnelTitle')}</Txt>
            <Spacer size={12} />
            <Row gap={8}>
              <Metric value={String(analytics.funnel.totalEnrollments)} label={t('management.totalEnrolled')} color={theme.brand} />
              <Metric value={String(analytics.funnel.activeStudents)} label={t('management.activeStudents')} color={theme.success} />
              <Metric value={String(analytics.funnel.certifiedStudents)} label={t('management.certified')} color={theme.teal} />
            </Row>
            <Spacer size={10} />
            <Row gap={8}>
              <Metric value={`${analytics.funnel.avgAttendancePct}%`} label={t('management.avgAttendance')} color={theme.success} />
              <Metric value={String(analytics.funnel.avgRating)} label={t('management.avgRating')} color={theme.certGold} />
              <Metric value={String(analytics.funnel.ratedCount)} label={t('management.raterCount')} color={theme.brand} />
            </Row>
          </Card>

          <Card>
            <Txt variant="h3">{t('management.batchStats')}</Txt>
            <Spacer size={8} />
            <Info icon="layers" label={t('management.totalBatches')} value={String(analytics.totalBatches)} />
            <Info icon="play-circle" label={t('management.activeBatches')} value={String(analytics.activeBatches)} />
            <Info icon="checkmark-done" label={t('management.completedBatches')} value={String(analytics.completedBatches)} />
          </Card>
        </>
      ) : null}
    </View>
  );
}

export function CourseReviewsTab({
  db,
  courseId,
}: {
  db: Db;
  courseId: string;
}) {
  const { theme } = useTheme();
  const { t, lang } = useI18n();

  const reviews = db.ratings.filter((r) => r.courseId === courseId).sort((a, b) => b.createdAt - a.createdAt);
  const avgStars = reviews.length > 0 ? (reviews.reduce((s, r) => s + r.stars, 0) / reviews.length).toFixed(1) : null;

  if (reviews.length === 0) {
    return <Empty emoji="⭐" title={t('management.noReviews')} body={t('management.noReviewsBody')} />;
  }

  return (
    <View style={{ gap: 10 }}>
      <Card glass>
        <Row center between>
          <View>
            <Txt variant="caption" color={theme.textSecondary}>{t('management.avgStudentRating')}</Txt>
            <Row center gap={6}>
              <Txt variant="h1" color={theme.certGold}>{avgStars}</Txt>
              <Stars value={parseFloat(avgStars || '5')} size={20} />
            </Row>
          </View>
          <Tag label={t('management.reviewCount', { x: reviews.length })} color={theme.brand} bg={theme.brandSoft} />
        </Row>
      </Card>
      {reviews.map((rev) => {
        const reviewer = profileOf(db, rev.userId);
        return (
          <Card key={`${rev.userId}-${rev.createdAt}`}>
            <Row center between style={{ marginBottom: 6 }}>
              <Row center gap={8}>
                <Avatar name={reviewer?.fullName ?? t('management.studentFallback')} color={reviewer?.avatarColor ?? theme.brand} size={32} />
                <View>
                  <Txt variant="bodyMed">{reviewer?.fullName ?? t('management.studentFallback')}</Txt>
                  <Txt variant="micro" color={theme.textMuted}>{formatDate(rev.createdAt, lang)}</Txt>
                </View>
              </Row>
              <Stars value={rev.stars} size={15} />
            </Row>
            {rev.comment ? (
              <Txt variant="body" color={theme.textSecondary} style={{ marginTop: 4 }}>
                "{rev.comment}"
              </Txt>
            ) : null}
          </Card>
        );
      })}
    </View>
  );
}
