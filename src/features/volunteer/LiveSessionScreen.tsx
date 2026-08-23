/**
 * features/volunteer — S32 الجلسة الحية (شاشة البروجكتور).
 * QR دوّار كل 25 ثانية + كود احتياطي + عداد حضور حي + آخر الواصلين
 * + رصد يدوي بسبب إلزامي + إنهاء ← تقرير 3 حقول + محاسبة تلقائية.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import Svg, { Circle } from 'react-native-svg';
import { useApp } from '../../data/store';
import {
  backupCodeOf, batchOf, batchStudents, courseOf, currentQrToken, profileOf,
  qrSlotOf, rpcCloseSession, rpcManualMark, rpcStartSession, simulateArrival,
} from '../../data/engine';
import { QR_ROTATION_MS } from '../../data/rules';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import {
  Avatar, Btn, Card, CountUp, Empty, FadeIn, Header, Input, Row, Sheet,
  Spacer, Tag, Txt,
} from '../../design/components';
import { CelebrationModal } from '../../design/celebrations';
import { spacing, radii } from '../../design/tokens';
import { formatTime } from '../../shared/format';
import { useTabs } from '../../app/RootNavigator';
import { TrainingSession } from '../../data/types';

export function LiveSessionScreen() {
  const { t, lang } = useI18n();
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { db, user, mutate, toast } = useApp();
  const tabs = useTabs();
  const [, setTick] = useState(0);
  const [starting, setStarting] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [endConfirm, setEndConfirm] = useState(false);
  const [reportStep, setReportStep] = useState(false);
  const [done, setDone] = useState('');
  const [planned, setPlanned] = useState('');
  const [challenges, setChallenges] = useState('');
  const [closing, setClosing] = useState(false);
  const [closedSummary, setClosedSummary] = useState<null | { present: number; absent: number; total: number }>(null);
  const [trickle, setTrickle] = useState(false);
  const fakeArrivals = useRef(false);

  // نبضة ساعة للتدوير (كل 500ms)
  useEffect(() => {
    const iv = setInterval(() => setTick((x) => x + 1), 500);
    return () => clearInterval(iv);
  }, []);

  if (!user) return null;
  const myBatches = db.batches.filter((b) => b.instructorId === user.id);
  const myLive = db.sessions.find((s) => s.status === 'live' && myBatches.some((b) => b.id === s.batchId));
  const batchWithScheduled = myBatches.find((b) => db.sessions.some((s) => s.batchId === b.id && s.status === 'scheduled'));

  // محاكاة وصول طلاب تجريبي أثناء العرض
  useEffect(() => {
    if (!trickle || !myLive || !user) return;
    fakeArrivals.current = true;
    const iv = setInterval(async () => {
      const r = await mutate((d) => simulateArrival(d, myLive.id));
      if (!r) setTrickle(false);
    }, 9000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trickle, myLive?.id]);

  const start = async () => {
    if (!batchWithScheduled) return;
    setStarting(true);
    await mutate((d) => rpcStartSession(d, batchWithScheduled.id, user.id));
    setStarting(false);
  };

  const endAndReport = async () => {
    if (!myLive) return;
    setClosing(true);
    const report = { done: done.trim(), planned: planned.trim(), challenges: challenges.trim(), submittedAt: Date.now() };
    const summary = await mutate((d) => rpcCloseSession(d, myLive.id, user.id, report));
    setClosing(false);
    setReportStep(false);
    setEndConfirm(false);
    setClosedSummary({ present: summary.present + summary.late, absent: summary.absent, total: summary.total });
    toast(t('live.closedSnack'), 'success');
    toast(t('report.sent'), 'success');
  };

  // ── الحالة 1: لا جلسة حية ──
  if (!myLive) {
    const nextSess = batchWithScheduled
      ? db.sessions.filter((s) => s.batchId === batchWithScheduled.id && s.status === 'scheduled').sort((a, b) => a.startsAt - b.startsAt)[0]
      : undefined;
    return (
      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.s3, padding: spacing.s5, gap: 14, alignItems: 'center', paddingBottom: 130 }}>
          <Header title={t('live.title')} />
          <Empty emoji="🎬" title={closedSummary ? `${t('live.closedSnack')}` : t('vtoday.noSessionToday')} />
          {closedSummary ? (
            <Card style={{ alignSelf: 'stretch' }}>
              <Row center gap={12} style={{ justifyContent: 'center' }}>
                <View style={{ alignItems: 'center' }}>
                  <Txt variant="display" color={theme.success}>{closedSummary.present}</Txt>
                  <Txt variant="caption" color={theme.textMuted}>{t('history.present')}</Txt>
                </View>
                <Txt variant="display" color={theme.textMuted}>/</Txt>
                <View style={{ alignItems: 'center' }}>
                  <Txt variant="display">{closedSummary.total}</Txt>
                  <Txt variant="caption" color={theme.textMuted}>{t('common.students')}</Txt>
                </View>
                <View style={{ alignItems: 'center', marginStart: 12 }}>
                  <Txt variant="display" color={theme.danger}>{closedSummary.absent}</Txt>
                  <Txt variant="caption" color={theme.textMuted}>{t('history.absent')}</Txt>
                </View>
              </Row>
            </Card>
          ) : null}
          {batchWithScheduled && nextSess ? (
            <Card style={{ alignSelf: 'stretch' }}>
              <Txt variant="h3">{nextSess.title}</Txt>
              <Txt variant="caption" color={theme.textSecondary}>
                {courseOf(db, batchWithScheduled.courseId)?.title} · {formatTime(nextSess.startsAt, lang)} · {batchWithScheduled.room}
              </Txt>
              <Spacer size={12} />
              <Btn title={t('vtoday.startSession')} size="lg" full loading={starting} onPress={start} icon="play" />
            </Card>
          ) : null}
        </ScrollView>
        {renderClosedModal()}
      </View>
    );
  }

  // ── الحالة 2: جلسة حية — شاشة العرض ──
  const batch = batchOf(db, myLive.batchId)!;
  const course = courseOf(db, batch.courseId)!;
  const now = Date.now();
  const token = currentQrToken(myLive, now);
  const slot = qrSlotOf(myLive, now);
  const slotProgress = 1 - ((now - (myLive.startedAt ?? myLive.startsAt) - slot * QR_ROTATION_MS) / QR_ROTATION_MS);
  const code = backupCodeOf(myLive);
  const students = batchStudents(db, batch.id);
  const rows = db.attendance.filter((a) => a.sessionId === myLive.id && a.status !== 'absent');
  const recent = [...rows].sort((a, b) => (b.checkedInAt ?? 0) - (a.checkedInAt ?? 0)).slice(0, 4);

  return (
    <View style={{ flex: 1, backgroundColor: isDark ? theme.bg : '#0E1230' }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.s3, padding: spacing.s5, gap: 16, paddingBottom: 130 }}>
        {/* رأس الجلسة */}
        <FadeIn index={0}>
          <Row between center>
            <View style={{ flex: 1 }}>
              <Row center gap={8}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#4ADE80' }} />
                <Txt variant="caption" color="#4ADE80">{t('common.liveStatus')}</Txt>
              </Row>
              <Txt variant="h1" color="#F1F5F9">{myLive.title}</Txt>
              <Txt variant="caption" color="#A8B0C2">{course.title} · {batch.room}</Txt>
            </View>
          </Row>
        </FadeIn>

        <Row gap={14} style={{ alignItems: 'stretch' }} wrap>
          {/* QR العملاق */}
          <FadeIn index={1} style={{ flexGrow: 1, minWidth: 280 }}>
            <Card color="rgba(255,255,255,0.06)" style={{ borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', paddingVertical: 24, gap: 12 }}>
              <View style={{ position: 'relative', alignItems: 'center', justifyContent: 'center' }}>
                <RingCountdown progress={slotProgress} size={236} />
                <View style={{ backgroundColor: '#fff', padding: 14, borderRadius: 20 }}>
                  <QRCode value={token} size={176} />
                </View>
              </View>
              <Row center gap={8}>
                <Txt variant="micro" color="#5B6478">{t('live.codeLabel')}:</Txt>
                <View style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 4 }}>
                  <Txt variant="h2" color="#F1F5F9" style={{ letterSpacing: 6 }}>{code}</Txt>
                </View>
              </Row>
            </Card>
          </FadeIn>

          {/* العداد الحي + آخر الواصلين */}
          <FadeIn index={2} style={{ flexGrow: 1, minWidth: 280 }}>
            <View style={{ gap: 12 }}>
              <Card color="rgba(255,255,255,0.06)" style={{ borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', paddingVertical: 20 }}>
                <Txt variant="caption" color="#A8B0C2">{t('live.attendanceNow')}</Txt>
                <Row center gap={8} style={{ alignItems: 'flex-end' }}>
                  <CountUp value={rows.length} variant="display" color="#4ADE80" />
                  <Txt variant="h2" color="#5B6478" style={{ marginBottom: 4 }}>{t('live.of')} {students.length}</Txt>
                </Row>
                <View style={{ alignSelf: 'stretch', marginTop: 8 }}>
                  <View style={{ height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                    <View style={{ height: 8, width: `${Math.round((rows.length / Math.max(students.length, 1)) * 100)}%`, backgroundColor: '#4ADE80' }} />
                  </View>
                </View>
              </Card>

              <Card color="rgba(255,255,255,0.06)" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
                <Txt variant="caption" color="#A8B0C2" style={{ marginBottom: 8 }}>{t('live.recentArrivals')}</Txt>
                {recent.length === 0 ? (
                  <Txt variant="caption" color="#5B6478">{t('live.waiting')}</Txt>
                ) : (
                  <View style={{ gap: 8 }}>
                    {recent.map((r) => {
                      const st = profileOf(db, r.userId);
                      if (!st) return null;
                      return (
                        <Row key={r.userId} center gap={8}>
                          <Avatar name={st.fullName} color={st.avatarColor} size={32} />
                          <View style={{ flex: 1 }}>
                            <Txt variant="caption" color="#F1F5F9">{st.fullName}</Txt>
                          </View>
                          <Tag
                            label={r.status === 'late' ? t('history.late') : t('history.present')}
                            color={r.status === 'late' ? theme.warn : '#4ADE80'}
                            bg="rgba(255,255,255,0.08)"
                            icon={r.method === 'manual' ? 'hand-left' : r.method === 'code' ? 'keypad' : 'qr-code'}
                          />
                        </Row>
                      );
                    })}
                  </View>
                )}
              </Card>
            </View>
          </FadeIn>
        </Row>

        {/* أزرار التحكم */}
        <FadeIn index={3}>
          <Row gap={10} wrap>
            <Btn title={t('live.manualMark')} variant="secondary" icon="hand-left" onPress={() => setManualOpen(true)} />
            <Btn
              title={`${t('live.demoTrickle')} ${trickle ? '⏸' : '▶'}`}
              variant="ghost"
              icon="flask"
              style={{ borderColor: 'rgba(255,255,255,0.2)' }}
              onPress={() => setTrickle((x) => !x)}
            />
            <View style={{ flex: 1 }} />
            <Btn title={t('live.endSession')} variant="danger" icon="stop-circle" onPress={() => setEndConfirm(true)} />
          </Row>
        </FadeIn>
      </ScrollView>

      {/* تأكيد الإنهاء */}
      <Sheet visible={endConfirm && !reportStep} onClose={() => setEndConfirm(false)} title={t('live.endSession')}>
        <View style={{ gap: 12 }}>
          <Row center gap={10}>
            <Ionicons name="warning" size={26} color={theme.warn} />
            <Txt variant="body" color={theme.textSecondary} style={{ flex: 1 }}>{t('live.endConfirm')}</Txt>
          </Row>
          <Row gap={10}>
            <Btn title={t('common.confirm')} variant="danger" onPress={() => setReportStep(true)} />
            <Btn title={t('common.cancel')} variant="ghost" onPress={() => setEndConfirm(false)} />
          </Row>
        </View>
      </Sheet>

      {/* تقرير الجلسة — 3 حقول فقط */}
      <Sheet visible={reportStep} onClose={() => {}} title={`${t('report.title')} — ${myLive.title}`}>
        <ScrollView>
          <View style={{ gap: 12 }}>
            <Card glass>
              <Row center gap={8}>
                <Ionicons name="people" size={16} color={theme.brand} />
                <Txt variant="bodyMed">{t('report.summary', { x: rows.length, y: students.length })}</Txt>
              </Row>
            </Card>
            <Input label={`✍️ ${t('report.done')}`} value={done} onChange={setDone} multiline />
            <Input label={`📌 ${t('report.planned')}`} value={planned} onChange={setPlanned} multiline />
            <Input label={`⚠️ ${t('report.challenges')}`} value={challenges} onChange={setChallenges} multiline />
            <Btn title={t('report.submit')} size="lg" full loading={closing} onPress={endAndReport} icon="send" />
          </View>
        </ScrollView>
      </Sheet>

      {/* الرصد اليدوي */}
      <ManualMarkSheet visible={manualOpen} onClose={() => setManualOpen(false)} session={myLive} />
      {renderClosedModal()}
    </View>
  );

  function renderClosedModal() {
    return (
      <CelebrationModal
        visible={closedSummary != null}
        onClose={() => setClosedSummary(null)}
        title={t('live.closedSnack')}
        subtitle={closedSummary ? t('report.summary', { x: closedSummary.present, y: closedSummary.total }) : undefined}
        emoji="📋"
      />
    );
  }
}

// ── حلقة عداد التدوير ──
function RingCountdown({ progress, size }: { progress: number; size: number }) {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));
  return (
    <View style={{ position: 'absolute', width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.12)" strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={p > 0.25 ? '#8B5CF6' : '#EF4444'}
          strokeWidth={stroke} fill="none"
          strokeDasharray={`${circ} ${circ}`}
          strokeDashoffset={circ * (1 - p)}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
    </View>
  );
}

// ── ورقة الرصد اليدوي (S33) ──
function ManualMarkSheet({ visible, onClose, session }: { visible: boolean; onClose: () => void; session: TrainingSession }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const { db, user, mutate, toast } = useApp();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<'present' | 'late'>('present');
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  if (!user) return null;

  const students = batchStudents(db, session.batchId).filter((st) => {
    const r = db.attendance.find((a) => a.sessionId === session.id && a.userId === st.id);
    const already = r && r.status !== 'absent';
    return !already && (query.trim() === '' || st.fullName.includes(query.trim()));
  });

  const submit = async () => {
    if (!selected) return;
    if (reason.trim().length < 3) return;
    setSending(true);
    const r = await mutate((d) => rpcManualMark(d, { sessionId: session.id, userId: selected, status, reason: reason.trim(), actorId: user.id }));
    setSending(false);
    if (r.ok) {
      toast(t('manual.done'), 'success');
      setSelected(null);
      setReason('');
      onClose();
    } else if (r.already) {
      toast(t('manual.already'), 'warn');
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t('manual.title')}>
      <View style={{ gap: 12 }}>
        <Input value={query} onChange={setQuery} placeholder={t('manual.searchPlaceholder')} icon="search" />
        <View style={{ maxHeight: 200 }}>
          <ScrollView>
            <View style={{ gap: 6 }}>
              {students.map((st) => {
                const active = selected === st.id;
                return (
                  <Card key={st.id} onPress={() => setSelected(st.id)} color={active ? theme.brandSoft : undefined} style={{ borderColor: active ? theme.brand : theme.line, padding: 10 }}>
                    <Row center gap={8}>
                      <Avatar name={st.fullName} color={st.avatarColor} size={32} />
                      <Txt variant="bodyMed">{st.fullName}</Txt>
                      {active ? <Ionicons name="checkmark-circle" size={18} color={theme.brand} /> : null}
                    </Row>
                  </Card>
                );
              })}
            </View>
          </ScrollView>
        </View>
        <Row gap={8}>
          <Btn title={t('manual.markPresent')} variant={status === 'present' ? 'success' : 'ghost'} icon="checkmark" onPress={() => setStatus('present')} />
          <Btn title={t('manual.markLate')} variant={status === 'late' ? 'secondary' : 'ghost'} icon="time" onPress={() => setStatus('late')} />
        </Row>
        <Input label={t('manual.reasonReq')} value={reason} onChange={setReason} placeholder={t('manual.reasonPlaceholder')} />
        <Btn title={t('common.confirm')} full size="lg" loading={sending} onPress={submit} disabled={!selected || reason.trim().length < 3} icon="hand-left" />
      </View>
    </Sheet>
  );
}
