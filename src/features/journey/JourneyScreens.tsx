/**
 * features/journey — S14 رحلتي + S15 خريطة الرحلة (التوقيع البصري) + S16 سجل الحضور + S26 تقييم الكورس.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useApp } from '../../data/store';
import {
  attendanceOf, attendancePct, batchOf, courseOf, courseStreak, isBatchComplete,
  profileOf, sessionsOfBatch,
} from '../../data/engine';
import { submitCourseRating, issueBatchCertificates } from '../../data/actions';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import {
  Btn, Card, Chip, DisclosureIcon, Empty, FadeIn, Flame, Header, Input, ProgressBar, Row,
  Segmented, Sheet, Spacer, Stars, StatRing, Tag, Txt,
} from '../../design/components';
import { spacing, radii, attendanceColors } from '../../design/tokens';
import { formatDate, formatTime, timePast } from '../../shared/format';
import { Batch, TrainingSession, AttendanceStatus } from '../../data/types';
import { useTabs } from '../../app/RootNavigator';

// ───────────────────────────── S14 رحلتي ─────────────────────────────

export function JourneyScreen({ navigation: propNav }: any) {
  const hookNav = useNavigation<any>();
  const navigation = propNav ?? hookNav;
  const { t } = useI18n();
  const { theme } = useTheme();
  const { db, user } = useApp();
  const tabs = useTabs();
  if (!user) return null;

  const myEnrollments = db.enrollments.filter((e) => e.userId === user.id && e.status === 'active');
  const certPct = (() => {
    const r = db.rules.find((x) => x.key === 'certificate.min_attendance_pct');
    return typeof r?.value === 'number' ? r.value : 75;
  })();

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingTop: spacing.s3, paddingBottom: 120 }}>
        <Header title={t('journey.title')} />
        <View style={{ paddingHorizontal: spacing.s5, gap: 14 }}>
          {myEnrollments.length === 0 ? (
            <Empty emoji="🗺️" title={t('journey.emptyTitle')} cta={t('today.exploreCta')} onCta={() => tabs.setTab('explore')} />
          ) : (
            myEnrollments.map((enr, i) => {
              const batch = batchOf(db, enr.batchId);
              const course = batch ? courseOf(db, batch.courseId) : undefined;
              if (!batch || !course) return null;
              const sess = sessionsOfBatch(db, batch.id);
              const closed = sess.filter((s) => s.status === 'closed').length;
              const { pct } = attendancePct(db, user.id, batch.id);
              const streak = courseStreak(db, user.id, batch.id);
              const completed = isBatchComplete(db, batch.id);
              const rated = db.ratings.some((r) => r.userId === user.id && r.courseId === course.id);
              return (
                <FadeIn key={batch.id} index={i}>
                  <Card>
                    <Pressable onPress={() => navigation.navigate('JourneyMap', { batchId: batch.id })}>
                      <Row center gap={14}>
                        <StatRing size={74} stroke={7} progress={pct / 100} color={pct >= certPct ? theme.success : course.color}>
                          <Txt variant="h3">{pct}%</Txt>
                        </StatRing>
                        <View style={{ flex: 1, gap: 4 }}>
                          <Txt variant="h3">{course.title}</Txt>
                          <Row center gap={8} wrap>
                            <Tag
                              label={t('journey.sessionXofY', { x: Math.min(closed, course.sessionsCount), y: course.sessionsCount })}
                              color={theme.brand} bg={theme.brandSoft} icon="calendar"
                            />
                            {completed ? <Tag label={t('journey.courseComplete')} color={theme.certGold} bg={theme.warnSoft} icon="trophy" /> : null}
                          </Row>
                          <Row center gap={6}>
                            {pct >= certPct ? (
                              <Tag label={t('today.eligible')} color={theme.success} bg={theme.successSoft} icon="checkmark-circle" />
                            ) : (
                              <Txt variant="micro" color={theme.warn}>{t('today.needMore', { x: Math.max(1, Math.ceil((certPct / 100) * course.sessionsCount) - (db.attendance.filter((a) => a.userId === user.id && a.status !== 'absent' && sess.some((s) => s.id === a.sessionId && s.status === 'closed')).length)) })}</Txt>
                            )}
                            {streak >= 2 ? (
                              <Row center gap={3}>
                                <Flame size={13} />
                                <Txt variant="micro" color={theme.warn}>{t('map.courseStreak', { x: streak })}</Txt>
                              </Row>
                            ) : null}
                          </Row>
                        </View>
                        <DisclosureIcon color={theme.textMuted} />
                      </Row>
                    </Pressable>
                    <Spacer size={10} />
                    <Row gap={8}>
                      <Btn title={t('journey.map')} size="sm" variant="secondary" icon="map" onPress={() => navigation.navigate('JourneyMap', { batchId: batch.id })} />
                      <Btn title={t('journey.history')} size="sm" variant="ghost" icon="list" onPress={() => navigation.navigate('AttendanceHistory', { batchId: batch.id })} />
                      {completed && !rated ? (
                        <Btn title={t('journey.rateCourse')} size="sm" variant="gold" icon="star" onPress={() => navigation.navigate('JourneyMap', { batchId: batch.id, rate: true })} />
                      ) : null}
                    </Row>
                  </Card>
                </FadeIn>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// ───────────────────────────── S15 خريطة الرحلة ─────────────────────────────

export function JourneyMapScreen({ route, navigation: propNav }: any) {
  const hookNav = useNavigation<any>();
  const navigation = propNav ?? hookNav;
  const { t, lang } = useI18n();
  const { theme, isDark } = useTheme();
  const { db, user, refresh, toast } = useApp();
  const batchId: string = route.params.batchId;
  const batch = batchOf(db, batchId);
  const course = batch ? courseOf(db, batch.courseId) : undefined;
  const sessions = batch ? sessionsOfBatch(db, batchId) : [];
  const [rateOpen, setRateOpen] = useState<boolean>(route.params?.rate === true);
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);

  if (!batch || !course || !user) return null;

  const instructor = profileOf(db, batch.instructorId);
  const streak = courseStreak(db, user.id, batchId);
  const myAtt = db.attendance.filter((a) => a.userId === user.id && sessions.some((s) => s.id === a.sessionId));
  const attendedCount = myAtt.filter((a) => a.status === 'present' || a.status === 'late').length;
  const excusedCount = myAtt.filter((a) => a.status === 'excused').length;
  const totalClosed = sessions.filter((s) => s.status === 'closed').length;
  const attendanceRate = totalClosed === 0 ? 100 : Math.round(((attendedCount + excusedCount) / totalClosed) * 100);

  const statusOf = (sess: TrainingSession): 'done' | 'late' | 'current' | 'locked' | 'excused' | 'absent' => {
    const att = attendanceOf(db, sess.id, user.id);
    if (sess.status === 'live') return att && att.status !== 'absent' ? (att.status === 'late' ? 'late' : 'done') : 'current';
    if (sess.status === 'scheduled') {
      const prev = sessions.filter((s) => s.seq < sess.seq);
      const prevDone = prev.every((p) => {
        const a = attendanceOf(db, p.id, user.id);
        return p.status === 'closed' && a && a.status !== 'absent';
      });
      return prevDone && sess.seq === prev.length + 1 ? 'current' : 'locked';
    }
    // closed
    if (!att || att.status === 'absent') return 'absent';
    if (att.status === 'excused') return 'excused';
    if (att.status === 'late') return 'late';
    return 'done';
  };

  const nodeMeta = (st: ReturnType<typeof statusOf>) => {
    switch (st) {
      case 'done': return { color: theme.success, icon: 'checkmark-circle' as const, label: t('map.nodeDone'), bg: theme.successSoft };
      case 'late': return { color: theme.warn, icon: 'time' as const, label: t('map.nodeLate'), bg: theme.warnSoft };
      case 'current': return { color: theme.brand, icon: 'radio-button-on' as const, label: t('map.nodeCurrent'), bg: theme.brandSoft };
      case 'excused': return { color: theme.info, icon: 'shield-checkmark' as const, label: t('map.nodeExcused'), bg: theme.infoSoft };
      case 'absent': return { color: theme.danger, icon: 'close-circle' as const, label: t('map.nodeAbsent'), bg: theme.dangerSoft };
      default: return { color: theme.textMuted, icon: 'lock-closed' as const, label: t('map.nodeLocked'), bg: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' };
    }
  };

  const [instructorStars, setInstructorStars] = useState(5);
  const [venueStars, setVenueStars] = useState(5);

  const submitRating = async () => {
    if (!user) return;
    setSending(true);
    try {
      const detailedComment = `[المدرب: ${instructorStars}/5 | المكان والتنظيم: ${venueStars}/5] ${comment.trim()}`.trim();
      await submitCourseRating({ courseId: course.id, stars, comment: detailedComment || undefined });
      await refresh();
      setRateOpen(false);
      toast(t('journey.ratingThanks'), 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setSending(false);
    }
  };

  const myCert = db.certificates.find((c) => c.userId === user.id && c.batchId === batch.id);
  const [issuingCert, setIssuingCert] = useState(false);

  const handleIssueMyCert = async () => {
    setIssuingCert(true);
    try {
      await issueBatchCertificates(batch.id);
      await refresh();
      toast('تم إصدار شهادتك الرسمية بنجاح! مبروك 🎓', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setIssuingCert(false);
    }
  };

  const minCertPct = 75;
  const isEligibleForCert = totalClosed >= sessions.length * 0.75 && attendanceRate >= minCertPct;

  return (
    <View style={{ flex: 1 }}>
      <Header
        title={course.title}
        subtitle={`${instructor?.fullName ?? ''} · ${batch.room}`}
        back={() => navigation.goBack()}
        right={
          <Row center gap={6}>
            <Btn
              title="⭐ تقييم"
              size="sm"
              variant="ghost"
              icon="star"
              onPress={() => setRateOpen(true)}
            />
            {streak >= 1 ? (
              <Row center gap={4} style={{ backgroundColor: theme.warnSoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 }}>
                <Flame size={16} />
                <Txt variant="h3" color={theme.warn}>{streak}</Txt>
              </Row>
            ) : null}
          </Row>
        }
      />
      <ScrollView contentContainerStyle={{ paddingBottom: 140, paddingTop: 12, paddingHorizontal: spacing.s5, alignItems: 'center' }}>
        <View style={{ width: '100%', maxWidth: 660, gap: 14 }}>
          {/* Bento الملخص */}
          <FadeIn index={0}>
            <Card style={{ padding: 16 }}>
              <Row between center>
                <View style={{ gap: 3 }}>
                  <Txt variant="caption" color={theme.textMuted}>{t('history.commitment')}</Txt>
                  <Txt variant="h2" color={attendanceRate >= 75 ? theme.success : theme.brand}>{attendanceRate}%</Txt>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 3 }}>
                  <Txt variant="caption" color={theme.textMuted}>{t('common.sessions')}</Txt>
                  <Txt variant="h3">{attendedCount + excusedCount} / {sessions.length}</Txt>
                </View>
              </Row>
              <Spacer size={10} />
              <ProgressBar progress={sessions.length === 0 ? 0 : (attendedCount + excusedCount) / sessions.length} color={attendanceRate >= 75 ? theme.success : theme.brand} height={8} />
              <Spacer size={8} />
              <Row between center>
                <Txt variant="micro" color={theme.textMuted}>
                  {batch.schedule.days.map((d) => t(`dayShort.${d}` as any)).join(' + ')} · {batch.schedule.time}
                </Txt>
                <Tag label={`الحد الأدنى ${minCertPct}%`} color={theme.certGold} bg={theme.warnSoft} />
              </Row>
            </Card>
          </FadeIn>

          <Spacer size={8} />
          <Txt variant="h3" style={{ marginHorizontal: 4 }}>{t('journey.map')}</Txt>

          {/* المسار التفاعلي للمحاضرات */}
          {sessions.map((sess, i) => {
            const st = statusOf(sess);
            const meta = nodeMeta(st);
            const isLiveNow = sess.status === 'live';
            const att = attendanceOf(db, sess.id, user.id);
            const isPassed = st === 'done' || st === 'late' || st === 'excused';

            return (
              <FadeIn key={sess.id} index={i + 1}>
                <View style={{ width: '100%', position: 'relative' }}>
                  {/* خط الربط بين العقد */}
                  {i < sessions.length - 1 ? (
                    <View
                      style={{
                        position: 'absolute',
                        top: 56,
                        right: 28,
                        bottom: -24,
                        width: 3,
                        backgroundColor: isPassed ? theme.success : theme.line,
                        zIndex: 0,
                      }}
                    />
                  ) : null}

                  <Card
                    style={{
                      borderColor: isLiveNow ? theme.brand : meta.color + '44',
                      borderWidth: isLiveNow ? 2 : 1,
                      backgroundColor: isLiveNow ? theme.brandSoft + '44' : theme.card,
                    }}
                  >
                    <Row center gap={12}>
                      <View
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 24,
                          backgroundColor: meta.bg,
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderWidth: 2,
                          borderColor: meta.color,
                        }}
                      >
                        <Ionicons name={meta.icon} size={22} color={meta.color} />
                      </View>

                      <View style={{ flex: 1 }}>
                        <Row between center>
                          <Txt variant="bodyMed">{sess.title}</Txt>
                          <Tag label={meta.label} color={meta.color} bg={meta.bg} />
                        </Row>
                        <Txt variant="micro" color={theme.textMuted}>
                          {formatDate(sess.startsAt, lang)} · {formatTime(sess.startsAt, lang)}
                        </Txt>

                        {isLiveNow ? (
                          <View style={{ marginTop: 8 }}>
                            <Btn
                              title="📷 مسح رمز الـ QR لتسجيل الحضور الآن"
                              size="sm"
                              variant="gold"
                              icon="qr-code"
                              onPress={() => navigation.navigate('Scanner')}
                              full
                            />
                          </View>
                        ) : st === 'absent' ? (
                          <Row center gap={8} style={{ marginTop: 6 }}>
                            <Txt variant="micro" color={theme.danger}>{t('history.absent')}</Txt>
                            <Btn
                              title={t('excuses.title')}
                              size="sm"
                              variant="ghost"
                              icon="shield"
                              onPress={() => navigation.navigate('Excuses', { sessionId: sess.id })}
                            />
                          </Row>
                        ) : st === 'done' || st === 'late' ? (
                          <Row center gap={6} style={{ marginTop: 4 }}>
                            <Ionicons name="checkmark-circle" size={14} color={theme.success} />
                            <Txt variant="micro" color={theme.success}>
                              {st === 'done' ? `+10 ${t('common.points')}` : `+7 ${t('common.points')} (${t('history.late')})`}
                            </Txt>
                          </Row>
                        ) : null}
                      </View>
                    </Row>
                  </Card>
                </View>
              </FadeIn>
            );
          })}

          {/* العقدة النهائية: منصة التخرج والشهادة */}
          <FadeIn index={sessions.length + 1}>
            <Card
              style={{
                backgroundColor: (myCert || isEligibleForCert) ? (isDark ? 'rgba(255,215,0,0.12)' : 'rgba(255,215,0,0.18)') : theme.card,
                borderWidth: 2,
                borderColor: (myCert || isEligibleForCert) ? theme.certGold : theme.line,
                padding: 20,
                alignItems: 'center',
                gap: 12,
              }}
            >
              <View
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 36,
                  backgroundColor: theme.warnSoft,
                  borderWidth: 3,
                  borderColor: theme.certGold,
                  alignItems: 'center',
                  justifyContent: 'center',
                  shadowColor: theme.certGold,
                  shadowOpacity: 0.4,
                  shadowRadius: 14,
                  shadowOffset: { width: 0, height: 6 },
                }}
              >
                <Ionicons name="trophy" size={38} color={theme.certGold} />
              </View>

              <View style={{ alignItems: 'center', gap: 4 }}>
                <Txt variant="h2" color={theme.certGold}>{t('map.certNode')}</Txt>
                {myCert ? (
                  <>
                    <Txt variant="bodyMed" color={theme.success} align="center">تم إصدار وتوثيق شهادتك الرسمية بنجاح 🎓</Txt>
                    <Tag label={`رقم الشهادة: ${myCert.serial}`} color={theme.brand} bg="#fff" icon="ribbon" />
                  </>
                ) : (
                  <Txt variant="caption" color={theme.textSecondary} align="center">
                    {isEligibleForCert
                      ? 'تهانينا! حققت نسبة الحضور المطلوبة ويمكنك إصدار شهادتك الآن'
                      : `${t('history.commitment')}: ${attendanceRate}% (المطلوب ≥${minCertPct}% للحصول على الشهادة)`}
                  </Txt>
                )}
              </View>

              <Row gap={10} style={{ width: '100%', justifyContent: 'center' }} wrap>
                {myCert ? (
                  <Btn
                    title="🎓 عرض وتحميل الشهادة الرسمية"
                    variant="gold"
                    icon="ribbon"
                    onPress={() => navigation.navigate('CertificateViewer', { certId: myCert.id })}
                  />
                ) : isEligibleForCert ? (
                  <Btn
                    title="🎓 إصدار الشهادة الرسمية الآن"
                    variant="gold"
                    icon="ribbon"
                    loading={issuingCert}
                    onPress={handleIssueMyCert}
                  />
                ) : (
                  <Btn
                    title={t('certs.title')}
                    variant="secondary"
                    icon="ribbon"
                    onPress={() => navigation.navigate('Certificates')}
                  />
                )}
                <Btn
                  title={t('journey.rateCourse')}
                  variant="ghost"
                  icon="star"
                  onPress={() => setRateOpen(true)}
                />
              </Row>
            </Card>
          </FadeIn>
        </View>
      </ScrollView>

      {/* S26 — تقييم الكورس متعدد المحاور */}
      <Sheet visible={rateOpen} onClose={() => setRateOpen(false)} title="⭐ تقييم التجربة التدريبية">
        <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 20 }} showsVerticalScrollIndicator={false}>
          <Card glass style={{ gap: 6, alignItems: 'center' }}>
            <Txt variant="caption" color={theme.textSecondary}>⭐ التقييم العام للدورة التدريبية</Txt>
            <Stars value={stars} size={32} onRate={setStars} />
          </Card>

          <Card glass style={{ gap: 6, alignItems: 'center' }}>
            <Txt variant="caption" color={theme.textSecondary}>👨‍🏫 تقييم أداء المدرب وجودة الشرح</Txt>
            <Stars value={instructorStars} size={28} onRate={setInstructorStars} />
          </Card>

          <Card glass style={{ gap: 6, alignItems: 'center' }}>
            <Txt variant="caption" color={theme.textSecondary}>🏢 تقييم المكان والقاعة والتنظيم</Txt>
            <Stars value={venueStars} size={28} onRate={setVenueStars} />
          </Card>

          <Input
            label="رأيك وملاحظاتك بالتفصيل (اختياري)"
            value={comment}
            onChange={setComment}
            placeholder="اكتب انطباعك، ما أعجبك وما يمكن تحسينه..."
            multiline
          />

          <Btn title="إرسال التقييم المعتمد" full size="lg" loading={sending} onPress={submitRating} icon="checkmark-circle" />
        </ScrollView>
      </Sheet>
    </View>
  );
}

