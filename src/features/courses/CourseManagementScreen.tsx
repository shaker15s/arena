import React, { useEffect, useMemo, useState } from 'react';
import { Platform, RefreshControl, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import { useApp } from '../../data/store';
import {
  attendancePct, batchStudents, canManageCourse, courseOf, courseOrganizers,
  isBatchComplete, profileOf, seatCounts, sessionsOfBatch,
} from '../../data/engine';
import {
  assignCourseRole, cancelBatch, cancelTrainingSession, getBatchRoster, getCourseOverview,
  getDetailedCourseAnalytics, getSessionRoster,
  notifySessionAbsentees, rescheduleTrainingSession, revokeCourseRole, sendBroadcast,
  startTrainingSession, updateCourse, type DetailedCourseAnalytics,
} from '../../data/actions';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import {
  Avatar, Btn, Card, Chip, Empty, FadeIn, Header, Input, ProgressBar, Row,
  Segmented, Sheet, Spacer, Stars, Tag, Txt,
} from '../../design/components';
import { spacing } from '../../design/tokens';
import { formatDate, formatTime } from '../../shared/format';
import { publicJoinUrl } from '../../shared/links';
import type { CourseRoleType, TrainingSession } from '../../data/types';
import { BatchFormSheet } from '../org/AdminScreens';

export function CourseManagementScreen({ route, navigation }: any) {
  const { db, user, refresh, syncing, toast } = useApp();
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
      .filter((batch) => user.role === 'admin' || user.role === 'supervisor' || canManageCourse(db, courseId, user.id) || batch.instructorId === user.id)
      .sort((a, b) => b.startDate - a.startDate);
  }, [courseId, db.batches, db.courseRoles, user]);

  const [batchId, setBatchId] = useState<string>(requestedBatchId ?? allowedBatches[0]?.id ?? '');
  const [tab, setTab] = useState<'overview' | 'sessions' | 'students' | 'staff' | 'analytics' | 'reviews'>('overview');
  const [selectedSession, setSelectedSession] = useState<TrainingSession | null>(null);
  const [rescheduleSession, setRescheduleSession] = useState<TrainingSession | null>(null);
  const [cancelSessionTarget, setCancelSessionTarget] = useState<TrainingSession | null>(null);
  const [cancelBatchTarget, setCancelBatchTarget] = useState<string | null>(null);
  const [assignRoleOpen, setAssignRoleOpen] = useState(false);
  const [joinQrOpen, setJoinQrOpen] = useState(false);
  const [editCourseOpen, setEditCourseOpen] = useState(false);
  const [newBatchOpen, setNewBatchOpen] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastBody, setBroadcastBody] = useState('');
  const [sendingBroadcast, setSendingBroadcast] = useState(false);
  const [startingSessionId, setStartingSessionId] = useState<string | null>(null);
  const [notifying, setNotifying] = useState(false);
  const [analytics, setAnalytics] = useState<DetailedCourseAnalytics | null>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);

  useEffect(() => {
    if (courseId && tab === 'analytics') {
      setLoadingAnalytics(true);
      void getDetailedCourseAnalytics(courseId)
        .then((res) => { setAnalytics(res); })
        .catch(() => {})
        .finally(() => setLoadingAnalytics(false));
    }
  }, [courseId, tab]);

  useEffect(() => {
    if (!courseId) return;
    void getCourseOverview(courseId).catch(() => {});
  }, [courseId]);

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
  const joinUrl = batch ? publicJoinUrl(batch.joinCode) : '';
  const owner = course.ownerId ? profileOf(db, course.ownerId) : undefined;
  const organizers = courseOrganizers(db, course.id);
  const rolesList = db.courseRoles?.filter((r) => r.courseId === course.id) ?? [];

  const isCourseManager = user.role === 'admin' || user.role === 'supervisor' || canManageCourse(db, course.id, user.id);

  const copyJoinLink = async () => {
    if (!batch) return;
    try {
      if (Platform.OS === 'web' && navigator.clipboard) {
        await navigator.clipboard.writeText(joinUrl);
      } else {
        await Clipboard.setStringAsync(joinUrl);
      }
      toast(t('management.linkCopied'), 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const handleStartLive = async (sess?: TrainingSession) => {
    if (!batch) return;
    setStartingSessionId(sess?.id ?? 'batch');
    try {
      await startTrainingSession(batch.id);
      await refresh();
      toast(t('management.sessionStarted'), 'success');
      navigation.navigate('Tabs', { tab: 'live' });
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setStartingSessionId(null);
    }
  };

  const statusMeta = (status: string, candidateBatchId?: string) => status === 'active'
    ? { label: t('common.active'), color: theme.success }
    : status === 'completed' && candidateBatchId && isBatchComplete(db, candidateBatchId)
      ? { label: t('common.closedStatus'), color: theme.brand }
      : status === 'completed' ? { label: t('management.incompleteData'), color: theme.danger }
      : status === 'cancelled' ? { label: t('common.cancelled'), color: theme.danger }
      : status === 'scheduled' ? { label: t('common.scheduledStatus'), color: theme.warn }
      : { label: t('common.archived'), color: theme.textMuted };

  const handleNotifyAbsentees = async (sessionId: string) => {
    setNotifying(true);
    try {
      const res = await notifySessionAbsentees(sessionId);
      toast(t('sess.absenteesNotified', { x: res.notified }), 'success');
      await refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setNotifying(false);
    }
  };

  const handleSendBroadcast = async () => {
    if (!batch || !broadcastTitle.trim() || !broadcastBody.trim()) return;
    setSendingBroadcast(true);
    try {
      const count = await sendBroadcast({
        scope: 'batch',
        scopeId: batch.id,
        title: broadcastTitle.trim(),
        body: broadcastBody.trim(),
      });
      toast(t('management.broadcastSent', { x: count }), 'success');
      setBroadcastTitle('');
      setBroadcastBody('');
      setBroadcastOpen(false);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSendingBroadcast(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Header
        title={course.title}
        subtitle={t('management.opsSubtitle')}
        back={() => navigation.goBack()}
        right={
          <Row gap={6}>
            {isCourseManager ? (
              <Btn
                title={t('management.editCurriculum')}
                size="sm"
                variant="secondary"
                icon="create-outline"
                onPress={() => setEditCourseOpen(true)}
              />
            ) : null}
            {isCourseManager ? (
              <Btn
                title={t('batchAdm.new')}
                size="sm"
                icon="add"
                onPress={() => setNewBatchOpen(true)}
              />
            ) : null}
          </Row>
        }
      />
      <ScrollView
        contentContainerStyle={{ padding: spacing.s5, gap: 14, paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={syncing} onRefresh={() => { void refresh(); }} tintColor={theme.brand} />}
      >
        {/* بطاقة ملخص الكورس والمالك */}
        <Card color={course.color + '14'} style={{ borderColor: course.color + '44' }}>
          <Row center gap={12}>
            <View style={{ width: 54, height: 54, borderRadius: 17, backgroundColor: course.color, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="book" size={25} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Txt variant="h2">{course.title}</Txt>
              <Txt variant="caption" color={theme.textSecondary}>
                {course.field} · {t('explore.sessionsCount', { x: course.sessionsCount })}
                {owner ? ` · ${t('management.ownerName', { name: owner.fullName })}` : ''}
              </Txt>
            </View>
            <Tag label={course.status === 'published' ? t('common.published') : course.status === 'running' ? t('management.running') : course.status} color={course.color} bg={course.color + '1F'} />
          </Row>
          {course.description ? <Txt variant="body" color={theme.textSecondary} style={{ marginTop: 10 }}>{course.description}</Txt> : null}
          <Spacer size={10} />
          <Row gap={8}>
            {isCourseManager ? (
              <View style={{ flex: 1 }}>
                <Btn
                  title={t('management.editTopics')}
                  variant="ghost"
                  size="sm"
                  icon="create"
                  onPress={() => setEditCourseOpen(true)}
                  full
                />
              </View>
            ) : null}
            {batch && batch.status !== 'cancelled' && (
              <View style={{ flex: 1 }}>
                <Btn
                  title={t('management.startLive')}
                  variant="primary"
                  size="sm"
                  icon="play"
                  loading={Boolean(startingSessionId)}
                  onPress={() => handleStartLive()}
                  full
                />
              </View>
            )}
          </Row>
        </Card>

        {/* مؤشرات الأداء السريعة */}
        <Row gap={8}>
          <Metric value={String(allowedBatches.length)} label={t('management.groups')} color={theme.brand} />
          <Metric value={String(allCounts)} label={t('management.registrants')} color={theme.success} />
          <Metric value={String(active)} label={t('common.active')} color={theme.warn} />
          <Metric value={String(completed)} label={t('management.completed')} color={theme.teal} />
        </Row>

        {allowedBatches.length === 0 ? (
          <Card style={{ paddingVertical: 24 }}>
            <Empty
              emoji="🎓"
              title={t('management.noGroupsYet')}
              body={t('management.noGroupsYetBody')}
              cta={t('management.noGroupsCta')}
              onCta={() => setNewBatchOpen(true)}
            />
          </Card>
        ) : (
          <>
            {/* اختيار الدفعة */}
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

            {/* التبويبات الموحدة */}
            <Segmented
              value={tab}
              onChange={(value) => setTab(value as typeof tab)}
              options={[
                { value: 'overview', label: t('management.tabOverview'), icon: 'information-circle' },
                { value: 'sessions', label: t('management.tabSessions', { x: sessions.length }), icon: 'calendar' },
                { value: 'students', label: t('management.tabStudents', { x: counts.taken }), icon: 'people' },
                { value: 'staff', label: t('management.tabStaff', { x: rolesList.length + (owner ? 1 : 0) }), icon: 'shield' },
                { value: 'analytics', label: t('management.tabAnalytics'), icon: 'analytics' },
                { value: 'reviews', label: t('management.tabReviews', { x: db.ratings.filter((r) => r.courseId === course.id).length }), icon: 'star' },
              ]}
            />

            {/* 1) تبويب النظرة العامة */}
            {batch && tab === 'overview' ? (
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
                      <Btn title={t('management.showQr')} size="sm" variant="primary" icon="qr-code" onPress={() => setJoinQrOpen(true)} full />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Btn title={t('management.shareLink')} size="sm" variant="secondary" icon="copy" onPress={copyJoinLink} full />
                    </View>
                  </Row>
                  <Spacer size={8} />
                  <Btn
                    title={t('management.broadcastStudents')}
                    size="sm"
                    variant="ghost"
                    icon="megaphone"
                    onPress={() => setBroadcastOpen(true)}
                    full
                  />
                  {isCourseManager && batch.status !== 'cancelled' && (
                    <Btn
                      title={t('management.cancelThisBatch')}
                      size="sm"
                      variant="danger"
                      icon="close-circle"
                      style={{ marginTop: 6 }}
                      onPress={() => setCancelBatchTarget(batch.id)}
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
            ) : null}

            {/* 2) تبويب المحاضرات الميدانية */}
            {batch && tab === 'sessions' ? (
              sessions.length === 0 ? <Empty emoji="🗓️" title={t('management.noSessions')} /> : sessions.map((session) => {
                const attendance = db.attendance.filter((item) => item.sessionId === session.id);
                const honored = attendance.filter((item) => item.status !== 'absent').length;
                return (
                  <Card key={session.id} onPress={() => setSelectedSession(session)}>
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
                            onPress={() => handleStartLive(session)}
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
                                onPress={() => setRescheduleSession(session)}
                                full
                              />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Btn
                                title={t('common.cancel')}
                                size="sm"
                                variant="danger"
                                icon="close"
                                onPress={() => setCancelSessionTarget(session)}
                                full
                              />
                            </View>
                          </>
                        )}
                      </Row>
                    ) : null}
                  </Card>
                );
              })
            ) : null}

            {/* 3) تبويب الطلاب */}
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
                          <Txt variant="micro" color={theme.textMuted}>
                            {student.phone || t('common.noPhone')} {student.email ? `· ${student.email}` : ''}
                          </Txt>
                        </View>
                        <Tag label={`${stat.pct}% ${t('management.attendance')}`} color={stat.pct >= 75 ? theme.success : theme.warn} bg={stat.pct >= 75 ? theme.successSoft : theme.warnSoft} />
                      </Row>
                    </Card>
                  </FadeIn>
                );
              })
            ) : null}

            {/* 4) تبويب فريق العمل والمنظمين */}
            {tab === 'staff' ? (
              <View style={{ gap: 10 }}>
                {isCourseManager && (
                  <Btn
                    title={t('management.assignStaff')}
                    variant="primary"
                    icon="person-add"
                    onPress={() => setAssignRoleOpen(true)}
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
                              onPress={async () => {
                                try {
                                  await revokeCourseRole({ courseId: course.id, userId: cr.userId, role: cr.role });
                                  await refresh();
                                  toast(t('management.revokeOk'), 'success');
                                } catch (e) {
                                  toast((e as Error).message, 'error');
                                }
                              }}
                            />
                          )}
                        </Row>
                      </Card>
                    );
                  })
                )}
              </View>
            ) : null}

            {/* 5) تبويب التحليلات ومسار التحويل (Analytics Funnel) */}
            {tab === 'analytics' ? (
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
            ) : null}

            {/* 6) تبويب التقييمات */}
            {tab === 'reviews' ? (
              (() => {
                const reviews = db.ratings.filter((r) => r.courseId === course.id).sort((a, b) => b.createdAt - a.createdAt);
                const avgStars = reviews.length > 0 ? (reviews.reduce((s, r) => s + r.stars, 0) / reviews.length).toFixed(1) : null;
                return reviews.length === 0 ? (
                  <Empty emoji="⭐" title={t('management.noReviews')} body={t('management.noReviewsBody')} />
                ) : (
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
              })()
            ) : null}
          </>
        )}
      </ScrollView>

      {/* نافذة QR الانضمام للمجموعة */}
      {batch ? (
        <Sheet visible={joinQrOpen} onClose={() => setJoinQrOpen(false)} title={`${t('joinCode.title')} — ${batch.joinCode}`}>
          <View style={{ alignItems: 'center', gap: 14, paddingVertical: 10 }}>
            <View style={{ backgroundColor: '#fff', padding: 16, borderRadius: 20, borderWidth: 1, borderColor: theme.line }}>
              <QRCode value={joinUrl} size={180} color="#0A0E1A" backgroundColor="#fff" />
            </View>
            <Txt variant="h2" color={theme.brand}>{batch.joinCode}</Txt>
            <Txt variant="caption" color={theme.textSecondary} align="center">{course.title} · {batch.room}</Txt>
            <Txt variant="micro" color={theme.textMuted} align="center">{joinUrl}</Txt>
            <Spacer size={6} />
            <Btn title={t('management.shareLink')} icon="copy" full onPress={copyJoinLink} />
          </View>
        </Sheet>
      ) : null}

      {/* نافذة تفاصيل الجلسة وسجل الحضور الكامل */}
      {selectedSession && batch ? (
        <SessionDetailSheet
          session={selectedSession}
          batchId={batch.id}
          onClose={() => setSelectedSession(null)}
          onNotifyAbsentees={() => handleNotifyAbsentees(selectedSession.id)}
          onStartLive={() => handleStartLive(selectedSession)}
          notifying={notifying}
        />
      ) : null}

      {/* تعديل المنهج */}
      <EditCourseSheet
        visible={editCourseOpen}
        course={course}
        onClose={() => setEditCourseOpen(false)}
      />

      {/* إنشاء دفعة جديدة */}
      <BatchFormSheet
        visible={newBatchOpen}
        initialCourseId={course.id}
        onClose={() => setNewBatchOpen(false)}
      />

      {/* نافذة تعديل موعد المحاضرة */}
      {rescheduleSession && (
        <RescheduleSessionSheet
          visible={Boolean(rescheduleSession)}
          session={rescheduleSession}
          onClose={() => setRescheduleSession(null)}
        />
      )}

      {/* نافذة إلغاء المحاضرة */}
      {cancelSessionTarget && (
        <CancelSessionSheet
          visible={Boolean(cancelSessionTarget)}
          session={cancelSessionTarget}
          onClose={() => setCancelSessionTarget(null)}
        />
      )}

      {/* نافذة إلغاء الدفعة */}
      {cancelBatchTarget && (
        <CancelBatchSheet
          visible={Boolean(cancelBatchTarget)}
          batchId={cancelBatchTarget}
          onClose={() => setCancelBatchTarget(null)}
        />
      )}

      {/* نافذة تعيين منظم جديد */}
      <AssignCourseRoleSheet
        visible={assignRoleOpen}
        courseId={course.id}
        onClose={() => setAssignRoleOpen(false)}
      />

      {/* إرسال إشعار للمجموعة */}
      {batch ? (
        <Sheet visible={broadcastOpen} onClose={() => setBroadcastOpen(false)} title={t('management.broadcastStudents')}>
          <ScrollView contentContainerStyle={{ paddingBottom: 30, gap: 12 }}>
            <Card glass>
              <Row center gap={8}>
                <Ionicons name="people" size={18} color={theme.brand} />
                <Txt variant="bodyMed" color={theme.brand}>
                  {t('management.broadcastReach', { x: students.length })}
                </Txt>
              </Row>
            </Card>
            <Input
              label={t('management.alertTitle')}
              value={broadcastTitle}
              onChange={setBroadcastTitle}
              placeholder={t('management.alertPlaceholder')}
              icon="notifications"
            />
            <Input
              label={t('broadcast.message')}
              value={broadcastBody}
              onChange={setBroadcastBody}
              placeholder={t('management.messagePlaceholder')}
              multiline
            />
            <Spacer size={8} />
            <Btn
              title={t('management.sendAlert')}
              size="lg"
              variant="primary"
              icon="paper-plane"
              loading={sendingBroadcast}
              disabled={!broadcastTitle.trim() || !broadcastBody.trim()}
              onPress={handleSendBroadcast}
              full
            />
          </ScrollView>
        </Sheet>
      ) : null}
    </View>
  );
}

