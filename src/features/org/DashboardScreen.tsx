import React, { useEffect, useRef, useState } from 'react';
import { Animated, RefreshControl, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useApp } from '../../data/store';
import {
  courseOf, dashboardStats, profileOf, seatCounts,
} from '../../data/engine';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import {
  Btn, Card, Chip, CountUp, FadeIn, Header, ListRow,
  NotificationBell, Row, Spacer, Tag, Txt,
} from '../../design/components';
import { useTabs } from '../../app/RootNavigator';
import { spacing } from '../../design/tokens';
import { easing, isReducedMotion } from '../../design/motion';
import type { Db } from '../../data/types';
import { toCsv, saveCsv } from '../../shared/export';

export function DashboardScreen({ navigation: propNav }: any) {
  const hookNav = useNavigation<any>();
  const navigation = propNav ?? hookNav;
  const { t } = useI18n();
  const { theme } = useTheme();
  const { db, user, unreadCount, refresh, syncing, lastSyncAt, toast } = useApp();
  const tabs = useTabs();
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [exporting, setExporting] = useState(false);
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
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: spacing.s3, padding: spacing.s5, gap: 14, paddingBottom: 130 }}
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
        <Row gap={8} wrap>
          <Chip label={t('dash.allBranches')} active={branchFilter === 'all'} onPress={() => setBranchFilter('all')} />
          {db.branches.map((b) => (
            <Chip key={b.id} label={b.name.replace('فرع ', '')} active={branchFilter === b.id} onPress={() => setBranchFilter(b.id)} />
          ))}
        </Row>

        {lastSyncAt ? (
          <Txt variant="micro" color={theme.textMuted}>{t('common.lastSync')}</Txt>
        ) : null}
        <NeedsAttention db={db} t={t} navigation={navigation} />

        {/* KPI Bento */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
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
          <Spacer size={8} />
          <ListRow
            icon="rocket"
            title={t('dash.openWizard')}
            subtitle={t('dash.quickSetup')}
            onPress={() => navigation.navigate('Wizard')}
          />
          <Spacer size={8} />
          <Row gap={8}>
            <View style={{ flex: 1 }}>
              <ListRow
                icon="ribbon"
                title={t('dash.issueCerts')}
                subtitle={t('dash.issueEligible')}
                onPress={() => navigation.navigate('IssueCertificates')}
              />
            </View>
            <View style={{ flex: 1 }}>
              <ListRow
                icon="albums"
                title={t('courses.title')}
                subtitle={t('dash.catalogManage')}
                onPress={() => navigation.navigate('Courses')}
              />
            </View>
          </Row>
          <Spacer size={8} />
          <ListRow
            icon="people"
            title={t('batchAdm.title')}
            subtitle={t('batchAdm.new')}
            onPress={() => navigation.navigate('BatchesAdmin')}
          />
        </FadeIn>
      </ScrollView>
    </View>
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
        <Txt variant="h3" style={{ marginBottom: 10 }}>{t('dash.needsAttention')}</Txt>
        <View style={{ gap: 8 }}>
          {pendingExcuses > 0 ? (
            <Card style={{ backgroundColor: theme.dangerSoft, borderStartWidth: 3, borderStartColor: theme.danger, padding: 12 }}>
              <ListRow icon="shield" title={t('dash.pendingExcuses', { x: pendingExcuses })} onPress={() => navigation.navigate('Inbox')} />
            </Card>
          ) : null}
          {liveSessions > 0 ? (
            <Card style={{ backgroundColor: theme.warnSoft, borderStartWidth: 3, borderStartColor: theme.warn, padding: 12 }}>
              <ListRow icon="radio" title={t('dash.liveSessions', { x: liveSessions })} />
            </Card>
          ) : null}
          {completedWithoutCert > 0 ? (
            <Card style={{ backgroundColor: theme.infoSoft, borderStartWidth: 3, borderStartColor: theme.info, padding: 12 }}>
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
    Animated.timing(progress, {
      toValue: 1,
      duration: isReducedMotion() ? 100 : 520,
      delay: isReducedMotion() ? 0 : index * 55,
      easing: easing.standard,
      useNativeDriver: false,
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
