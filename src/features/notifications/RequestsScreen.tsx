import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../../data/store';
import {
  fetchSupportRequests, reviewSupportRequest, submitSupportRequest,
  type SupportRequestRow,
} from '../../data/actions';
import { useTheme } from '../../design/theme';
import {
  Avatar, Btn, Card, Chip, Empty, Header, Input, Row, Segmented, Sheet, Spacer, Tag, Txt,
} from '../../design/components';
import { spacing } from '../../design/tokens';
import { timePast } from '../../shared/format';
import { useI18n } from '../../i18n';

const STATUS_KEY: Record<SupportRequestRow['status'], string> = {
  open: 'requests.open',
  in_review: 'requests.inReview',
  resolved: 'requests.resolved',
  rejected: 'requests.rejected',
};

export function RequestsScreen({ navigation }: any) {
  const { db, user, toast, refresh } = useApp();
  const { theme } = useTheme();
  const { lang, t } = useI18n();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<SupportRequestRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'inbox' | 'new'>(user?.role === 'student' ? 'new' : 'inbox');
  const [selected, setSelected] = useState<SupportRequestRow | null>(null);
  const [kind, setKind] = useState<'course_request' | 'role_request'>('course_request');
  const volunteers = useMemo(
    () => db.profiles.filter((p) => p.status === 'active' && p.role === 'volunteer'),
    [db.profiles],
  );
  const [recipientId, setRecipientId] = useState<string>('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [response, setResponse] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchSupportRequests());
      await refresh();
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [refresh, toast]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!recipientId && volunteers[0]) setRecipientId(volunteers[0].id);
  }, [recipientId, volunteers]);

  if (!user) return null;
  const isStudent = user.role === 'student';

  const send = async () => {
    if (subject.trim().length < 3 || body.trim().length < 10) return;
    if (kind === 'course_request' && !recipientId) return;
    setSending(true);
    try {
      await submitSupportRequest({
        kind,
        subject: subject.trim(),
        body: body.trim(),
        recipientId: kind === 'course_request' ? recipientId : undefined,
      });
      setSubject('');
      setBody('');
      toast(t('requests.sent'), 'success');
      setTab('inbox');
      await load();
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setSending(false);
    }
  };

  const review = async (status: 'in_review' | 'resolved' | 'rejected') => {
    if (!selected) return;
    setSending(true);
    try {
      await reviewSupportRequest({ requestId: selected.id, status, response: response.trim() });
      toast(t('requests.updated'), 'success');
      setSelected(null);
      setResponse('');
      await load();
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Header title={t('requests.title')} back={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.s5, paddingBottom: insets.bottom + 40, gap: 12 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { void load(); }} tintColor={theme.brand} />}
      >
        {isStudent ? (
          <Segmented
            value={tab}
            onChange={(value) => setTab(value as 'inbox' | 'new')}
            options={[
              { value: 'new', label: t('requests.new'), icon: 'create' },
              { value: 'inbox', label: t('requests.mine'), icon: 'mail' },
            ]}
          />
        ) : null}

        {tab === 'new' && isStudent ? (
          <View style={{ gap: 12 }}>
            <Card glass>
              <Txt variant="h3">{t('requests.officialTitle')}</Txt>
              <Txt variant="caption" color={theme.textSecondary}>
                {t('requests.officialBody')}
              </Txt>
            </Card>
            <Row gap={8} wrap>
              <Chip label={t('requests.course')} active={kind === 'course_request'} onPress={() => setKind('course_request')} icon="book" />
              <Chip label={t('requests.role')} active={kind === 'role_request'} onPress={() => setKind('role_request')} icon="trending-up" />
            </Row>
            {kind === 'course_request' ? (
              <Card>
                <Txt variant="caption" color={theme.textSecondary}>{t('requests.pickVolunteer')}</Txt>
                <Spacer size={8} />
                <Row gap={7} wrap>
                  {volunteers.map((volunteer) => (
                    <Chip
                      key={volunteer.id}
                      label={volunteer.fullName}
                      active={recipientId === volunteer.id}
                      onPress={() => setRecipientId(volunteer.id)}
                      icon="person"
                    />
                  ))}
                </Row>
              </Card>
            ) : null}
            <Input label={t('requests.subject')} value={subject} onChange={setSubject} icon="text" maxLength={120} />
            <Input label={t('requests.details')} value={body} onChange={setBody} multiline maxLength={2000} />
            <Btn
              title={t('requests.send')}
              full size="lg" icon="send" loading={sending} onPress={send}
              disabled={subject.trim().length < 3 || body.trim().length < 10 || (kind === 'course_request' && !recipientId)}
            />
          </View>
        ) : (
          rows.length === 0 ? <Empty emoji="📨" title={t('requests.empty')} /> : rows.map((request) => {
            const sender = db.profiles.find((p) => p.id === request.sender_id);
            const statusColor = request.status === 'resolved' ? theme.success : request.status === 'rejected' ? theme.danger : request.status === 'in_review' ? theme.warn : theme.brand;
            return (
              <Card key={request.id} onPress={() => { setSelected(request); setResponse(request.response ?? ''); }}>
                <Row center gap={10}>
                  {sender ? <Avatar name={sender.fullName} color={sender.avatarColor} size={40} /> : (
                    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name="mail" size={18} color={theme.brand} />
                    </View>
                  )}
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt variant="bodyMed">{request.subject}</Txt>
                    <Txt variant="micro" color={theme.textMuted}>
                      {sender?.fullName ?? t('requests.user')} · {request.kind === 'role_request' ? t('requests.role') : request.kind === 'course_request' ? t('requests.course') : t('requests.support')} · {timePast(new Date(request.created_at).getTime(), lang)}
                    </Txt>
                  </View>
                  <Tag label={t(STATUS_KEY[request.status] as any)} color={statusColor} bg={statusColor + '1F'} />
                </Row>
                <Spacer size={7} />
                <Txt variant="caption" color={theme.textSecondary} numberOfLines={2}>{request.body}</Txt>
                {request.response ? (
                  <Txt variant="caption" color={theme.success} style={{ marginTop: 7 }}>{t('requests.response')}: {request.response}</Txt>
                ) : null}
              </Card>
            );
          })
        )}
      </ScrollView>

      <Sheet visible={selected != null} onClose={() => setSelected(null)} title={selected?.subject ?? ''}>
        {selected ? (
          <ScrollView>
            <View style={{ gap: 12 }}>
              <Card glass><Txt variant="body" color={theme.textSecondary}>{selected.body}</Txt></Card>
              {selected.response ? <Card color={theme.successSoft}><Txt variant="caption" color={theme.success}>{selected.response}</Txt></Card> : null}
              {!isStudent && selected.status !== 'resolved' && selected.status !== 'rejected' ? (
                <>
                  <Input label={t('requests.response')} value={response} onChange={setResponse} multiline maxLength={2000} />
                  <Row gap={8} wrap>
                    <Btn title={t('requests.inReview')} variant="secondary" loading={sending} onPress={() => { void review('in_review'); }} />
                    <Btn title={t('requests.resolved')} variant="success" loading={sending} onPress={() => { void review('resolved'); }} />
                    <Btn title={t('requests.rejected')} variant="danger" loading={sending} onPress={() => { void review('rejected'); }} />
                  </Row>
                </>
              ) : null}
            </View>
          </ScrollView>
        ) : null}
      </Sheet>
    </View>
  );
}
