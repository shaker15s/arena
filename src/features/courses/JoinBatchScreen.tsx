import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../../data/store';
import { joinBatchByCode } from '../../data/actions';
import { courseOf } from '../../data/engine';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import { Btn, Card, Header, Row, Spacer, Txt } from '../../design/components';
import { JellyButton, PillGradientSearchInput, SuccessWaveAlert } from '../../design/interactive';
import { spacing } from '../../design/tokens';

export function JoinBatchScreen({ route, navigation }: any) {
  const { db, user, refresh, toast } = useApp();
  const { theme } = useTheme();
  const { t } = useI18n();
  const [code, setCode] = useState(String(route.params?.code ?? ''));
  const [submitting, setSubmitting] = useState(false);
  const [joined, setJoined] = useState<'active' | 'waitlist' | null>(null);
  const batch = useMemo(
    () => db.batches.find((item) => item.joinCode.toUpperCase() === code.trim().toUpperCase()),
    [code, db.batches],
  );
  const course = batch ? courseOf(db, batch.courseId) : undefined;

  const submit = async () => {
    if (!user || user.role !== 'student' || code.trim().length < 6) return;
    setSubmitting(true);
    try {
      const result = await joinBatchByCode(code);
      setJoined(result.status);
      await refresh();
      toast(result.status === 'waitlist' ? t('joinCode.waitlist') : t('joinCode.joined'), result.status === 'waitlist' ? 'warn' : 'success');
    } catch {
      toast(t('joinCode.invalid'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Header title={t('joinCode.title')} back={navigation.canGoBack?.() ? () => navigation.goBack() : undefined} />
      <ScrollView contentContainerStyle={{ padding: spacing.s5, gap: 14 }}>
        <Card glass>
          <Row center gap={10}>
            <Ionicons name="qr-code" size={28} color={theme.brand} />
            <Txt variant="body" color={theme.textSecondary} style={{ flex: 1 }}>{t('joinCode.body')}</Txt>
          </Row>
        </Card>

        {/* حقل إدخال كود الانضمام بتصميم متدرج وأنيق */}
        <View style={{ gap: 6 }}>
          <Txt variant="caption" color={theme.textSecondary} style={{ marginHorizontal: 4 }}>
            {t('joinCode.code')}
          </Txt>
          <PillGradientSearchInput
            value={code}
            onChangeText={(value) => { setCode(value); setJoined(null); }}
            placeholder={t('joinCode.code')}
            icon="key"
          />
        </View>

        {batch && course ? (
          <Card color={theme.card}>
            <Txt variant="h3">{course.title}</Txt>
            <Spacer size={6} />
            <Txt variant="caption" color={theme.textSecondary}>{batch.room} · {batch.schedule.time}</Txt>
          </Card>
        ) : null}

        {!user ? (
          <JellyButton
            title={t('auth.continueGoogle')}
            icon="logo-google"
            onPress={() => navigation.navigate('SignIn')}
          />
        ) : joined ? (
          <View style={{ gap: 12 }}>
            <SuccessWaveAlert
              title={joined === 'active' ? t('joinCode.joined') : t('joinCode.waitlist')}
              description={course ? `${course.title} · ${batch?.room ?? ''}` : t('joinCode.joined')}
              actionText={t('common.done')}
              onAction={() => navigation.navigate('Tabs')}
            />
            <Btn title={t('common.done')} full onPress={() => navigation.navigate('Tabs')} />
          </View>
        ) : (
          <JellyButton
            title={t('joinCode.confirm')}
            icon="enter"
            onPress={submit}
            loading={submitting}
            disabled={user?.role !== 'student' || code.trim().length < 6}
            variant="purple"
          />
        )}
      </ScrollView>
    </View>
  );
}
