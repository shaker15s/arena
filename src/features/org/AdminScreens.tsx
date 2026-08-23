/**
 * features/org — S40 لوحة التحكم + S42 التنظيم + S43 الكورسات +
 * S44 فورم المجموعات (أهم فورم: معاينة تلقائية + تحذير تعارض) + S47 المستخدمون.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../../data/store';
import {
  attendancePct, batchOf, batchStudents, checkInstructorConflict, courseOf,
  dashboardStats, generateSessionsForBatch, profileOf, seatCounts, sessionsOfBatch,
} from '../../data/engine';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import {
  Avatar, Btn, Card, Chip, CountUp, Empty, FadeIn, Header, Input, ListRow,
  ProgressBar, Row, Sheet, Spacer, Tag, Txt, useDebounce,
} from '../../design/components';
import { useTabs } from '../../app/RootNavigator';
import { spacing, radii } from '../../design/tokens';
import { formatDate, uid } from '../../shared/format';
import { Batch, Course } from '../../data/types';

// ───────────────────────────── S40 لوحة التحكم ─────────────────────────────

export function DashboardScreen({ navigation }: any) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { db, user, refresh, syncing } = useApp();
  const [branchFilter, setBranchFilter] = useState<string>('all');
  if (!user) return null;

  const stats = dashboardStats(db, branchFilter === 'all' ? undefined : branchFilter);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.s3, padding: spacing.s5, gap: 14, paddingBottom: 130 }}
        refreshControl={
          <RefreshControl
            refreshing={syncing}
            onRefresh={() => void refresh()}
            tintColor={theme.brand}
            colors={[theme.brand]}
          />
        }
      >
        <Header title={t('dash.title')} subtitle={`${t('dash.hello')} ${user.fullName} 👋`} />

        {/* فلتر الفروع */}
        <Row gap={8} wrap>
          <Chip label={t('dash.allBranches')} active={branchFilter === 'all'} onPress={() => setBranchFilter('all')} />
          {db.branches.map((b) => (
            <Chip key={b.id} label={b.name.replace('فرع ', '')} active={branchFilter === b.id} onPress={() => setBranchFilter(b.id)} />
          ))}
        </Row>

        {/* KPI Bento */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          <KpiCard icon="business" color={theme.brand} value={stats.branchesCount} label={t('dash.branches')} index={0} />
          <KpiCard icon="people" color={theme.success} value={stats.activeBatches} label={t('dash.activeBatches')} index={1} />
          <KpiCard icon="school" color={theme.warn} value={stats.students} label={t('dash.activeStudents')} index={2} />
          <KpiCard icon="pulse" color={theme.teal} value={stats.avgAttendance} suffix="%" label={t('dash.avgAttendance')} index={3} />
          <KpiCard icon="ribbon" color={theme.certGold} value={stats.certsMonth} label={t('dash.certsMonth')} index={4} />
        </View>

        {/* اتجاه الحضور */}
        <FadeIn index={5}>
          <Card>
            <Row between center style={{ marginBottom: 12 }}>
              <Txt variant="h3">{t('dash.trend')}</Txt>
              <Tag label="6" color={theme.brand} bg={theme.brandSoft} icon="calendar" />
            </Row>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 110 }}>
              {stats.trend.map((v, i) => (
                <View key={i} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                  <Txt variant="micro" color={theme.textMuted}>{v}%</Txt>
                  <View style={{
                    width: '100%', borderRadius: 6,
                    height: Math.max(6, (v / 100) * 80),
                    backgroundColor: v >= 75 ? theme.success : v >= 50 ? theme.brand : theme.warn,
                    opacity: 0.4 + (i / Math.max(stats.trend.length - 1, 1)) * 0.6,
                  }} />
                </View>
              ))}
            </View>
          </Card>
        </FadeIn>

        {/* إجراءات سريعة */}
        <FadeIn index={6}>
          <Txt variant="h3">{t('today.quickActions')}</Txt>
          <Spacer size={8} />
          <ListRow icon="rocket" title={t('dash.openWizard')} onPress={() => navigation.navigate('Wizard')} />
          <Spacer size={8} />
          <Row gap={8}>
            <View style={{ flex: 1 }}>
              <ListRow icon="ribbon" title={t('dash.issueCerts')} onPress={() => navigation.navigate('IssueCertificates')} />
            </View>
            <View style={{ flex: 1 }}>
              <ListRow icon="albums" title={t('courses.title')} onPress={() => navigation.navigate('Courses')} />
            </View>
          </Row>
          <Spacer size={8} />
          <ListRow icon="albums" title={t('batchAdm.title')} subtitle={t('batchAdm.new')} onPress={() => navigation.navigate('BatchesAdmin')} />
        </FadeIn>
      </ScrollView>
    </View>
  );
}

