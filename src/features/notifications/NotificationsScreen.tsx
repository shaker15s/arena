/**
 * features/notifications — S25 مركز الإشعارات (مجمعة باليوم).
 */
import React, { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../../data/store';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import { Card, Empty, FadeIn, Header, Row, Txt } from '../../design/components';
import { spacing } from '../../design/tokens';
import { sameDay, timePast } from '../../shared/format';
import { AppNotification } from '../../data/types';

const TYPE_META: Record<AppNotification['type'], { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  session: { icon: 'calendar', color: '#4F46E5' },
  excuse: { icon: 'shield', color: '#0EA5E9' },
  badge: { icon: 'medal', color: '#A855F7' },
  cert: { icon: 'ribbon', color: '#F0B429' },
  league: { icon: 'trophy', color: '#F59E0B' },
  broadcast: { icon: 'megaphone', color: '#14B8A6' },
  streak: { icon: 'flame', color: '#EF4444' },
  system: { icon: 'information-circle', color: '#64748B' },
};

export function NotificationsScreen({ navigation }: any) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const { db, user, markNotificationsRead } = useApp();

  const mine = db.notifications
    .filter((n) => n.userId === user?.id)
    .sort((a, b) => b.createdAt - a.createdAt);

  useEffect(() => {
    const timer = setTimeout(() => markNotificationsRead(), 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const todayRows = mine.filter((n) => sameDay(n.createdAt, Date.now()));
  const yesterdayRows = mine.filter((n) => sameDay(n.createdAt, Date.now() - 86_400_000));
  const olderRows = mine.filter((n) => !sameDay(n.createdAt, Date.now()) && !sameDay(n.createdAt, Date.now() - 86_400_000));

  const Group = ({ label, rows }: { label: string; rows: AppNotification[] }) =>
    rows.length === 0 ? null : (
      <>
        <Txt variant="caption" color={theme.textMuted} style={{ marginTop: 6 }}>{label}</Txt>
        {rows.map((n, i) => {
          const meta = TYPE_META[n.type];
          return (
            <FadeIn key={n.id} index={Math.min(i, 6)}>
              <Card style={{ opacity: n.read ? 0.85 : 1, borderColor: n.read ? theme.line : theme.brand + '55' }}>
                <Row center gap={12}>
                  <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: meta.color + '1F', alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name={meta.icon} size={19} color={meta.color} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt variant="bodyMed">{n.title}</Txt>
                    <Txt variant="caption" color={theme.textSecondary}>{n.body}</Txt>
                    <Txt variant="micro" color={theme.textMuted}>{timePast(n.createdAt, lang)}</Txt>
                  </View>
                  {!n.read ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: theme.brand }} /> : null}
                </Row>
              </Card>
            </FadeIn>
          );
        })}
      </>
    );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title={t('notif.title')} back={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: spacing.s5, gap: 10, paddingBottom: 60 }}>
        {mine.length === 0 ? (
          <Empty emoji="🔔" title={t('notif.empty')} />
        ) : (
          <>
            <Group label={t('common.today')} rows={todayRows} />
            <Group label={t('common.yesterday')} rows={yesterdayRows} />
            <Group label={t('notif.earlier')} rows={olderRows} />
          </>
        )}
      </ScrollView>
    </View>
  );
}
