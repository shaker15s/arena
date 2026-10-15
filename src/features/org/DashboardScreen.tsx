import React, { useEffect, useRef, useState } from 'react';
import { Animated, RefreshControl, ScrollView, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { useApp } from '../../data/store';
import {
  courseOf, dashboardStats, profileOf, seatCounts,
} from '../../data/engine';
// «الجلسة القادمة على مجموعاتك» — نفس مصدر الطالب والمدرّب بلا حساب موازي.
import { nextAgendaItem } from '../../data/agenda';
import { formatTime, relativeDayLabel, startsIn } from '../../shared/format';
import { tPlural } from '../../shared/plural';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import {
  Btn, Card, Chip, CountUp, FadeIn, Header, ListRow,
  NotificationBell, Row, Screen, Spacer, Tag, Txt,
} from '../../design/components';
import { useTabs } from '../../app/RootNavigator';
import { radii, spacing } from '../../design/tokens';
import { isReducedMotion, springs } from '../../design/motion';
import type { Db } from '../../data/types';
import { toCsv, saveCsv } from '../../shared/export';
import { anticheatReport, needsAttention, orgWeeklyReport, setReportSubscription, type AnticheatReport, type NeedsAttentionItem, type WeeklyReport } from '../../data/actions';
import { useA11yPrefsOptional } from '../../design/preferences';
import { Icon } from '../../design/icons';

export function DashboardScreen({ navigation: propNav }: any) {
  const hookNav = useNavigation<any>();
  const navigation = propNav ?? hookNav;
  const { t } = useI18n();
  const { theme } = useTheme();
  const { db, user, unreadCount, refresh, syncing, lastSyncAt, toast } = useApp();
  const tabs = useTabs();
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [exporting, setExporting] = useState(false);
  // FUNC-09: لوحة «يحتاج تدخلك» — تُجلب من الخادم مرّة واحدة عند فتح اللوحة.
  const [attention, setAttention] = useState<NeedsAttentionItem[]>([]);
  // FUNC-12: ملخص التقرير الأسبوعي (نفس حساب الخادم بتوقيت القاهرة).
  const [weekly, setWeekly] = useState<WeeklyReport | null>(null);
  // FUNC-17: أحدث إشارات التدقيق ضد التلاعب (للمشرفين).
  const [signals, setSignals] = useState<AnticheatReport['rows']>([]);
  const [subBusy, setSubBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void (async () => {
      try {
        const [att, report] = await Promise.all([needsAttention(), orgWeeklyReport()]);
        if (!active) return;
        setAttention(att.items.filter((i) => i.count > 0 && i.key !== 'live_checkin' && i.key !== 'my_open_disputes'));
        setWeekly(report);
        if (user.role !== 'student') {
          const audit = await anticheatReport(30);
          if (active) setSignals(audit.rows.slice(0, 3));
        }
      } catch {
        /* اللوحة تعمل ببقية البيانات حتى لو تعذّر جلب الملخص */
      }
    })();
    return () => { active = false; };
  }, [user]);

  const toggleWeeklyReport = async () => {
    setSubBusy(true);
    try {
      await setReportSubscription({ enabled: true, cadence: 'weekly', dayOfWeek: 0, hourLocal: 7 });
      toast(t('dash.reportSubscribed'), 'success');
    } catch {
      toast(t('dash.reportSubFail'), 'error');
    } finally {
      setSubBusy(false);
    }
  };

  if (!user) return null;

  const stats = dashboardStats(db, branchFilter === 'all' ? undefined : branchFilter);

  const handleExportOrgCsv = async () => {
    try {
      setExporting(true);
      const rows: Array<Array<string | number>> = [
        ['تقرير المنظمة الشامل — مسار', new Date().toLocaleDateString('ar-EG')],
        [],
        ['إحصائيات المنظمة الحالية'],
        ['الفروع الكلية', stats.branchesCount],
        ['المجموعات النشطة', stats.activeBatches],
        ['إجمالي الطلاب النشطين', stats.students],
        ['متوسط الحضور العام (%)', `${stats.avgAttendance}%`],
        ['شهادات هذا الشهر', stats.certsMonth],
        [],
        ['ملخص الكورسات'],
        ['اسم الكورس', 'المجال', 'المجموعات الكلية', 'المجموعات النشطة', 'إجمالي المسجلين'],
        ...db.courses.map((c) => {
          const cBatches = db.batches.filter((b) => b.courseId === c.id);
          const active = cBatches.filter((b) => b.status === 'active').length;
          const totalStudents = cBatches.reduce((acc, b) => acc + seatCounts(db, b.id).taken, 0);
          return [c.title, c.field ?? '', cBatches.length, active, totalStudents];
        }),
        [],
        ['تفاصيل المجموعات'],
        ['رمز المجموعة', 'القاعة', 'الكورس', 'الفرع', 'المدرب', 'الحالة', 'المقاعد المشغولة', 'السعة'],
        ...db.batches.map((b) => {
          const c = courseOf(db, b.courseId);
          const br = db.branches.find((item) => item.id === b.branchId);
          const instructor = profileOf(db, b.instructorId);
          const sc = seatCounts(db, b.id);
          return [
            b.joinCode,
            b.room,
            c?.title ?? '',
            br?.name ?? '',
            instructor?.fullName ?? '',
            b.status,
            sc.taken,
            b.capacity,
          ];
        }),
      ];
      const csvContent = toCsv(rows);
      const dateStr = new Date().toISOString().split('T')[0];
      const ok = await saveCsv(`masar-org-report-${dateStr}.csv`, csvContent);
      if (ok) {
        toast(t('admin.exportSuccess'));
      } else {
        toast(t('admin.exportFailed'));
      }
    } catch {
      toast(t('admin.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Screen label={t('dash.title')} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: spacing.s5, paddingTop: spacing.s3, paddingBottom: spacing.s5, gap: spacing.s3 }}
        refreshControl={
          <RefreshControl
            refreshing={syncing}
            onRefresh={() => void refresh()}
            tintColor={theme.brand}
            colors={[theme.brand]}
          />
        }
      >
        <Header
          title={t('dash.title')}
          subtitle={`${t('dash.hello')} ${user.fullName} 👋`}
          onSubtitlePress={() => tabs.setTab('profile')}
          right={
            <NotificationBell count={unreadCount} onPress={() => navigation.navigate('Notifications')} />
          }
        />

        {/* فلتر الفروع */}
        <Row gap={spacing.s2} wrap>
          <Chip label={t('dash.allBranches')} active={branchFilter === 'all'} onPress={() => setBranchFilter('all')} />
          {db.branches.map((b) => (
            <Chip key={b.id} label={b.name.replace('فرع ', '')} active={branchFilter === b.id} onPress={() => setBranchFilter(b.id)} />
          ))}
        </Row>

        {lastSyncAt ? (
          <Txt variant="micro" color={theme.textMuted}>{t('common.lastSync')}</Txt>
        ) : null}
        <NeedsAttention db={db} t={t} navigation={navigation} />

        {/* ── الجلسة القادمة على مجموعاتي (منظّم/مشرف) ── */}
        <NextSessionCard db={db} userId={user.id} t={t} navigation={navigation} />

        {/* KPI Bento */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s3 }}>
          <KpiCard icon="business" color={theme.brand} value={stats.branchesCount} label={t('dash.branches')} index={0} />
          <KpiCard icon="people" color={theme.success} value={stats.activeBatches} label={t('dash.activeBatches')} index={1} />
          <KpiCard icon="school" color={theme.warn} value={stats.students} label={t('dash.activeStudents')} index={2} />
          <KpiCard icon="pulse" color={theme.teal} value={stats.avgAttendance} suffix="%" label={t('dash.avgAttendance')} index={3} />
          <KpiCard icon="ribbon" color={theme.certGold} value={stats.certsMonth} label={t('dash.certsMonth')} index={4} />
        </View>

        {/* تصدير تقارير المنظمة (CSV) - F9 */}
        <Btn
          variant="secondary"
          icon="download-outline"
          title={t('admin.exportCsv')}
          loading={exporting}
          onPress={handleExportOrgCsv}
        />

        {/* FUNC-09 — كل ما يحتاج تدخلك في بطاقة واحدة، وكل بند له إجراء */}
        {attention.length > 0 ? (
          <FadeIn index={5}>
            <Card>
              <Row between center style={{ marginBottom: spacing.s2 }}>
                <Txt variant="h3">{t('dash.attention')}</Txt>
                <Tag label={String(attention.reduce((a, i) => a + i.count, 0))} color={theme.warn} bg={theme.warnSoft} icon="alert" />
              </Row>
              <View style={{ gap: spacing.s2 }}>
                {attention.map((item) => (
                  <Row key={item.key} between center gap={spacing.s3}>
                    <Row center gap={spacing.s2} style={{ flex: 1 }}>
                      <Icon
                        name={item.urgency === 'high' ? 'alert-circle' : 'ellipse-outline'}
                        size={16}
                        color={item.urgency === 'high' ? theme.danger : theme.textMuted}
                      />
                      <Txt variant="caption" style={{ flex: 1 }}>{t(`dash.att.${item.key}` as any)}</Txt>
                    </Row>
                    <Tag label={String(item.count)} color={theme.brand} bg={theme.brandSoft} />
                    <Btn
                      title={t('dash.attOpen')}
                      size="sm"
                      variant="ghost"
                      onPress={() => {
                        if (item.key === 'attendance_disputes') navigation.navigate('Disputes', { mode: 'inbox' });
                        else if (item.key === 'stale_sessions') navigation.navigate('BatchesAdmin');
                        else navigation.navigate('Support');
                      }}
                    />
                  </Row>
                ))}
              </View>
            </Card>
          </FadeIn>
        ) : null}

        {/* FUNC-12 — التقرير الأسبوعي (أرقام الخادم بتوقيت القاهرة) */}
        {weekly ? (
          <FadeIn index={6}>
            <Card>
              <Row between center style={{ marginBottom: spacing.s2 }}>
                <Txt variant="h3">{t('dash.weekly')}</Txt>
                <Tag label={t('dash.weeklyTz')} color={theme.info} bg={theme.infoSoft} icon="time-outline" />
              </Row>
              <Row between center gap={spacing.s2} style={{ marginBottom: 6 }}>
                <Txt variant="caption" color={theme.textSecondary}>{t('dash.weeklyRate')}</Txt>
                <Txt variant="bodyMed" color={theme.success}>{weekly.attendance_rate}%</Txt>
              </Row>
              <Row between center gap={spacing.s2} style={{ marginBottom: 6 }}>
                <Txt variant="caption" color={theme.textSecondary}>{t('dash.weeklySessions')}</Txt>
                <Txt variant="bodyMed">{weekly.sessions_closed} / {weekly.sessions_total}</Txt>
              </Row>
              <Row between center gap={spacing.s2} style={{ marginBottom: spacing.s2 }}>
                <Txt variant="caption" color={theme.textSecondary}>{t('dash.weeklyMissing')}</Txt>
                <Txt variant="bodyMed" color={weekly.sessions_missing_report > 0 ? theme.warn : theme.textMuted}>
                  {weekly.sessions_missing_report}
                </Txt>
              </Row>
              <Btn
                title={t('dash.weeklySubscribe')}
                variant="secondary"
                size="sm"
                icon="mail-outline"
                loading={subBusy}
                onPress={() => void toggleWeeklyReport()}
              />
            </Card>
          </FadeIn>
        ) : null}

        {/* FUNC-17 — إشارات التدقيق ضد التلاعب (للمشرفين) */}
        {signals.length > 0 ? (
          <FadeIn index={7}>
            <Card>
              <Row center gap={spacing.s2} style={{ marginBottom: spacing.s2 }}>
                <Icon name="shield-half-outline" size={17} color={theme.brand} />
                <Txt variant="h3" style={{ flex: 1 }}>{t('dash.anticheat')}</Txt>
              </Row>
              <View style={{ gap: spacing.s2 }}>
                {signals.map((row) => (
                  <Row key={row.id} between center gap={spacing.s3}>
                    <View style={{ flex: 1 }}>
                      <Txt variant="caption">{t(`dash.sig.${row.signal}` as any)}</Txt>
                      <Txt variant="micro" color={theme.textMuted} numberOfLines={1}>
                        {row.student_name ?? row.session_title ?? ''}
                      </Txt>
                    </View>
                    <Tag
                      label={row.severity}
                      color={row.severity === 'high' ? theme.danger : row.severity === 'warn' ? theme.warn : theme.textMuted}
                      bg={theme.fill}
                    />
                  </Row>
                ))}
              </View>
            </Card>
          </FadeIn>
        ) : null}

        {/* اتجاه الحضور */}
        <FadeIn index={8}>
          <Card>
            <Row between center style={{ marginBottom: 12 }}>
              <Txt variant="h3">{t('dash.trend')}</Txt>
              <Tag label="6" color={theme.brand} bg={theme.brandSoft} icon="calendar" />
            </Row>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.s2, height: 110 }}>
              {stats.trend.map((v, i) => (
                <View key={i} style={{ flex: 1, alignItems: 'center', gap: spacing.s1 }}>
                  <Txt variant="micro" color={theme.textMuted}>{v}%</Txt>
                  <TrendBar
                    value={v}
                    index={i}
                    color={v >= 75 ? theme.success : v >= 50 ? theme.brand : theme.warn}
                    opacity={0.4 + (i / Math.max(stats.trend.length - 1, 1)) * 0.6}
                  />
                </View>
              ))}
            </View>
          </Card>
        </FadeIn>

        {/* إجراءات سريعة */}
        <FadeIn index={6}>
          <Txt variant="h3">{t('today.quickActions')}</Txt>
          <ListRow
            icon="rocket"
            title={t('dash.openWizard')}
            subtitle={t('dash.quickSetup')}
            onPress={() => navigation.navigate('Wizard')}
          />
          <Row gap={spacing.s2}>
            <View style={{ flex: 1 }}>
              <ListRow
                icon="ribbon"
                title={t('dash.issueCerts')}
                subtitle={t('dash.issueEligible')}
                onPress={() => navigation.navigate('IssueCertificates')}
                grow
              />
            </View>
            <View style={{ flex: 1 }}>
              <ListRow
                icon="albums"
                title={t('courses.title')}
                subtitle={t('dash.catalogManage')}
                onPress={() => navigation.navigate('Courses')}
                grow
              />
            </View>
          </Row>
          <ListRow
            icon="people"
            title={t('batchAdm.title')}
            subtitle={t('batchAdm.new')}
            onPress={() => navigation.navigate('BatchesAdmin')}
          />
        </FadeIn>
      </ScrollView>
    </Screen>
  );
}

