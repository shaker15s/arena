/**
 * features/disputes — نزاعات/تماسات الحضور (FUNC-05).
 *
 * شاشة واحدة بوضعين:
 *  • **الطالب**: يرى تماساته وحالتها، ويقدّم تماسًا جديدًا على جلسة غاب عنها
 *    (مع مرفق اختياري)، ويمكنه سحبه قبل البتّ فيه.
 *  • **المدرب/المشرف**: صندوق التماسات المفتوحة على مجموعاته فقط، وكل قرار
 *    يكتب سببًا موثّقًا — القبول يصحّح سجل الحضور على الخادم ويُشعر الطالب.
 *
 * كل النصوص من القاموس (متوافق مع بوابة التعريب)، وكل نداء للخادم عبر
 * `src/data/actions.ts` (RPCs ترحيل 0031).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../../data/store';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import { Btn, Card, Empty, FadeIn, Header, Input, Row, Sheet, Tag, Txt } from '../../design/components';
import { Icon } from '../../design/icons';
import { radii, spacing } from '../../design/tokens';
import { timePast } from '../../shared/format';
import {
  listAttendanceDisputes, resolveAttendanceDispute, submitAttendanceDispute, withdrawAttendanceDispute,
  type AttendanceDisputeRow,
} from '../../data/actions';
import { batchOf, sessionsOfBatch } from '../../data/engine';

type Mode = 'mine' | 'inbox';

export function DisputesScreen({ navigation, route }: any) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { db, user, toast, refresh, syncing } = useApp();

  const role = user?.role ?? 'student';
  const canReview = role === 'volunteer' || role === 'supervisor' || role === 'admin';
  const [mode, setMode] = useState<Mode>(route?.params?.mode === 'inbox' && canReview ? 'inbox' : 'mine');
  const [rows, setRows] = useState<AttendanceDisputeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [composeOpen, setComposeOpen] = useState(false);
  const [decideOpen, setDecideOpen] = useState<AttendanceDisputeRow | null>(null);
  const [claim, setClaim] = useState('');
  const [evidence, setEvidence] = useState('');
  const [note, setNote] = useState('');
  const [accept, setAccept] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listAttendanceDisputes(mode));
    } catch {
      toast(t('disputes.loadFail'), 'error');
    } finally {
      setLoading(false);
    }
  }, [mode, t, toast]);

  useEffect(() => { void load(); }, [load]);

  /** الجلسات التي يحق للطالب التماسها: مجموعاته، وليست الحاضرة أصلًا. */
  const appealable = useMemo(() => {
    if (!user) return [];
    const myBatchIds = db.enrollments.filter((e) => e.userId === user.id && e.status === 'active').map((e) => e.batchId);
    const out: Array<{ id: string; label: string; startsAt: number }> = [];
    for (const batchId of myBatchIds) {
      for (const s of sessionsOfBatch(db, batchId)) {
        if (s.status === 'scheduled') continue;
        const att = db.attendance.find((a) => a.sessionId === s.id && a.userId === user.id);
        if (att && (att.status === 'present' || att.status === 'late')) continue;
        const open = rows.some((r) => r.session_id === s.id && r.status === 'open');
        if (open) continue;
        out.push({ id: s.id, label: s.title, startsAt: s.startsAt });
      }
    }
    return out.sort((a, b) => b.startsAt - a.startsAt).slice(0, 30);
  }, [db, user, rows]);

  const [sessionId, setSessionId] = useState<string>('');

  const submit = useCallback(async () => {
    if (!sessionId || claim.trim().length < 10) return;
    setBusy(true);
    try {
      await submitAttendanceDispute(sessionId, claim.trim(), evidence.trim() || undefined);
      toast(t('disputes.submitted'), 'success');
      setComposeOpen(false);
      setClaim('');
      setEvidence('');
      setSessionId('');
      await load();
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }, [sessionId, claim, evidence, load, t, toast]);

  const decide = useCallback(async () => {
    if (!decideOpen) return;
    setBusy(true);
    try {
      await resolveAttendanceDispute(decideOpen.id, accept, note.trim() || undefined);
      toast(accept ? t('disputes.accepted') : t('disputes.rejected'), accept ? 'success' : 'warn');
      setDecideOpen(null);
      setNote('');
      await Promise.all([load(), refresh()]);
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }, [decideOpen, accept, note, load, refresh, t, toast]);

  const withdraw = useCallback(async (id: string) => {
    try {
      await withdrawAttendanceDispute(id);
      toast(t('disputes.withdrawn'), 'success');
      await load();
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  }, [load, t, toast]);

  const statusMeta: Record<AttendanceDisputeRow['status'], { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
    open: { label: t('disputes.statusOpen'), color: theme.warn, icon: 'time' },
    accepted: { label: t('disputes.statusAccepted'), color: theme.success, icon: 'checkmark-circle' },
    rejected: { label: t('disputes.statusRejected'), color: theme.danger, icon: 'close-circle' },
    withdrawn: { label: t('disputes.statusWithdrawn'), color: theme.textMuted, icon: 'return-down-back' },
  };

  return (
    <View style={{ flex: 1 }}>
      <Header title={t('disputes.title')} back={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.s5, paddingBottom: insets.bottom + 90, gap: 12 }}
        refreshControl={
          <RefreshControl refreshing={syncing || loading} onRefresh={() => void load()} tintColor={theme.brand} colors={[theme.brand]} />
        }
      >
        {canReview ? (
          <Row gap={8}>
            <Btn
              title={t('disputes.myTab')}
              variant={mode === 'mine' ? 'primary' : 'ghost'}
              size="sm"
              onPress={() => setMode('mine')}
            />
            <Btn
              title={t('disputes.inboxTab')}
              variant={mode === 'inbox' ? 'primary' : 'ghost'}
              size="sm"
              onPress={() => setMode('inbox')}
            />
          </Row>
        ) : null}

        {mode === 'mine' ? (
          <Btn title={t('disputes.new')} variant="secondary" icon="add-circle-outline" onPress={() => setComposeOpen(true)} />
        ) : null}

        {rows.length === 0 && !loading ? (
          <Card>
            <Empty
              emoji={mode === 'mine' ? '📄' : '📥'}
              title={mode === 'mine' ? t('disputes.emptyMine') : t('disputes.emptyInbox')}
              body={mode === 'mine' ? t('disputes.emptyMineHint') : t('disputes.emptyInboxHint')}
            />
          </Card>
        ) : null}

        {rows.map((row, index) => {
          const meta = statusMeta[row.status];
          const title = row.session_title ?? t('disputes.sessionFallback');
          return (
            <FadeIn key={row.id} index={Math.min(index, 8)}>
              <Card>
                <Row between center gap={10}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Txt variant="bodyMed" numberOfLines={2}>{title}</Txt>
                    <Txt variant="micro" color={theme.textMuted}>
                      {row.starts_at ? new Date(row.starts_at).toLocaleDateString() : timePast(new Date(row.created_at).getTime(), lang)}
                    </Txt>
                  </View>
                  <Tag label={meta.label} color={meta.color} bg={meta.color + '22'} />
                </Row>
                {row.student_name && mode === 'inbox' ? (
                  <Row center gap={6} style={{ marginTop: 8 }}>
                    <Icon name="person-circle-outline" size={15} color={theme.textSecondary} />
                    <Txt variant="caption" color={theme.textSecondary}>{row.student_name}</Txt>
                  </Row>
                ) : null}
                <Txt variant="caption" color={theme.textSecondary} style={{ marginTop: 8 }}>{row.claim}</Txt>
                {row.decision_note ? (
                  <View style={{ marginTop: 8, backgroundColor: theme.fill, borderRadius: radii.md, padding: 10 }}>
                    <Txt variant="micro" color={theme.textMuted}>{t('disputes.decision')}</Txt>
                    <Txt variant="caption" color={theme.textSecondary}>{row.decision_note}</Txt>
                  </View>
                ) : null}
                {row.evidence_url ? (
                  <Row center gap={6} style={{ marginTop: 8 }}>
                    <Icon name="attach" size={14} color={theme.brand} />
                    <Txt variant="micro" color={theme.brand} numberOfLines={1}>{row.evidence_url}</Txt>
                  </Row>
                ) : null}

                {mode === 'mine' && row.status === 'open' ? (
                  <View style={{ marginTop: 10 }}>
                    <Btn title={t('disputes.withdraw')} variant="ghost" size="sm" icon="return-down-back" onPress={() => void withdraw(row.id)} />
                  </View>
                ) : null}

                {mode === 'inbox' && row.status === 'open' ? (
                  <View style={{ marginTop: 10 }}>
                    <Btn
                      title={t('disputes.review')}
                      variant="primary"
                      size="sm"
                      icon="shield-checkmark-outline"
                      onPress={() => { setDecideOpen(row); setAccept(true); setNote(''); }}
                    />
                  </View>
                ) : null}
              </Card>
            </FadeIn>
          );
        })}
      </ScrollView>

      {/* تقديم تماس جديد */}
      <Sheet visible={composeOpen} onClose={() => setComposeOpen(false)} title={t('disputes.new')}>
        <View style={{ gap: 10 }}>
          <Txt variant="caption" color={theme.textSecondary}>{t('disputes.pickSession')}</Txt>
          {appealable.length === 0 ? (
            <Txt variant="caption" color={theme.textMuted}>{t('disputes.noSessions')}</Txt>
          ) : (
            <ScrollView style={{ maxHeight: 210 }}>
              <View style={{ gap: 8 }}>
                {appealable.map((s) => (
                  <Card
                    key={s.id}
                    onPress={() => setSessionId(s.id)}
                    style={{ borderColor: sessionId === s.id ? theme.brand : theme.line, borderWidth: sessionId === s.id ? 2 : 1 }}
                  >
                    <Txt variant="caption">{s.label}</Txt>
                  </Card>
                ))}
              </View>
            </ScrollView>
          )}
          <Input label={t('disputes.claimLabel')} value={claim} onChange={setClaim} multiline maxLength={1000} />
          <Input label={t('disputes.evidenceLabel')} value={evidence} onChange={setEvidence} placeholder={t('disputes.evidenceHint')} />
          <Row gap={10}>
            <Btn
              title={t('disputes.submit')}
              variant="primary"
              loading={busy}
              disabled={!sessionId || claim.trim().length < 10}
              onPress={() => void submit()}
            />
            <Btn title={t('common.cancel')} variant="ghost" onPress={() => setComposeOpen(false)} />
          </Row>
        </View>
      </Sheet>

      {/* قرار المدرب */}
      <Sheet visible={Boolean(decideOpen)} onClose={() => setDecideOpen(null)} title={t('disputes.review')}>
        <View style={{ gap: 10 }}>
          <Txt variant="caption" color={theme.textSecondary}>{decideOpen?.claim}</Txt>
          <Row gap={8}>
            <Btn title={t('disputes.accept')} variant={accept ? 'success' : 'ghost'} size="sm" onPress={() => setAccept(true)} />
            <Btn title={t('disputes.reject')} variant={!accept ? 'danger' : 'ghost'} size="sm" onPress={() => setAccept(false)} />
          </Row>
          <Input label={t('disputes.noteLabel')} value={note} onChange={setNote} multiline maxLength={1000} placeholder={t('disputes.noteHint')} />
          <Txt variant="micro" color={theme.textMuted}>{t('disputes.acceptEffect')}</Txt>
          <Row gap={10}>
            <Btn title={t('disputes.confirmDecision')} variant="primary" loading={busy} onPress={() => void decide()} />
            <Btn title={t('common.cancel')} variant="ghost" onPress={() => setDecideOpen(null)} />
          </Row>
        </View>
      </Sheet>
    </View>
  );
}

export const disputeBatchRoom = (db: ReturnType<typeof useApp>['db'], sessionId: string) => {
  const session = db.sessions.find((s) => s.id === sessionId);
  if (!session) return undefined;
  return batchOf(db, session.batchId)?.room;
};
