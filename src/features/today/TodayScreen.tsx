/**
 * features/today — S10 «اليوم»: مركز القيادة.
 * تصميم Apple Liquid Glass — Bento Grid + الستريك والنقاط والدوري.
 */
import React, { useMemo, useState, useRef } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
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
import { StatBubble } from '../../design/glass';
import { useTabs } from '../../app/RootNavigator';
import { spacing, radii, leagueTierColors } from '../../design/tokens';
import { formatDuration, formatTime, formatDate, sameDay } from '../../shared/format';
import { useNow } from '../../shared/hooks';

export function TodayScreen() {
  const { t, lang } = useI18n();
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { db, user, unreadCount, online, refresh, syncing } = useApp();
  const navigation = useNavigation<any>();
  const tabs = useTabs();

  const [flameTaps, setFlameTaps] = useState(0);
  const [showEasterEgg, setShowEasterEgg] = useState(false);
  const flameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFlameTap = () => {
    if (flameTimer.current) clearTimeout(flameTimer.current);
    setFlameTaps(prev => {
      const next = prev + 1;
      if (next >= 7) {
        setShowEasterEgg(true);
        setTimeout(() => setShowEasterEgg(false), 3000);
        return 0;
      }
      return next;
    });
    flameTimer.current = setTimeout(() => setFlameTaps(0), 2000);
  };

  const gam = useMemo(() => (user ? getMyGamification(db, user.id) : null), [db, user]);
  const liveSess = useMemo(() => (user ? liveSessionForStudent(db, user.id) : undefined), [db, user]);
  const now = useNow(liveSess ? 1_000 : 60_000);
  const nextSess = useMemo(() => (user ? nextSessionForUser(db, user.id) : undefined), [db, user]);
  const near = useMemo(() => (user ? nearestBadge(db, user.id) : null), [db, user]);
  const myEnrollmentCount = db.enrollments.filter((e) => e.userId === user?.id && e.status === 'active').length;

  if (!user) return null;
  const hour = new Date(now).getHours();
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
    <View style={{ flex: 1 }}>
      {/* Background gradient orbs */}
      <View style={{
        position: 'absolute', top: -80, right: -60,
        width: 300, height: 300, borderRadius: 150,
        backgroundColor: isDark ? 'rgba(10,132,255,0.06)' : 'rgba(0,122,255,0.04)',
      }} />

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
        {/* ── الهيدر ── */}
        <FadeIn index={0}>
          <Row between center style={{ paddingHorizontal: spacing.s5, marginBottom: spacing.s4 }}>
            <Row center gap={12}>
              <Avatar name={user.fullName} color={user.avatarColor} size={50} ring={theme.brand} />
              <View>
                <Txt variant="caption" color={theme.textMuted}>{greeting} 👋</Txt>
                <Txt variant="h3">{firstName}</Txt>
              </View>
            </Row>
            <Pressable
              onPress={() => navigation.navigate('Notifications')}
              style={({ pressed }) => ({
                width: 44, height: 44, borderRadius: 22,
                backgroundColor: isDark ? 'rgba(120,120,128,0.24)' : 'rgba(120,120,128,0.12)',
                alignItems: 'center', justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Ionicons name="notifications-outline" size={21} color={theme.text} />
              {unreadCount > 0 ? (
                <View style={{ position: 'absolute', top: 8, end: 10, width: 10, height: 10, borderRadius: 5, backgroundColor: theme.danger, borderWidth: 2, borderColor: theme.bg }} />
              ) : null}
            </Pressable>
          </Row>
        </FadeIn>

        {/* ── شريط المؤشرات الثلاثة — Glass Bubbles ── */}
        {gam ? (
          <FadeIn index={1}>
            <Row gap={10} style={{ paddingHorizontal: spacing.s5, marginBottom: spacing.s4 }}>
              <StatBubble
                value={gam.streak}
                label={t('today.streakLabel')}
                icon={
                  <Pressable onPress={handleFlameTap}>
                    <Flame size={20} urgent={streakUrgent} />
                  </Pressable>
                }
                color="#FF9F0A"
                onPress={() => navigation.navigate('Achievements')}
              />
              <StatBubble
                value={gam.points}
                label={t('today.pointsLabel')}
                icon={<Ionicons name="star" size={20} color={theme.certGold} />}
                color={theme.certGold}
                onPress={() => navigation.navigate('Wallet')}
              />
              <StatBubble
                value={gam.leagueXp > 0 && gam.leagueRank > 0 ? `#${gam.leagueRank}` : '—'}
                label={t(`tier.${gam.leagueTier}` as any)}
                icon={<Ionicons name="shield" size={20} color={leagueTierColors[gam.leagueTier]} />}
                color={leagueTierColors[gam.leagueTier]}
                onPress={() => navigation.navigate('League')}
              />
            </Row>
          </FadeIn>
        ) : null}

        <View style={{ paddingHorizontal: spacing.s5, gap: 14 }}>
          {/* ── بطاقة الجلسة الحية — Gradient Premium ── */}
          {liveSess && !alreadyChecked ? (
            <FadeIn index={2}>
              <Pressable onPress={() => navigation.navigate('Scanner')}>
                <LinearGradient
                  colors={[theme.brandGradientFrom, theme.brandGradientTo]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{
                    borderRadius: radii.card,
                    padding: spacing.s4,
                    overflow: 'hidden',
                    shadowColor: theme.brand,
                    shadowOpacity: 0.3,
                    shadowRadius: 24,
                    shadowOffset: { width: 0, height: 12 },
                    elevation: 12,
                  }}
                >
                  <Row between center>
                    <View style={{ flex: 1, gap: 8 }}>
                      <Tag label={t('common.liveStatus')} color="#fff" bg="rgba(255,255,255,0.2)" icon="radio" />
                      <Txt variant="h2" color="#fff">{liveCourse?.title ?? ''}</Txt>
                      <Txt variant="caption" color="rgba(255,255,255,0.85)">{liveSess.title}</Txt>
                      <Txt variant="micro" color="rgba(255,255,255,0.65)">
                        {t('today.endsIn')}: {formatDuration(checkinEndsAt - now, lang)}
                      </Txt>
                      <Spacer size={6} />
                      <View style={{
                        backgroundColor: 'rgba(255,255,255,0.2)',
                        borderRadius: radii.button,
                        paddingVertical: 12, paddingHorizontal: 18,
                        flexDirection: 'row', alignItems: 'center', gap: 8,
                        alignSelf: 'flex-start',
                      }}>
                        <Ionicons name="qr-code" size={18} color="#fff" />
                        <Txt variant="bodyMed" color="#fff">{t('today.checkInNow')}</Txt>
                      </View>
                    </View>
                    <Ionicons name="qr-code-outline" size={90} color="rgba(255,255,255,0.15)" />
                  </Row>
                </LinearGradient>
              </Pressable>
            </FadeIn>
          ) : null}

          {/* ── المحاضرة القادمة ── */}
          {nextSess && nextCourse ? (
            <FadeIn index={3}>
              <Card>
                <Row between center>
                  <View style={{ flex: 1, gap: 6 }}>
                    <Row center gap={6}>
                      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: theme.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="calendar" size={13} color={theme.brand} />
                      </View>
                      <Txt variant="caption" color={theme.brand}>{t('today.nextSession')}</Txt>
                    </Row>
                    <Txt variant="h3">{nextCourse.title}</Txt>
                    <Txt variant="caption" color={theme.textSecondary}>{nextSess.title}</Txt>
                    <Row center gap={12} wrap style={{ marginTop: 4 }}>
                      <Row center gap={4}>
                        <Ionicons name="time-outline" size={14} color={theme.textMuted} />
                        <Txt variant="micro" color={theme.textMuted}>
                          {sameDay(nextSess.startsAt, now) ? t('common.today') : formatDate(nextSess.startsAt, lang)} · {formatTime(nextSess.startsAt, lang)}
                        </Txt>
                      </Row>
                      <Row center gap={4}>
                        <Ionicons name="location-outline" size={14} color={theme.textMuted} />
                        <Txt variant="micro" color={theme.textMuted}>{nextBatch?.room}</Txt>
                      </Row>
                    </Row>
                  </View>
                  <View style={{
                    width: 68, height: 68, borderRadius: 20,
                    backgroundColor: (nextCourse.color ?? theme.brand) + '1A',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Ionicons name="book" size={32} color={nextCourse.color ?? theme.brand} />
                  </View>
                </Row>
              </Card>
            </FadeIn>
          ) : null}

          {/* ── Bento: التقدم + الأهلية ── */}
          {pct && primaryBatch ? (
            <FadeIn index={4}>
              <Row gap={12}>
                <Card style={{ flex: 1, alignItems: 'center', gap: 10, paddingVertical: 18 }}>
                  <StatRing size={90} stroke={8} progress={pct.pct / 100} color={pct.pct >= certPct ? theme.success : theme.brand}>
                    <Txt variant="h2" color={pct.pct >= certPct ? theme.success : theme.brand}>{pct.pct}%</Txt>
                  </StatRing>
                  <Txt variant="micro" color={theme.textMuted} align="center">{t('today.attendanceRate')}</Txt>
                </Card>
                <Card style={{ flex: 1, alignItems: 'center', gap: 8, justifyContent: 'center', paddingVertical: 18 }}>
                  <View style={{
                    width: 56, height: 56, borderRadius: 28,
                    backgroundColor: pct.pct >= certPct ? theme.successSoft : theme.warnSoft,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Ionicons name={pct.pct >= certPct ? 'checkmark-circle' : 'ribbon-outline'} size={30} color={pct.pct >= certPct ? theme.success : theme.warn} />
                  </View>
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
                <Row center gap={14}>
                  <View style={{
                    width: 56, height: 56, borderRadius: 18,
                    backgroundColor: theme.brandSoft,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Ionicons name={near.badge.icon as any} size={28} color={theme.brand} />
                  </View>
                  <View style={{ flex: 1, gap: 6 }}>
                    <Row between center>
                      <Txt variant="caption" color={theme.textMuted}>{t('today.nearestBadge')}</Txt>
                      <Txt variant="caption" color={theme.brand}>{Math.round(near.progress * 100)}%</Txt>
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
              <Card style={{ alignItems: 'center', paddingVertical: spacing.s8, gap: 12 }}>
                <View style={{
                  width: 100, height: 100, borderRadius: 50,
                  backgroundColor: theme.brandSoft,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Ionicons name="rocket" size={48} color={theme.brand} />
                </View>
                <Txt variant="h2" align="center">{t('today.emptyTitle')}</Txt>
                <Spacer size={8} />
                <Btn title={t('today.exploreCta')} icon="compass" onPress={() => tabs.setTab('explore')} />
              </Card>
            </FadeIn>
          ) : null}

          {/* ── وصول سريع ── */}
          <FadeIn index={6}>
            <Txt variant="h3" style={{ marginTop: 6, marginBottom: 10 }}>{t('today.quickActions')}</Txt>
            <Row gap={10}>
              <QuickAction icon="shield-half" label={t('excuses.title')} color={theme.info} onPress={() => navigation.navigate('Excuses')} />
              <QuickAction icon="ribbon" label={t('certs.title')} color={theme.certGold} onPress={() => navigation.navigate('Certificates')} />
              <QuickAction icon="wallet" label={t('wallet.title')} color={theme.success} onPress={() => navigation.navigate('Wallet')} />
              <QuickAction icon="trophy" label={t('league.title')} color={theme.warn} onPress={() => navigation.navigate('League')} />
            </Row>
          </FadeIn>
        </View>

        {showEasterEgg && (
          <FadeIn>
            <Card style={{ alignItems: 'center', padding: 20, marginHorizontal: spacing.s5, marginBottom: spacing.s4, borderColor: theme.certGold, borderWidth: 2 }}>
              <Txt variant="h2" align="center">{t('today.secretTitle')}</Txt>
              <Spacer size={8} />
              <Txt variant="body" color={theme.textSecondary} align="center">{t('today.secretBody')}</Txt>
            </Card>
          </FadeIn>
        )}
      </ScrollView>
    </View>
  );
}

function QuickAction({ icon, label, color, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; color: string; onPress: () => void }) {
  const { theme, isDark } = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
      <Card style={{ alignItems: 'center', gap: 8, paddingVertical: 16 }}>
        <View style={{
          width: 46, height: 46, borderRadius: 14,
          backgroundColor: color + '1A',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Ionicons name={icon} size={22} color={color} />
        </View>
        <Txt variant="micro" align="center">{label}</Txt>
      </Card>
    </Pressable>
  );
}
