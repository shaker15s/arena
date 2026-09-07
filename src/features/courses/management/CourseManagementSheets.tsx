import React, { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../../../data/store';
import { useTheme } from '../../../design/theme';
import { useI18n } from '../../../i18n';
import {
  Avatar, Btn, Card, Input, ProgressBar, Row,
  Segmented, Sheet, Spacer, Stars, Tag, Txt,
} from '../../../design/components';
import { formatDate, formatTime } from '../../../shared/format';
import { batchStudents, profileOf, sessionsOfBatch } from '../../../data/engine';
import {
  assignCourseRole, cancelBatch, cancelTrainingSession,
  getBatchRoster, getSessionRoster, rescheduleTrainingSession, updateCourse,
} from '../../../data/actions';
import type { CourseRoleType, TrainingSession } from '../../../data/types';

export function RescheduleSessionSheet({
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

export function CancelSessionSheet({
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

export function CancelBatchSheet({
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

export function AssignCourseRoleSheet({
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

export function EditCourseSheet({
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

export function SessionDetailSheet({
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

export function Metric({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <Card style={{ flex: 1, padding: 10, alignItems: 'center' }}>
      <Txt variant="h2" color={color}>{value}</Txt>
      <Txt variant="micro" align="center">{label}</Txt>
    </Card>
  );
}

export function Info({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  const { theme } = useTheme();
  return (
    <Row center gap={8} style={{ marginTop: 8 }}>
      <Ionicons name={icon} size={15} color={theme.brand} />
      <Txt variant="micro" color={theme.textMuted}>{label}</Txt>
      <Txt variant="caption" style={{ flex: 1 }}>{value}</Txt>
    </Row>
  );
}

