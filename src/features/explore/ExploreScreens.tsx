/**
 * features/explore — S11 الكتالوج + S12 تفاصيل الكورس + S13 ورقة الانضمام.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { useApp } from '../../data/store';
import {
  batchOf, courseRatingStats, profileOf, seatCounts, sessionsOfBatch,
} from '../../data/engine';
import { joinBatch as joinBatchOnServer, leaveBatch, startTrainingSession } from '../../data/actions';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import { useHaptics } from '../../shared/hooks';
import {
  Avatar, BackIcon, Btn, Card, Chip, Empty, FadeIn, Header, Input, ProgressBar, Row,
  Segmented, Sheet, Spacer, Stars, Tag, Txt, useDebounce,
} from '../../design/components';
import { AnimatedTabContent } from '../../design/AnimatedTabContent';
import { JellyButton, PillGradientSearchInput, SaveActionButton } from '../../design/interactive';
import { Course, Batch } from '../../data/types';
import { spacing, radii } from '../../design/tokens';
import { formatDate, formatTime } from '../../shared/format';
import { matchesAny } from '../../shared/search';
import { getCourseOverview } from '../../data/actions';
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

  const published = useMemo(() => db.courses.filter((c) => c.status === 'published' || c.status === 'running'), [db.courses]);
  const fields = useMemo(() => ['all', ...new Set(published.map((c) => c.field))], [published]);

  const filtered = useMemo(() => {
    return published.filter((c) => {
      if (field !== 'all' && c.field !== field) return false;
      if (branchId !== 'all') {
        const inBranch = db.batches.some((b) => b.courseId === c.id && b.branchId === branchId && (b.status === 'active' || b.status === 'scheduled'));
        if (!inBranch) return false;
      }
      if (debouncedQuery.trim()) {
        return matchesAny([c.title, c.field, c.description], debouncedQuery);
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
        contentContainerStyle={{ paddingTop: spacing.s3, paddingBottom: 110 }}
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
            <PillGradientSearchInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('explore.searchPlaceholder')}
              onClear={() => setQuery('')}
            />
          </FadeIn>
          <FadeIn index={1}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              accessibilityRole="tablist"
              contentContainerStyle={{ gap: 8 }}
            >
              {fields.map((f) => (
                <Chip key={f} label={f === 'all' ? t('common.all') : f} active={f === field} onPress={() => setField(f)} />
              ))}
            </ScrollView>
            <Spacer size={8} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              accessibilityRole="tablist"
              contentContainerStyle={{ gap: 8 }}
            >
              <Chip label={t('common.all')} active={branchId === 'all'} onPress={() => setBranchId('all')} icon="business" />
              {db.branches.map((b) => (
                <Chip key={b.id} label={b.name.replace('فرع ', '')} active={branchId === b.id} onPress={() => setBranchId(b.id)} icon="business" />
              ))}
            </ScrollView>
          </FadeIn>

          {filtered.length === 0 ? (
            <Empty
              emoji="🧭"
              title={t('explore.noResults')}
              body={t('explore.noResultsBody')}
              cta={t('explore.clearFilters')}
              onCta={() => {
                setQuery('');
                setField('all');
                setBranchId('all');
              }}
            />
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
  const { t, lang } = useI18n();
  const { theme, isDark } = useTheme();
  const { db, user } = useApp();
  const { impactLight } = useHaptics();
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
      <Card
        onPress={() => {
          impactLight();
          onPress();
        }}
        noPad
        style={{
          overflow: 'hidden',
          borderRadius: radii.xl,
          borderWidth: 1,
          borderColor: theme.glassBorder,
          backgroundColor: isDark ? 'rgba(24, 24, 32, 0.85)' : 'rgba(255, 255, 255, 0.92)',
          shadowColor: course.color,
          shadowOpacity: isDark ? 0.25 : 0.08,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 6 },
          elevation: 4,
        }}
      >
        {/* الغلاف الانسيابي الأنيق */}
        <LinearGradient
          colors={[course.color, course.color + 'D9']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            height: 76,
            paddingHorizontal: 14,
            paddingVertical: 12,
            justifyContent: 'space-between',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* أيقونة موضوعية في الخلفية كلمسة جمالية */}
          <Ionicons
            name="school"
            size={68}
            color="#FFFFFF"
            style={{
              position: 'absolute',
              end: -10,
              bottom: -16,
              opacity: 0.15,
            }}
          />

          {/* الحافة العاكسة العلوية للزجاج */}
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 1.5,
              backgroundColor: 'rgba(255, 255, 255, 0.4)',
            }}
          />

          <Row center between>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                backgroundColor: 'rgba(0, 0, 0, 0.24)',
                paddingHorizontal: 9,
                paddingVertical: 4,
                borderRadius: radii.full,
              }}
            >
              <Ionicons name="bookmark" size={11} color="#FFFFFF" />
              <Txt variant="micro" bold color="#FFFFFF">
                {course.field}
              </Txt>
            </View>

            {organizer ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  backgroundColor: 'rgba(0, 0, 0, 0.3)',
                  paddingHorizontal: 8,
                  paddingVertical: 3.5,
                  borderRadius: radii.full,
                  maxWidth: 160,
                }}
              >
                <Avatar name={organizer.fullName} color={organizer.avatarColor} size={18} />
                <Txt variant="micro" color="#FFFFFF" numberOfLines={1}>
                  {isMyCourse ? t('explore.youOrganize') : organizer.fullName.split(' ')[0]}
                </Txt>
              </View>
            ) : (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  backgroundColor: 'rgba(20, 184, 166, 0.75)',
                  paddingHorizontal: 8,
                  paddingVertical: 3.5,
                  borderRadius: radii.full,
                }}
              >
                <Ionicons name="sparkles" size={11} color="#FFFFFF" />
                <Txt variant="micro" bold color="#FFFFFF">
                  {t('explore.availableToOrganize')}
                </Txt>
              </View>
            )}
          </Row>
        </LinearGradient>

        {/* محتوى البطاقة المبسط والمنظم */}
        <View style={{ padding: 14, gap: 10 }}>
          <Row center between>
            <Txt variant="h3" numberOfLines={2} style={{ flex: 1, fontSize: 16, lineHeight: 22, fontWeight: '700' }}>
              {course.title}
            </Txt>
            <Ionicons
              name={lang === 'ar' ? 'chevron-back' : 'chevron-forward'}
              size={16}
              color={theme.textMuted}
              style={{ opacity: 0.6, marginStart: 8 }}
            />
          </Row>

          <Row center gap={10} wrap>
            <Row center gap={4}>
              <Ionicons name="calendar-outline" size={13} color={theme.textMuted} />
              <Txt variant="caption" color={theme.textSecondary}>
                {t('explore.sessionsCount', { x: course.sessionsCount })}
              </Txt>
            </Row>

            {stats.count > 0 ? (
              <Row center gap={4}>
                <Ionicons name="star" size={13} color={theme.certGold} />
                <Txt variant="caption" bold color={theme.text}>
                  {stats.avg} <Txt variant="micro" color={theme.textMuted}>({stats.count})</Txt>
                </Txt>
              </Row>
            ) : null}

            {joined ? (
              <Tag label={t('explore.joined')} color={theme.success} bg={theme.successSoft} icon="checkmark" />
            ) : seatsLeft > 0 && seatsLeft <= 6 ? (
              <Tag label={t('explore.seatsLeft', { x: seatsLeft })} color={theme.warn} bg={theme.warnSoft} icon="flash" />
            ) : seatsLeft === 0 && openBatch ? (
              <Tag label={t('common.full')} color={theme.danger} bg={theme.dangerSoft} icon="close" />
            ) : !openBatch ? (
              <Tag label={t('explore.awaitingBatch')} color={theme.teal} bg={theme.teal + '18'} icon="time-outline" />
            ) : null}
          </Row>

          {openBatch && !joined && seatsLeft > 0 && (seats?.taken ?? 0) > 0 ? (
            <View style={{ gap: 4, marginTop: 2 }}>
              <Row between center>
                <Txt variant="micro" color={theme.textMuted}>{t('common.seats')}</Txt>
                <Txt variant="micro" color={theme.textMuted}>{seats?.taken ?? 0}/{openBatch.capacity}</Txt>
              </Row>
              <ProgressBar
                progress={(seats?.taken ?? 0) / openBatch.capacity}
                color={seatsLeft <= 6 ? theme.warn : theme.brand}
                height={5}
              />
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

  React.useEffect(() => {
    if (!courseId) return;
    void getCourseOverview(courseId).catch(() => {});
  }, [courseId]);

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
      toast(user.role === 'volunteer' ? t('explore.volunteersCannotJoin') : t('explore.studentsOnly'), 'warn');
      return;
    }
    setJoinBatch(b);
  };

  const [joinedBatchData, setJoinedBatchData] = useState<null | { batch: Batch; waitlist: boolean }>(null);

  const confirmJoin = async () => {
    if (!joinBatch) return;
    if (!user) {
      navigation.navigate('SignIn');
      return;
    }
    const currentJoinBatch = joinBatch;
    setJoining(true);
    try {
      const result = await joinBatchOnServer(joinBatch.id);
      await refresh();
      setJoinBatch(null);
      setJoinedBatchData({ batch: currentJoinBatch, waitlist: result.status === 'waitlist' });
      toast(result.status === 'waitlist' ? t('joinCode.waitlist') : t('joinCode.joined'), 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setJoining(false);
    }
  };

  const [isSaved, setIsSaved] = useState(false);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 130 }}>
        {/* غلاف Hero متدرج */}
        <View style={{ backgroundColor: course.color, paddingTop: insets.top + 10, paddingBottom: 26, paddingHorizontal: spacing.s5, borderBottomLeftRadius: radii.xl, borderBottomRightRadius: radii.xl }}>
          <Row between center style={{ marginBottom: 18 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.back')}
              onPress={() => navigation.goBack()}
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' }}
            >
              <BackIcon color="#fff" />
            </Pressable>
            <SaveActionButton
              saved={isSaved}
              onToggle={(next) => {
                setIsSaved(next);
                toast(next ? 'تمت إضافة المسار للمفضلة ⭐' : 'تمت الإزالة من المفضلة', 'info');
              }}
              size={44}
            />
          </Row>
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
                      <Txt variant="bodyMed" color={theme.warn}>{t('explore.organizedNow')}</Txt>
                      <Txt variant="micro" color={theme.textSecondary}>
                        {t('explore.currentOrganizer', { name: currentOrganizer?.fullName ?? t('management.delegated') })}
                      </Txt>
                    </View>
                  </Row>
                </Card>
              ) : isMyOrganizedCourse ? (
                <Card color={theme.brandSoft} style={{ borderColor: theme.brand + '44', marginBottom: 4 }}>
                  <Row center gap={10}>
                    <Ionicons name="shield-checkmark" size={24} color={theme.brand} />
                    <View style={{ flex: 1 }}>
                      <Txt variant="bodyMed" color={theme.brand}>{t('explore.youAreOrganizer')}</Txt>
                      <Txt variant="micro" color={theme.textSecondary}>
                        {t('explore.youAreOrganizerBody')}
                      </Txt>
                    </View>
                  </Row>
                  <Spacer size={10} />
                  <Row gap={8}>
                    <View style={{ flex: 1 }}>
                      <Btn
                        title={t('explore.manageCourse')}
                        variant="primary"
                        icon="settings"
                        onPress={() => navigation.navigate('CourseManagement', { courseId: course.id })}
                        full
                      />
                    </View>
                    {activeBatch && (
                      <View style={{ flex: 1 }}>
                        <Btn
                          title={t('explore.startQr')}
                          variant="gold"
                          icon="play"
                          onPress={async () => {
                            try {
                              await startTrainingSession(activeBatch.id);
                              await refresh();
                              toast(t('explore.startLiveOk'), 'success');
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
                    title={t('explore.newBatch')}
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
                      <Txt variant="bodyMed" color={theme.brand}>{t('explore.availableToOrganize')}</Txt>
                      <Txt variant="micro" color={theme.textSecondary}>
                        {t('explore.availableBody')}
                      </Txt>
                    </View>
                  </Row>
                  <Spacer size={10} />
                  <Btn
                    title={t('explore.organizeCta')}
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

          <AnimatedTabContent tabKey={tab}>
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
          </AnimatedTabContent>
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
            <JellyButton
              title={joinBatch.capacity - seatCounts(db, joinBatch.id).taken <= 0 ? t('join.waitlistConfirm') : t('join.confirm')}
              loading={joining}
              icon="checkmark-circle"
              onPress={confirmJoin}
              variant="purple"
            />
          </View>
        ) : null}
      </Sheet>

      {/* نافذة تأكيد التسجيل التفاعلية والانتقال المباشر */}
      <Sheet visible={joinedBatchData != null} onClose={() => setJoinedBatchData(null)} title={joinedBatchData?.waitlist ? t('explore.joinedWaitlist') : t('explore.joinConfirmed')}>
        {joinedBatchData ? (
          <View style={{ gap: 14, paddingBottom: 20 }}>
            <Card color={theme.brandSoft} style={{ borderColor: theme.brand + '44', padding: 14 }}>
              <Txt variant="h2" color={theme.brand}>{course.title}</Txt>
              <Spacer size={4} />
              <Txt variant="caption" color={theme.textSecondary}>
                {t('explore.trainer', { name: profileOf(db, joinedBatchData.batch.instructorId)?.fullName ?? '' })} · {joinedBatchData.batch.room}
              </Txt>
              <Spacer size={6} />
              <Row center gap={6}>
                <Ionicons name="time" size={15} color={theme.brand} />
                <Txt variant="caption" color={theme.textSecondary}>
                  {t('explore.schedule', { days: joinedBatchData.batch.schedule.days.map((d) => t(`dayShort.${d}` as any)).join(' + '), time: joinedBatchData.batch.schedule.time })}
                </Txt>
              </Row>
              <Spacer size={4} />
              <Row center gap={6}>
                <Ionicons name="flag" size={15} color={theme.success} />
                <Txt variant="bodyMed" color={theme.success}>
                  أول محاضرة: {(() => {
                    const next = sessionsOfBatch(db, joinedBatchData.batch.id).find((s) => s.status === 'scheduled');
                    return next ? `${formatDate(next.startsAt, lang)} · ${formatTime(next.startsAt, lang)}` : t('explore.startsSoon');
                  })()}
                </Txt>
              </Row>
            </Card>

            <View style={{ gap: 8 }}>
              <Btn
                title={t('explore.goJourney')}
                variant="primary"
                size="lg"
                icon="map"
                full
                onPress={() => {
                  const bId = joinedBatchData.batch.id;
                  setJoinedBatchData(null);
                  navigation.navigate('JourneyMap', { batchId: bId });
                }}
              />
              <Btn
                title={t('explore.scanQr')}
                variant="gold"
                size="md"
                icon="qr-code"
                full
                onPress={() => {
                  setJoinedBatchData(null);
                  navigation.navigate('Scanner');
                }}
              />
              <Btn
                title={t('explore.keepExploring')}
                variant="ghost"
                size="md"
                full
                onPress={() => setJoinedBatchData(null)}
              />
            </View>
          </View>
        ) : null}
      </Sheet>

      <BatchFormSheet
        visible={createBatchOpen}
        onClose={() => setCreateBatchOpen(false)}
        initialCourseId={courseId}
      />
    </View>
  );
}