function RescheduleSessionSheet({
  visible,
  session,
  onClose,
}: {
  visible: boolean;
  session: TrainingSession;
  onClose: () => void;
}) {
  const { refresh, toast } = useApp();
  const { t } = useI18n();
  const [dateStr, setDateStr] = useState(new Date(session.startsAt).toISOString().split('T')[0]);
  const [timeStr, setTimeStr] = useState(formatTime(session.startsAt, 'en') || '18:00');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const parts = timeStr.trim().split(':');
      const targetDate = new Date(dateStr);
      targetDate.setHours(parseInt(parts[0] || '18', 10), parseInt(parts[1] || '0', 10), 0, 0);
      await rescheduleTrainingSession({
        sessionId: session.id,
        startsAt: targetDate.getTime(),
        reason: reason.trim() || undefined,
      });
      await refresh();
      toast(t('management.rescheduleOk'), 'success');
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t('management.rescheduleTitle')}>
      <ScrollView contentContainerStyle={{ paddingBottom: 30, gap: 12 }}>
        <Input label={t('management.newDate')} value={dateStr} onChange={setDateStr} icon="calendar" />
        <Input label={t('management.newTime')} value={timeStr} onChange={setTimeStr} icon="time" placeholder="18:00" />
        <Input label={t('management.rescheduleReason')} value={reason} onChange={setReason} multiline />
        <Spacer size={8} />
        <Btn title={t('management.saveSchedule')} size="lg" loading={saving} onPress={save} icon="checkmark-circle" full />
      </ScrollView>
    </Sheet>
  );
}