function KpiCard({ icon, color, value, suffix, label, index }: { icon: keyof typeof Ionicons.glyphMap; color: string; value: number; suffix?: string; label: string; index: number }) {
  const { theme } = useTheme();
  return (
    <FadeIn index={index} style={{ flexGrow: 1, minWidth: 150, flexBasis: '30%' }}>
      <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 18 }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: color + '1F', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon} size={22} color={color} />
        </View>
        <Row center gap={2}>
          <CountUp value={value} variant="numberHero" />
          {suffix ? <Txt variant="h3" color={color}>{suffix}</Txt> : null}
        </Row>
        <Txt variant="micro" align="center">{label}</Txt>
      </Card>
    </FadeIn>
  );
}

// ───────────────────────────── S42 التنظيم ─────────────────────────────

export function OrgManagerScreen() {
  const { t } = useI18n();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { db, mutate, toast, user } = useApp();
  const [branchSheet, setBranchSheet] = useState(false);
  const [committeeSheet, setCommitteeSheet] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [gov, setGov] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);

  const saveBranch = async () => {
    if (!name.trim() || !gov.trim()) return;
    setSaving(true);
    await mutate((d) => {
      d.branches.push({ id: uid('b'), name: name.trim(), governorate: gov.trim(), address: address.trim(), supervisorId: null });
    });
    setSaving(false);
    setBranchSheet(false);
    setName(''); setGov(''); setAddress('');
    toast(t('common.done') + ' ✓', 'success');
  };

  const saveCommittee = async () => {
    if (!name.trim() || !committeeSheet) return;
    setSaving(true);
    await mutate((d) => {
      d.committees.push({ id: uid('cm'), branchId: committeeSheet, name: name.trim() });
    });
    setSaving(false);
    setCommitteeSheet(null);
    setName('');
    toast(t('common.done') + ' ✓', 'success');
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.s3, padding: spacing.s5, gap: 14, paddingBottom: 130 }}>
        <Header title={t('org.branches')} right={<Btn title={t('org.newBranch')} size="sm" icon="add" onPress={() => setBranchSheet(true)} />} />
        {db.branches.map((b, i) => {
          const committees = db.committees.filter((c) => c.branchId === b.id);
          const activeBatches = db.batches.filter((x) => x.branchId === b.id && x.status === 'active').length;
          const courses = db.courses.filter((c) => committees.some((cm) => cm.id === c.committeeId));
          const supervisor = b.supervisorId ? profileOf(db, b.supervisorId) : null;
          return (
            <FadeIn key={b.id} index={i}>
              <Card>
                <Row center gap={12}>
                  <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: theme.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="business" size={26} color={theme.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt variant="h3">{b.name}</Txt>
                    <Txt variant="caption" color={theme.textSecondary}>{b.governorate} · {b.address}</Txt>
                    <Row center gap={6} style={{ marginTop: 4 }}>
                      <Ionicons name="person-circle" size={13} color={theme.textMuted} />
                      <Txt variant="micro" color={theme.textMuted}>{supervisor ? supervisor.fullName : t('org.pickSupervisor')}</Txt>
                    </Row>
                  </View>
                  <Tag label={`${activeBatches} ${t('org.activeBatches')}`} color={theme.success} bg={theme.successSoft} icon="pulse" />
                </Row>
                <Spacer size={10} />
                <Txt variant="caption" color={theme.textMuted}>{t('org.committees')}:</Txt>
                <Spacer size={6} />
                <Row gap={6} wrap>
                  {committees.map((c) => (
                    <Tag key={c.id} label={c.name} color={theme.brand} bg={theme.brandSoft} icon="git-network" />
                  ))}
                  <Btn title={t('org.newCommittee')} size="sm" variant="ghost" icon="add" onPress={() => { setCommitteeSheet(b.id); setName(''); }} />
                </Row>
              </Card>
            </FadeIn>
          );
        })}
      </ScrollView>

      <Sheet visible={branchSheet} onClose={() => setBranchSheet(false)} title={t('org.newBranch')}>
        <View style={{ gap: 12 }}>
          <Input label={t('common.name')} value={name} onChange={setName} icon="business" />
          <Input label={t('org.governorate')} value={gov} onChange={setGov} icon="map" />
          <Input label={t('org.address')} value={address} onChange={setAddress} icon="location" />
          <Btn title={t('common.save')} full loading={saving} onPress={saveBranch} icon="checkmark" disabled={!name.trim() || !gov.trim()} />
        </View>
      </Sheet>

      <Sheet visible={committeeSheet != null} onClose={() => setCommitteeSheet(null)} title={t('org.newCommittee')}>
        <View style={{ gap: 12 }}>
          <Input label={t('wizard.committeeName')} value={name} onChange={setName} icon="git-network" />
          <Btn title={t('wizard.addCommittee')} full loading={saving} onPress={saveCommittee} icon="checkmark" disabled={!name.trim()} />
        </View>
      </Sheet>
    </View>
  );
}

