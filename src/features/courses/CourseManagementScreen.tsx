import React, { useEffect, useMemo, useState } from 'react';
import { Platform, RefreshControl, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import { useApp } from '../../data/store';
import {
  attendancePct, batchStudents, courseOf, isBatchComplete, profileOf, seatCounts, sessionsOfBatch,
} from '../../data/engine';
import {
  notifySessionAbsentees, startTrainingSession, updateCourse, createSessionForBatch, getBatchRoster,
} from '../../data/actions';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import {
  Avatar, Btn, Card, Chip, Empty, FadeIn, Header, Input, ProgressBar, Row, Segmented, Sheet, Spacer, Stars, Tag, Txt,
} from '../../design/components';
import { spacing } from '../../design/tokens';
import { formatDate, formatTime } from '../../shared/format';
import { publicJoinUrl } from '../../shared/links';
import type { TrainingSession } from '../../data/types';
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
      .filter((batch) => user.role === 'admin' || user.role === 'supervisor' || batch.instructorId === user.id)
      .sort((a, b) => b.startDate - a.startDate);
  }, [courseId, db.batches, user]);

  const [batchId, setBatchId] = useState<string>(requestedBatchId ?? allowedBatches[0]?.id ?? '');
  const [tab, setTab] = useState<'overview' | 'students' | 'sessions' | 'reviews'>('overview');
  const [selectedSession, setSelectedSession] = useState<TrainingSession | null>(null);
  const [joinQrOpen, setJoinQrOpen] = useState(false);
  const [editCourseOpen, setEditCourseOpen] = useState(false);
  const [newBatchOpen, setNewBatchOpen] = useState(false);
  const [startingSessionId, setStartingSessionId] = useState<string | null>(null);
  const [notifying, setNotifying] = useState(false);

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
      toast('تم بدء المحاضرة بنجاح وتوليد رمز الـ QR!', 'success');
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

  return (
    <View style={{ flex: 1 }}>
      <Header
        title={course.title}
        subtitle={t('management.subtitle')}
        back={() => navigation.goBack()}
        right={
          <Row gap={6}>
            <Btn
              title="تعديل الكورس"
              size="sm"
              variant="secondary"
              icon="create-outline"
              onPress={() => setEditCourseOpen(true)}
            />
            <Btn
              title={t('batchAdm.new')}
              size="sm"
              icon="add"
              onPress={() => setNewBatchOpen(true)}
            />
          </Row>
        }
      />
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
          <Spacer size={12} />
          <Row gap={8}>
            <View style={{ flex: 1 }}>
              <Btn
                title="تعديل بيانات الكورس والمحاور"
                variant="ghost"
                size="sm"
                icon="create"
                onPress={() => setEditCourseOpen(true)}
                full
              />
            </View>
            {batch && (
              <View style={{ flex: 1 }}>
                <Btn
                  title="🚀 بدء محاضرة حية الآن"
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

        <Row gap={9}>
          <Metric value={String(allowedBatches.length)} label={t('management.groups')} color={theme.brand} />
          <Metric value={String(allCounts)} label={t('management.registrants')} color={theme.success} />
          <Metric value={String(active)} label={t('common.active')} color={theme.warn} />
          <Metric value={String(completed)} label={t('management.completed')} color={theme.teal} />
        </Row>

        {allowedBatches.length === 0 ? (
          <Card style={{ paddingVertical: 24 }}>
            <Empty
              emoji="🎓"
              title="لم يتم إنشاء مجموعات لهذا الكورس بعد"
              body="يمكنك كمنظم البدء في إنشاء أول دفعة وتحديد أوقات المحاضرات واستقبال الطلاب وبدء الحضور فوراً"
              cta="➕ إنشاء وتنظيم مجموعة جديدة"
              onCta={() => setNewBatchOpen(true)}
            />
          </Card>
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
                { value: 'reviews', label: `التقييمات (${db.ratings.filter((r) => r.courseId === course.id).length})`, icon: 'star' },
              ]}
            />

            {batch && tab === 'overview' ? (
              <View style={{ gap: 10 }}>
                {/* بطاقة تقدم المحاضرات المنجزة */}
                <Card color={theme.brandSoft} style={{ borderColor: theme.brand + '33' }}>
                  <Row center between>
                    <View>
                      <Txt variant="caption" color={theme.textSecondary}>تقدم المحاضرات المنجزة</Txt>
                      <Txt variant="h2" color={theme.brand}>
                        {sessions.filter((s) => s.status === 'closed').length} / {sessions.length} محاضرة
                      </Txt>
                    </View>
                    <Tag
                      label={isBatchComplete(db, batch.id) ? 'مكتملة الدورة' : batch.status === 'active' ? 'قيد التدريب' : 'مجدولة'}
                      color={isBatchComplete(db, batch.id) ? theme.brand : theme.success}
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

                {/* بطاقة رابط وQR الانضمام الفوري للطلاب */}
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
                          <Txt variant="micro" color={theme.textMuted}>
                            {student.phone || 'بدون هاتف'} {student.email ? `· ${student.email}` : ''}
                          </Txt>
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
                        label={session.status === 'closed' ? `${t('management.closed')} · ${honored}/${counts.taken}` : session.status === 'live' ? t('management.live') : t('common.scheduledStatus')}
                        color={session.status === 'closed' ? theme.textMuted : session.status === 'live' ? theme.success : theme.warn}
                        bg={session.status === 'live' ? theme.successSoft : theme.bg}
                        icon={session.status === 'closed' ? 'checkmark-circle' : session.status === 'live' ? 'radio' : 'time'}
                      />
                    </Row>
                    {session.status === 'scheduled' ? (
                      <View style={{ marginTop: 10 }}>
                        <Btn
                          title="🚀 بدء المحاضرة وتوليد الـ QR الآن"
                          size="sm"
                          variant="primary"
                          icon="play"
                          loading={startingSessionId === session.id}
                          onPress={() => handleStartLive(session)}
                          full
                        />
                      </View>
                    ) : null}
                  </Card>
                );
              })
            ) : null}

            {tab === 'reviews' ? (
              (() => {
                const reviews = db.ratings.filter((r) => r.courseId === course.id).sort((a, b) => b.createdAt - a.createdAt);
                const avgStars = reviews.length > 0 ? (reviews.reduce((s, r) => s + r.stars, 0) / reviews.length).toFixed(1) : null;
                return reviews.length === 0 ? (
                  <Empty emoji="⭐" title="لا توجد تقييمات أو آراء مسجلة حتى الآن" body="تظهر تقييمات الطلاب وآراؤهم بعد حضورهم وإكمال المحاضرات" />
                ) : (
                  <View style={{ gap: 10 }}>
                    <Card glass>
                      <Row center between>
                        <View>
                          <Txt variant="caption" color={theme.textSecondary}>متوسط تقييم الطلاب</Txt>
                          <Row center gap={6}>
                            <Txt variant="h1" color={theme.certGold}>{avgStars}</Txt>
                            <Stars value={parseFloat(avgStars || '5')} size={20} />
                          </Row>
                        </View>
                        <Tag label={`${reviews.length} تقييم`} color={theme.brand} bg={theme.brandSoft} />
                      </Row>
                    </Card>
                    {reviews.map((rev) => {
                      const reviewer = profileOf(db, rev.userId);
                      return (
                        <Card key={`${rev.userId}-${rev.createdAt}`}>
                          <Row center between style={{ marginBottom: 6 }}>
                            <Row center gap={8}>
                              <Avatar name={reviewer?.fullName ?? 'طالب'} color={reviewer?.avatarColor ?? theme.brand} size={32} />
                              <View>
                                <Txt variant="bodyMed">{reviewer?.fullName ?? 'طالب مسجل'}</Txt>
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

      {/* تعديل الكورس */}
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
    </View>
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
      errs.title = 'عنوان الكورس يجب ألا يقل عن 3 أحرف';
    }
    if (!field.trim() || field.trim().length < 2) {
      errs.field = 'المجال / التخصص مطلوب ولا يقل عن حرفين';
    }
    const count = parseInt(sessionsCount, 10);
    if (!count || count < 1 || count > 100) {
      errs.sessionsCount = 'عدد المحاضرات يجب أن يكون بين 1 و 100';
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
      toast('تم تحديث تفاصيل الكورس بنجاح!', 'success');
      onClose();
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('forbidden')) {
        toast('ليس لديك صلاحية لتعديل هذا الكورس', 'error');
      } else {
        setErrors((prev) => ({ ...prev, general: msg }));
        toast(msg, 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="تعديل تفاصيل الكورس">
      <ScrollView contentContainerStyle={{ paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {errors.general ? (
          <Card color="#EF44441F" style={{ borderColor: '#EF4444', padding: 10 }}>
            <Txt variant="caption" color="#EF4444">{errors.general}</Txt>
          </Card>
        ) : null}
        <Input
          label="عنوان الكورس"
          value={title}
          onChange={(v) => { setTitle(v); setErrors((e) => ({ ...e, title: '' })); }}
          icon="book"
          error={errors.title}
        />
        <Input
          label="المجال / التخصص"
          value={field}
          onChange={(v) => { setField(v); setErrors((e) => ({ ...e, field: '' })); }}
          icon="bookmark"
          error={errors.field}
        />
        <Input
          label="وصف الكورس"
          value={description}
          onChange={setDescription}
          multiline
        />
        <Input
          label="عدد المحاضرات"
          value={sessionsCount}
          onChange={(v) => { setSessionsCount(v); setErrors((e) => ({ ...e, sessionsCount: '' })); }}
          keyboardType="numeric"
          icon="calendar"
          error={errors.sessionsCount}
        />
        <Input
          label="المحاور التدريبية (كل محور في سطر منفصل)"
          value={topics}
          onChange={setTopics}
          multiline
        />
        <Btn title="حفظ التعديلات" size="lg" full loading={saving} onPress={save} icon="checkmark-circle" />
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

  useEffect(() => {
    if (localStudents.length === 0) {
      void getBatchRoster(batchId).then((res) => {
        if (res.students) setRoster(res.students);
      }).catch(() => {});
    }
  }, [batchId, localStudents.length]);

  const students = localStudents.length > 0 ? localStudents : roster.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    avatarColor: theme.brand,
    phone: r.phone ?? '',
    email: r.email ?? '',
  }));

  const attRows = db.attendance.filter((a) => a.sessionId === session.id);

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
              title="🚀 بدء هذه المحاضرة الآن وتوليد الـ QR"
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

