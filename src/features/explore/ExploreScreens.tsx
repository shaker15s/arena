/**
 * features/explore — S11 الكتالوج + S12 تفاصيل الكورس + S13 ورقة الانضمام.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useApp } from '../../data/store';
import {
  batchOf, courseRatingStats, profileOf, seatCounts, sessionsOfBatch,
} from '../../data/engine';
import { joinBatch as joinBatchOnServer, leaveBatch, startTrainingSession } from '../../data/actions';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import {
  Avatar, BackIcon, Btn, Card, Chip, Empty, FadeIn, Header, Input, ProgressBar, Row,
  Segmented, Sheet, Spacer, Stars, Tag, Txt, useDebounce,
} from '../../design/components';
import { Course, Batch } from '../../data/types';
import { spacing, radii } from '../../design/tokens';
import { formatDate, formatTime } from '../../shared/format';
import { CelebrationModal } from '../../design/celebrations';
import { batchStudents } from '../../data/engine';
import { BatchFormSheet } from '../org/AdminScreens';

// ───────────────────────────── الكتالوج ─────────────────────────────

export function ExploreScreen({ navigation: propNav }: any) {
  const hookNav = useNavigation<any>();
  const navigation = propNav ?? hookNav;
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { db, user, online, refresh, syncing } = useApp();
  const [query, setQuery] = useState('');
  const [field, setField] = useState<string>('all');
  const [branchId, setBranchId] = useState<string>('all');

  const debouncedQuery = useDebounce(query, 250);

  const published = useMemo(() => db.courses.filter((c) => c.status === 'published'), [db.courses]);
  const fields = useMemo(() => ['all', ...new Set(published.map((c) => c.field))], [published]);

  const filtered = useMemo(() => {
    return published.filter((c) => {
      if (field !== 'all' && c.field !== field) return false;
      if (branchId !== 'all') {
        const inBranch = db.batches.some((b) => b.courseId === c.id && b.branchId === branchId && (b.status === 'active' || b.status === 'scheduled'));
        if (!inBranch) return false;
      }
      if (debouncedQuery.trim()) {
        const q = debouncedQuery.trim().toLowerCase();
        return c.title.toLowerCase().includes(q) || c.field.toLowerCase().includes(q) || c.description.toLowerCase().includes(q);
      }
      return true;
    });
  }, [published, field, branchId, debouncedQuery, db.batches]);

  return (
    <View style={{ flex: 1 }}>
      {!online ? (
        <View style={{ backgroundColor: theme.warnSoft, padding: 8, marginTop: insets.top }}>
          <Txt variant="caption" color={theme.warn} align="center">{t('common.offlineBanner')}</Txt>
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.s3, paddingBottom: 110 }}
        refreshControl={
          <RefreshControl
            refreshing={syncing}
            onRefresh={() => void refresh()}
            tintColor={theme.brand}
            colors={[theme.brand]}
          />
        }
      >
        <Header title={t('explore.title')} />
        <View style={{ paddingHorizontal: spacing.s5, gap: 12 }}>
          <FadeIn index={0}>
            <Input value={query} onChange={setQuery} placeholder={t('explore.searchPlaceholder')} icon="search" />
          </FadeIn>
          <FadeIn index={1}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {fields.map((f) => (
                <Chip key={f} label={f === 'all' ? t('common.all') : f} active={f === field} onPress={() => setField(f)} />
              ))}
            </ScrollView>
            <Spacer size={8} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              <Chip label={t('common.all')} active={branchId === 'all'} onPress={() => setBranchId('all')} icon="business" />
              {db.branches.map((b) => (
                <Chip key={b.id} label={b.name.replace('فرع ', '')} active={branchId === b.id} onPress={() => setBranchId(b.id)} icon="business" />
              ))}
            </ScrollView>
          </FadeIn>

          {filtered.length === 0 ? (
            <Empty emoji="🧭" title={t('explore.noResults')} />
          ) : (
            filtered.map((course, i) => (
              <CourseCard key={course.id} course={course} index={i} onPress={() => navigation.navigate('CourseDetails', { courseId: course.id })} />
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function CourseCard({ course, index, onPress }: { course: Course; index: number; onPress: () => void }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const { db, user } = useApp();
  const batches = db.batches.filter((b) => b.courseId === course.id && (b.status === 'active' || b.status === 'scheduled'));
  const stats = courseRatingStats(db, course.id);
  const openBatch = batches.find(b => b.capacity - seatCounts(db, b.id).taken > 0) || batches[0];
  const seats = openBatch ? seatCounts(db, openBatch.id) : null;
  const seatsLeft = openBatch ? openBatch.capacity - (seats?.taken ?? 0) : 0;
  const joined = openBatch && user ? db.enrollments.some((e) => e.userId === user.id && e.batchId === openBatch.id) : false;
  const organizer = openBatch?.instructorId ? profileOf(db, openBatch.instructorId) : null;
  const isMyCourse = Boolean(user && openBatch && openBatch.instructorId === user.id);

  return (
    <FadeIn index={index + 2}>
      <Card onPress={onPress} noPad style={{ overflow: 'hidden' }}>
        {/* الغلاف المتدرج */}
        <View style={{ height: 96, backgroundColor: course.color, justifyContent: 'flex-end', padding: 14, opacity: 0.95 }}>
          <Row center between>
            <Tag label={course.field} color="#fff" bg="rgba(255,255,255,0.22)" icon="bookmark" />
            {organizer ? (
              <Tag
                label={isMyCourse ? 'أنت المنظم 👑' : `منظم: ${organizer.fullName}`}
                color="#fff"
                bg="rgba(0,0,0,0.35)"
                icon={isMyCourse ? 'shield-checkmark' : 'person'}
              />
            ) : (
              <Tag label="✨ متاح للتنظيم" color="#fff" bg="rgba(20,184,166,0.55)" icon="sparkles" />
            )}
          </Row>
        </View>
        <View style={{ padding: 14, gap: 8 }}>
          <Txt variant="h3">{course.title}</Txt>
          <Row center gap={10} wrap>
            <Row center gap={4}>
              <Ionicons name="calendar-outline" size={13} color={theme.textMuted} />
              <Txt variant="micro" color={theme.textMuted}>{t('explore.sessionsCount', { x: course.sessionsCount })}</Txt>
            </Row>
            {stats.count > 0 ? (
              <Row center gap={4}>
                <Ionicons name="star" size={13} color={theme.certGold} />
                <Txt variant="micro" color={theme.textMuted}>{stats.avg} ({stats.count})</Txt>
              </Row>
            ) : null}
            {joined ? (
              <Tag label="منضم ✓" color={theme.success} bg={theme.successSoft} icon="checkmark" />
            ) : seatsLeft > 0 && seatsLeft <= 6 ? (
              <Tag label={t('explore.seatsLeft', { x: seatsLeft })} color={theme.warn} bg={theme.warnSoft} icon="flash" />
            ) : seatsLeft === 0 && openBatch ? (
              <Tag label={t('common.full')} color={theme.danger} bg={theme.dangerSoft} icon="close" />
            ) : !openBatch ? (
              <Tag label="بانتظار تنظيم دفعة" color={theme.teal} bg={theme.teal + '18'} icon="time-outline" />
            ) : null}
          </Row>
          {openBatch ? (
            <View style={{ gap: 5 }}>
              <Row between>
                <Txt variant="micro" color={theme.textMuted}>{batchOf(db, openBatch.id) ? t('common.seats') : ''}</Txt>
                <Txt variant="micro" color={theme.textMuted}>{seats?.taken ?? 0}/{openBatch.capacity}</Txt>
              </Row>
              <ProgressBar progress={(seats?.taken ?? 0) / openBatch.capacity} color={seatsLeft === 0 ? theme.danger : seatsLeft <= 6 ? theme.warn : theme.teal} height={6} />
            </View>
          ) : null}
        </View>
      </Card>
    </FadeIn>
  );
}