function CancelSessionSheet({
  visible,
  session,
  onClose,
}: {
  visible: boolean;
  session: TrainingSession;
  onClose: () => void;
}) {
  const { refresh, toast } = useApp();
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCancel = async () => {
    setSaving(true);
    try {
      await cancelTrainingSession({
        sessionId: session.id,
        reason: reason.trim() || t('destroy.reason'),
      });
      await refresh();
      toast(t('common.done'), 'success');
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={`${t('destroy.confirmSession')} — ${session.title}`}>
      <ScrollView contentContainerStyle={{ paddingBottom: 30, gap: 12 }}>
        <Card color="#EF444415" style={{ borderColor: '#EF4444' }}>
          <Txt variant="caption" color="#EF4444">{t('destroy.sessionBody')}</Txt>
        </Card>
        <Input label={t('destroy.reason')} value={reason} onChange={setReason} multiline />
        <Spacer size={8} />
        <Btn title={t('destroy.confirmSession')} size="lg" variant="danger" loading={saving} onPress={handleCancel} icon="close-circle" full />
      </ScrollView>
    </Sheet>
  );
}

function CancelBatchSheet({
  visible,
  batchId,
  onClose,
}: {
  visible: boolean;
  batchId: string;
  onClose: () => void;
}) {
  const { db, refresh, toast } = useApp();
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const students = batchStudents(db, batchId).length;
  const sessions = sessionsOfBatch(db, batchId).filter((s) => s.status !== 'closed' && s.status !== 'cancelled').length;

  const handleCancel = async () => {
    setSaving(true);
    try {
      await cancelBatch({
        batchId,
        reason: reason.trim() || t('destroy.reason'),
      });
      await refresh();
      toast(t('common.done'), 'success');
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t('destroy.batchTitle')}>
      <ScrollView contentContainerStyle={{ paddingBottom: 30, gap: 12 }}>
        <Card color="#EF444415" style={{ borderColor: '#EF4444' }}>
          <Txt variant="caption" color="#EF4444">
            {t('destroy.batchBody', { sessions, students })}
          </Txt>
        </Card>
        <Input label={t('destroy.reason')} value={reason} onChange={setReason} multiline />
        <Spacer size={8} />
        <Btn title={t('destroy.confirmBatch')} size="lg" variant="danger" loading={saving} onPress={handleCancel} icon="trash" full />
      </ScrollView>
    </Sheet>
  );
}

function AssignCourseRoleSheet({
  visible,
  courseId,
  onClose,
}: {
  visible: boolean;
  courseId: string;
  onClose: () => void;
}) {
  const { db, refresh, toast } = useApp();
  const { theme } = useTheme();
  const { t } = useI18n();
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState<CourseRoleType>('organizer');
  const [saving, setSaving] = useState(false);

  const candidates = db.profiles.filter((p) => p.role !== 'student' && p.status === 'active');

  const handleAssign = async () => {
    if (!selectedUserId) {
      toast(t('management.pickMember'), 'error');
      return;
    }
    setSaving(true);
    try {
      await assignCourseRole({
        courseId,
        userId: selectedUserId,
        role: selectedRole,
      });
      await refresh();
      toast(t('management.assignOk'), 'success');
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t('management.assignTitle')}>
      <ScrollView contentContainerStyle={{ paddingBottom: 30, gap: 12 }}>
        <Txt variant="caption" color={theme.textSecondary}>{t('management.pickRole')}</Txt>
        <Segmented
          value={selectedRole}
          onChange={(v) => setSelectedRole(v as CourseRoleType)}
          options={[
            { value: 'organizer', label: t('management.roleOrganizer') },
            { value: 'coordinator', label: t('management.roleCoordinator') },
            { value: 'instructor_delegate', label: t('management.roleDelegate') },
          ]}
        />
        <Spacer size={6} />
        <Txt variant="caption" color={theme.textSecondary}>{t('management.pickStaff')}</Txt>
        {candidates.map((cand) => (
          <Card
            key={cand.id}
            color={selectedUserId === cand.id ? theme.brandSoft : undefined}
            style={{ borderColor: selectedUserId === cand.id ? theme.brand : theme.line }}
            onPress={() => setSelectedUserId(cand.id)}
          >
            <Row center gap={10}>
              <Avatar name={cand.fullName} color={cand.avatarColor} size={36} />
              <View style={{ flex: 1 }}>
                <Txt variant="bodyMed">{cand.fullName}</Txt>
                <Txt variant="micro" color={theme.textMuted}>{cand.role} · {cand.phone}</Txt>
              </View>
              {selectedUserId === cand.id ? (
                <Ionicons name="checkmark-circle" size={22} color={theme.brand} />
              ) : null}
            </Row>
          </Card>
        ))}
        <Spacer size={8} />
        <Btn
          title={t('management.confirmAssign')}
          size="lg"
          variant="primary"
          icon="shield-checkmark"
          loading={saving}
          disabled={!selectedUserId}
          onPress={handleAssign}
          full
        />
      </ScrollView>
    </Sheet>
  );
}

function EditCourseSheet({
  visible,
  course,
  onClose,
}: {
  visible: boolean;
  course: any;
  onClose: () => void;
}) {
  const { refresh, toast } = useApp();
  const { t } = useI18n();
  const [title, setTitle] = useState(course.title);
  const [field, setField] = useState(course.field);
  const [description, setDescription] = useState(course.description ?? '');
  const [sessionsCount, setSessionsCount] = useState(String(course.sessionsCount));
  const [topics, setTopics] = useState(course.topics ? course.topics.join('\n') : '');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setTitle(course.title);
    setField(course.field);
    setDescription(course.description ?? '');
    setSessionsCount(String(course.sessionsCount));
    setTopics(course.topics ? course.topics.join('\n') : '');
    setErrors({});
  }, [course, visible]);

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!title.trim() || title.trim().length < 3) {
      errs.title = t('management.titleMin');
    }
    if (!field.trim() || field.trim().length < 2) {
      errs.field = t('management.fieldMin');
    }
    const count = parseInt(sessionsCount, 10);
    if (!count || count < 1 || count > 100) {
      errs.sessionsCount = t('management.sessionsRange');
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      await updateCourse({
        courseId: course.id,
        title: title.trim(),
        field: field.trim(),
        description: description.trim(),
        sessionsCount: parseInt(sessionsCount, 10) || course.sessionsCount,
        topics: topics.split('\n').map((x: string) => x.trim()).filter(Boolean),
      });
      await refresh();
      toast(t('management.courseUpdated'), 'success');
      onClose();
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('forbidden')) {
        toast(t('management.noPermission'), 'error');
      } else {
        setErrors((prev) => ({ ...prev, general: msg }));
        toast(msg, 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t('management.editCourse')}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {errors.general ? (
          <Card color="#EF44441F" style={{ borderColor: '#EF4444', padding: 10 }}>
            <Txt variant="caption" color="#EF4444">{errors.general}</Txt>
          </Card>
        ) : null}
        <Input
          label={t('courses.titleLabel')}
          value={title}
          onChange={(v) => { setTitle(v); setErrors((e) => ({ ...e, title: '' })); }}
          icon="book"
          error={errors.title}
        />
        <Input
          label={t('courses.fieldLabel')}
          value={field}
          onChange={(v) => { setField(v); setErrors((e) => ({ ...e, field: '' })); }}
          icon="bookmark"
          error={errors.field}
        />
        <Input
          label={t('courses.descLabel')}
          value={description}
          onChange={setDescription}
          multiline
        />
        <Input
          label={t('courses.sessionsLabel')}
          value={sessionsCount}
          onChange={(v) => { setSessionsCount(v); setErrors((e) => ({ ...e, sessionsCount: '' })); }}
          keyboardType="numeric"
          icon="calendar"
          error={errors.sessionsCount}
        />
        <Input
          label={t('courses.topicsLabel')}
          value={topics}
          onChange={setTopics}
          multiline
        />
        <Btn title={t('common.save')} size="lg" full loading={saving} onPress={save} icon="checkmark-circle" />
      </ScrollView>
    </Sheet>
  );
}

