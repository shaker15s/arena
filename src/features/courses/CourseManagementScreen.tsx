import React, { useEffect, useMemo, useState } from 'react';
import { Platform, RefreshControl, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import { useApp } from '../../data/store';
import {
  canManageCourse, courseOf,
  isBatchComplete, profileOf, seatCounts, sessionsOfBatch, batchStudents,
} from '../../data/engine';
import {
  getCourseOverview, getDetailedCourseAnalytics,
  notifySessionAbsentees, revokeCourseRole, sendBroadcast,
  startTrainingSession, type DetailedCourseAnalytics,
} from '../../data/actions';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import {
  Btn, Card, Chip, Empty, Header, Input, Row,
  Segmented, Sheet, Spacer, Tag, Txt,
} from '../../design/components';
import { AnimatedTabContent } from '../../design/AnimatedTabContent';
import { spacing } from '../../design/tokens';
import { formatDate } from '../../shared/format';
import { publicJoinUrl } from '../../shared/links';
import type { CourseRole, TrainingSession } from '../../data/types';
import { BatchFormSheet } from '../org/AdminScreens';
import {
  Metric,
  RescheduleSessionSheet, CancelSessionSheet, CancelBatchSheet,
  AssignCourseRoleSheet, EditCourseSheet, SessionDetailSheet,
} from './management/CourseManagementSheets';
import {
  CourseOverviewTab, CourseSessionsTab, CourseStudentsTab,
  CourseStaffTab, CourseAnalyticsTab, CourseReviewsTab,
} from './management/CourseTabs';

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

  const handleRevokeRole = async (cr: CourseRole) => {
    try {
      await revokeCourseRole({ courseId: course.id, userId: cr.userId, role: cr.role });
      await refresh();
      toast(t('management.revokeOk'), 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
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

            <AnimatedTabContent tabKey={tab}>
            {/* 1) تبويب النظرة العامة */}
            {batch && tab === 'overview' ? (
              <CourseOverviewTab
                db={db}
                batch={batch}
                course={course}
                sessions={sessions}
                counts={counts}
                instructor={instructor}
                branch={branch}
                isCourseManager={isCourseManager}
                statusMeta={statusMeta}
                onShowQr={() => setJoinQrOpen(true)}
                onShareLink={copyJoinLink}
                onBroadcast={() => setBroadcastOpen(true)}
                onCancelBatch={() => setCancelBatchTarget(batch.id)}
              />
            ) : null}

            {/* 2) تبويب المحاضرات الميدانية */}
            {batch && tab === 'sessions' ? (
              <CourseSessionsTab
                db={db}
                course={course}
                sessions={sessions}
                counts={counts}
                isCourseManager={isCourseManager}
                startingSessionId={startingSessionId}
                onSelectSession={(sess) => setSelectedSession(sess)}
                onStartLive={(sess) => handleStartLive(sess)}
                onRescheduleSession={(sess) => setRescheduleSession(sess)}
                onCancelSession={(sess) => setCancelSessionTarget(sess)}
              />
            ) : null}

            {/* 3) تبويب الطلاب */}
            {batch && tab === 'students' ? (
              <CourseStudentsTab
                db={db}
                batchId={batch.id}
                students={students}
                countsTaken={counts.taken}
                onStudentPress={(userId, bId) => navigation.navigate('StudentRecord', { userId, batchId: bId })}
              />
            ) : null}

            {/* 4) تبويب فريق العمل والمنظمين */}
            {tab === 'staff' ? (
              <CourseStaffTab
                db={db}
                owner={owner}
                rolesList={rolesList}
                isCourseManager={isCourseManager}
                onAssignStaff={() => setAssignRoleOpen(true)}
                onRevokeRole={handleRevokeRole}
              />
            ) : null}

            {/* 5) تبويب التحليلات ومسار التحويل (Analytics Funnel) */}
            {tab === 'analytics' ? (
              <CourseAnalyticsTab
                analytics={analytics}
                loadingAnalytics={loadingAnalytics}
              />
            ) : null}

            {/* 6) تبويب التقييمات */}
            {tab === 'reviews' ? (
              <CourseReviewsTab
                db={db}
                courseId={course.id}
              />
            ) : null}
            </AnimatedTabContent>
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