// ───────────────────────────── S43 الكورسات ─────────────────────────────

export function CoursesScreen({ navigation }: any) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const { db, mutate, toast } = useApp();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [field, setField] = useState('تصميم');
  const [desc, setDesc] = useState('');
  const [sessionsCount, setSessionsCount] = useState('8');
  const [topics, setTopics] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (title.trim().length < 3) return;
    setSaving(true);
    await mutate((d) => {
      const committeeId = d.committees[0]?.id ?? 'cm_train';
      d.courses.push({
        id: uid('c'), committeeId, title: title.trim(), field: field.trim() || 'عام',
        description: desc.trim(), topics: topics.split('\n').map((x) => x.trim()).filter(Boolean),
        sessionsCount: Math.max(1, parseInt(sessionsCount, 10) || 8), status: 'published',
        color: ['#8B5CF6', '#14B8A6', '#F59E0B', '#EF4444', '#3B82F6', '#EC4899'][d.courses.length % 6],
      });
    });
    setSaving(false);
    setCreating(false);
    setTitle(''); setDesc(''); setTopics('');
    toast(t('common.done') + ' ✓', 'success');
  };

  return (
    <View style={{ flex: 1 }}>
      <Header title={t('courses.title')} back={() => navigation.goBack()} right={<Btn title={t('courses.new')} size="sm" icon="add" onPress={() => setCreating(true)} />} />
      <ScrollView contentContainerStyle={{ padding: spacing.s5, gap: 12 }}>
        {db.courses.map((c, i) => {
          const batches = db.batches.filter((b) => b.courseId === c.id);
          const active = batches.filter((b) => b.status === 'active').length;
          return (
            <FadeIn key={c.id} index={i}>
              <Card>
                <Row center gap={12}>
                  <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: c.color, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="book" size={22} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt variant="bodyMed">{c.title}</Txt>
                    <Txt variant="micro" color={theme.textMuted}>{c.field} · {t('explore.sessionsCount', { x: c.sessionsCount })} · {active} {t('org.activeBatches')}</Txt>
                  </View>
                  <Tag
                    label={t(`common.${c.status}` as any)}
                    color={c.status === 'published' ? theme.success : c.status === 'draft' ? theme.warn : theme.textMuted}
                    bg={c.status === 'published' ? theme.successSoft : c.status === 'draft' ? theme.warnSoft : theme.bg}
                  />
                </Row>
              </Card>
            </FadeIn>
          );
        })}
      </ScrollView>

      <Sheet visible={creating} onClose={() => setCreating(false)} title={t('courses.new')}>
        <ScrollView>
          <View style={{ gap: 12 }}>
            <Input label={t('courses.titleLabel')} value={title} onChange={setTitle} icon="book" />
            <Input label={t('courses.fieldLabel')} value={field} onChange={setField} icon="bookmark" />
            <Input label={t('courses.descLabel')} value={desc} onChange={setDesc} multiline />
            <Row gap={10}>
              <View style={{ flex: 1 }}>
                <Input label={t('courses.sessionsLabel')} value={sessionsCount} onChange={setSessionsCount} keyboardType="numeric" icon="calendar" />
              </View>
            </Row>
            <Input label={t('courses.topicsLabel')} value={topics} onChange={setTopics} multiline />
            <Btn title={t('courses.save')} full size="lg" loading={saving} onPress={save} icon="checkmark" disabled={title.trim().length < 3} />
          </View>
        </ScrollView>
      </Sheet>
    </View>
  );
}