// ───────────────────────────── تفاصيل الكورس ─────────────────────────────

export function CourseDetailsScreen({ navigation: propNav, route }: any) {
  const hookNav = useNavigation<any>();
  const navigation = propNav ?? hookNav;
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { db, user, refresh, toast } = useApp();
  const courseId: string = route?.params?.courseId ?? '';
  const course = db.courses.find((c) => c.id === courseId);
  const [tab, setTab] = useState<'about' | 'batches' | 'reviews'>('about');
  const [joinBatch, setJoinBatch] = useState<Batch | null>(null);
  const [joining, setJoining] = useState(false);
  const [celebrate, setCelebrate] = useState<{ waitlist: boolean } | null>(null);
  const [createBatchOpen, setCreateBatchOpen] = useState(false);

  const batches = useMemo(
    () => db.batches.filter((b) => b.courseId === courseId && (b.status === 'active' || b.status === 'scheduled')),
    [db.batches, courseId],
  );
  const stats = courseRatingStats(db, courseId);
  const reviews = db.ratings.filter((r) => r.courseId === courseId).sort((a, b) => b.createdAt - a.createdAt);

  if (!course) return null;

  const myEnrollment = user
    ? db.enrollments.find((e) => e.userId === user.id && batches.some((b) => b.id === e.batchId))
    : undefined;

  // فحص حالة التنظيم للكورس
  const activeBatch = batches.find((b) => b.status === 'active' || b.status === 'scheduled');
  const currentOrganizer = activeBatch ? profileOf(db, activeBatch.instructorId) : null;
  const isVolunteer = user?.role === 'volunteer' || user?.role === 'admin';
  const isMyOrganizedCourse = Boolean(user && currentOrganizer && currentOrganizer.id === user.id);
  const isTakenByOtherVolunteer = Boolean(user && currentOrganizer && currentOrganizer.id !== user.id);

  const handleSelectBatch = (b: Batch) => {
    if (!user) {
      toast(t('auth.continueGoogle'), 'warn');
      navigation.navigate('SignIn');
      return;
    }
    if (user.role !== 'student') {
      toast(user.role === 'volunteer' ? 'حسابك مسجل كمدرب — الانضمام متاح لحسابات الطلاب' : 'الانضمام متاح للطلاب فقط', 'warn');
      return;
    }
    setJoinBatch(b);
  };

  const confirmJoin = async () => {
    if (!joinBatch) return;
    if (!user) {
      navigation.navigate('SignIn');
      return;
    }
    setJoining(true);
    try {
      const result = await joinBatchOnServer(joinBatch.id);
      await refresh();
      setJoinBatch(null);
      setCelebrate({ waitlist: result.status === 'waitlist' });
      toast(result.status === 'waitlist' ? t('joinCode.waitlist') : t('joinCode.joined'), 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setJoining(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 130 }}>
        {/* غلاف Hero متدرج */}
        <View style={{ backgroundColor: course.color, paddingTop: insets.top + 10, paddingBottom: 26, paddingHorizontal: spacing.s5, borderBottomLeftRadius: radii.xl, borderBottomRightRadius: radii.xl }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            onPress={() => navigation.goBack()}
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}
          >
            <BackIcon color="#fff" />
          </Pressable>
          <Tag label={course.field} color="#fff" bg="rgba(255,255,255,0.22)" icon="bookmark" />
          <Spacer size={10} />
          <Txt variant="h1" color="#fff">{course.title}</Txt>
          <Spacer size={8} />
          <Row center gap={12}>
            <Row center gap={4}>
              <Ionicons name="calendar" size={14} color="rgba(255,255,255,0.85)" />
              <Txt variant="caption" color="rgba(255,255,255,0.85)">{t('explore.sessionsCount', { x: course.sessionsCount })}</Txt>
            </Row>
            {stats.count > 0 ? (
              <Row center gap={4}>
                <Ionicons name="star" size={14} color="#FFD86B" />
                <Txt variant="caption" color="rgba(255,255,255,0.9)">{stats.avg}</Txt>
                <Txt variant="micro" color="rgba(255,255,255,0.7)">({stats.count} {t('course.ratingCount')})</Txt>
              </Row>
            ) : null}
          </Row>
        </View>

        <View style={{ padding: spacing.s5, gap: 14 }}>
          {/* بطاقة أدوات المنظم السريعة */}
          {isVolunteer ? (
            <FadeIn index={0}>
              {isTakenByOtherVolunteer ? (
                <Card color={theme.warnSoft} style={{ borderColor: theme.warn + '55', marginBottom: 4 }}>
                  <Row center gap={10}>
                    <Ionicons name="lock-closed" size={24} color={theme.warn} />
                    <View style={{ flex: 1 }}>
                      <Txt variant="bodyMed" color={theme.warn}>كورس منظم حالياً 🔒</Txt>
                      <Txt variant="micro" color={theme.textSecondary}>
                        المنظم المسؤول: {currentOrganizer?.fullName ?? 'منظم معتمد'} (لا يمكن لمنظم آخر تنظيمه في نفس الوقت)
                      </Txt>
                    </View>
                  </Row>
                </Card>
              ) : isMyOrganizedCourse ? (
                <Card color={theme.brandSoft} style={{ borderColor: theme.brand + '44', marginBottom: 4 }}>
                  <Row center gap={10}>
                    <Ionicons name="shield-checkmark" size={24} color={theme.brand} />
                    <View style={{ flex: 1 }}>
                      <Txt variant="bodyMed" color={theme.brand}>أنت المنظم المسؤول عن هذا الكورس 👑</Txt>
                      <Txt variant="micro" color={theme.textSecondary}>
                        يمكنك إدارة المحاضرات والطلاب، وتعديل التفاصيل، وبدء جلسة الحضور والـ QR الآن
                      </Txt>
                    </View>
                  </Row>
                  <Spacer size={10} />
                  <Row gap={8}>
                    <View style={{ flex: 1 }}>
                      <Btn
                        title="⚙️ لوحة إدارة الكورس"
                        variant="primary"
                        icon="settings"
                        onPress={() => navigation.navigate('CourseManagement', { courseId: course.id })}
                        full
                      />
                    </View>
                    {activeBatch && (
                      <View style={{ flex: 1 }}>
                        <Btn
                          title="🚀 بدء محاضرة وQR"
                          variant="gold"
                          icon="play"
                          onPress={async () => {
                            try {
                              await startTrainingSession(activeBatch.id);
                              await refresh();
                              toast('تم بدء المحاضرة بنجاح!', 'success');
                              navigation.navigate('Tabs', { tab: 'live' });
                            } catch (e) {
                              toast((e as Error).message, 'error');
                            }
                          }}
                          full
                        />
                      </View>
                    )}
                  </Row>
                  <Spacer size={8} />
                  <Btn
                    title="➕ إنشاء دفعة ومجموعة جديدة"
                    variant="ghost"
                    size="sm"
                    icon="add"
                    onPress={() => setCreateBatchOpen(true)}
                    full
                  />
                </Card>
              ) : (
                <Card color={theme.brandSoft} style={{ borderColor: theme.brand + '44', marginBottom: 4 }}>
                  <Row center gap={10}>
                    <Ionicons name="sparkles" size={24} color={theme.brand} />
                    <View style={{ flex: 1 }}>
                      <Txt variant="bodyMed" color={theme.brand}>الكورس متاح للتنظيم والبدء ✨</Txt>
                      <Txt variant="micro" color={theme.textSecondary}>
                        يمكنك كمتطوع تنظيم هذا الكورس وجدولة دفعة جديدة وتوليد المحاضرات فوراً
                      </Txt>
                    </View>
                  </Row>
                  <Spacer size={10} />
                  <Btn
                    title="➕ تنظيم هذا الكورس وإنشاء أول دفعة"
                    variant="primary"
                    icon="add-circle"
                    full
                    onPress={() => setCreateBatchOpen(true)}
                  />
                </Card>
              )}
            </FadeIn>
          ) : null}

          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'about', label: t('course.about'), icon: 'information-circle' },
              { value: 'batches', label: `${t('course.batches')} (${batches.length})`, icon: 'people' },
              { value: 'reviews', label: t('course.reviews'), icon: 'star' },
            ]}
          />

          {tab === 'about' ? (
            <FadeIn>
              {myEnrollment ? (
                <Card color={theme.successSoft} style={{ borderColor: theme.success + '44', marginBottom: 12 }}>
                  <Row center gap={10}>
                    <Ionicons name="checkmark-circle" size={24} color={theme.success} />
                    <View style={{ flex: 1 }}>
                      <Txt variant="bodyMed" color={theme.success}>{t('joinCode.joined')}</Txt>
                      <Txt variant="micro" color={theme.textMuted}>{batchOf(db, myEnrollment.batchId)?.room} · {batchOf(db, myEnrollment.batchId)?.schedule.time}</Txt>
                    </View>
                  </Row>
                  <Spacer size={10} />
                  <Btn title={t('course.goToJourney')} variant="secondary" icon="map" onPress={() => navigation.navigate('Tabs', { tab: 'journey' })} />
                </Card>
              ) : null}

              <Card>
                <Txt variant="body" color={theme.textSecondary}>{course.description}</Txt>
              </Card>
              <Spacer size={12} />
              <Txt variant="h3">{t('course.topics')}</Txt>
              <Spacer size={8} />
              {course.topics.map((topic, i) => (
                <FadeIn key={i} index={i}>
                  <Row center gap={10} style={{ paddingVertical: 8, borderBottomWidth: i < course.topics.length - 1 ? 1 : 0, borderBottomColor: theme.line }}>
                    <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: course.color + '22', alignItems: 'center', justifyContent: 'center' }}>
                      <Txt variant="micro" color={course.color}>{i + 1}</Txt>
                    </View>
                    <Txt variant="body" style={{ flex: 1 }}>{topic}</Txt>
                  </Row>
                </FadeIn>
              ))}

              {/* المجموعات المتاحة مباشرة داخل تبويب "عن الكورس" */}
              {!myEnrollment && batches.length > 0 ? (
                <>
                  <Spacer size={16} />
                  <Txt variant="h3">{t('course.batches')}</Txt>
                  <Spacer size={8} />
                  {batches.map((b) => {
                    const instructor = profileOf(db, b.instructorId);
                    const branch = db.branches.find((x) => x.id === b.branchId);
                    const seats = seatCounts(db, b.id);
                    const left = b.capacity - seats.taken;
                    return (
                      <Card key={b.id} style={{ marginBottom: 10 }}>
                        <Row center gap={12}>
                          {instructor ? <Avatar name={instructor.fullName} color={instructor.avatarColor} size={42} /> : null}
                          <View style={{ flex: 1 }}>
                            <Txt variant="bodyMed">{instructor?.fullName ?? ''}</Txt>
                            <Txt variant="micro" color={theme.textMuted}>
                              {b.schedule.days.map((d) => t(`dayShort.${d}` as any)).join(' + ')} · {b.schedule.time}
                            </Txt>
                            <Txt variant="micro" color={theme.textMuted}>{b.room} — {branch?.governorate}</Txt>
                          </View>
                          <Tag
                            label={left === 0 ? t('common.full') : t('explore.seatsLeft', { x: left })}
                            color={left === 0 ? theme.danger : left <= 6 ? theme.warn : theme.teal}
                            bg={left === 0 ? theme.dangerSoft : left <= 6 ? theme.warnSoft : theme.teal + '1F'}
                          />
                        </Row>
                        <Spacer size={10} />
                        <Btn
                          title={left === 0 ? t('explore.waitlist') : t('course.join')}
                          full
                          icon={left === 0 ? 'time' : 'add-circle'}
                          variant={left === 0 ? 'secondary' : 'primary'}
                          onPress={() => handleSelectBatch(b)}
                        />
                      </Card>
                    );
                  })}
                </>
              ) : null}
            </FadeIn>
          ) : null}

          {tab === 'batches' ? (
            batches.length === 0 ? (
              <Empty emoji="🗓️" title={t('course.noBatches')} />
            ) : (
              batches.map((b, i) => {
                const instructor = profileOf(db, b.instructorId);
                const branch = db.branches.find((x) => x.id === b.branchId);
                const seats = seatCounts(db, b.id);
                const left = b.capacity - seats.taken;
                const mine = user ? db.enrollments.find((e) => e.userId === user.id && e.batchId === b.id) : undefined;
                return (
                  <FadeIn key={b.id} index={i}>
                    <Card>
                      <Row center gap={12}>
                        {instructor ? <Avatar name={instructor.fullName} color={instructor.avatarColor} size={46} /> : null}
                        <View style={{ flex: 1, gap: 3 }}>
                          <Txt variant="bodyMed">{instructor?.fullName ?? ''}</Txt>
                          <Row center gap={6} wrap>
                            <Row center gap={3}>
                              <Ionicons name="repeat" size={12} color={theme.textMuted} />
                              <Txt variant="micro" color={theme.textMuted}>
                                {b.schedule.days.map((d) => t(`dayShort.${d}` as any)).join(' + ')} · {b.schedule.time}
                              </Txt>
                            </Row>
                          </Row>
                          <Row center gap={6} wrap>
                            <Row center gap={3}>
                              <Ionicons name="location" size={12} color={theme.textMuted} />
                              <Txt variant="micro" color={theme.textMuted}>{b.room} — {branch?.governorate}</Txt>
                            </Row>
                          </Row>
                        </View>
                      </Row>
                      <Spacer size={10} />
                      <Row between center>
                        <Txt variant="micro" color={left === 0 ? theme.danger : left <= 6 ? theme.warn : theme.teal}>
                          {left === 0 ? t('common.full') : t('explore.seatsLeft', { x: left })}
                        </Txt>
                        <Txt variant="micro" color={theme.textMuted}>
                          {t('journey.sessionXofY', { x: sessionsOfBatch(db, b.id).filter((s) => s.status !== 'scheduled').length, y: course.sessionsCount })}
                        </Txt>
                      </Row>
                      <Spacer size={6} />
                      <ProgressBar progress={seats.taken / b.capacity} height={6} color={left === 0 ? theme.danger : left <= 6 ? theme.warn : theme.teal} />
                      <Spacer size={12} />
                      {mine ? (
                        mine.status === 'waitlist' ? (
                          <Btn title={t('explore.onWaitlist')} variant="secondary" full disabled icon="time" />
                        ) : (
                          <>
                            <Btn title={t('course.goToJourney')} variant="secondary" full icon="map" onPress={() => navigation.navigate('Tabs', { tab: 'journey' })} />
                            <Spacer size={6} />
                            <Btn
                              title={t('course.leaveBatch')}
                              variant="ghost" full icon="exit"
                              onPress={async () => {
                                try {
                                  await leaveBatch(b.id);
                                  await refresh();
                                  toast(t('course.leavedBatch'), 'success');
                                } catch (error) {
                                  toast((error as Error).message, 'error');
                                }
                              }}
                            />
                          </>
                        )
                      ) : (
                        <Btn
                          title={left === 0 ? t('explore.waitlist') : t('course.join')}
                          full
                          icon={left === 0 ? 'time' : 'add-circle'}
                          variant={left === 0 ? 'secondary' : 'primary'}
                          onPress={() => handleSelectBatch(b)}
                        />
                      )}
                    </Card>
                  </FadeIn>
                );
              })
            )
          ) : null}

          {tab === 'reviews' ? (
            reviews.length === 0 ? (
              <Empty emoji="⭐" title={t('explore.noResults')} />
            ) : (
              reviews.map((r, i) => {
                const reviewer = profileOf(db, r.userId);
                return (
                  <FadeIn key={`${r.userId}-${i}`} index={i}>
                    <Card>
                      <Row center gap={10}>
                        {reviewer ? <Avatar name={reviewer.fullName} color={reviewer.avatarColor} size={38} /> : null}
                        <View style={{ flex: 1 }}>
                          <Txt variant="bodyMed">{reviewer?.fullName ?? ''}</Txt>
                          <Stars value={r.stars} size={13} />
                        </View>
                        <Txt variant="micro" color={theme.textMuted}>{formatDate(r.createdAt, lang)}</Txt>
                      </Row>
                      {r.comment ? <Txt variant="body" color={theme.textSecondary} style={{ marginTop: 8 }}>{r.comment}</Txt> : null}
                    </Card>
                  </FadeIn>
                );
              })
            )
          ) : null}
        </View>
      </ScrollView>

      {/* CTA سفلي ثابت */}
      {!myEnrollment && batches.length > 0 ? (
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: spacing.s4, paddingBottom: insets.bottom + 12, backgroundColor: theme.glass, borderTopWidth: 1, borderTopColor: theme.line }}>
          <Btn title={t('course.join')} size="lg" full icon="add-circle" onPress={() => handleSelectBatch(batches[0])} />
        </View>
      ) : null}

      {/* ورقة تأكيد الانضمام — S13 */}
      <Sheet visible={joinBatch != null} onClose={() => setJoinBatch(null)} title={t('join.title')}>
        {joinBatch ? (
          <View style={{ gap: 12, paddingBottom: 20 }}>
            <Card glass>
              <Txt variant="h3">{course.title}</Txt>
              <Spacer size={4} />
              <Txt variant="caption" color={theme.textSecondary}>
                {profileOf(db, joinBatch.instructorId)?.fullName} · {joinBatch.schedule.days.map((d) => t(`dayShort.${d}` as any)).join(' + ')} {joinBatch.schedule.time} · {joinBatch.room}
              </Txt>
              <Spacer size={8} />
              <Row center gap={6}>
                <Ionicons name="flag" size={14} color={theme.success} />
                <Txt variant="caption" color={theme.success}>
                  {t('join.firstSession')}: {(() => {
                    const next = sessionsOfBatch(db, joinBatch.id).find((s) => s.status === 'scheduled');
                    return next ? `${formatDate(next.startsAt, lang)} · ${formatTime(next.startsAt, lang)}` : '—';
                  })()}
                </Txt>
              </Row>
            </Card>
            <Btn
              title={joinBatch.capacity - seatCounts(db, joinBatch.id).taken <= 0 ? t('join.waitlistConfirm') : t('join.confirm')}
              size="lg" full loading={joining} icon="checkmark-circle"
              onPress={confirmJoin}
            />
          </View>
        ) : null}
      </Sheet>

      <CelebrationModal
        visible={celebrate != null}
        onClose={() => setCelebrate(null)}
        title={celebrate?.waitlist ? t('join.waitlisted') : t('join.reserved')}
        subtitle={t('course.joinedSnack')}
        emoji="🎉"
      />

      <BatchFormSheet
        visible={createBatchOpen}
        onClose={() => setCreateBatchOpen(false)}
        initialCourseId={courseId}
      />
    </View>
  );
}

