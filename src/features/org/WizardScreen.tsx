/**
 * features/org — S41 معالج «ابدأ مركزك»: 6 خطوات حتى أول باتش على الهواء (F7).
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { useApp } from '../../data/store';
import { generateSessionsForBatch, profileOf } from '../../data/engine';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import {
  Avatar, Btn, Card, Chip, FadeIn, Input, ProgressBar, Row, Tag, Txt, Spacer,
} from '../../design/components';
import { CelebrationModal } from '../../design/celebrations';
import { spacing, radii } from '../../design/tokens';
import { RULE_DEFS } from '../../data/rules';
import { formatDate } from '../../shared/format';
import { bootstrapOrganization } from '../../data/actions';
import { publicJoinUrl } from '../../shared/links';

export function OrgWizardScreen({ navigation }: any) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { db, user, refresh, toast } = useApp();
  const [step, setStep] = useState(1);
  const [doneOpen, setDoneOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createdJoinCode, setCreatedJoinCode] = useState<string | null>(null);

  // الخطوة 1: الفرع
  const [branchName, setBranchName] = useState('');
  const [branchGovernorate, setBranchGovernorate] = useState('');
  const [branchAddress, setBranchAddress] = useState('');
  // الخطوة 2: اللجان (محلية حتى الحفظ الذري في الخطوة الأخيرة)
  const [committeeNames, setCommitteeNames] = useState<string[]>([]);
  const [newCommittee, setNewCommittee] = useState('');
  // الخطوة 3: الكورس
  const [courseTitle, setCourseTitle] = useState('');
  const [courseField, setCourseField] = useState('');
  const [courseDescription, setCourseDescription] = useState('');
  const [courseTopics, setCourseTopics] = useState('');
  const [courseSessions, setCourseSessions] = useState('8');
  // الخطوة 4: المجموعة
  const [instructorId, setInstructorId] = useState<string | null>(null);
  const [capacity, setCapacity] = useState('25');
  const [days, setDays] = useState<number[]>([6]);
  const [time, setTime] = useState('18:00');
  const [room, setRoom] = useState('');

  const instructors = db.profiles.filter((p) => p.status === 'active' && ['volunteer', 'supervisor', 'admin'].includes(p.role));
  const previewCourse = { sessionsCount: Math.min(100, Math.max(1, parseInt(courseSessions, 10) || 8)) };
  const previewStarts = new Date(Date.now() + 7 * 86_400_000).getTime();
  const previewBatch = instructorId && user ? {
    id: 'wizard-preview', courseId: 'wizard-course', branchId: user.branchId ?? user.id, instructorId,
    capacity: parseInt(capacity, 10) || 25, schedule: { days, time, durationMin: 120 },
    startDate: previewStarts, room, status: 'scheduled' as const, joinCode: '',
  } : null;
  const preview = previewBatch ? generateSessionsForBatch(previewBatch, previewCourse.sessionsCount) : [];

  const canNext = useMemo(() => {
    switch (step) {
      case 1: return branchName.trim().length > 2 && branchGovernorate.trim().length > 2 && branchAddress.trim().length > 3;
      case 2: return committeeNames.length > 0;
      case 3: return courseTitle.trim().length >= 3 && courseField.trim().length >= 2 && previewCourse.sessionsCount <= 100;
      case 4: return instructorId != null && room.trim().length > 0 && days.length > 0;
      case 5: return true;
      default: return true;
    }
  }, [step, branchName, branchGovernorate, branchAddress, committeeNames.length, courseTitle, courseField, previewCourse.sessionsCount, instructorId, room, days.length]);

  const next = async () => {
    if (createdJoinCode) { navigation.goBack(); return; }
    if (step < 6) { setStep(step + 1); return; }
    if (!previewBatch || !instructorId) return;
    const topics = courseTopics.split('\n').map((item) => item.trim()).filter(Boolean);
    setSaving(true);
    try {
      const result = await bootstrapOrganization({
        branch_name: branchName.trim(),
        governorate: branchGovernorate.trim(),
        address: branchAddress.trim(),
        committee_names: committeeNames,
        course_title: courseTitle.trim(),
        course_field: courseField.trim(),
        course_description: courseDescription.trim(),
        topics,
        sessions_count: previewCourse.sessionsCount,
        color: '#4F46E5',
        instructor_id: instructorId,
        capacity: previewBatch.capacity,
        schedule: previewBatch.schedule,
        start_date: new Date(previewStarts).toISOString().slice(0, 10),
        room: room.trim(),
        sessions: preview.map((session) => ({
          seq: session.seq,
          title: topics[session.seq - 1] ?? `${courseTitle.trim()} — ${session.seq}`,
          starts_at: new Date(session.startsAt).toISOString(),
          duration_min: previewBatch.schedule.durationMin,
        })),
      });
      setCreatedJoinCode(result.joinCode);
      await refresh();
      setDoneOpen(true);
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const stepIcons: Array<keyof typeof Ionicons.glyphMap> = ['business', 'git-network', 'book', 'people', 'game-controller', 'rocket'];

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingTop: insets.top + spacing.s3, paddingHorizontal: spacing.s5 }}>
        <Row between center>
          <Txt variant="h2">{t('wizard.title')} 🚀</Txt>
          <Btn title={t('common.close')} size="sm" variant="ghost" onPress={() => navigation.goBack()} />
        </Row>
        <Spacer size={10} />
        {/* شريط تقدم المعالج */}
        <Row center gap={8}>
          <Txt variant="caption" color={theme.brand}>{t('wizard.step', { x: step })}</Txt>
          <View style={{ flex: 1 }}>
            <ProgressBar progress={step / 6} />
          </View>
        </Row>
        <Spacer size={8} />
        <Row center gap={6} style={{ justifyContent: 'center' }}>
          {stepIcons.map((icon, i) => {
            const active = i + 1 <= step;
            return (
              <View key={i} style={{
                width: 34, height: 34, borderRadius: 17,
                backgroundColor: active ? theme.brand : theme.card,
                borderWidth: 1, borderColor: active ? theme.brand : theme.line,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Ionicons name={icon} size={15} color={active ? '#fff' : theme.textMuted} />
              </View>
            );
          })}
        </Row>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.s5, gap: 14, paddingBottom: 140 }}>
        <FadeIn>
          <Txt variant="h1">{t(`wizard.s${step}Title` as any)}</Txt>
          <Txt variant="body" color={theme.textSecondary}>{t(`wizard.s${step}Body` as any)}</Txt>
        </FadeIn>
        <Spacer size={8} />

        {step === 1 ? (
          <FadeIn index={1}>
            <View style={{ gap: 12 }}>
              <Input label={t('common.name')} value={branchName} onChange={setBranchName} icon="business" />
              <Input label={t('wizard.governorate')} value={branchGovernorate} onChange={setBranchGovernorate} icon="map" />
              <Input label={t('wizard.address')} value={branchAddress} onChange={setBranchAddress} icon="location" />
            </View>
          </FadeIn>
        ) : null}

        {step === 2 ? (
          <FadeIn index={1}>
            <View style={{ gap: 10 }}>
              {committeeNames.map((name) => (
                <Card key={name}>
                  <Row center gap={10}>
                    <Ionicons name="git-network" size={18} color={theme.brand} />
                    <Txt variant="bodyMed">{name}</Txt>
                    <View style={{ flex: 1 }} />
                    <Btn title={t('common.remove')} size="sm" variant="ghost" onPress={() => setCommitteeNames((items) => items.filter((item) => item !== name))} />
                  </Row>
                </Card>
              ))}
              <Row gap={8}>
                <View style={{ flex: 1 }}>
                  <Input value={newCommittee} onChange={setNewCommittee} placeholder={t('wizard.committeeName')} icon="add" />
                </View>
                <Btn title={t('wizard.addCommittee')} variant="secondary" icon="add" disabled={!newCommittee.trim() || committeeNames.includes(newCommittee.trim())}
                  onPress={() => {
                    setCommitteeNames((items) => [...items, newCommittee.trim()]);
                    setNewCommittee('');
                  }} />
              </Row>
            </View>
          </FadeIn>
        ) : null}

        {step === 3 ? (
          <FadeIn index={1}>
            <View style={{ gap: 12 }}>
              <Input label={t('wizard.courseName')} value={courseTitle} onChange={setCourseTitle} placeholder={t('wizard.courseExample')} icon="book" />
              <Row gap={10}>
                <View style={{ flex: 1 }}>
                  <Input label={t('wizard.courseField')} value={courseField} onChange={setCourseField} icon="bookmark" />
                </View>
                <View style={{ flex: 1 }}>
                  <Input label={t('wizard.sessionsCount')} value={courseSessions} onChange={setCourseSessions} keyboardType="numeric" icon="calendar" />
                </View>
              </Row>
              <Input label={t('courses.descLabel')} value={courseDescription} onChange={setCourseDescription} multiline />
              <Input label={t('courses.topicsLabel')} value={courseTopics} onChange={setCourseTopics} multiline />
            </View>
          </FadeIn>
        ) : null}

        {step === 4 ? (
          <FadeIn index={1}>
            <View style={{ gap: 12 }}>
              <Txt variant="caption" color={theme.textSecondary}>{t('common.instructor')}</Txt>
              <Row gap={8} wrap>
                {instructors.map((v) => (
                  <Card key={v.id} onPress={() => setInstructorId(v.id)} color={instructorId === v.id ? theme.brandSoft : undefined} style={{ borderColor: instructorId === v.id ? theme.brand : theme.line, padding: 10 }}>
                    <Row center gap={8}>
                      <Avatar name={v.fullName} color={v.avatarColor} size={32} />
                      <Txt variant="caption">{v.fullName}</Txt>
                      {instructorId === v.id ? <Ionicons name="checkmark-circle" size={16} color={theme.brand} /> : null}
                    </Row>
                  </Card>
                ))}
              </Row>
              <Row gap={10}>
                <View style={{ flex: 1 }}>
                  <Input label={t('common.capacity')} value={capacity} onChange={setCapacity} keyboardType="numeric" icon="people" />
                </View>
                <View style={{ flex: 1 }}>
                  <Input label={t('batchAdm.time')} value={time} onChange={setTime} icon="time" />
                </View>
              </Row>
              <Txt variant="caption" color={theme.textSecondary}>{t('batchAdm.days')}</Txt>
              <Row gap={6} wrap>
                {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                  <Chip key={d} label={t(`dayShort.${d}` as any)} active={days.includes(d)} onPress={() => setDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort())} />
                ))}
              </Row>
              <Input label={t('common.room')} value={room} onChange={setRoom} icon="location" />
              {preview.length > 0 ? (
                <Card glass>
                  <Txt variant="caption" color={theme.brand} style={{ marginBottom: 6 }}>👁️ {t('batchAdm.preview')}</Txt>
                  <Row wrap gap={6}>
                    {preview.slice(0, 12).map((p) => (
                      <Tag key={p.seq} label={`${p.seq}: ${formatDate(p.startsAt, lang)}`} color={theme.textSecondary} bg={theme.bg} />
                    ))}
                  </Row>
                </Card>
              ) : null}
            </View>
          </FadeIn>
        ) : null}

        {step === 5 ? (
          <FadeIn index={1}>
            <View style={{ gap: 10 }}>
              {RULE_DEFS.slice(0, 8).map((def) => {
                const rule = db.rules.find((r) => r.key === def.key);
                const value = rule?.value ?? def.def;
                return (
                  <Card key={def.key}>
                    <Row between center>
                      <Txt variant="body" style={{ flex: 1 }}>{t(`rules.${ruleKeyLabel(def.key)}` as any)}</Txt>
                      <Tag label={formatRuleValue(def.key, Number(value), t)} color={theme.brand} bg={theme.brandSoft} />
                    </Row>
                  </Card>
                );
              })}
              <Btn title={t('studio.title')} variant="ghost" icon="options" onPress={() => navigation.navigate('Tabs')} />
            </View>
          </FadeIn>
        ) : null}

        {step === 6 ? (
          <FadeIn index={1}>
            <View style={{ gap: 14, alignItems: 'center' }}>
              <Card style={{ alignItems: 'center', paddingVertical: 20, gap: 12, alignSelf: 'stretch' }}>
                {createdJoinCode ? (
                  <>
                    <View style={{ backgroundColor: '#fff', padding: 12, borderRadius: 16 }}>
                      <QRCode value={publicJoinUrl(createdJoinCode)} size={140} />
                    </View>
                    <Tag label={createdJoinCode} color={theme.teal} bg={theme.infoSoft} icon="link" />
                  </>
                ) : (
                  <Ionicons name="rocket" size={72} color={theme.brand} />
                )}
                <Tag label={courseTitle} color={theme.brand} bg={theme.brandSoft} icon="book" />
                {instructorId ? <Tag label={profileOf(db, instructorId)?.fullName ?? ''} color={theme.success} bg={theme.successSoft} icon="person" /> : null}
              </Card>
            </View>
          </FadeIn>
        ) : null}
      </ScrollView>

      {/* أزرار التنقل */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: spacing.s5, paddingBottom: insets.bottom + 16, backgroundColor: theme.glass, borderTopWidth: 1, borderTopColor: theme.line }}>
        <Row gap={10}>
          {step > 1 && !createdJoinCode ? <Btn title={t('common.back')} variant="ghost" onPress={() => setStep(step - 1)} /> : null}
          <View style={{ flex: 1 }}>
            <Btn
              title={createdJoinCode ? t('common.done') : step === 6 ? t('wizard.finish') : t('common.next')}
              size="lg" full icon={createdJoinCode ? 'checkmark' : step === 6 ? 'rocket' : 'arrow-back'}
              disabled={!canNext || saving}
              loading={saving}
              onPress={next}
            />
          </View>
        </Row>
      </View>

      <CelebrationModal
        visible={doneOpen}
        onClose={() => setDoneOpen(false)}
        title={t('wizard.doneTitle')}
        emoji="🚀"
      />
    </View>
  );
}

function ruleKeyLabel(key: string): string {
  switch (key) {
    case 'points.present': return 'presentPts';
    case 'points.late': return 'latePts';
    case 'attendance.late_window_min': return 'lateWindow';
    case 'certificate.min_attendance_pct': return 'certPct';
    case 'streak.freeze_max_hold': return 'freezeMax';
    case 'league.promotion_pct': return 'leagueMove';
    case 'kudos.monthly_quota_per_instructor': return 'kudosQuota';
    case 'points.month_bonus': return 'monthBonus';
    default: return 'presentPts';
  }
}

function formatRuleValue(key: string, value: number, t: any): string {
  if (key.endsWith('_pct') || key.includes('pct')) return `${value}%`;
  if (key.includes('min')) return `${value} ${t('common.minutes')}`;
  return String(value);
}
