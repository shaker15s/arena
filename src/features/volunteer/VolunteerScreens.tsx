/**
 * features/volunteer — S30 يوم المدرب + S31 مجموعاتي + S36 ملف الطالب + S37 سجل الجلسات.
 */
import React, { useMemo, useState } from 'react';
import { Platform, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useApp } from '../../data/store';
import {
  attendanceOf, attendancePct, batchOf, batchStudents, courseOf, instructorBatches,
  seatCounts, sessionsOfBatch,
} from '../../data/engine';
import {
  awardKudos, getSessionReport, notifySessionAbsentees, type SessionReportData,
} from '../../data/actions';
import { saveCsv, toCsv } from '../../shared/export';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import {
  Avatar, Btn, Card, Empty, FadeIn, Header, Input, ListRow, ProgressBar,
  Row, Segmented, Sheet, Spacer, Tag, Txt,
} from '../../design/components';
import { spacing, radii } from '../../design/tokens';
import { formatDate, formatTime, monthKeyOf, sameDay, uid } from '../../shared/format';
import { useTabs } from '../../app/RootNavigator';

// ───────────────────────────── S30 يوم المدرب ─────────────────────────────

export function VolunteerTodayScreen({ navigation }: any) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { db, user, refresh, syncing } = useApp();
  const tabs = useTabs();
  if (!user) return null;

  const batches = instructorBatches(db, user.id).filter((b) => b.status === 'active');
  const todaySessions = db.sessions.filter((s) => batches.some((b) => b.id === s.batchId) && s.status !== 'closed');
  const liveSession = todaySessions.find((s) => s.status === 'live');
  const nextSession = [...todaySessions].filter((s) => s.status === 'scheduled').sort((a, b) => a.startsAt - b.startsAt)[0];

  const pendingExcuses = db.excuses.filter((e) => {
    const s = db.sessions.find((x) => x.id === e.sessionId);
    return s && batches.some((b) => b.id === s.batchId) && e.status === 'pending';
  }).length;

  // متوسط حضور مجموعاتي
  const monthKey = monthKeyOf(Date.now());
  const monthAttendance = (() => {
    const sess = db.sessions.filter((s) => batches.some((b) => b.id === s.batchId) && s.status === 'closed');
    const rows = db.attendance.filter((a) => sess.some((s) => s.id === a.sessionId));
    if (rows.length === 0) return 0;
    return Math.round((rows.filter((a) => a.status !== 'absent').length / rows.length) * 100);
  })();

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
        <Header title={t('vtoday.title')} subtitle={`${t('dash.hello')} ${user.fullName.split(' ')[0]} 👋`} />

        {/* بطاقة محاضرة اليوم/الجارية */}
        {liveSession ? (
          <FadeIn index={0}>
            <Card color={theme.brand} style={{ borderColor: 'transparent' }}>
              <Row center gap={10}>
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#4ADE80' }} />
                <Txt variant="h3" color="#fff">{t('common.liveStatus')}</Txt>
              </Row>
              <Spacer size={8} />
              <Txt variant="h2" color="#fff">{liveSession.title}</Txt>
              <Txt variant="caption" color="rgba(255,255,255,0.85)">{courseOf(db, batchOf(db, liveSession.batchId)!.courseId)?.title}</Txt>
              <Spacer size={12} />
              <Btn title={t('vtoday.resumeSession')} variant="gold" icon="play" onPress={() => tabs.setTab('live')} />
            </Card>
          </FadeIn>
        ) : nextSession ? (
          <FadeIn index={0}>
            <Card>
              <Row center gap={10}>
                <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: theme.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="calendar" size={26} color={theme.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt variant="caption" color={theme.brand}>{t('vtoday.sessionToday')}</Txt>
                  <Txt variant="h3">{nextSession.title}</Txt>
                  <Txt variant="micro" color={theme.textMuted}>
                    {sameDay(nextSession.startsAt, Date.now()) ? t('common.today') : formatDate(nextSession.startsAt, lang)} · {formatTime(nextSession.startsAt, lang)} · {batchOf(db, nextSession.batchId)?.room}
                  </Txt>
                </View>
              </Row>
              <Spacer size={12} />
              <Btn title={t('vtoday.startSession')} icon="play" onPress={() => tabs.setTab('live')} />
            </Card>
          </FadeIn>
        ) : (
          <FadeIn index={0}>
            <Card>
              <Row center gap={10}>
                <Ionicons name="cafe" size={26} color={theme.teal} />
                <Txt variant="body" color={theme.textSecondary} style={{ flex: 1 }}>{t('vtoday.noSessionToday')}</Txt>
              </Row>
            </Card>
          </FadeIn>
        )}

        {/* إحصاءات سريعة */}
        <FadeIn index={2}>
          <Txt variant="h3">{t('vtoday.quickStats')}</Txt>
          <Spacer size={8} />
          <Row gap={10}>
            <StatCard icon="people" color={theme.brand} value={String(batches.length)} label={t('vtoday.activeBatches')} />
            <StatCard icon="checkmark-done" color={theme.success} value={`${monthAttendance}%`} label={t('vtoday.monthAttendance')} />
            <StatCard icon="shield" color={theme.warn} value={String(pendingExcuses)} label={t('vtoday.pendingExcuses')} onPress={() => tabs.setTab('inbox')} />
          </Row>
        </FadeIn>

        {/* جلساتي القادمة */}
        <FadeIn index={3}>
          <Row between center>
            <Txt variant="h3">{t('batches.title')}</Txt>
            <Btn title={t('common.seeAll')} size="sm" variant="ghost" onPress={() => tabs.setTab('batches')} />
          </Row>
          <Spacer size={8} />
          {batches.slice(0, 3).map((b) => {
            const course = courseOf(db, b.courseId)!;
            const closed = sessionsOfBatch(db, b.id).filter((s) => s.status === 'closed').length;
            return (
              <Card key={b.id} style={{ marginBottom: 10 }}>
                <Row center gap={12}>
                  <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: course.color + '22', alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="book" size={21} color={course.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt variant="bodyMed">{course.title}</Txt>
                    <Txt variant="micro" color={theme.textMuted}>
                      {b.schedule.days.map((d) => t(`dayShort.${d}` as any)).join(' + ')} {b.schedule.time} · {b.room}
                    </Txt>
                  </View>
                  <Tag label={t('journey.sessionXofY', { x: closed, y: course.sessionsCount })} color={theme.brand} bg={theme.brandSoft} />
                </Row>
              </Card>
            );
          })}
        </FadeIn>
      </ScrollView>
    </View>
  );
}

