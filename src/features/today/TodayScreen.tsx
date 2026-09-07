/**
 * features/today — S10 «اليوم»: مركز القيادة.
 * تصميم Apple Liquid Glass — Bento Grid + الستريك والنقاط والدوري.
 */
import React, { useEffect, useMemo, useState, useRef } from 'react';
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
  Avatar, Btn, Card, CountUp, FadeIn, Flame, LiquidGlassCard, NotificationBell, ProgressBar, Row, Spacer, StatRing, Tag, Txt,
  BorderBeam, AnimatedShinyText,
} from '../../design/components';
import { StatBubble } from '../../design/glass';
import { useTabs } from '../../app/RootNavigator';
import { MasarMascot, FatenBehaviorState, getRandomMascotQuote } from '../../design/mascot';
import { ShimmerProgressBar } from '../../design/animations';
import { spacing, radii, leagueTierColors } from '../../design/tokens';
import { formatDuration, formatTime, formatDate, getFirstName, sameDay } from '../../shared/format';
import { useNow, useHaptics } from '../../shared/hooks';
import { getMyCourses, getToday } from '../../data/actions';

export function TodayScreen() {
  const { t, lang } = useI18n();
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { db, user, unreadCount, online, refresh, syncing } = useApp();
  const navigation = useNavigation<any>();
  const tabs = useTabs();
  const { impactLight } = useHaptics();

  const [showEasterEgg, setShowEasterEgg] = useState(false);
  const [activeMascotQuote, setActiveMascotQuote] = useState<string>(() => getRandomMascotQuote('welcome'));
  const flameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFlameTap = () => {
    setShowEasterEgg(true);
    if (flameTimer.current) clearTimeout(flameTimer.current);
    flameTimer.current = setTimeout(() => setShowEasterEgg(false), 3000);
  };

  const gam = useMemo(() => (user ? getMyGamification(db, user.id) : null), [db, user]);
  const liveSess = useMemo(() => (user ? liveSessionForStudent(db, user.id) : undefined), [db, user]);
  const now = useNow(liveSess ? 1_000 : 60_000);
  const nextSess = useMemo(() => (user ? nextSessionForUser(db, user.id) : undefined), [db, user]);
  const near = useMemo(() => (user ? nearestBadge(db, user.id) : null), [db, user]);
  const myEnrollmentCount = db.enrollments.filter((e) => e.userId === user?.id && e.status === 'active').length;

  useEffect(() => {
    void Promise.all([getToday().catch(() => null), getMyCourses().catch(() => null)]);
  }, []);

  if (!user) return null;
  const hour = new Date(now).getHours();
  const greeting = hour < 12 ? t('today.morning') : t('today.evening');
  const firstName = getFirstName(user.fullName);

  const liveBatch = liveSess ? batchOf(db, liveSess.batchId) : undefined;
  const liveCourse = liveBatch ? courseOf(db, liveBatch.courseId) : undefined;
  const liveChecked = liveSess
    ? db.attendance.some((a) => a.sessionId === liveSess.id && a.userId === user.id && a.status !== 'absent')
    : false;

  // استمرار كارت توثيق الحضور طوال اليوم حتى بعد انتهاء الجلسة أو إغلاقها
  const todayCheckedSession = useMemo(() => {
    if (liveSess && liveChecked) return liveSess;
    return db.sessions.find((s) => {
      const isToday = sameDay(s.startsAt, now) || (s.startedAt && sameDay(s.startedAt, now));
      if (!isToday) return false;
      return db.attendance.some((a) => a.sessionId === s.id && a.userId === user.id && a.status !== 'absent');
    });
  }, [liveSess, liveChecked, db.sessions, db.attendance, user.id, now]);

  const checkedBatch = todayCheckedSession ? batchOf(db, todayCheckedSession.batchId) : undefined;
  const checkedCourse = checkedBatch ? courseOf(db, checkedBatch.courseId) : undefined;
  const alreadyChecked = Boolean(todayCheckedSession);

  const checkinEndsAt = liveSess ? (liveSess.startedAt ?? liveSess.startsAt) + 30 * 60_000 : 0;

  const nextBatch = nextSess ? batchOf(db, nextSess.batchId) : undefined;
  const nextCourse = nextBatch ? courseOf(db, nextBatch.courseId) : undefined;

  // تجميع التقدّم يمسح جلسات كل مجموعة نشطة؛ بدون تذكير كان يعاد حسابه في كل
  // رندر (وكل حدث realtime يسبب رندرًا). المفاتيح الدقيقة تُبقيه على تغيّر
  // البيانات المعنية فقط بدل مرجع `db` بالكامل.
  const { activeBatches, certPct, closedCount, totalCount, totalHonored, combinedPct } = useMemo(() => {
    const myBatches = db.enrollments.filter((e) => e.userId === user.id && e.status === 'active');
    const batches = myBatches.map((e) => batchOf(db, e.batchId)).filter(Boolean);
    const rule = db.rules.find((r) => r.key === 'certificate.min_attendance_pct');
    const pct = typeof rule?.value === 'number' ? rule.value : 75;

    let closed = 0;
    let total = 0;
    let honored = 0;
    for (const b of batches) {
      if (!b) continue;
      const sessions = sessionsOfBatch(db, b.id);
      closed += sessions.filter((sn) => sn.status === 'closed').length;
      total += sessions.length;
      honored += attendancePct(db, user.id, b.id).honored;
    }
    return {
      activeBatches: batches,
      certPct: pct,
      closedCount: closed,
      totalCount: total,
      totalHonored: honored,
      combinedPct: closed > 0 ? Math.round((honored / closed) * 100) : 100,
    };
  }, [db.enrollments, db.batches, db.sessions, db.attendance, db.excuses, db.rules, user.id]);
  const needed = Math.max(0, Math.ceil(((certPct / 100) * Math.max(totalCount, closedCount)) - totalHonored));
  const hasBatches = activeBatches.length > 0;

  const streakUrgent = gam != null && gam.weekStatus === 'tracking' && liveSess != null && !alreadyChecked;
  const isUpcomingToday = !liveSess && nextSess != null && sameDay(nextSess.startsAt, now);

  const mascotBehavior: FatenBehaviorState = !online
    ? 'offline'
    : liveSess && !alreadyChecked
    ? 'attention'
    : liveSess && alreadyChecked
    ? 'success'
    : streakUrgent
    ? 'streak_fire'
    : isUpcomingToday
    ? 'ready'
    : needed === 0 && totalHonored > 0
    ? 'achievement'
    : 'welcome';

  useEffect(() => {
    setActiveMascotQuote(getRandomMascotQuote(mascotBehavior));
  }, [mascotBehavior]);

  const defaultMascotQuote = !online
    ? 'أنت في وضع عدم الاتصال.. بياناتك وسجلاتك التدريبية محفوظة محلياً بأمان! 💾'
    : liveSess && !alreadyChecked
    ? `محاضرة ${liveCourse?.title ?? 'اليوم'} بدأت الآن! سجّل حضورك وثبّت نقاطك ⚡`
    : liveSess && alreadyChecked
    ? 'حضورك موثق اليوم بنجاح يا بطل! نقاطك واستمرارك محفوظين 🦅'
    : streakUrgent
    ? 'سلسلة التزامك في خطر! سجّل حضورك اليوم للحفاظ على الستريك 🔥'
    : isUpcomingToday
    ? `جلستك القادمة اليوم الساعة ${formatTime(nextSess.startsAt, lang)} في ${nextBatch?.room ?? 'القاعة'}.. جهّز نفسك! 🎯`
    : needed > 0
    ? `باقي لك ${needed} جلسات لتحقيق نسبة الـ 75% واستحقاق الشهادة 🎓`
    : 'التعلّم المستمر يصنع المستحيل! كن فخوراً بمسارك اليوم 🦅';

  return (
    <View style={{ flex: 1 }}>
      {/* Background gradient orb */}
      <View style={{
        position: 'absolute', top: -80, right: -60,
        width: 300, height: 300, borderRadius: 150,
        backgroundColor: theme.orbPrimary,
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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('tabs.profile')}
              accessibilityHint={t('profile.edit')}
              onPress={() => tabs.setTab('profile')}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                opacity: pressed ? 0.78 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              <Avatar name={user.fullName} color={user.avatarColor} size={50} ring={theme.brand} />
              <View>
                <Txt variant="caption" color={theme.textMuted}>{greeting} 👋</Txt>
                <Row center gap={4}>
                  <Txt variant="h3" numberOfLines={1} style={{ maxWidth: 180 }}>{firstName}</Txt>
                  <Ionicons name="chevron-forward" size={14} color={theme.textMuted} style={{ opacity: 0.6 }} />
                </Row>
              </View>
            </Pressable>
            <NotificationBell count={unreadCount} onPress={() => navigation.navigate('Notifications')} />
          </Row>
        </FadeIn>

        <View style={{ paddingHorizontal: spacing.s5, gap: 14 }}>
          {/* ── تميمة مسار التفاعلية («فطن») بلون مميز وتصميم ممتع بصرياً ── */}
          <FadeIn index={1}>
            <View
              style={{
                borderRadius: radii.xl,
                overflow: 'hidden',
                borderWidth: 1.5,
                borderColor: isDark ? 'rgba(245, 158, 11, 0.42)' : 'rgba(217, 119, 6, 0.35)',
                backgroundColor: isDark ? 'rgba(32, 23, 50, 0.92)' : '#FFFBF0',
                shadowColor: isDark ? '#F59E0B' : '#D97706',
                shadowOffset: { width: 0, height: 8 },
                shadowOpacity: isDark ? 0.35 : 0.12,
                shadowRadius: 20,
                elevation: 6,
              }}
            >
              {/* تدرج بصري دافئ ومميز (Sunrise Amber / Twilight Aurora) */}
              <LinearGradient
                colors={
                  isDark
                    ? ['rgba(245, 158, 11, 0.18)', 'rgba(124, 58, 237, 0.16)', 'rgba(30, 27, 75, 0.7)']
                    : ['rgba(254, 243, 199, 0.85)', 'rgba(255, 237, 213, 0.6)', 'rgba(243, 232, 255, 0.45)']
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ position: 'absolute', inset: 0 as any }}
                pointerEvents="none"
              />

              {/* الحافة العاكسة العلوية للزجاج بلون ذهبي دافئ */}
              <LinearGradient
                colors={['rgba(251, 191, 36, 0.65)', 'rgba(245, 158, 11, 0.2)', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2 }}
                pointerEvents="none"
              />

              {/* شعاع الحواف المشع المستوحى من Magic UI */}
              <BorderBeam
                size={140}
                duration={5500}
                borderWidth={2}
                colorFrom="#F59E0B"
                colorTo="#7C3AED"
                borderRadius={radii.xl}
              />

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="التفاعل مع صقر مسار فطن"
                onPress={() => {
                  impactLight();
                  setActiveMascotQuote(getRandomMascotQuote(mascotBehavior));
                }}
                style={{
                  padding: spacing.s4,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 14,
                }}
              >
                {/* منصة الصقر المضيئة */}
                <View
                  style={{
                    borderRadius: 44,
                    padding: 4,
                    backgroundColor: isDark ? 'rgba(245, 158, 11, 0.14)' : 'rgba(245, 158, 11, 0.18)',
                    borderWidth: 1.5,
                    borderColor: isDark ? 'rgba(245, 158, 11, 0.38)' : 'rgba(245, 158, 11, 0.45)',
                    shadowColor: '#F59E0B',
                    shadowOpacity: 0.25,
                    shadowRadius: 10,
                    shadowOffset: { width: 0, height: 4 },
                  }}
                >
                  <MasarMascot
                    size={78}
                    behavior={mascotBehavior}
                    interactive={false}
                    hideFloatingBubble
                  />
                </View>

                {/* المحتوى النصي وفقاعة الحوار */}
                <View style={{ flex: 1, gap: 6 }}>
                  <Row center gap={6}>
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 4,
                        backgroundColor: isDark ? 'rgba(245, 158, 11, 0.22)' : 'rgba(245, 158, 11, 0.25)',
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        borderRadius: radii.full,
                        borderWidth: 1,
                        borderColor: isDark ? 'rgba(245, 158, 11, 0.45)' : 'rgba(217, 119, 6, 0.35)',
                      }}
                    >
                      <Ionicons name="sparkles" size={12} color={isDark ? '#FBBF24' : '#B45309'} />
                      <Txt variant="micro" bold color={isDark ? '#FDE68A' : '#92400E'} style={{ fontSize: 10.5 }}>
                        نصيحة فطن 💬
                      </Txt>
                    </View>
                  </Row>

                  <Txt variant="bodyMed" bold color={isDark ? '#FFFFFF' : '#1F2937'}>
                    {liveSess && !alreadyChecked
                      ? 'المحاضرة بدأت الآن! ⚡'
                      : liveSess && alreadyChecked
                      ? 'حضورك موثق لليوم ✓'
                      : streakUrgent
                      ? 'حافظ على الستريك اليوم! 🔥'
                      : isUpcomingToday
                      ? 'جلستك القادمة اليوم 🎯'
                      : 'صقر مسار («فطن») يقول لك:'}
                  </Txt>

                  {/* فقاعة الحديث الكاريكاتورية الأنيقة */}
                  <View
                    style={{
                      backgroundColor: isDark ? 'rgba(20, 16, 36, 0.88)' : 'rgba(255, 255, 255, 0.95)',
                      padding: 10,
                      borderRadius: radii.md,
                      borderWidth: 1,
                      borderColor: isDark ? 'rgba(245, 158, 11, 0.45)' : 'rgba(217, 119, 6, 0.4)',
                      shadowColor: '#000',
                      shadowOpacity: isDark ? 0.25 : 0.06,
                      shadowRadius: 8,
                      shadowOffset: { width: 0, height: 3 },
                    }}
                  >
                    <Txt
                      variant="caption"
                      color={isDark ? '#FDE68A' : '#92400E'}
                      style={{
                        lineHeight: 20,
                        fontWeight: '600',
                      }}
                    >
                      {activeMascotQuote || defaultMascotQuote}
                    </Txt>
                    <Row center gap={4} style={{ marginTop: 5 }}>
                      <Ionicons name="sparkles" size={11} color={isDark ? '#FBBF24' : '#D97706'} />
                      <Txt variant="micro" color={isDark ? '#FCD34D' : '#B45309'} style={{ fontSize: 9.5 }}>
                        اضغط على فطن لاقتباس جديد ✨
                      </Txt>
                    </Row>
                  </View>
                </View>
              </Pressable>
            </View>
          </FadeIn>

          {/* Task-first: live check-in before KPIs (spec §06 / §44) */}
          {liveSess && !alreadyChecked ? (
            <FadeIn index={1}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t('scanner.submit')}: ${liveSess.title}`}
                onPress={() => navigation.navigate('Scanner')}
              >
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
                    position: 'relative',
                  }}
                >
                  {/* شعاع الحواف المشع المستوحى من Magic UI */}
                  <BorderBeam
                    size={150}
                    duration={5000}
                    borderWidth={2.5}
                    colorFrom="#FDE68A"
                    colorTo="#38BDF8"
                    borderRadius={radii.card}
                  />

                  <Row center>
                    <View style={{ flex: 1, gap: 8, minWidth: 0 }}>
                      <Row center gap={8}>
                        <Tag label={t('common.liveStatus')} color="#fff" bg="rgba(255,255,255,0.2)" icon="radio" />
                        <AnimatedShinyText shimmerColor="#FDE68A" style={{ color: '#FDE68A', fontSize: 11.5, fontWeight: '700' }}>
                          ⚡ مباشر الآن
                        </AnimatedShinyText>
                      </Row>
                      <Txt variant="h2" color="#fff" numberOfLines={2}>{liveCourse?.title ?? ''}</Txt>
                      <Txt variant="caption" color="rgba(255,255,255,0.85)" numberOfLines={1}>{liveSess.title}</Txt>
                      <Txt variant="micro" color="rgba(255,255,255,0.65)">
                        {t('today.endsIn')}: {formatDuration(checkinEndsAt - now, lang)}
                      </Txt>
                      <Spacer size={6} />
                      <View style={{
                        backgroundColor: 'rgba(255,255,255,0.2)',
                        borderRadius: radii.pill,
                        paddingVertical: 10, paddingHorizontal: 16,
                        flexDirection: 'row', alignItems: 'center', gap: 8,
                        alignSelf: 'flex-start',
                      }}>
                        <Ionicons name="qr-code" size={18} color="#fff" />
                        <Txt variant="bodyMed" color="#fff">{t('today.checkInNow')}</Txt>
                      </View>
                    </View>
                    <Ionicons name="qr-code-outline" size={72} color="rgba(255,255,255,0.18)" style={{ marginStart: 6 }} />
                  </Row>
                </LinearGradient>
              </Pressable>
            </FadeIn>
          ) : null}

          {/* Confirmed attendance state (Calm reinforcement with liquid glass styling) */}
          {todayCheckedSession ? (
            <FadeIn index={1}>
              <View
                style={{
                  borderRadius: radii.xl,
                  overflow: 'hidden',
                  borderWidth: 1.5,
                  borderColor: isDark ? 'rgba(16, 185, 129, 0.45)' : 'rgba(16, 185, 129, 0.35)',
                  backgroundColor: isDark ? 'rgba(6, 44, 31, 0.75)' : 'rgba(236, 253, 245, 0.95)',
                  shadowColor: '#10B981',
                  shadowOffset: { width: 0, height: 8 },
                  shadowOpacity: isDark ? 0.25 : 0.12,
                  shadowRadius: 18,
                  elevation: 6,
                  position: 'relative',
                  padding: spacing.s4,
                }}
              >
                <BorderBeam
                  size={140}
                  duration={6000}
                  borderWidth={2}
                  colorFrom="#10B981"
                  colorTo="#38BDF8"
                  borderRadius={radii.xl}
                />
                <Row center between>
                  <View style={{ flex: 1, gap: 6, minWidth: 0 }}>
                    <Row center gap={6}>
                      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: theme.success, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                      </View>
                      <Txt variant="caption" bold color={theme.success}>
                        {t('today.attendanceConfirmed')}
                      </Txt>
                    </Row>
                    <Txt variant="h3" color={theme.text} numberOfLines={1}>{checkedCourse?.title ?? liveCourse?.title ?? ''}</Txt>
                    <Txt variant="caption" color={theme.textSecondary} numberOfLines={1}>{todayCheckedSession.title}</Txt>
                    <Txt variant="micro" color={theme.textMuted}>
                      {t('today.attendanceConfirmedBody')}
                    </Txt>
                  </View>
                  <View style={{
                    width: 58, height: 58, borderRadius: 29,
                    backgroundColor: isDark ? 'rgba(16, 185, 129, 0.22)' : 'rgba(16, 185, 129, 0.15)',
                    borderWidth: 1.5,
                    borderColor: isDark ? 'rgba(16, 185, 129, 0.4)' : 'rgba(16, 185, 129, 0.3)',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Ionicons name="shield-checkmark" size={32} color={theme.success} />
                  </View>
                </Row>
              </View>
            </FadeIn>
          ) : null}
        </View>

        {gam ? (
          <FadeIn index={2}>
            <Row gap={10} style={{ paddingHorizontal: spacing.s5, marginBottom: spacing.s4, marginTop: spacing.s3 }}>
              <StatBubble
                value={gam.streak}
                label={t('today.streakLabel')}
                icon={<Flame size={20} urgent={streakUrgent} />}
                color="#FF9F0A"
                onPress={() => navigation.navigate('Achievements')}
                onLongPress={handleFlameTap}
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
          {hasBatches ? (
            <FadeIn index={4}>
              <Row gap={12}>
                <Card style={{ flex: 1, alignItems: 'center', gap: 10, paddingVertical: 18 }}>
                  <StatRing size={90} stroke={8} progress={combinedPct / 100} color={combinedPct >= certPct ? theme.success : theme.brand}>
                    <Txt variant="h2" color={combinedPct >= certPct ? theme.success : theme.brand}>{combinedPct}%</Txt>
                  </StatRing>
                  <Txt variant="micro" color={theme.textMuted} align="center">{t('today.attendanceRate')}</Txt>
                </Card>
                <Card style={{ flex: 1, alignItems: 'center', gap: 8, justifyContent: 'center', paddingVertical: 18 }}>
                  <View style={{
                    width: 56, height: 56, borderRadius: 28,
                    backgroundColor: combinedPct >= certPct ? theme.successSoft : theme.warnSoft,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Ionicons name={combinedPct >= certPct ? 'checkmark-circle' : 'ribbon-outline'} size={30} color={combinedPct >= certPct ? theme.success : theme.warn} />
                  </View>
                  <Txt variant="caption" color={combinedPct >= certPct ? theme.success : theme.warn} align="center">
                    {combinedPct >= certPct ? t('today.eligible') : t('today.needMore', { x: needed })}
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
                    <ShimmerProgressBar progress={near.progress} />
                  </View>
                </Row>
              </Card>
            </FadeIn>
          ) : null}

          {/* ── حالة فارغة: لا كورسات ── */}
          {myEnrollmentCount === 0 ? (
            <FadeIn index={2}>
              <Card style={{ alignItems: 'center', paddingVertical: spacing.s8, gap: 12 }}>
                <MasarMascot size={110} mode="encouraging" interactive />
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
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] })}
    >
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
