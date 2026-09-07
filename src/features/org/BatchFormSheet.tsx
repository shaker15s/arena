import React, { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../../data/store';
import {
  checkInstructorConflict, courseOf, generateSessionsForBatch, profileOf,
} from '../../data/engine';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import {
  Btn, Card, Chip, Input, Row, Sheet, Tag, Txt,
} from '../../design/components';
import { formatDate } from '../../shared/format';
import { Batch } from '../../data/types';
import { createBatchWithSessions } from '../../data/actions';

export function BatchFormSheet({ visible, onClose, initialCourseId }: { visible: boolean; onClose: () => void; initialCourseId?: string }) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const { db, refresh, toast, user } = useApp();
  const [branchId, setBranchId] = useState<string | null>(db.branches[0]?.id ?? null);
  const [courseId, setCourseId] = useState<string | null>(initialCourseId ?? null);
  const [instructorId, setInstructorId] = useState<string | null>(user?.role === 'volunteer' ? user.id : null);
  const [capacity, setCapacity] = useState('25');
  const [customSessionsCount, setCustomSessionsCount] = useState('8');
  const [days, setDays] = useState<number[]>([6]);
  const [time, setTime] = useState('');
  const [startDate, setStartDate] = useState('');
  const [room, setRoom] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (initialCourseId) setCourseId(initialCourseId);
    if (user?.role === 'volunteer') setInstructorId(user.id);
    if (initialCourseId) {
      const c = courseOf(db, initialCourseId);
      if (c?.sessionsCount) setCustomSessionsCount(String(c.sessionsCount));
    }
    setErrors({});
  }, [initialCourseId, user, visible, db]);

  const publishedCourses = db.courses.filter((c) => c.status === 'published');
  const volunteers = db.profiles.filter((p) => p.role === 'volunteer' && p.status === 'active');
  const course = courseId ? courseOf(db, courseId) : null;

  // فحص حصرية المنظم: هل هذا الكورس منظم بالفعل بواسطة شخص آخر معروف؟
  const activeBatchForCourse = courseId ? db.batches.find((b) => b.courseId === courseId && b.status !== 'archived') : null;
  const currentOrganizer = activeBatchForCourse?.instructorId ? profileOf(db, activeBatchForCourse.instructorId) : null;
  const isConflictWithOtherOrganizer = Boolean(
    activeBatchForCourse && currentOrganizer && instructorId && activeBatchForCourse.instructorId !== instructorId
  );

  const toggleDay = (d: number) => {
    setDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort());
    setErrors((e) => ({ ...e, days: '' }));
  };

  const effectiveTime = time.trim() || '18:00';
  const effectiveStartDate = startDate.trim() || new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const effectiveCapacity = parseInt(capacity, 10) || 25;
  const effectiveSessionsCount = Math.min(100, Math.max(1, parseInt(customSessionsCount, 10) || course?.sessionsCount || 8));
  const effectiveRoom = room.trim() || t('batchAdm.defaultRoom');

  // معاينة مولّدة تلقائيًا + تحذير تعارض
  const draftBatch: Batch | null = course && branchId && instructorId && days.length > 0 ? {
    id: 'preview', courseId: course.id, branchId, instructorId,
    capacity: effectiveCapacity,
    schedule: { days, time: effectiveTime, durationMin: 120 },
    startDate: new Date(effectiveStartDate).getTime(),
    room: effectiveRoom, status: 'scheduled', joinCode: '',
  } : null;
  const preview = course && draftBatch ? generateSessionsForBatch(draftBatch, effectiveSessionsCount) : [];
  const conflict = instructorId && days.length > 0 ? checkInstructorConflict(db, instructorId, days, effectiveTime) : null;

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!branchId) errs.branchId = t('batchAdm.needBranch');
    if (!courseId) errs.courseId = t('batchAdm.needCourse');
    if (!instructorId) errs.instructorId = t('batchAdm.needInstructor');
    if (days.length === 0) errs.days = t('batchAdm.needDays');
    const cap = parseInt(capacity, 10);
    if (!cap || cap < 5 || cap > 200) errs.capacity = t('batchAdm.capacityRange');
    if (startDate.trim() && isNaN(new Date(startDate.trim()).getTime())) {
      errs.startDate = t('batchAdm.badDate');
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const publish = async () => {
    if (!validate()) return;
    if (!course || !branchId || !instructorId || !draftBatch) return;
    if (isConflictWithOtherOrganizer) {
      setErrors((prev) => ({
        ...prev,
        courseId: t('batchAdm.alreadyOrganized', { name: currentOrganizer?.fullName ?? t('management.delegated') }),
      }));
      toast(t('batchAdm.alreadyOrganized', { name: currentOrganizer?.fullName ?? t('management.delegated') }), 'warn');
      return;
    }
    setSaving(true);
    try {
      await createBatchWithSessions({
        courseId: course.id,
        branchId,
        instructorId,
        capacity: draftBatch.capacity,
        schedule: draftBatch.schedule,
        startDate: effectiveStartDate,
        room: effectiveRoom,
        sessions: preview.map((session, idx) => ({
          seq: idx + 1,
          title: (course.topics && course.topics[idx] && course.topics[idx].trim())
            ? course.topics[idx].trim()
            : `المحاضرة ${idx + 1}`,
          starts_at: (session.startsAt && !isNaN(session.startsAt))
            ? new Date(session.startsAt).toISOString()
            : new Date(Date.now() + (idx + 1) * 7 * 86_400_000).toISOString(),
          duration_min: Math.max(15, draftBatch.schedule.durationMin || 120),
        })),
      });
      await refresh();
      onClose();
      toast(t('batchAdm.published'), 'success');
    } catch (error) {
      const msg = (error as Error).message;
      setErrors((prev) => ({ ...prev, general: msg }));
      toast(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t('batchAdm.new')}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {errors.general ? (
          <Card color="#EF44441F" style={{ borderColor: '#EF4444', padding: 10 }}>
            <Txt variant="caption" color="#EF4444">{errors.general}</Txt>
          </Card>
        ) : null}

        <Txt variant="caption" color={theme.textSecondary}>{t('common.branch')}</Txt>
        <Row gap={6} wrap>
          {db.branches.map((branch) => (
            <Chip key={branch.id} label={branch.name} active={branchId === branch.id} onPress={() => { setBranchId(branch.id); setErrors((e) => ({ ...e, branchId: '' })); }} />
          ))}
        </Row>
        {errors.branchId ? <Txt variant="micro" color={theme.danger}>{errors.branchId}</Txt> : null}

        <Txt variant="caption" color={theme.textSecondary}>{t('batchAdm.pickCourse')}</Txt>
        <Row gap={6} wrap>
          {publishedCourses.map((c) => {
            const existingBatch = db.batches.find((b) => b.courseId === c.id && b.status !== 'archived');
            const org = existingBatch?.instructorId ? profileOf(db, existingBatch.instructorId) : null;
            const takenByOther = Boolean(existingBatch && org && user?.role === 'volunteer' && existingBatch.instructorId !== user.id);
            return (
              <Chip
                key={c.id}
                label={takenByOther ? `🔒 ${c.title} (${org?.fullName})` : c.title}
                active={courseId === c.id}
                onPress={() => {
                  if (takenByOther) {
                    toast(t('batchAdm.alreadyOrganized', { name: org?.fullName ?? t('management.delegated') }), 'warn');
                  }
                  setCourseId(c.id);
                  setErrors((e) => ({ ...e, courseId: '' }));
                }}
              />
            );
          })}
        </Row>
        {errors.courseId ? <Txt variant="micro" color={theme.danger}>{errors.courseId}</Txt> : null}

        {isConflictWithOtherOrganizer && (
          <Card color={theme.dangerSoft} style={{ borderColor: theme.danger + '55', padding: 10 }}>
            <Row center gap={8}>
              <Ionicons name="alert-circle" size={20} color={theme.danger} />
              <Txt variant="micro" color={theme.danger}>
                تنبيه: هذا الكورس منظم حالياً بواسطة {currentOrganizer?.fullName}. لا يمكنك تنظيم كورس مسند لمنظم آخر.
              </Txt>
            </Row>
          </Card>
        )}

        {user?.role === 'admin' ? (
          <>
            <Txt variant="caption" color={theme.textSecondary}>{t('batchAdm.pickInstructor')}</Txt>
            <Row gap={6} wrap>
              {volunteers.map((v) => (
                <Chip key={v.id} label={v.fullName} active={instructorId === v.id} onPress={() => { setInstructorId(v.id); setErrors((e) => ({ ...e, instructorId: '' })); }} />
              ))}
            </Row>
            {errors.instructorId ? <Txt variant="micro" color={theme.danger}>{errors.instructorId}</Txt> : null}
          </>
        ) : null}

        <Txt variant="caption" color={theme.textSecondary}>{t('batchAdm.days')}</Txt>
        <Row gap={6} wrap>
          {[0, 1, 2, 3, 4, 5, 6].map((d) => (
            <Chip key={d} label={t(`dayShort.${d}` as any)} active={days.includes(d)} onPress={() => toggleDay(d)} />
          ))}
        </Row>
        {errors.days ? <Txt variant="micro" color={theme.danger}>{errors.days}</Txt> : null}

        <Row gap={10}>
          <View style={{ flex: 1 }}>
            <Input label={t('batchAdm.sessionsCustom')} value={customSessionsCount} onChange={setCustomSessionsCount} placeholder={t('batchAdm.sessionsPh')} keyboardType="numeric" icon="calendar" />
          </View>
          <View style={{ flex: 1 }}>
            <Input label={t('batchAdm.capacity')} value={capacity} onChange={(v) => { setCapacity(v); setErrors((e) => ({ ...e, capacity: '' })); }} placeholder="25" keyboardType="numeric" icon="people" error={errors.capacity} />
          </View>
        </Row>
        <Row gap={10}>
          <View style={{ flex: 1 }}>
            <Input label={t('batchAdm.time')} value={time} onChange={setTime} placeholder="18:00 (6:00 م)" icon="time" />
          </View>
          <View style={{ flex: 1 }}>
            <Input label={t('batchAdm.startDate')} value={startDate} onChange={(v) => { setStartDate(v); setErrors((e) => ({ ...e, startDate: '' })); }} placeholder="YYYY-MM-DD" icon="calendar" error={errors.startDate} />
          </View>
        </Row>
        <Input label={t('batchAdm.room')} value={room} onChange={setRoom} placeholder={t('batchAdm.roomPh')} icon="location" />

        {conflict ? (
          <Card color={theme.warnSoft} style={{ borderColor: theme.warn + '55' }}>
            <Row center gap={8}>
              <Ionicons name="warning" size={18} color={theme.warn} />
              <Txt variant="caption" color={theme.warn} style={{ flex: 1 }}>{t('batchAdm.conflict')}</Txt>
            </Row>
          </Card>
        ) : null}

        {preview.length > 0 ? (
          <Card glass>
            <Txt variant="caption" color={theme.brand} style={{ marginBottom: 6 }}>👁️ {t('batchAdm.preview')} ({preview.length})</Txt>
            <Row wrap gap={6}>
              {preview.map((p) => (
                <Tag key={p.seq} label={`${p.seq}: ${formatDate(p.startsAt, lang)}`} color={theme.textSecondary} bg={theme.bg} />
              ))}
            </Row>
          </Card>
        ) : null}

        <Btn title={t('batchAdm.publish')} size="lg" full loading={saving} onPress={publish} icon="rocket" disabled={!branchId || !course || !instructorId || days.length === 0 || Boolean(conflict)} />
      </ScrollView>
    </Sheet>
  );
}