/**
 * بطاقة «الجلسة القادمة» في لوحة المنظّم — كانت **مفقودة تمامًا**: المنظّم يرى
 * أرقامًا إجمالية فقط، ولا يعرف إن كانت عنده محاضرة بعد عشر دقائق.
 *
 * تعرض بحسب علاقته بالجلسة:
 *   • هو المدرّب ⇒ «محاضرتك الجاية» + زر «ابدأ الجلسة».
 *   • هو منظّم الكورس ⇒ «الجلسة القادمة في كورساتك» + اسم المدرّب.
 * وتستخدم نفس محرّك الأجندة المستخدم في شاشتي الطالب والمدرّب، فلا تتناقض
 * الأرقام بين الشاشات أبدًا.
 */
export function NextSessionCard({ db, userId, t, navigation }: { db: Db; userId: string; t: (k: any, p?: any) => string; navigation: any }) {
  const { theme } = useTheme();
  const { lang } = useI18n();
  const item = nextAgendaItem(db, userId);
  if (!item) {
    return (
      <FadeIn index={1}>
        <Card>
          <Row center gap={spacing.s3}>
            <Icon name="calendar-clear" size={22} color={theme.textMuted} />
            <Txt variant="caption" color={theme.textSecondary} style={{ flex: 1 }}>{t('org.noUpcoming')}</Txt>
          </Row>
        </Card>
      </FadeIn>
    );
  }
  const isMine = item.batch.instructorId === userId;
  const soon = item.msUntilStart >= 0 && item.msUntilStart < 60 * 60_000;
  const live = item.session.status === 'live' && !item.stale;
  const accent = live || soon ? theme.danger : theme.brand;
  const instructor = profileOf(db, item.batch.instructorId);
  return (
    <FadeIn index={1}>
      <Card
        onPress={() => navigation.navigate(isMine ? 'SessionsHistory' : 'BatchesAdmin')}
        accessibilityLabel={isMine ? t('org.nextSession') : t('org.courseNext')}
        accessibilityHint={t('day.hint')}
      >
        <Row between center>
          <Row center gap={spacing.s2}>
            <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: accent + '1A', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={live ? 'radio' : 'calendar'} size={13} color={accent} />
            </View>
            <Txt variant="caption" color={accent}>{isMine ? t('org.nextSession') : t('org.courseNext')}</Txt>
          </Row>
          <Tag
            label={live ? t('day.liveBadge') : soon ? t('org.upcomingSoon') : startsIn(item.startsAt, lang)}
            color={accent}
            bg={accent + '1A'}
            icon="time"
          />
        </Row>
        <View style={{ marginTop: spacing.s3, gap: spacing.s2 }}>
          <Txt variant="h3">{item.course?.title ?? item.session.title}</Txt>
          <Txt variant="caption" color={theme.textSecondary}>{item.session.title}</Txt>
          <Row wrap center gap={spacing.s3}>
            <Row center gap={spacing.s1}>
              <Icon name="calendar-outline" size={14} color={theme.textMuted} />
              <Txt variant="micro" color={theme.textMuted}>
                {relativeDayLabel(item.startsAt, lang)} · {formatTime(item.startsAt, lang)}
              </Txt>
            </Row>
            {item.batch.room ? (
              <Row center gap={spacing.s1}>
                <Icon name="location-outline" size={14} color={theme.textMuted} />
                <Txt variant="micro" color={theme.textMuted}>{item.batch.room}</Txt>
              </Row>
            ) : null}
            {!isMine && instructor ? (
              <Row center gap={spacing.s1}>
                <Icon name="person-outline" size={14} color={theme.textMuted} />
                <Txt variant="micro" color={theme.textMuted}>{instructor.fullName}</Txt>
              </Row>
            ) : null}
          </Row>
        </View>
      </Card>
    </FadeIn>
  );
}

