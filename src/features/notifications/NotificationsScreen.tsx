/**
 * features/notifications — S25 مركز الإشعارات (مجمعة باليوم).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, RefreshControl, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../../data/store';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import { Btn, Card, CustomSwitch, Empty, Header, Row, Sheet, Txt } from '../../design/components';
import {
  DEFAULT_PUSH_PREFERENCES, getPushPreferences, setPushPreferences, type PushPreferences,
} from '../../data/actions';
import { SUPABASE_ENABLED } from '../../data/supabase';
import { spacing } from '../../design/tokens';
import { isReducedMotion } from '../../design/motion';
import { sameDay, timePast } from '../../shared/format';
import { AppNotification } from '../../data/types';
import { screenForNotification } from '../../shared/notifyRoute';

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

interface NotificationCardProps {
  item: AppNotification;
  lang: 'ar' | 'en';
  theme: any;
  pulseAnim: Animated.Value;
  onPress: () => void;
}

const NotificationCard = React.memo(function NotificationCard({
  item,
  lang,
  theme,
  pulseAnim,
  onPress,
}: NotificationCardProps) {
  const meta = TYPE_META[item.type] || TYPE_META.system;

  return (
    <Card
      onPress={onPress}
      style={{
        opacity: item.read ? 0.85 : 1,
        borderColor: item.read ? theme.line : meta.color + '55',
        borderStartWidth: item.read ? 0 : 3,
        borderStartColor: meta.color,
        marginBottom: 8,
      }}
    >
      <Row center gap={12}>
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: 13,
            backgroundColor: meta.color + '1F',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={meta.icon} size={19} color={meta.color} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="bodyMed">{item.title}</Txt>
          <Txt variant="caption" color={theme.textSecondary}>
            {item.body}
          </Txt>
          <Txt variant="micro" color={theme.textMuted}>
            {timePast(item.createdAt, lang)}
          </Txt>
        </View>
        {!item.read ? (
          <Animated.View
            style={{
              width: 9,
              height: 9,
              borderRadius: 5,
              backgroundColor: theme.brand,
              transform: [{ scale: isReducedMotion() ? 1 : pulseAnim }],
            }}
          />
        ) : null}
      </Row>
    </Card>
  );
});

interface NotificationGroupProps {
  label: string;
  rows: AppNotification[];
  lang: 'ar' | 'en';
  theme: any;
  pulseAnim: Animated.Value;
  onItemPress: (item: AppNotification) => void;
}

const NotificationGroup = React.memo(function NotificationGroup({
  label,
  rows,
  lang,
  theme,
  pulseAnim,
  onItemPress,
}: NotificationGroupProps) {
  if (rows.length === 0) return null;

  return (
    <View style={{ marginTop: 6 }}>
      <Txt variant="caption" color={theme.textMuted} style={{ marginBottom: 6 }}>
        {label}
      </Txt>
      {rows.map((n) => (
        <NotificationCard
          key={n.id}
          item={n}
          lang={lang}
          theme={theme}
          pulseAnim={pulseAnim}
          onPress={() => onItemPress(n)}
        />
      ))}
    </View>
  );
});

export function NotificationsScreen({ navigation }: any) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isReducedMotion()) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.4, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const { db, user, markNotificationsRead, refresh, syncing } = useApp();

  const mine = useMemo(() => {
    return (db.notifications || [])
      .filter((n) => n.userId === user?.id)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [db.notifications, user?.id]);

  const hasUnread = useMemo(() => mine.some((n) => !n.read), [mine]);

  // ── تفضيلات الإشعارات (الخادم يفرضها عند توزيع الدفع) ──
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [prefs, setPrefs] = useState<PushPreferences>(DEFAULT_PUSH_PREFERENCES);
  const [prefsError, setPrefsError] = useState<string | null>(null);

  useEffect(() => {
    if (!SUPABASE_ENABLED || !user) return;
    let cancelled = false;
    void getPushPreferences().then((p) => {
      if (!cancelled) setPrefs(p);
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const togglePref = useCallback((key: keyof PushPreferences) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      // تفاؤلي مع تراجع عند فشل الخادم — لا يُترك المفتاح كاذبًا.
      void setPushPreferences(next).catch(() => {
        setPrefs(prev);
        setPrefsError(t('notif.prefsError'));
      });
      setPrefsError(null);
      return next;
    });
  }, [t]);

  const PREF_ROWS: Array<{ key: keyof PushPreferences; icon: keyof typeof Ionicons.glyphMap; label: string }> = useMemo(() => [
    { key: 'session', icon: 'calendar', label: t('notif.prefSession') },
    { key: 'excuse', icon: 'shield', label: t('notif.prefExcuse') },
    { key: 'cert', icon: 'ribbon', label: t('notif.prefCert') },
    { key: 'progress', icon: 'medal', label: t('notif.prefProgress') },
    { key: 'system', icon: 'megaphone', label: t('notif.prefSystem') },
  ], [t]);

  const { todayRows, yesterdayRows, olderRows } = useMemo(() => {
    const now = Date.now();
    const yesterday = now - 86_400_000;
    return {
      todayRows: mine.filter((n) => sameDay(n.createdAt, now)),
      yesterdayRows: mine.filter((n) => sameDay(n.createdAt, yesterday)),
      olderRows: mine.filter((n) => !sameDay(n.createdAt, now) && !sameDay(n.createdAt, yesterday)),
    };
  }, [mine]);

  const handleCardPress = useCallback((n: AppNotification) => {
    const dest = screenForNotification(n.type, user?.role);
    if (dest) navigation.navigate(dest.name, dest.params);
  }, [navigation, user?.role]);

  return (
    <View style={{ flex: 1 }}>
      <Header
        title={t('notif.title')}
        back={() => navigation.goBack()}
        right={
          <Row gap={8} center>
            {hasUnread ? (
              <Btn
                title={t('notif.markAllRead')}
                size="sm"
                variant="secondary"
                icon="checkmark-done"
                onPress={() => markNotificationsRead()}
              />
            ) : null}
            <Btn
              title={t('notif.prefsTitle')}
              size="sm"
              variant="secondary"
              icon="options"
              onPress={() => setPrefsOpen(true)}
            />
          </Row>
        }
      />
      <ScrollView
        contentContainerStyle={{ padding: spacing.s5, gap: 10, paddingBottom: 60 }}
        refreshControl={
          <RefreshControl
            refreshing={syncing}
            onRefresh={() => void refresh()}
            tintColor={theme.brand}
            colors={[theme.brand]}
          />
        }
      >
        {mine.length === 0 ? (
          <Empty emoji="🔔" title={t('notif.empty')} />
        ) : (
          <View style={{ gap: 10 }}>
            <NotificationGroup
              label={t('common.today')}
              rows={todayRows}
              lang={lang}
              theme={theme}
              pulseAnim={pulseAnim}
              onItemPress={handleCardPress}
            />
            <NotificationGroup
              label={t('common.yesterday')}
              rows={yesterdayRows}
              lang={lang}
              theme={theme}
              pulseAnim={pulseAnim}
              onItemPress={handleCardPress}
            />
            <NotificationGroup
              label={t('notif.earlier')}
              rows={olderRows}
              lang={lang}
              theme={theme}
              pulseAnim={pulseAnim}
              onItemPress={handleCardPress}
            />
          </View>
        )}
      </ScrollView>

      <Sheet visible={prefsOpen} onClose={() => setPrefsOpen(false)} title={t('notif.prefsTitle')}>
        <Txt variant="caption" color={theme.textSecondary}>{t('notif.prefsHint')}</Txt>
        <View style={{ height: 12 }} />
        {PREF_ROWS.map((row) => (
          <Card key={row.key} style={{ marginBottom: 8 }}>
            <Row between center gap={12}>
              <Row center gap={10} style={{ flex: 1 }}>
                <Ionicons name={row.icon} size={19} color={theme.brand} />
                <Txt variant="bodyMed" style={{ flex: 1 }}>{row.label}</Txt>
              </Row>
              <CustomSwitch value={prefs[row.key]} onChange={() => togglePref(row.key)} />
            </Row>
          </Card>
        ))}
        {prefsError ? <Txt variant="caption" color={theme.danger}>{prefsError}</Txt> : null}
        {Platform.OS === 'web' ? (
          <Txt variant="micro" color={theme.textMuted}>{t('notif.prefsWebNote')}</Txt>
        ) : null}
      </Sheet>
    </View>
  );
}