// ───────────────────────────── S16 سجل الحضور ─────────────────────────────

type Filter = 'all' | AttendanceStatus;

export function AttendanceHistoryScreen({ route, navigation }: any) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const { db, user } = useApp();
  const batchId: string | undefined = route.params?.batchId;
  const [filter, setFilter] = useState<Filter>('all');
  if (!user) return null;

  const rows = useMemo(() => {
    return db.attendance
      .filter((a) => a.userId === user.id)
      .map((a) => ({ att: a, sess: db.sessions.find((s) => s.id === a.sessionId)! }))
      .filter((r) => r.sess && (!batchId || r.sess.batchId === batchId))
      .sort((a, b) => b.sess.startsAt - a.sess.startsAt);
  }, [db.attendance, db.sessions, user.id, batchId]);

  const filtered = filter === 'all' ? rows : rows.filter((r) => r.att.status === filter);
  const honored = rows.filter((r) => r.att.status !== 'absent').length;
  const pct = rows.length === 0 ? 0 : Math.round((honored / rows.length) * 100);

  const statusMeta: Record<AttendanceStatus, { color: string; label: string; icon: keyof typeof Ionicons.glyphMap }> = {
    present: { color: theme.success, label: t('history.present'), icon: 'checkmark-circle' },
    late: { color: theme.warn, label: t('history.late'), icon: 'time' },
    excused: { color: theme.info, label: t('history.excused'), icon: 'shield' },
    absent: { color: '#64748B', label: t('history.absent'), icon: 'close-circle' },
  };

  return (
    <View style={{ flex: 1 }}>
      <Header title={t('history.title')} back={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.s5, paddingBottom: 60, gap: 12 }}>
        <FadeIn index={0}>
          <Card>
            <Row between center>
              <View>
                <Txt variant="caption" color={theme.textMuted}>{t('history.commitment')}</Txt>
                <Txt variant="numberHero">{pct}%</Txt>
              </View>
              <Row gap={14}>
                {(['present', 'late', 'excused', 'absent'] as const).map((s) => (
                  <View key={s} style={{ alignItems: 'center', gap: 2 }}>
                    <Txt variant="h3" color={statusMeta[s].color}>{rows.filter((r) => r.att.status === s).length}</Txt>
                    <Txt variant="micro" color={theme.textMuted}>{statusMeta[s].label}</Txt>
                  </View>
                ))}
              </Row>
            </Row>
            <Spacer size={10} />
            <ProgressBar progress={pct / 100} color={theme.success} />
          </Card>
        </FadeIn>

        <FadeIn index={1}>
          <Row gap={8} wrap>
            {(['all', 'present', 'late', 'excused', 'absent'] as const).map((f) => (
              <Chip
                key={f}
                label={f === 'all' ? t('common.all') : statusMeta[f].label}
                active={filter === f}
                onPress={() => setFilter(f)}
              />
            ))}
          </Row>
        </FadeIn>

        {filtered.length === 0 ? (
          <Empty emoji="🗂️" title={t('history.emptyFilter')} />
        ) : (
          filtered.map(({ att, sess }, i) => {
            const batch = batchOf(db, sess.batchId);
            const course = batch ? courseOf(db, batch.courseId) : undefined;
            const meta = statusMeta[att.status];
            const points = att.status === 'present' ? 10 : att.status === 'late' ? 7 : 0;
            return (
              <FadeIn key={sess.id} index={Math.min(i, 6)}>
                <Card>
                  <Row center gap={12}>
                    <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: meta.color + '1F', alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name={meta.icon} size={22} color={meta.color} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Txt variant="bodyMed" numberOfLines={1}>{course?.title ?? ''}</Txt>
                      <Txt variant="caption" color={theme.textSecondary} numberOfLines={1}>{sess.title}</Txt>
                      <Txt variant="micro" color={theme.textMuted}>
                        {formatDate(sess.startsAt, lang)} · {formatTime(sess.startsAt, lang)}
                        {att.method === 'manual' ? ` · ${t('common.manual')}` : ''}
                      </Txt>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Tag label={meta.label} color={meta.color} bg={meta.color + '1F'} />
                      {points > 0 ? <Txt variant="micro" color={theme.success}>+{points}</Txt> : null}
                    </View>
                  </Row>
                </Card>
              </FadeIn>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}