function SessionDetailSheet({
  session,
  batchId,
  onClose,
  onNotifyAbsentees,
  onStartLive,
  notifying,
}: {
  session: TrainingSession;
  batchId: string;
  onClose: () => void;
  onNotifyAbsentees: () => void;
  onStartLive?: () => void;
  notifying: boolean;
}) {
  const { db } = useApp();
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const localStudents = batchStudents(db, batchId);
  const [roster, setRoster] = useState<any[]>([]);
  const [sessionRows, setSessionRows] = useState<Array<{
    user_id: string; status: string; checked_in_at: string | null; method: string | null;
  }>>([]);

  useEffect(() => {
    if (localStudents.length === 0) {
      void getBatchRoster(batchId).then((res) => {
        if (res.students) setRoster(res.students);
      }).catch(() => {});
    }
    void getSessionRoster(session.id).then((rows) => {
      if (Array.isArray(rows)) setSessionRows(rows);
    }).catch(() => {});
  }, [batchId, localStudents.length, session.id]);

  const students = localStudents.length > 0 ? localStudents : roster.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    avatarColor: theme.brand,
    phone: r.phone ?? '',
    email: r.email ?? '',
  }));

  const attRows = sessionRows.length > 0
    ? sessionRows.map((r) => ({
      sessionId: session.id,
      userId: r.user_id,
      status: r.status as 'present' | 'late' | 'absent' | 'excused',
      checkedInAt: r.checked_in_at ? new Date(r.checked_in_at).getTime() : undefined,
      method: (r.method as 'qr' | 'code' | 'manual' | undefined) ?? undefined,
    }))
    : db.attendance.filter((a) => a.sessionId === session.id);

  const present = attRows.filter((a) => a.status === 'present').length;
  const late = attRows.filter((a) => a.status === 'late').length;
  const excused = attRows.filter((a) => a.status === 'excused').length;
  const absent = attRows.filter((a) => a.status === 'absent').length;
  const honored = present + late;
  const total = students.length;
  const pct = total > 0 ? Math.round((honored / total) * 100) : 0;

  const attendanceMeta = (st?: string) =>
    st === 'present' ? { label: t('history.present'), icon: 'checkmark-circle', color: theme.success, bg: theme.successSoft }
    : st === 'late' ? { label: t('history.late'), icon: 'time', color: theme.warn, bg: theme.warnSoft }
    : st === 'excused' ? { label: t('history.excused'), icon: 'shield', color: theme.info, bg: theme.brandSoft }
    : st === 'absent' ? { label: t('history.absent'), icon: 'close-circle', color: theme.danger, bg: theme.dangerSoft }
    : { label: t('common.scheduledStatus'), icon: 'ellipse-outline', color: theme.textMuted, bg: theme.bg };

  return (
    <Sheet visible={true} onClose={onClose} title={`${session.title} — #${session.seq}`}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false}>
        <View style={{ gap: 12 }}>
          {session.status === 'scheduled' && onStartLive ? (
            <Btn
              title={t('management.startThisLive')}
              size="lg"
              variant="primary"
              icon="play"
              full
              onPress={() => {
                onClose();
                onStartLive();
              }}
            />
          ) : null}
          {/* إحصاءات الجلسة */}
          <Row gap={8}>
            <Metric value={String(present)} label={t('history.present')} color={theme.success} />
            <Metric value={String(late)} label={t('history.late')} color={theme.warn} />
            <Metric value={String(excused)} label={t('history.excused')} color={theme.info} />
            <Metric value={String(absent)} label={t('history.absent')} color={theme.danger} />
          </Row>

          <Card glass>
            <Row between center>
              <Txt variant="caption" color={theme.textSecondary}>{t('sess.attendancePct')}</Txt>
              <Txt variant="h3" color={pct >= 75 ? theme.success : theme.warn}>{pct}% ({honored}/{total})</Txt>
            </Row>
            <Spacer size={6} />
            <ProgressBar progress={total > 0 ? honored / total : 0} color={pct >= 75 ? theme.success : theme.warn} height={6} />
          </Card>

          {/* تقرير المحاضرة */}
          {session.report && (session.report.done || session.report.planned || session.report.challenges) ? (
            <Card style={{ gap: 8 }}>
              <Txt variant="h3">{t('sess.report')}</Txt>
              {session.report.done ? (
                <View>
                  <Txt variant="micro" color={theme.textMuted}>✍️ {t('report.done')}</Txt>
                  <Txt variant="body">{session.report.done}</Txt>
                </View>
              ) : null}
              {session.report.planned ? (
                <View>
                  <Txt variant="micro" color={theme.textMuted}>📌 {t('report.planned')}</Txt>
                  <Txt variant="body">{session.report.planned}</Txt>
                </View>
              ) : null}
              {session.report.challenges ? (
                <View>
                  <Txt variant="micro" color={theme.textMuted}>⚠️ {t('report.challenges')}</Txt>
                  <Txt variant="body">{session.report.challenges}</Txt>
                </View>
              ) : null}
            </Card>
          ) : null}

          {/* سجل حضور الطلاب */}
          <Card noPad>
            <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: theme.line }}>
              <Txt variant="h3">{t('management.sessionRoster')}</Txt>
            </View>
            {students.length === 0 ? (
              <View style={{ padding: 16 }}>
                <Txt variant="caption" color={theme.textMuted} align="center">{t('management.noStudents')}</Txt>
              </View>
            ) : (
              students.map((st, i) => {
                const att = attRows.find((a) => a.userId === st.id);
                const meta = attendanceMeta(att?.status);
                return (
                  <Row key={st.id} center gap={10} style={{ padding: 12, borderBottomWidth: i < students.length - 1 ? 1 : 0, borderBottomColor: theme.line }}>
                    <Avatar name={st.fullName} color={st.avatarColor} size={36} />
                    <View style={{ flex: 1 }}>
                      <Txt variant="bodyMed">{st.fullName}</Txt>
                      <Txt variant="micro" color={theme.textMuted}>
                        {st.phone ? `${st.phone} ` : ''}{st.email ? `· ${st.email} ` : ''}
                        {att?.method ? `· ${t('common.manual')}: ${att.method}` : ''}
                        {att?.checkedInAt ? ` · ${formatTime(att.checkedInAt, lang)}` : ''}
                      </Txt>
                    </View>
                    <Tag label={meta.label} color={meta.color} bg={meta.bg} icon={meta.icon as any} />
                  </Row>
                );
              })
            )}
          </Card>

          {absent > 0 ? (
            <Btn title={t('sess.notifyAbsentees', { x: absent })} variant="secondary" icon="notifications" loading={notifying} onPress={onNotifyAbsentees} full />
          ) : null}
        </View>
      </ScrollView>
    </Sheet>
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

