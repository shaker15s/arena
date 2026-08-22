/**
 * features/org — S41 معالج «ابدأ مركزك»: 6 خطوات حتى أول باتش على الهواء (F7).
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { useApp } from '../../data/store';
import { courseOf, profileOf } from '../../data/engine';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import {
  Avatar, Btn, Card, Chip, FadeIn, Input, ProgressBar, Row, Tag, Txt, Spacer,
} from '../../design/components';
import { CelebrationModal } from '../../design/celebrations';
import { spacing, radii } from '../../design/tokens';
import { RULE_DEFS } from '../../data/rules';
import { uid } from '../../shared/format';
import { generateSessionsForBatch } from '../../data/engine';
import { formatDate } from '../../shared/format';

export function OrgWizardScreen({ navigation }: any) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { db, user, mutate } = useApp();
  const [step, setStep] = useState(1);
  const [doneOpen, setDoneOpen] = useState(false);

  // الخطوة 1: الفرع
  const mainBranch = db.branches[0];
  const [branchName, setBranchName] = useState(mainBranch?.name ?? '');
  const [branchAddress, setBranchAddress] = useState(mainBranch?.address ?? '');
  // الخطوة 2: اللجان
  const [newCommittee, setNewCommittee] = useState('');
  // الخطوة 3: الكورس
  const [courseTitle, setCourseTitle] = useState('');
  const [courseField, setCourseField] = useState('تصميم');
  const [courseSessions, setCourseSessions] = useState('8');
  // الخطوة 4: المجموعة
  const [instructorId, setInstructorId] = useState<string | null>(null);
  const [capacity, setCapacity] = useState('25');
  const [days, setDays] = useState<number[]>([6]);
  const [time, setTime] = useState('18:00');
  const [room, setRoom] = useState('');

  const committees = db.committees.filter((c) => c.branchId === mainBranch?.id);
  const volunteers = db.profiles.filter((p) => p.role === 'volunteer');
  const previewCourse = { sessionsCount: parseInt(courseSessions, 10) || 8 };
  const previewStarts = new Date(Date.now() + 7 * 86_400_000).getTime();
  const previewBatch = instructorId && mainBranch ? {
    id: 'wizard-preview', courseId: 'wizard-course', branchId: mainBranch.id, instructorId,
    capacity: parseInt(capacity, 10) || 25, schedule: { days, time, durationMin: 120 },
    startDate: previewStarts, room, status: 'scheduled' as const, joinCode: '',
  } : null;
  const preview = previewBatch ? generateSessionsForBatch(previewBatch, previewCourse.sessionsCount).slice(0, 12) : [];

  const canNext = useMemo(() => {
    switch (step) {
      case 1: return branchName.trim().length > 2 && branchAddress.trim().length > 3;
      case 2: return committees.length > 0;
      case 3: return courseTitle.trim().length >= 3;
      case 4: return instructorId != null && room.trim().length > 0 && days.length > 0;
      case 5: return true;
      default: return true;
    }
  }, [step, branchName, branchAddress, committees.length, courseTitle, instructorId, room, days.length]);

  const next = async () => {
    if (step < 6) { setStep(step + 1); return; }
    // الإطلاق: حفظ كل شيء في معاملة واحدة
    await mutate((d) => {
      const br = d.branches[0];
      if (br) { br.name = branchName.trim(); br.address = branchAddress.trim(); }
      const committeeId = committees[0]?.id ?? d.committees[0].id;
      const course = {
        id: uid('c'), committeeId, title: courseTitle.trim(), field: courseField,
        description: `كورس ${courseTitle.trim()} — منظّم عبر معالج البداية.`,
        topics: Array.from({ length: previewCourse.sessionsCount }).map((_, i) => `محور ${i + 1} — ${courseTitle.trim()}`),
        sessionsCount: previewCourse.sessionsCount, status: 'published' as const,
        color: '#4F46E5',
      };
      d.courses.push(course);
      if (previewBatch) {
        const batch = { ...previewBatch, id: uid('bt'), courseId: course.id, joinCode: `MSR-WZ-${Math.floor(100 + Math.random() * 900)}` };
        d.batches.push(batch);
        generateSessionsForBatch(batch, course.sessionsCount).forEach((p) => {
          d.sessions.push({
            id: uid('s'), batchId: batch.id, seq: p.seq, title: `${course.title} — محاضرة ${p.seq}`,
            startsAt: p.startsAt, durationMin: 120, status: 'scheduled' as const,
          });
        });
      }
    });
    setDoneOpen(true);
  };

  const stepIcons: Array<keyof typeof Ionicons.glyphMap> = ['business', 'git-network', 'book', 'people', 'game-controller', 'rocket'];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
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
              <Input label={t('wizard.governorate')} value={mainBranch?.governorate ?? ''} onChange={() => {}} icon="map" />
              <Input label={t('wizard.address')} value={branchAddress} onChange={setBranchAddress} icon="location" />
            </View>
          </FadeIn>
        ) : null}

        {step === 2 ? (
          <FadeIn index={1}>
            <View style={{ gap: 10 }}>
              {committees.map((c) => (
                <Card key={c.id}>
                  <Row center gap={10}>
                    <Ionicons name="git-network" size={18} color={theme.brand} />
                    <Txt variant="bodyMed">{c.name}</Txt>
                    <View style={{ flex: 1 }} />
                    <Ionicons name="checkmark-circle" size={18} color={theme.success} />
                  </Row>
                </Card>
              ))}
              <Row gap={8}>
                <View style={{ flex: 1 }}>
                  <Input value={newCommittee} onChange={setNewCommittee} placeholder={t('wizard.committeeName')} icon="add" />
                </View>
                <Btn title={t('wizard.addCommittee')} variant="secondary" icon="add" disabled={!newCommittee.trim()}
                  onPress={async () => {
                    await mutate((d) => {
                      d.committees.push({ id: uid('cm'), branchId: mainBranch.id, name: newCommittee.trim() });
                    });
                    setNewCommittee('');
                  }} />
              </Row>
            </View>
          </FadeIn>
        ) : null}

        {step === 3 ? (
          <FadeIn index={1}>
            <View style={{ gap: 12 }}>
              <Input label={t('wizard.courseName')} value={courseTitle} onChange={setCourseTitle} placeholder="مثال: أساسيات التصميم الجرافيكي" icon="book" />
              <Row gap={10}>
                <View style={{ flex: 1 }}>
                  <Input label={t('wizard.courseField')} value={courseField} onChange={setCourseField} icon="bookmark" />
                </View>
                <View style={{ flex: 1 }}>
                  <Input label={t('wizard.sessionsCount')} value={courseSessions} onChange={setCourseSessions} keyboardType="numeric" icon="calendar" />
                </View>
              </Row>
            </View>
          </FadeIn>
        ) : null}

        {step === 4 ? (
          <FadeIn index={1}>
            <View style={{ gap: 12 }}>
              <Txt variant="caption" color={theme.textSecondary}>{t('common.instructor')}</Txt>
              <Row gap={8} wrap>
                {volunteers.map((v) => (
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
                    {preview.map((p) => (
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
              <Card glass>
                <Row center gap={8}>
                  <Ionicons name="bulb" size={17} color={theme.certGold} />
                  <Txt variant="caption" color={theme.textSecondary} style={{ flex: 1 }}>{t('wizard.s5Body')}</Txt>
                </Row>
              </Card>
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
                <View style={{ backgroundColor: '#fff', padding: 12, borderRadius: 16 }}>
                  <QRCode value={`masar://join?code=MSR-WZ`} size={140} />
                </View>
                <Txt variant="caption" color={theme.textSecondary} align="center">{t('wizard.doneBody')}</Txt>
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
          {step > 1 ? <Btn title={t('common.back')} variant="ghost" onPress={() => setStep(step - 1)} /> : null}
          <View style={{ flex: 1 }}>
            <Btn
              title={step === 6 ? t('wizard.finish') : t('common.next')}
              size="lg" full icon={step === 6 ? 'rocket' : 'arrow-back'}
              disabled={!canNext}
              onPress={next}
            />
          </View>
        </Row>
      </View>

      <CelebrationModal
        visible={doneOpen}
        onClose={() => { setDoneOpen(false); navigation.goBack(); }}
        title={t('wizard.doneTitle')}
        subtitle={t('wizard.doneBody')}
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
  if (key.includes('min')) return `${value} د`;
  return String(value);
}
