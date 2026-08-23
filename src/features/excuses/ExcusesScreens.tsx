/**
 * features/excuses — S24 أعذاري (طالب) + S35 صندوق الأعذار (مدرب).
 * F5: قبول ← معذور + ستريك محفوظ بلا نقاط · رفض ← يبقى غياب + إشعار بالسبب.
 */
import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../../data/store';
import {
  attendanceOf, batchOf, courseOf, profileOf, rpcReviewExcuse, rpcSubmitExcuse,
} from '../../data/engine';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import {
  Avatar, Btn, Card, Empty, FadeIn, Header, Input, Row, Segmented, Spacer,
  Tag, Txt,
} from '../../design/components';
import { spacing } from '../../design/tokens';
import { formatDate, timePast } from '../../shared/format';
import { Excuse } from '../../data/types';

// ───────────────────────────── S24 أعذاري ─────────────────────────────

export function ExcusesScreen({ navigation }: any) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const { db, user, mutate, toast } = useApp();
  const [tab, setTab] = useState<'list' | 'new'>('list');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  if (!user) return null;

  const mine = db.excuses.filter((e) => e.userId === user.id).sort((a, b) => b.createdAt - a.createdAt);

  // الجلسات المؤهلة للعذر: مغلقة وغياب وبدون عذر قائم
  const eligible = db.sessions
    .filter((s) => s.status === 'closed')
    .filter((s) => {
      const att = attendanceOf(db, s.id, user.id);
      const isAbsent = att?.status === 'absent';
      const hasExcuse = db.excuses.some((e) => e.userId === user.id && e.sessionId === s.id && e.status !== 'rejected');
      return isAbsent && !hasExcuse;
    })
    .sort((a, b) => b.startsAt - a.startsAt);

  const statusMeta: Record<Excuse['status'], { label: string; color: string; bg: string }> = {
    pending: { label: t('excuses.pending'), color: theme.warn, bg: theme.warnSoft },
    accepted: { label: t('excuses.accepted'), color: theme.info, bg: theme.infoSoft },
    rejected: { label: t('excuses.rejected'), color: theme.danger, bg: theme.dangerSoft },
  };

  const submit = async () => {
    if (!sessionId) { setError(t('excuses.pickSession')); return; }
    if (reason.trim().length < 4) { setError(t('excuses.reasonLabel')); return; }
    setSending(true);
    const r = await mutate((d) => rpcSubmitExcuse(d, user.id, sessionId, reason.trim()));
    setSending(false);
    if (!r.ok) {
      setError(t(`excuses.${r.error}` as any));
      return;
    }
    toast(t('excuses.submitted'), 'success');
    setTab('list');
    setSessionId(null);
    setReason('');
    setError('');
  };

  return (
    <View style={{ flex: 1 }}>
      <Header title={t('excuses.title')} back={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: spacing.s5, gap: 14 }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'list', label: t('excuses.title'), icon: 'list' },
            { value: 'new', label: t('excuses.new'), icon: 'add-circle' },
          ]}
        />

        {tab === 'new' ? (
          eligible.length === 0 ? (
            <Empty emoji="✅" title={t('excuses.onlyAbsent')} />
          ) : (
            <FadeIn>
              <Txt variant="caption" color={theme.textSecondary}>{t('excuses.pickSession')}</Txt>
              <Spacer size={8} />
              <View style={{ gap: 8 }}>
                {eligible.map((s) => {
                  const batch = batchOf(db, s.batchId);
                  const course = batch ? courseOf(db, batch.courseId) : undefined;
                  const active = sessionId === s.id;
                  return (
                    <Card key={s.id} onPress={() => setSessionId(s.id)} color={active ? theme.brandSoft : undefined} style={{ borderColor: active ? theme.brand : theme.line, borderWidth: active ? 2 : 1 }}>
                      <Row center gap={10}>
                        <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={20} color={active ? theme.brand : theme.textMuted} />
                        <View style={{ flex: 1 }}>
                          <Txt variant="bodyMed">{course?.title ?? ''}</Txt>
                          <Txt variant="micro" color={theme.textMuted}>{s.title} · {formatDate(s.startsAt, lang)}</Txt>
                        </View>
                      </Row>
                    </Card>
                  );
                })}
              </View>
              <Spacer size={12} />
              <Input label={t('excuses.reasonLabel')} value={reason} onChange={setReason} placeholder={t('excuses.reasonPlaceholder')} multiline />
              <Spacer size={8} />
              <Row center gap={6}>
                <Ionicons name="attach" size={14} color={theme.textMuted} />
                <Txt variant="micro" color={theme.textMuted}>{t('excuses.attach')}</Txt>
              </Row>
              {error ? <Txt variant="caption" color={theme.danger}>{error}</Txt> : null}
              <Spacer size={10} />
              <Btn title={t('excuses.submit')} full size="lg" loading={sending} onPress={submit} icon="send" />
            </FadeIn>
          )
        ) : mine.length === 0 ? (
          <Empty emoji="🛡️" title={t('excuses.emptyTitle')} />
        ) : (
          mine.map((e, i) => {
            const sess = db.sessions.find((s) => s.id === e.sessionId);
            const meta = statusMeta[e.status];
            return (
              <FadeIn key={e.id} index={i}>
                <Card>
                  <Row between center>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Txt variant="bodyMed">{sess?.title ?? ''}</Txt>
                      <Txt variant="micro" color={theme.textMuted}>{sess ? formatDate(sess.startsAt, lang) : ''} · {timePast(e.createdAt, lang)}</Txt>
                    </View>
                    <Tag label={meta.label} color={meta.color} bg={meta.bg} />
                  </Row>
                  <Spacer size={8} />
                  <Txt variant="body" color={theme.textSecondary}>{e.reason}</Txt>
                  {e.status === 'accepted' ? (
                    <>
                      <Spacer size={8} />
                      <Row center gap={6}>
                        <Ionicons name="shield" size={13} color={theme.info} />
                        <Txt variant="micro" color={theme.info}>{t('excuses.acceptedNote')}</Txt>
                      </Row>
                    </>
                  ) : null}
                  {e.status === 'rejected' && e.note ? (
                    <>
                      <Spacer size={8} />
                      <Card color={theme.dangerSoft} noPad style={{ padding: 10 }}>
                        <Row center gap={6}>
                          <Ionicons name="chatbox" size={13} color={theme.danger} />
                          <Txt variant="micro" color={theme.danger}>{t('excuses.instructorNote')}: {e.note}</Txt>
                        </Row>
                      </Card>
                    </>
                  ) : null}
                </Card>
              </FadeIn>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

// ───────────────────────────── S35 صندوق الأعذار (المدرب) ─────────────────────────────

export function ExcusesInboxScreen() {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { db, user, mutate, toast } = useApp();
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [tab, setTab] = useState<'excuses' | 'reports'>('excuses');
  if (!user) return null;

  const myBatchIds = db.batches.filter((b) => b.instructorId === user.id).map((b) => b.id);
  const myPending = db.excuses
    .filter((e) => {
      const s = db.sessions.find((x) => x.id === e.sessionId);
      return s && myBatchIds.includes(s.batchId) && e.status === 'pending';
    })
    .sort((a, b) => b.createdAt - a.createdAt);
  const handled = db.excuses
    .filter((e) => {
      const s = db.sessions.find((x) => x.id === e.sessionId);
      return s && myBatchIds.includes(s.batchId) && e.status !== 'pending';
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 10);

  const reports = db.sessions
    .filter((s) => myBatchIds.includes(s.batchId) && s.report)
    .sort((a, b) => (b.report?.submittedAt ?? 0) - (a.report?.submittedAt ?? 0))
    .slice(0, 20);

  const review = async (id: string, decision: 'accepted' | 'rejected', note?: string) => {
    if (decision === 'rejected' && !note?.trim()) return;
    await mutate((d) => rpcReviewExcuse(d, id, user.id, decision, note));
    toast(decision === 'accepted' ? t('inbox.acceptedSnack') : t('inbox.rejectedSnack'), decision === 'accepted' ? 'success' : 'warn');
    setRejectId(null);
    setRejectNote('');
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.s3, padding: spacing.s5, gap: 14, paddingBottom: 120 }}>
        <Header title={t('inbox.title')} />
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'excuses', label: t('excuses.title'), icon: 'shield' },
            { value: 'reports', label: t('inbox.reports'), icon: 'document-text' },
          ]}
        />

        {tab === 'excuses' ? (
          <>
            {myPending.length === 0 ? (
              <Empty emoji="✨" title={t('inbox.emptyTitle')} />
            ) : (
              myPending.map((e, i) => {
                const student = profileOf(db, e.userId);
                const sess = db.sessions.find((s) => s.id === e.sessionId);
                const isRejecting = rejectId === e.id;
                return (
                  <FadeIn key={e.id} index={i}>
                    <Card>
                      <Row center gap={10}>
                        {student ? <Avatar name={student.fullName} color={student.avatarColor} size={44} /> : null}
                        <View style={{ flex: 1 }}>
                          <Txt variant="bodyMed">{student?.fullName ?? ''}</Txt>
                          <Txt variant="micro" color={theme.textMuted}>{sess?.title} · {sess ? formatDate(sess.startsAt, lang) : ''}</Txt>
                        </View>
                        <Tag label={t('excuses.pending')} color={theme.warn} bg={theme.warnSoft} />
                      </Row>
                      <Spacer size={10} />
                      <Card color={theme.bg} noPad style={{ padding: 12 }}>
                        <Row gap={8} center>
                          <Ionicons name="chatbubble-ellipses" size={15} color={theme.textMuted} />
                          <Txt variant="body" color={theme.textSecondary} style={{ flex: 1 }}>{e.reason}</Txt>
                        </Row>
                        {e.attachment ? (
                          <Row center gap={6} style={{ marginTop: 6 }}>
                            <Ionicons name="attach" size={13} color={theme.info} />
                            <Txt variant="micro" color={theme.info}>{e.attachment}</Txt>
                          </Row>
                        ) : null}
                      </Card>
                      <Spacer size={10} />
                      {isRejecting ? (
                        <View style={{ gap: 8 }}>
                          <Input value={rejectNote} onChange={setRejectNote} placeholder={t('inbox.rejectNote')} multiline />
                          <Row gap={8}>
                            <Btn title={t('inbox.reject')} variant="danger" onPress={() => review(e.id, 'rejected', rejectNote)} disabled={!rejectNote.trim()} />
                            <Btn title={t('common.cancel')} variant="ghost" onPress={() => { setRejectId(null); setRejectNote(''); }} />
                          </Row>
                        </View>
                      ) : (
                        <Row gap={8}>
                          <Btn title={t('inbox.accept')} variant="success" icon="shield-checkmark" onPress={() => review(e.id, 'accepted')} />
                          <Btn title={t('inbox.reject')} variant="ghost" icon="close" onPress={() => setRejectId(e.id)} />
                        </Row>
                      )}
                    </Card>
                  </FadeIn>
                );
              })
            )}
            {handled.length > 0 ? (
              <>
                <Txt variant="h3" style={{ marginTop: 8 }}>{t('common.done')}</Txt>
                {handled.map((e) => {
                  const student = profileOf(db, e.userId);
                  const sess = db.sessions.find((s) => s.id === e.sessionId);
                  return (
                    <Card key={e.id}>
                      <Row center gap={10}>
                        {student ? <Avatar name={student.fullName} color={student.avatarColor} size={38} /> : null}
                        <View style={{ flex: 1 }}>
                          <Txt variant="bodyMed">{student?.fullName}</Txt>
                          <Txt variant="micro" color={theme.textMuted}>{sess?.title}</Txt>
                        </View>
                        <Tag
                          label={e.status === 'accepted' ? t('excuses.accepted') : t('excuses.rejected')}
                          color={e.status === 'accepted' ? theme.info : theme.danger}
                          bg={e.status === 'accepted' ? theme.infoSoft : theme.dangerSoft}
                        />
                      </Row>
                    </Card>
                  );
                })}
              </>
            ) : null}
          </>
        ) : (
          reports.length === 0 ? (
            <Empty emoji="📝" title={t('inbox.noReports')} />
          ) : (
            reports.map((s, i) => {
              const batch = batchOf(db, s.batchId);
              const course = batch ? courseOf(db, batch.courseId) : undefined;
              const attended = db.attendance.filter((a) => a.sessionId === s.id && a.status !== 'absent').length;
              const total = db.attendance.filter((a) => a.sessionId === s.id).length;
              return (
                <FadeIn key={s.id} index={i}>
                  <Card>
                    <Row between center>
                      <View style={{ flex: 1 }}>
                        <Txt variant="bodyMed">{s.title}</Txt>
                        <Txt variant="micro" color={theme.textMuted}>{course?.title} · {formatDate(s.startsAt, lang)}</Txt>
                      </View>
                      <Tag label={`${attended}/${total}`} color={theme.brand} bg={theme.brandSoft} icon="people" />
                    </Row>
                    {s.report ? (
                      <View style={{ marginTop: 8, gap: 6 }}>
                        {s.report.done ? <ReportLine icon="checkmark-done" color={theme.success} text={s.report.done} /> : null}
                        {s.report.planned ? <ReportLine icon="flag" color={theme.brand} text={s.report.planned} /> : null}
                        {s.report.challenges ? <ReportLine icon="warning" color={theme.warn} text={s.report.challenges} /> : null}
                      </View>
                    ) : null}
                  </Card>
                </FadeIn>
              );
            })
          )
        )}
      </ScrollView>
    </View>
  );
}

function ReportLine({ icon, color, text }: { icon: keyof typeof Ionicons.glyphMap; color: string; text: string }) {
  return (
    <Row center gap={8}>
      <Ionicons name={icon} size={14} color={color} />
      <Txt variant="caption" style={{ flex: 1 }}>{text}</Txt>
    </Row>
  );
}