// ───────────────────────────── S44 المجموعات (أهم فورم) ─────────────────────────────

export function BatchesAdminScreen({ navigation }: any) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const { db, mutate, toast } = useApp();
  const [creating, setCreating] = useState(false);

  return (
    <View style={{ flex: 1 }}>
      <Header title={t('batchAdm.title')} back={() => navigation.goBack()} right={<Btn title={t('batchAdm.new')} size="sm" icon="add" onPress={() => setCreating(true)} />} />
      <ScrollView contentContainerStyle={{ padding: spacing.s5, gap: 12 }}>
        {db.batches.map((b, i) => {
          const course = courseOf(db, b.courseId)!;
          const instructor = profileOf(db, b.instructorId);
          const seats = seatCounts(db, b.id);
          const statusMeta = b.status === 'active' ? { label: t('common.active'), color: theme.success, bg: theme.successSoft }
            : b.status === 'completed' ? { label: t('common.closedStatus'), color: theme.brand, bg: theme.brandSoft }
            : b.status === 'scheduled' ? { label: t('common.scheduledStatus'), color: theme.warn, bg: theme.warnSoft }
            : { label: t('common.archived'), color: theme.textMuted, bg: theme.bg };
          return (
            <FadeIn key={b.id} index={i}>
              <Card>
                <Row center gap={12}>
                  <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: course.color + '22', alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="people" size={22} color={course.color} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt variant="bodyMed">{course.title}</Txt>
                    <Txt variant="micro" color={theme.textMuted}>{instructor?.fullName} · {b.room}</Txt>
                    <Txt variant="micro" color={theme.textMuted}>{b.schedule.days.map((d) => t(`dayShort.${d}` as any)).join(' + ')} {b.schedule.time}</Txt>
                  </View>
                  <Tag label={statusMeta.label} color={statusMeta.color} bg={statusMeta.bg} />
                </Row>
                <Spacer size={10} />
                <Row between>
                  <Txt variant="micro" color={theme.textMuted}>{t('batchAdm.occupancy')}</Txt>
                  <Txt variant="micro" color={theme.textMuted}>{seats.taken}/{b.capacity}{seats.waitlist > 0 ? ` · ⏳${seats.waitlist}` : ''}</Txt>
                </Row>
                <Spacer size={5} />
                <ProgressBar progress={seats.taken / b.capacity} height={6} color={course.color} />
                <Spacer size={8} />
                <Row center gap={6}>
                  <Ionicons name="link" size={12} color={theme.teal} />
                  <Txt variant="micro" color={theme.teal}>{t('batchAdm.joinCode')}: {b.joinCode}</Txt>
                </Row>
              </Card>
            </FadeIn>
          );
        })}
      </ScrollView>
      <BatchFormSheet visible={creating} onClose={() => setCreating(false)} />
    </View>
  );
}

function BatchFormSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const { db, mutate, toast } = useApp();
  const [courseId, setCourseId] = useState<string | null>(null);
  const [instructorId, setInstructorId] = useState<string | null>(null);
  const [capacity, setCapacity] = useState('25');
  const [days, setDays] = useState<number[]>([6]);
  const [time, setTime] = useState('18:00');
  const [startDate, setStartDate] = useState(new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
  const [room, setRoom] = useState('');
  const [saving, setSaving] = useState(false);

  const publishedCourses = db.courses.filter((c) => c.status === 'published');
  const volunteers = db.profiles.filter((p) => p.role === 'volunteer');
  const course = courseId ? courseOf(db, courseId) : null;

  const toggleDay = (d: number) => {
    setDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort());
  };

  // معاينة مولّدة تلقائيًا + تحذير تعارض
  const draftBatch: Batch | null = course && instructorId && days.length > 0 ? {
    id: 'preview', courseId: course.id, branchId: db.branches[0].id, instructorId,
    capacity: parseInt(capacity, 10) || 25,
    schedule: { days, time, durationMin: 120 },
    startDate: new Date(startDate).getTime(),
    room, status: 'scheduled', joinCode: '',
  } : null;
  const preview = course && draftBatch ? generateSessionsForBatch(draftBatch, course.sessionsCount) : [];
  const conflict = instructorId && days.length > 0 ? checkInstructorConflict(db, instructorId, days, time) : null;

  const publish = async () => {
    if (!course || !instructorId || !draftBatch) return;
    setSaving(true);
    await mutate((d) => {
      const batch: Batch = { ...draftBatch, id: uid('bt'), joinCode: `MSR-${String(Math.floor(1000 + Math.random() * 9000))}` };
      d.batches.push(batch);
      preview.forEach((p) => {
        d.sessions.push({
          id: uid('s'), batchId: batch.id, seq: p.seq, title: course.topics[p.seq - 1] ?? `محاضرة ${p.seq}`,
          startsAt: p.startsAt, durationMin: draftBatch.schedule.durationMin, status: 'scheduled',
        });
      });
    });
    setSaving(false);
    onClose();
    toast(t('batchAdm.published'), 'success');
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t('batchAdm.new')}>
      <ScrollView>
        <View style={{ gap: 12 }}>
          <Txt variant="caption" color={theme.textSecondary}>{t('batchAdm.pickCourse')}</Txt>
          <Row gap={6} wrap>
            {publishedCourses.map((c) => (
              <Chip key={c.id} label={c.title} active={courseId === c.id} onPress={() => setCourseId(c.id)} />
            ))}
          </Row>

          <Txt variant="caption" color={theme.textSecondary}>{t('batchAdm.pickInstructor')}</Txt>
          <Row gap={6} wrap>
            {volunteers.map((v) => (
              <Chip key={v.id} label={v.fullName} active={instructorId === v.id} onPress={() => setInstructorId(v.id)} />
            ))}
          </Row>

          <Txt variant="caption" color={theme.textSecondary}>{t('batchAdm.days')}</Txt>
          <Row gap={6} wrap>
            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
              <Chip key={d} label={t(`dayShort.${d}` as any)} active={days.includes(d)} onPress={() => toggleDay(d)} />
            ))}
          </Row>

          <Row gap={10}>
            <View style={{ flex: 1 }}>
              <Input label={t('batchAdm.capacity')} value={capacity} onChange={setCapacity} keyboardType="numeric" icon="people" />
            </View>
            <View style={{ flex: 1 }}>
              <Input label={t('batchAdm.time')} value={time} onChange={setTime} icon="time" />
            </View>
          </Row>
          <Input label={t('batchAdm.startDate')} value={startDate} onChange={setStartDate} icon="calendar" />
          <Input label={t('batchAdm.room')} value={room} onChange={setRoom} icon="location" />

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

          <Btn title={t('batchAdm.publish')} size="lg" full loading={saving} onPress={publish} icon="rocket" disabled={!course || !instructorId || days.length === 0 || !room.trim()} />
        </View>
      </ScrollView>
    </Sheet>
  );
}

// ───────────────────────────── S47 المستخدمون ─────────────────────────────