function NeedsAttention({ db, t, navigation }: { db: Db; t: (k: any, p?: any) => string; navigation: any }) {
  const { theme } = useTheme();
  const pendingExcuses = db.excuses.filter((e) => e.status === 'pending').length;
  const liveSessions = db.sessions.filter((s) => s.status === 'live').length;
  const completedWithoutCert = db.batches.filter((b) => b.status === 'completed' && !db.certificates.some((c) => c.batchId === b.id)).length;
  if (pendingExcuses + liveSessions + completedWithoutCert === 0) return null;
  return (
    <FadeIn index={0}>
      <Card>
        <Txt variant="h3" style={{ marginBottom: spacing.s2 }}>{t('dash.needsAttention')}</Txt>
        <View style={{ gap: spacing.s2 }}>
          {pendingExcuses > 0 ? (
            <Card style={{ backgroundColor: theme.dangerSoft, borderStartWidth: 3, borderStartColor: theme.danger, padding: spacing.s3 }}>
              <ListRow icon="shield" title={tPlural(t as never, 'dash.pendingExcuses', pendingExcuses)} onPress={() => navigation.navigate('ExcusesInbox')} />
            </Card>
          ) : null}
          {liveSessions > 0 ? (
            <Card style={{ backgroundColor: theme.warnSoft, borderStartWidth: 3, borderStartColor: theme.warn, padding: spacing.s3 }}>
              <ListRow icon="radio" title={tPlural(t as never, 'dash.liveSessions', liveSessions)} onPress={() => navigation.navigate('BatchesAdmin')} />
            </Card>
          ) : null}
          {completedWithoutCert > 0 ? (
            <Card style={{ backgroundColor: theme.infoSoft, borderStartWidth: 3, borderStartColor: theme.info, padding: spacing.s3 }}>
              <ListRow icon="ribbon" title={t('dash.readyCerts')} subtitle={String(completedWithoutCert)} onPress={() => navigation.navigate('IssueCertificates')} />
            </Card>
          ) : null}
        </View>
      </Card>
    </FadeIn>
  );
}