function StatCard({ icon, color, value, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; color: string; value: string; label: string; onPress?: () => void }) {
  return (
    <Card style={{ flex: 1, alignItems: 'center', gap: 4, paddingVertical: 14 }} onPress={onPress}>
      <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: color + '1F', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={17} color={color} />
      </View>
      <Txt variant="h3">{value}</Txt>
      <Txt variant="micro" align="center">{label}</Txt>
    </Card>
  );
}

// ───────────────────────────── S31 مجموعاتي ─────────────────────────────

export function MyBatchesScreen({ navigation }: any) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { db, user, refresh, syncing } = useApp();
  if (!user) return null;
  const batches = instructorBatches(db, user.id);

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
        <Header title={t('batches.title')} />
        {batches.map((b, i) => {
          const course = courseOf(db, b.courseId)!;
          const sess = sessionsOfBatch(db, b.id);
          const closed = sess.filter((s) => s.status === 'closed').length;
          const students = batchStudents(db, b.id);
          const attendedRowCount = db.attendance.filter((a) => sess.some((s) => s.id === a.sessionId && s.status === 'closed'));
          const avg = attendedRowCount.length === 0 ? 0 : Math.round((attendedRowCount.filter((a) => a.status !== 'absent').length / attendedRowCount.length) * 100);
          return (
            <FadeIn key={b.id} index={i}>
              <Card>
                <Row center gap={12}>
                  <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: course.color + '22', alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="book" size={24} color={course.color} />
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Txt variant="h3">{course.title}</Txt>
                    <Txt variant="micro" color={theme.textMuted}>
                      {b.schedule.days.map((d) => t(`dayShort.${d}` as any)).join(' + ')} · {b.schedule.time} · {b.room}
                    </Txt>
                    <Row center gap={8}>
                      <Tag label={t('batches.ofStudents', { x: students.length })} color={theme.brand} bg={theme.brandSoft} icon="people" />
                      <Tag label={`${t('batches.avgAttendance')} ${avg}%`} color={avg >= 75 ? theme.success : theme.warn} bg={avg >= 75 ? theme.successSoft : theme.warnSoft} icon="pulse" />
                    </Row>
                  </View>
                </Row>
                <Spacer size={10} />
                <Row between>
                  <Txt variant="micro" color={theme.textMuted}>{t('journey.sessionXofY', { x: closed, y: course.sessionsCount })}</Txt>
                  <Txt variant="micro" color={theme.brand}>{Math.round((closed / course.sessionsCount) * 100)}%</Txt>
                </Row>
                <Spacer size={5} />
                <ProgressBar progress={closed / course.sessionsCount} color={course.color} height={6} />
                <Spacer size={10} />
                <Row gap={8}>
                  <Btn title={t('management.detailsTitle')} size="sm" variant="secondary" icon="information-circle" onPress={() => navigation.navigate('CourseManagement', { batchId: b.id })} />
                  <Btn title={t('sess.title')} size="sm" variant="ghost" icon="archive" onPress={() => navigation.navigate('SessionsHistory', { batchId: b.id })} />
                </Row>
              </Card>
            </FadeIn>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ───────────────────────────── S37 سجل الجلسات ─────────────────────────────

export function SessionsHistoryScreen({ route, navigation }: any) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const { db, toast, user } = useApp();
  const batch = batchOf(db, route.params.batchId);
  const [report, setReport] = useState<SessionReportData | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [notifying, setNotifying] = useState(false);
  if (!batch || !user) return null;
  const course = courseOf(db, batch.courseId)!;
  const sessions = sessionsOfBatch(db, batch.id);
  const students = batchStudents(db, batch.id);

  /** فتح تقرير جلسة موثّق من الخادم. */
  const openReport = async (sessionId: string) => {
    setReportLoading(true);
    try {
      const data = await getSessionReport(sessionId);
      setReport(data);
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setReportLoading(false);
    }
  };

  /** إشعار المتغيبين عن الجلسة (إجراء واحد ذرّي على الخادم). */
  const notifyAbsentees = async () => {
    if (!report) return;
    setNotifying(true);
    try {
      const res = await notifySessionAbsentees(report.session_id);
      toast(t('sess.absenteesNotified', { x: res.notified }), 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setNotifying(false);
    }
  };

  /**
   * بناء صفوف كشف الحضور (طلاب × جلسات) — قابلة لإعادة الاستخدام بين CSV وPDF.
   */
  const buildAttendanceRows = () => {
    const statusLabel: Record<string, string> = {
      present: t('history.present'),
      late: t('history.late'),
      excused: t('history.excused'),
      absent: t('history.absent'),
    };
    const header = [
      t('common.name'), t('common.phone'),
      ...sessions.map((s) => `${s.seq}. ${s.title}`),
      `${t('issue.attendancePct')} %`,
    ];
    const body = students.map((st) => [
      st.fullName,
      st.phone,
      ...sessions.map((s) => {
        if (s.status !== 'closed') return '';
        const rec = attendanceOf(db, s.id, st.id);
        return statusLabel[rec?.status ?? 'absent'] ?? '';
      }),
      String(attendancePct(db, st.id, batch.id).pct),
    ]);
    return { header, body };
  };

  /** تصدير الكشف كملف CSV حقيقي (تنزيل/مشاركة). */
  const exportCsv = async () => {
    const { header, body } = buildAttendanceRows();
    const filename = `masar-${course.title.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`;
    const ok = await saveCsv(filename, toCsv([header, ...body]));
    toast(ok ? t('sess.exported') : t('common.errorTitle'), ok ? 'success' : 'error');
  };

  /** تصدير الكشف كملف PDF (طباعة/حفظ/مشاركة) — HTML بجدول مرتب RTL. */
  const exportPdf = async () => {
    const { header, body } = buildAttendanceRows();
    const esc = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char] ?? char));
    const th = header.map((h) => `<th>${esc(h)}</th>`).join('');
    const trs = body.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('');
    const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>
      @page{size:A4 landscape;margin:14mm} body{font-family:Arial,sans-serif;color:#1F2937;margin:0}
      h1{font-size:20px;margin:0 0 4px} .meta{font-size:12px;color:#6B7280;margin-bottom:16px}
      table{border-collapse:collapse;width:100%;font-size:11px} th,td{border:1px solid #D1D5DB;padding:6px;text-align:center}
      th{background:#F3F4F6;font-weight:bold} td:first-child,th:first-child{text-align:right}
    </style></head><body>
      <h1>${esc(`${course.title} — ${t('sess.title')}`)}</h1>
      <div class="meta">${esc(batch.room)} · ${esc(batch.schedule.days.map((d) => t(`dayShort.${d}` as any)).join(' + '))} ${esc(batch.schedule.time)} · ${esc(new Date().toLocaleDateString())}</div>
      <table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>
    </body></html>`;

    if (Platform.OS === 'web') {
      await Print.printAsync({ html });
    } else {
      const file = await Print.printToFileAsync({ html, base64: false });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: t('sess.export') });
      } else {
        toast(file.uri, 'success');
      }
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Header title={`${course.title} — ${t('sess.title')}`} back={() => navigation.goBack()} right={
        <Row gap={6}>
          <Btn title={t('sess.exportCsv')} size="sm" variant="ghost" icon="download" onPress={exportCsv} />
          <Btn title={t('sess.exportPdf')} size="sm" variant="ghost" icon="document-text" onPress={exportPdf} />
        </Row>
      } />
      <ScrollView contentContainerStyle={{ padding: spacing.s5, gap: 12, paddingBottom: 40 }}>
        {/* الطلاب */}
        <FadeIn index={0}>
          <Txt variant="h3">{t('common.students')} ({students.length})</Txt>
          <Spacer size={8} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {students.map((st) => {
              const { pct } = attendancePct(db, st.id, batch.id);
              return (
                <Card key={st.id} onPress={() => navigation.navigate('StudentRecord', { userId: st.id, batchId: batch.id })} style={{ paddingVertical: 10, paddingHorizontal: 12 }}>
                  <Row center gap={8}>
                    <Avatar name={st.fullName} color={st.avatarColor} size={30} />
                    <View>
                      <Txt variant="caption">{st.fullName}</Txt>
                      <Txt variant="micro" color={pct >= 75 ? theme.success : theme.warn}>{pct}%</Txt>
                    </View>
                  </Row>
                </Card>
              );
            })}
          </View>
        </FadeIn>

        <Spacer size={8} />
        <FadeIn index={1}>
          <Txt variant="h3">{t('common.sessions')}</Txt>
          <Spacer size={8} />
          {sessions.map((s) => {
            const rows = db.attendance.filter((a) => a.sessionId === s.id);
            const presentCount = rows.filter((a) => a.status !== 'absent').length;
            const statusColor = s.status === 'closed' ? theme.success : s.status === 'live' ? theme.brand : theme.textMuted;
            return (
              <Card key={s.id} style={{ marginBottom: 8 }}>
                <Row center gap={12}>
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: statusColor + '1F', alignItems: 'center', justifyContent: 'center' }}>
                    <Txt variant="micro" color={statusColor}>{s.seq}</Txt>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt variant="bodyMed" numberOfLines={1}>{s.title}</Txt>
                    <Txt variant="micro" color={theme.textMuted}>{formatDate(s.startsAt, lang)} · {formatTime(s.startsAt, lang)}</Txt>
                  </View>
                  {s.status === 'closed' ? (
                    <Tag label={`${presentCount}/${rows.length}`} color={theme.brand} bg={theme.brandSoft} icon="people" />
                  ) : (
                    <Tag label={t(`common.${s.status === 'live' ? 'liveStatus' : 'scheduledStatus'}` as any)} color={statusColor} bg={statusColor + '1F'} />
                  )}
                </Row>
                {s.report?.done ? (
                  <Row center gap={6} style={{ marginTop: 6 }}>
                    <Ionicons name="document-text" size={12} color={theme.success} />
                    <Txt variant="micro" color={theme.textSecondary} numberOfLines={1}>{s.report.done}</Txt>
                  </Row>
                ) : null}
                {s.status === 'closed' ? (
                  <Btn title={t('sess.report')} size="sm" variant="ghost" icon="stats-chart" onPress={() => { void openReport(s.id); }} />
                ) : null}
              </Card>
            );
          })}
        </FadeIn>
      </ScrollView>

      {/* تقرير الجلسة + إشعار المتغيبين */}
      <Sheet visible={report != null} onClose={() => setReport(null)} title={report?.title ? `${t('sess.report')} — ${report.title}` : t('sess.report')}>
        {reportLoading ? (
          <Txt variant="caption" color={theme.textMuted} align="center" style={{ padding: 20 }}>{t('common.loading')}</Txt>
        ) : report ? (
          <View style={{ gap: 10 }}>
            <Row gap={10}>
              <ReportStat label={t('history.present')} value={report.present} color={theme.success} />
              <ReportStat label={t('history.late')} value={report.late} color={theme.warn} />
              <ReportStat label={t('history.excused')} value={report.excused} color={theme.info} />
              <ReportStat label={t('history.absent')} value={report.absent} color={theme.danger} />
            </Row>
            <Card glass>
              <Row between center>
                <Row center gap={6}>
                  <Ionicons name="people" size={14} color={theme.brand} />
                  <Txt variant="caption" color={theme.textSecondary}>{t('sess.expected')}</Txt>
                </Row>
                <Txt variant="h3">{report.expected}</Txt>
              </Row>
              <Spacer size={8} />
              <Row between center>
                <Txt variant="caption" color={theme.textSecondary}>{t('sess.attendancePct')}</Txt>
                <Txt variant="h3" color={report.total === 0 ? theme.textMuted : (report.total - report.absent - report.excused >= report.total * 0.75 ? theme.success : theme.warn)}>
                  {report.total === 0 ? '—' : `${Math.round(((report.total - report.absent - report.excused) / report.total) * 100)}%`}
                </Txt>
              </Row>
            </Card>
            {report.absent > 0 ? (
              <Btn title={t('sess.notifyAbsentees', { x: report.absent })} variant="secondary" icon="notifications" loading={notifying} onPress={notifyAbsentees} />
            ) : null}
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}

function ReportStat({ label, value, color }: { label: string; value: number; color: string }) {
  const { theme } = useTheme();
  return (
    <Card style={{ flex: 1, alignItems: 'center', gap: 3, paddingVertical: 12 }}>
      <Txt variant="h3" color={color}>{value}</Txt>
      <Txt variant="micro" color={theme.textMuted} align="center">{label}</Txt>
    </Card>
  );
}

// ───────────────────────────── S36 ملف الطالب ─────────────────────────────

export function StudentRecordScreen({ route, navigation }: any) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const { db, user, mutate, refresh, toast } = useApp();
  const student = db.profiles.find((p) => p.id === route.params.userId);
  const batch = batchOf(db, route.params.batchId);
  const [note, setNote] = useState('');
  const [kudosOpen, setKudosOpen] = useState(false);
  const [kudosPts, setKudosPts] = useState('10');
  const [kudosReason, setKudosReason] = useState('');
  const [kudosRequestId, setKudosRequestId] = useState(() => uid());
  const [sending, setSending] = useState(false);

  if (!student || !batch || !user) return null;
  const course = courseOf(db, batch.courseId)!;
  const sess = sessionsOfBatch(db, batch.id);
  const { pct, honored, total } = attendancePct(db, student.id, batch.id);

  const noteRow = db.privateNotes.find((n) => n.instructorId === user.id && n.userId === student.id);
  const month = monthKeyOf(Date.now());
  const quotaRule = db.rules.find((r) => r.key === 'kudos.monthly_quota_per_instructor');
  const quota = typeof quotaRule?.value === 'number' ? quotaRule.value : 200;
  const spent = db.kudosQuotas.find((q) => q.instructorId === user.id && q.month === month)?.spent ?? 0;
  const left = quota - spent;

  const saveNote = async () => {
    await mutate((d) => {
      const row = d.privateNotes.find((n) => n.instructorId === user.id && n.userId === student.id);
      if (row) { row.note = note; row.updatedAt = Date.now(); }
      else d.privateNotes.push({ instructorId: user.id, userId: student.id, note, updatedAt: Date.now() });
    });
    toast(t('student.privateNoteSaved'), 'success');
  };

  const sendKudos = async () => {
    const pts = parseInt(kudosPts, 10);
    if (!kudosReason.trim()) return;
    setSending(true);
    try {
      await awardKudos({
        studentId: student.id,
        batchId: batch.id,
        points: pts,
        reason: kudosReason.trim(),
        idempotencyKey: kudosRequestId,
      });
      await refresh();
      setKudosOpen(false);
      setKudosReason('');
      setKudosRequestId(uid());
      toast(t('student.awarded'), 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setSending(false);
    }
  };

  const attendanceMeta = (st?: string) =>
    st === 'present' ? { icon: 'checkmark-circle', color: theme.success }
    : st === 'late' ? { icon: 'time', color: theme.warn }
    : st === 'excused' ? { icon: 'shield', color: theme.info }
    : st === 'absent' ? { icon: 'close-circle', color: '#64748B' }
    : { icon: 'ellipse-outline', color: theme.line };

  return (
    <View style={{ flex: 1 }}>
      <Header title={t('student.title')} back={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: spacing.s5, gap: 14, paddingBottom: 60 }}>
        <FadeIn index={0}>
          <Card style={{ alignItems: 'center', paddingVertical: 18, gap: 8 }}>
            <Avatar name={student.fullName} color={student.avatarColor} size={72} />
            <Txt variant="h2">{student.fullName}</Txt>
            <Txt variant="caption" color={theme.textSecondary}>{course.title} · {student.phone}</Txt>
            <Row gap={16} style={{ marginTop: 4 }}>
              <View style={{ alignItems: 'center' }}>
                <Txt variant="h3" color={pct >= 75 ? theme.success : theme.warn}>{pct}%</Txt>
                <Txt variant="micro" color={theme.textMuted}>{t('issue.attendancePct')}</Txt>
              </View>
              <View style={{ alignItems: 'center' }}>
                <Txt variant="h3">{honored}/{total}</Txt>
                <Txt variant="micro" color={theme.textMuted}>{t('users.sessionsAttended')}</Txt>
              </View>
            </Row>
          </Card>
        </FadeIn>

        {/* سجل المحاضرات */}
        <FadeIn index={1}>
          <Txt variant="h3">{t('common.sessions')}</Txt>
          <Spacer size={8} />
          <Card noPad>
            {sess.filter((s) => s.status === 'closed').map((s, i, arr) => {
              const att = db.attendance.find((a) => a.sessionId === s.id && a.userId === student.id);
              const meta = attendanceMeta(att?.status);
              return (
                <Row key={s.id} center gap={10} style={{ padding: 12, borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: theme.line }}>
                  <Ionicons name={meta.icon as any} size={20} color={meta.color} />
                  <View style={{ flex: 1 }}>
                    <Txt variant="caption">{s.title}</Txt>
                    <Txt variant="micro" color={theme.textMuted}>{formatDate(s.startsAt, lang)}{att?.method === 'manual' ? ` · ${t('common.manual')}` : ''}{att?.note ? ` · ${att.note}` : ''}</Txt>
                  </View>
                </Row>
              );
            })}
          </Card>
        </FadeIn>

        {/* منح تقدير */}
        <FadeIn index={2}>
          <Card>
            <Row between center>
              <Row center gap={8}>
                <Ionicons name="heart" size={19} color={theme.danger} />
                <Txt variant="bodyMed">{t('student.kudos')}</Txt>
              </Row>
              <Tag label={t('student.kudosLeft', { x: left })} color={left > 0 ? theme.brand : theme.danger} bg={left > 0 ? theme.brandSoft : theme.dangerSoft} />
            </Row>
            <Spacer size={10} />
            <Btn title={t('student.award')} icon="add" full disabled={left <= 0} onPress={() => setKudosOpen(true)} />
          </Card>
        </FadeIn>

        {/* ملاحظات خاصة */}
        <FadeIn index={3}>
          <Card>
            <Row center gap={8} style={{ marginBottom: 8 }}>
              <Ionicons name="lock-closed" size={15} color={theme.textMuted} />
              <Txt variant="caption" color={theme.textMuted}>{t('student.notes')}</Txt>
            </Row>
            <Input value={note || noteRow?.note || ''} onChange={setNote} placeholder={t('student.notesPlaceholder')} multiline />
            <Spacer size={8} />
            <Btn title={t('common.save')} size="sm" variant="secondary" onPress={saveNote} disabled={!note.trim()} />
          </Card>
        </FadeIn>
      </ScrollView>

      {/* نافذة التقدير */}
      <Sheet visible={kudosOpen} onClose={() => setKudosOpen(false)} title={t('student.kudos')}>
        <View style={{ gap: 12 }}>
          <Row gap={8} wrap>
            {[5, 10, 15, 20, 25].map((p) => (
              <Btn key={p} title={`+${p}`} variant={kudosPts === String(p) ? 'primary' : 'ghost'} size="sm" onPress={() => setKudosPts(String(p))} />
            ))}
          </Row>
          <Input value={kudosReason} onChange={setKudosReason} placeholder={t('student.kudosReason')} multiline />
          <Txt variant="micro" color={theme.textMuted}>{t('student.kudosLeft', { x: left })}</Txt>
          <Btn title={t('student.award')} full size="lg" loading={sending} onPress={sendKudos} icon="heart" disabled={!kudosReason.trim()} />
        </View>
      </Sheet>
    </View>
  );
}