export function UsersScreen() {
  const { t } = useI18n();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { db, mutate, toast, user, refresh, syncing } = useApp();
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [selected, setSelected] = useState<string | null>(null);

  const debouncedQuery = useDebounce(query, 250);

  const roles = ['all', 'student', 'volunteer', 'supervisor', 'admin'];
  const roleLabel: Record<string, string> = {
    student: t('common.student'), volunteer: t('common.volunteer'), supervisor: t('common.supervisor'), admin: t('common.admin'),
  };

  const list = useMemo(() => {
    return db.profiles.filter((p) => {
      if (roleFilter !== 'all' && p.role !== roleFilter) return false;
      if (debouncedQuery.trim()) {
        const q = debouncedQuery.trim().toLowerCase();
        return p.fullName.toLowerCase().includes(q) || p.phone.includes(q);
      }
      return true;
    });
  }, [db.profiles, roleFilter, debouncedQuery]);

  const selUser = selected ? profileOf(db, selected) : null;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.s3, padding: spacing.s5, gap: 12, paddingBottom: 130 }}
        refreshControl={
          <RefreshControl
            refreshing={syncing}
            onRefresh={() => void refresh()}
            tintColor={theme.brand}
            colors={[theme.brand]}
          />
        }
      >
        <Header title={t('users.title')} />
        <Input value={query} onChange={setQuery} placeholder={t('users.searchPlaceholder')} icon="search" />
        <Row gap={6} wrap>
          {roles.map((r) => (
            <Chip key={r} label={r === 'all' ? t('common.all') : roleLabel[r]} active={roleFilter === r} onPress={() => setRoleFilter(r)} />
          ))}
        </Row>
        {list.map((p, i) => (
          <FadeIn key={p.id} index={Math.min(i, 8)}>
            <Card onPress={() => setSelected(p.id)}>
              <Row center gap={10}>
                <Avatar name={p.fullName} color={p.avatarColor} size={40} />
                <View style={{ flex: 1 }}>
                  <Txt variant="bodyMed">{p.fullName}</Txt>
                  <Txt variant="micro" color={theme.textMuted}>{p.phone}</Txt>
                </View>
                <Tag label={roleLabel[p.role]} color={p.status === 'active' ? theme.brand : theme.danger} bg={p.status === 'active' ? theme.brandSoft : theme.dangerSoft} />
              </Row>
            </Card>
          </FadeIn>
        ))}
      </ScrollView>

      {/* S48 تفاصيل المستخدم */}
      <Sheet visible={selUser != null} onClose={() => setSelected(null)} title={selUser?.fullName ?? ''}>
        {selUser && user ? (
          <ScrollView>
            <View style={{ gap: 12 }}>
              <Row center gap={12}>
                <Avatar name={selUser.fullName} color={selUser.avatarColor} size={56} />
                <View>
                  <Txt variant="h3">{selUser.fullName}</Txt>
                  <Txt variant="caption" color={theme.textSecondary}>{selUser.phone} · {roleLabel[selUser.role]}</Txt>
                  <Txt variant="micro" color={theme.textMuted}>{db.branches.find((b) => b.id === selUser.branchId)?.name ?? '—'}</Txt>
                </View>
              </Row>

              <Txt variant="caption" color={theme.textSecondary}>{t('users.changeRole')}</Txt>
              <Row gap={6} wrap>
                {(['student', 'volunteer'] as const).map((r) => (
                  <Btn key={r} title={roleLabel[r]} size="sm" variant={selUser.role === r ? 'primary' : 'ghost'}
                    onPress={async () => {
                      await mutate((d) => {
                        const p = d.profiles.find((x) => x.id === selUser.id);
                        if (p) p.role = r;
                      });
                      toast(t('users.roleChanged'), 'success');
                    }} />
                ))}
                {(user.role === 'admin') ? (
                  <Btn title={t('common.supervisor')} size="sm" variant={selUser.role === 'supervisor' || selUser.role === 'admin' ? 'primary' : 'ghost'}
                    onPress={async () => {
                      await mutate((d) => {
                        const p = d.profiles.find((x) => x.id === selUser.id);
                        if (p) p.role = p.role === 'supervisor' ? 'admin' : 'supervisor';
                      });
                      toast(t('users.roleChanged'), 'success');
                    }} />
                ) : null}
              </Row>

              <Row gap={8}>
                <Btn
                  title={selUser.status === 'active' ? t('users.deactivate') : t('users.activate')}
                  variant={selUser.status === 'active' ? 'danger' : 'success'}
                  icon={selUser.status === 'active' ? 'pause-circle' : 'play-circle'}
                  onPress={async () => {
                    await mutate((d) => {
                      const p = d.profiles.find((x) => x.id === selUser.id);
                      if (p) p.status = p.status === 'active' ? 'disabled' : 'active';
                    });
                    toast(t('users.statusChanged'), 'success');
                  }}
                />
              </Row>

              <Card glass>
                <Row center gap={8}>
                  <Ionicons name="information-circle" size={15} color={theme.textMuted} />
                  <Txt variant="caption" color={theme.textSecondary} style={{ flex: 1 }}>
                    {t('users.sessionsAttended')}: {db.attendance.filter((a) => a.userId === selUser.id && a.status !== 'absent').length}
                  </Txt>
                </Row>
              </Card>
            </View>
          </ScrollView>
        ) : null}
      </Sheet>
    </View>
  );
}