function TrendBar({ value, index, color, opacity }: { value: number; index: number; color: string; opacity: number }) {
  const progress = useRef(new Animated.Value(isReducedMotion() ? 1 : 0)).current;
  useEffect(() => {
    if (isReducedMotion()) {
      Animated.timing(progress, { toValue: 1, duration: 100, useNativeDriver: false }).start();
      return;
    }
    // انتقال = spring موحّد (DS-08) — حُذف نظام easing الموازي من design/motion.
    Animated.spring(progress, {
      toValue: 1,
      delay: index * 55,
      useNativeDriver: false,
      ...springs.default,
    }).start();
  }, [index, progress]);
  return (
    <Animated.View style={{
      width: '100%', borderRadius: 6, backgroundColor: color, opacity,
      height: progress.interpolate({ inputRange: [0, 1], outputRange: [6, Math.max(6, (value / 100) * 80)] }),
    }} />
  );
}

function KpiCard({ icon, color, value, suffix, label, index }: { icon: keyof typeof Ionicons.glyphMap; color: string; value: number; suffix?: string; label: string; index: number }) {
  const { theme } = useTheme();
  // DESIGN-03: شبكة 48% بدل 30% — كانت صفوف الـ KPI غير متساوية
  // (3 في صف ثم 2 بـ 50%) فتظهر البطاقات «متناثرة» بين الصفين.
  return (
    <FadeIn index={index} style={{ flexGrow: 1, minWidth: 150, flexBasis: '48%' }}>
      <Card style={{ alignItems: 'center', gap: spacing.s2, paddingVertical: spacing.s4 }}>
        <View style={{ width: 44, height: 44, borderRadius: radii.md, backgroundColor: color + '1F', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={22} color={color} />
        </View>
        <Row center gap={spacing.s1}>
          <CountUp value={value} variant="numberHero" />
          {suffix ? <Txt variant="h3" color={color}>{suffix}</Txt> : null}
        </Row>
        <Txt variant="micro" align="center">{label}</Txt>
      </Card>
    </FadeIn>
  );
}
