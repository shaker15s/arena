/**
 * features/explore — S11 الكتالوج + S12 تفاصيل الكورس + S13 ورقة الانضمام.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../../data/store';
import {
  batchOf, courseRatingStats, instructorBatches, profileOf, rpcJoinBatch,
  seatCounts, sessionsOfBatch,
} from '../../data/engine';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import {
  Avatar, Btn, Card, Chip, Empty, FadeIn, Header, Input, ProgressBar, Row,
  Segmented, Sheet, Spacer, Stars, Tag, Txt,
} from '../../design/components';
import { Course, Batch } from '../../data/types';
import { spacing, radii } from '../../design/tokens';
import { formatDate, formatTime } from '../../shared/format';
import { CelebrationModal } from '../../design/celebrations';
import { batchStudents } from '../../data/engine';

// ───────────────────────────── الكتالوج ─────────────────────────────

export function ExploreScreen({ navigation }: any) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { db, user, online } = useApp();
  const [query, setQuery] = useState('');
  const [field, setField] = useState<string>('all');
  const [branchId, setBranchId] = useState<string>('all');

  const published = db.courses.filter((c) => c.status === 'published');
  const fields = ['all', ...new Set(published.map((c) => c.field))];

  const filtered = published.filter((c) => {
    if (field !== 'all' && c.field !== field) return false;
    if (branchId !== 'all') {
      const inBranch = db.batches.some((b) => b.courseId === c.id && b.branchId === branchId && (b.status === 'active' || b.status === 'scheduled'));
      if (!inBranch) return false;
    }
    if (query.trim()) {
      const q = query.trim();
      return c.title.includes(q) || c.field.includes(q) || c.description.includes(q);
    }
    return true;
  });

  return (
    <View style={{ flex: 1 }}>
      {!online ? (
        <View style={{ backgroundColor: theme.warnSoft, padding: 8, marginTop: insets.top }}>
          <Txt variant="caption" color={theme.warn} align="center">{t('common.offlineBanner')}</Txt>
        </View>
      ) : null}
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.s3, paddingBottom: 110 }}>
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
  const openBatch = batches[0];
  const seats = openBatch ? seatCounts(db, openBatch.id) : null;
  const seatsLeft = openBatch ? openBatch.capacity - (seats?.taken ?? 0) : 0;
  const joined = openBatch && user ? db.enrollments.some((e) => e.userId === user.id && e.batchId === openBatch.id) : false;

  return (
    <FadeIn index={index + 2}>
      <Card onPress={onPress} noPad style={{ overflow: 'hidden' }}>
        {/* الغلاف المتدرج */}
        <View style={{ height: 96, backgroundColor: course.color, justifyContent: 'flex-end', padding: 14, opacity: 0.95 }}>
          <Tag label={course.field} color="#fff" bg="rgba(255,255,255,0.22)" icon="bookmark" />
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
              <Tag label={t('journey.courseComplete') === 'كورس مكتمل 🏆' ? 'منضم ✓' : 'Joined ✓'} color={theme.success} bg={theme.successSoft} icon="checkmark" />
            ) : seatsLeft > 0 && seatsLeft <= 6 ? (
              <Tag label={t('explore.seatsLeft', { x: seatsLeft })} color={theme.warn} bg={theme.warnSoft} icon="flash" />
            ) : seatsLeft === 0 ? (
              <Tag label={t('common.full')} color={theme.danger} bg={theme.dangerSoft} icon="close" />
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

export function CourseDetailsScreen({ navigation, route }: any) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { db, user, mutate, toast } = useApp();
  const courseId: string = route.params.courseId;
  const course = db.courses.find((c) => c.id === courseId);
  const [tab, setTab] = useState<'about' | 'batches' | 'reviews'>('about');
  const [joinBatch, setJoinBatch] = useState<Batch | null>(null);
  const [joining, setJoining] = useState(false);
  const [celebrate, setCelebrate] = useState<{ waitlist: boolean } | null>(null);

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

  const confirmJoin = async () => {
    if (!joinBatch || !user) return;
    setJoining(true);
    const r = await mutate((d) => rpcJoinBatch(d, user.id, joinBatch.id));
    setJoining(false);
    setJoinBatch(null);
    setCelebrate({ waitlist: r.status === 'waitlist' });
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 130 }}>
        {/* غلاف Hero متدرج */}
        <View style={{ backgroundColor: course.color, paddingTop: insets.top + 10, paddingBottom: 26, paddingHorizontal: spacing.s5, borderBottomLeftRadius: radii.xl, borderBottomRightRadius: radii.xl }}>
          <Pressable onPress={() => navigation.goBack()} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
            <Ionicons name="chevron-forward" size={22} color="#fff" />
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
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'about', label: t('course.about'), icon: 'information-circle' },
              { value: 'batches', label: t('course.batches'), icon: 'people' },
              { value: 'reviews', label: t('course.reviews'), icon: 'star' },
            ]}
          />

          {tab === 'about' ? (
            <FadeIn>
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
                          <Btn title={t('course.goToJourney')} variant="secondary" full icon="map" onPress={() => navigation.navigate('Tabs', { screen: 'journey' })} />
                        )
                      ) : (
                        <Btn
                          title={left === 0 ? t('explore.waitlist') : t('course.join')}
                          full
                          icon={left === 0 ? 'time' : 'add-circle'}
                          variant={left === 0 ? 'secondary' : 'primary'}
                          onPress={() => setJoinBatch(b)}
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
          <Btn title={t('course.join')} size="lg" full icon="add-circle" onPress={() => setJoinBatch(batches[0])} />
        </View>
      ) : null}

      {/* ورقة تأكيد الانضمام — S13 */}
      <Sheet visible={joinBatch != null} onClose={() => setJoinBatch(null)} title={t('join.title')}>
        {joinBatch ? (
          <View style={{ gap: 12 }}>
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
    </View>
  );
}
