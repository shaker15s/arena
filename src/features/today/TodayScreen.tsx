/**
 * features/today — S10 «اليوم»: مركز القيادة.
 * إجابة «إيه اللي عليّ دلوقتي؟» في 5 ثواني — Bento Grid + الستريك والنقاط والدوري.
 */
import React, { useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useApp } from '../../data/store';
import {
  attendancePct, courseOf, batchOf, getMyGamification, liveSessionForStudent,
  nearestBadge, nextSessionForUser, seatCounts, sessionsOfBatch,
} from '../../data/engine';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import {
  Avatar, Btn, Card, CountUp, FadeIn, Flame, ProgressBar, Row, Spacer, StatRing, Tag, Txt,
} from '../../design/components';
import { useTabs } from '../../app/RootNavigator';
import { spacing, radii, leagueTierColors } from '../../design/tokens';
import { formatDuration, formatTime, formatDate, sameDay } from '../../shared/format';

export function TodayScreen() {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { db, user, unreadCount, online } = useApp();
  const navigation = useNavigation<any>();
  const tabs = useTabs();

  const gam = useMemo(() => (user ? getMyGamification(db, user.id) : null), [db, user]);
  const liveSess = useMemo(() => (user ? liveSessionForStudent(db, user.id) : undefined), [db, user]);
  const nextSess = useMemo(() => (user ? nextSessionForUser(db, user.id) : undefined), [db, user]);
  const near = useMemo(() => (user ? nearestBadge(db, user.id) : null), [db, user]);
  const myEnrollmentCount = db.enrollments.filter((e) => e.userId === user?.id && e.status === 'active').length;

  if (!user) return null;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? t('today.morning') : t('today.evening');
  const firstName = user.fullName.split(' ')[0];

  const liveBatch = liveSess ? batchOf(db, liveSess.batchId) : undefined;
  const liveCourse = liveBatch ? courseOf(db, liveBatch.courseId) : undefined;
  const alreadyChecked = liveSess
    ? db.attendance.some((a) => a.sessionId === liveSess.id && a.userId === user.id && a.status !== 'absent')
    : false;
  const checkinEndsAt = liveSess ? (liveSess.startedAt ?? liveSess.startsAt) + 30 * 60_000 : 0;

  const nextBatch = nextSess ? batchOf(db, nextSess.batchId) : undefined;
  const nextCourse = nextBatch ? courseOf(db, nextBatch.courseId) : undefined;

  // أفضل باتش لعرض التقدم
  const myBatches = db.enrollments.filter((e) => e.userId === user.id && e.status === 'active');
  const primaryBatch = myBatches.length > 0 ? batchOf(db, myBatches[0].batchId) : undefined;
  const pct = primaryBatch ? attendancePct(db, user.id, primaryBatch.id) : null;
  const certRule = db.rules.find((r) => r.key === 'certificate.min_attendance_pct');
  const certPct = typeof certRule?.value === 'number' ? certRule.value : 75;
  const closedCount = primaryBatch ? sessionsOfBatch(db, primaryBatch.id).filter((s) => s.status === 'closed').length : 0;
  const totalCount = primaryBatch ? sessionsOfBatch(db, primaryBatch.id).length : 0;
  const needed = pct ? Math.max(0, Math.ceil(((certPct / 100) * Math.max(totalCount, closedCount)) - pct.honored)) : 0;

  const streakUrgent = gam != null && gam.weekStatus === 'tracking' && liveSess != null && !alreadyChecked;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {!online ? (
        <View style={{ backgroundColor: theme.warnSoft, padding: 8, marginTop: insets.top }}>
          <Txt variant="caption" color={theme.warn} align="center">{t('common.offlineBanner')}</Txt>
        </View>
      ) : null}
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.s3, paddingBottom: 110 }}>
        {/* ── الهيدر ── */}
        <FadeIn index={0}>
          <Row between center style={{ paddingHorizontal: spacing.s5, marginBottom: spacing.s4 }}>
            <Row center gap={12}>
              <Avatar name={user.fullName} color={user.avatarColor} size={48} ring={theme.brand} />
              <View>
                <Txt variant="caption" color={theme.textSecondary}>{greeting} 👋</Txt>
                <Txt variant="h3">{firstName}</Txt>
              </View>
            </Row>
            <Pressable onPress={() => navigation.navigate('Notifications')} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="notifications-outline" size={21} color={theme.text} />
              {unreadCount > 0 ? (
                <View style={{ position: 'absolute', top: 8, end: 10, width: 10, height: 10, borderRadius: 5, backgroundColor: theme.danger }} />
              ) : null}
            </Pressable>
          </Row>
        </FadeIn>

        {/* ── شريط المؤشرات الثلاثة ── */}
        {gam ? (
          <FadeIn index={1}>
            <Row gap={10} style={{ paddingHorizontal: spacing.s5, marginBottom: spacing.s4 }}>
              <Pressable onPress={() => navigation.navigate('Achievements')} style={{ flex: 1 }}>
                <Card style={{ paddingVertical: 12, alignItems: 'center', gap: 2 }}>
                  <Row center gap={5}>
                    <Flame size={18} urgent={streakUrgent} />
                    <CountUp value={gam.streak} variant="h3" />
                  </Row>
                  <Txt variant="micro" color={theme.textMuted} align="center">{t('today.streakLabel')}</Txt>
                </Card>
              </Pressable>
              <Pressable onPress={() => navigation.navigate('Wallet')} style={{ flex: 1 }}>
                <Card style={{ paddingVertical: 12, alignItems: 'center', gap: 2 }}>
                  <Row center gap={5}>
                    <Ionicons name="star" size={16} color={theme.certGold} />
                    <CountUp value={gam.points} variant="h3" />
                  </Row>
                  <Txt variant="micro" color={theme.textMuted} align="center">{t('today.pointsLabel')}</Txt>
                </Card>
              </Pressable>
              <Pressable onPress={() => navigation.navigate('League')} style={{ flex: 1 }}>
                <Card style={{ paddingVertical: 12, alignItems: 'center', gap: 2 }}>
                  <Row center gap={5}>
                    <Ionicons name="shield" size={16} color={leagueTierColors[gam.leagueTier]} />
                    <Txt variant="h3">#{gam.leagueRank || '—'}</Txt>
                  </Row>
                  <Txt variant="micro" color={theme.textMuted} align="center">{t('today.leagueLabel')} {t(`tier.${gam.leagueTier}` as any)}</Txt>
                </Card>
              </Pressable>
            </Row>
          </FadeIn>
        ) : null}

        <View style={{ paddingHorizontal: spacing.s5, gap: 14 }}>
          {/* ── بطاقة الجلسة الحية ── */}
          {liveSess && !alreadyChecked ? (
            <FadeIn index={2}>
              <Card color={theme.brand} style={{ borderColor: 'transparent', overflow: 'hidden' }}>
                <Row between center>
                  <View style={{ flex: 1, gap: 6 }}>
                    <Tag label={t('common.liveStatus')} color="#fff" bg="rgba(255,255,255,0.2)" icon="radio" />
                    <Txt variant="h3" color="#fff">{liveCourse?.title ?? ''}</Txt>
                    <Txt variant="caption" color="rgba(255,255,255,0.85)">{liveSess.title}</Txt>
                    <Txt variant="micro" color="rgba(255,255,255,0.7)">
                      {t('today.endsIn')}: {formatDuration(checkinEndsAt - Date.now(), lang)}
                    </Txt>
                    <Spacer size={4} />
                    <Btn
                      title={t('today.checkInNow')}
                      variant="gold"
                      icon="qr-code"
                      onPress={() => navigation.navigate('Scanner')}
                    />
                  </View>
                  <Ionicons name="qr-code-outline" size={84} color="rgba(255,255,255,0.25)" />
                </Row>
              </Card>
            </FadeIn>
          ) : null}

          {/* ── المحاضرة القادمة ── */}
          {nextSess && nextCourse ? (
            <FadeIn index={3}>
              <Card>
                <Row between center>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Row center gap={6}>
                      <Ionicons name="calendar" size={15} color={theme.brand} />
                      <Txt variant="caption" color={theme.brand}>{t('today.nextSession')}</Txt>
                    </Row>
                    <Txt variant="h3">{nextCourse.title}</Txt>
                    <Txt variant="caption" color={theme.textSecondary}>{nextSess.title}</Txt>
                    <Row center gap={10} wrap>
                      <Row center gap={4}>
                        <Ionicons name="time-outline" size={14} color={theme.textMuted} />
                        <Txt variant="micro" color={theme.textMuted}>
                          {sameDay(nextSess.startsAt, Date.now()) ? t('common.today') : formatDate(nextSess.startsAt, lang)} · {formatTime(nextSess.startsAt, lang)}
                        </Txt>
                      </Row>
                      <Row center gap={4}>
                        <Ionicons name="location-outline" size={14} color={theme.textMuted} />
                        <Txt variant="micro" color={theme.textMuted}>{nextBatch?.room}</Txt>
                      </Row>
                    </Row>
                  </View>
                  <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: (nextCourse.color ?? theme.brand) + '22', alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="book" size={30} color={nextCourse.color ?? theme.brand} />
                  </View>
                </Row>
                <Spacer size={8} />
                <Row center gap={6}>
                  <Ionicons name="notifications" size={13} color={theme.success} />
                  <Txt variant="micro" color={theme.success}>{t('today.reminderOn')}</Txt>
                </Row>
              </Card>
            </FadeIn>
          ) : null}

          {/* ── Bento: التقدم + الأهلية ── */}
          {pct && primaryBatch ? (
            <FadeIn index={4}>
              <Row gap={12}>
                <Card style={{ flex: 1, alignItems: 'center', gap: 8 }}>
                  <StatRing size={86} stroke={8} progress={pct.pct / 100} color={pct.pct >= certPct ? theme.success : theme.brand}>
                    <Txt variant="h3">{pct.pct}%</Txt>
                  </StatRing>
                  <Txt variant="micro" color={theme.textMuted} align="center">{t('today.attendanceRate')}</Txt>
                </Card>
                <Card style={{ flex: 1, alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                  <Ionicons name={pct.pct >= certPct ? 'checkmark-circle' : 'ribbon-outline'} size={38} color={pct.pct >= certPct ? theme.success : theme.warn} />
                  <Txt variant="caption" color={pct.pct >= certPct ? theme.success : theme.warn} align="center">
                    {pct.pct >= certPct ? t('today.eligible') : t('today.needMore', { x: needed })}
                  </Txt>
                  <Txt variant="micro" color={theme.textMuted} align="center">
                    {t('journey.sessionXofY', { x: closedCount, y: totalCount })}
                  </Txt>
                </Card>
              </Row>
            </FadeIn>
          ) : null}

          {/* ── أقرب شارة ── */}
          {near ? (
            <FadeIn index={5}>
              <Card onPress={() => navigation.navigate('Achievements')}>
                <Row center gap={12}>
                  <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: theme.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name={near.badge.icon as any} size={26} color={theme.brand} />
                  </View>
                  <View style={{ flex: 1, gap: 6 }}>
                    <Row between center>
                      <Txt variant="caption" color={theme.textMuted}>{t('today.nearestBadge')}</Txt>
                      <Txt variant="micro" color={theme.brand}>{Math.round(near.progress * 100)}%</Txt>
                    </Row>
                    <Txt variant="bodyMed">{lang === 'ar' ? near.badge.nameAr : near.badge.nameEn}</Txt>
                    <ProgressBar progress={near.progress} />
                  </View>
                </Row>
              </Card>
            </FadeIn>
          ) : null}

          {/* ── حالة فارغة: لا كورسات ── */}
          {myEnrollmentCount === 0 ? (
            <FadeIn index={2}>
              <Card style={{ alignItems: 'center', paddingVertical: spacing.s8, gap: 10 }}>
                <View style={{ width: 90, height: 90, borderRadius: 45, backgroundColor: theme.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="rocket" size={44} color={theme.brand} />
                </View>
                <Txt variant="h2" align="center">{t('today.emptyTitle')}</Txt>
                <Txt variant="body" color={theme.textSecondary} align="center">{t('today.emptyBody')}</Txt>
                <Spacer size={6} />
                <Btn title={t('today.exploreCta')} icon="compass" onPress={() => tabs.setTab('explore')} />
              </Card>
            </FadeIn>
          ) : null}

          {/* ── وصول سريع ── */}
          <FadeIn index={6}>
            <Txt variant="h3" style={{ marginTop: 4 }}>{t('today.quickActions')}</Txt>
            <Row gap={10} style={{ marginTop: 10 }}>
              <QuickAction icon="shield-half" label={t('excuses.title')} color={theme.info} onPress={() => navigation.navigate('Excuses')} />
              <QuickAction icon="ribbon" label={t('certs.title')} color={theme.certGold} onPress={() => navigation.navigate('Certificates')} />
              <QuickAction icon="wallet" label={t('wallet.title')} color={theme.success} onPress={() => navigation.navigate('Wallet')} />
              <QuickAction icon="trophy" label={t('league.title')} color={theme.warn} onPress={() => navigation.navigate('League')} />
            </Row>
          </FadeIn>
        </View>
      </ScrollView>
    </View>
  );
}

function QuickAction({ icon, label, color, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; color: string; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.9 : 1 })}>
      <Card style={{ alignItems: 'center', gap: 8, paddingVertical: 14 }}>
        <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: color + '1F', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon} size={21} color={color} />
        </View>
        <Txt variant="micro" align="center">{label}</Txt>
      </Card>
    </Pressable>
  );
}
