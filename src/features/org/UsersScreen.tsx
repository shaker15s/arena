import React, { useMemo, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useApp } from '../../data/store';
import { profileOf } from '../../data/engine';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import {
  Avatar, Btn, Card, Chip, Header, Input, LiveRegion, Row, Screen, Sheet, Spacer, Tag, Txt, useDebounce,
} from '../../design/components';
import { PillGradientSearchInput } from '../../design/interactive';
import { MasarMascot } from '../../design/mascot';
import { spacing } from '../../design/tokens';
import { useDeferredSearch } from '../../shared/useSearch';
import type { Role } from '../../data/types';
import { updateUserAccess } from '../../data/actions';
import { Icon } from '../../design/icons';

export function UsersScreen() {
  const { t } = useI18n();
  const { theme } = useTheme();
  const { db, toast, user, refresh, syncing } = useApp();
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [selected, setSelected] = useState<string | null>(null);


  const roles = ['all', 'student', 'volunteer', 'supervisor', 'admin'];
  const roleLabel: Record<string, string> = {
    student: t('common.student'), volunteer: t('common.volunteer'), supervisor: t('common.supervisor'), admin: t('common.admin'),
  };

  const scoped = useMemo(
    () => db.profiles.filter((p) => roleFilter === 'all' || p.role === roleFilter),
    [db.profiles, roleFilter],
  );

  // FUNC-07: بحث عربي مُطبَّع ومرتَّب بالملاءمة (أحمد = احمد = أحمَد).
  const { results: list } = useDeferredSearch(query, scoped, (p) => [p.fullName, p.phone, p.email]);

  const selUser = selected ? profileOf(db, selected) : null;

  const changeAccess = async (profileId: string, patch: { role?: Role; status?: 'active' | 'disabled'; branchId?: string | null }) => {
    try {
      await updateUserAccess(profileId, patch);
      await refresh();
      toast(patch.role ? t('users.roleChanged') : patch.branchId !== undefined ? t('users.branchUpdated') : t('users.statusChanged'), 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  return (
    <Screen label={t('users.title')} style={{ flex: 1 }}>
      <FlatList
        data={list}
        keyExtractor={(p) => p.id}
        initialNumToRender={12}
        windowSize={5}
        contentContainerStyle={{ paddingTop: spacing.s3, padding: spacing.s5, gap: spacing.s3, paddingBottom: spacing.s5 }}
        refreshControl={
          <RefreshControl
            refreshing={syncing}
            onRefresh={() => void refresh()}
            tintColor={theme.brand}
            colors={[theme.brand]}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <Header title={t('users.title')} />
            <PillGradientSearchInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('users.searchHint')}
              onClear={() => setQuery('')}
            />
            <Row gap={6} wrap>
              {roles.map((r) => (
                <Chip key={r} label={r === 'all' ? t('common.all') : roleLabel[r]} active={roleFilter === r} onPress={() => setRoleFilter(r)} />
              ))}
            </Row>
            <LiveRegion politeness="polite">
              <Txt variant="caption" color={theme.textMuted}>{t('users.resultCount', { x: list.length })}</Txt>
            </LiveRegion>
          </View>
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingVertical: 30 }}>
            <MasarMascot size={90} mode="greeting" interactive hideFloatingBubble />
            <View style={{ height: 12 }} />
            <Txt variant="body" color={theme.textSecondary} align="center">
              {t('explore.noResults')}{'\n'}{t('explore.noResultsBody')}
            </Txt>
          </View>
        }
        renderItem={({ item: p }) => (
          <Card onPress={() => setSelected(p.id)} style={{ marginBottom: 8 }}>
            <Row center gap={10}>
              <Avatar name={p.fullName} color={p.avatarColor} size={40} />
              <View style={{ flex: 1 }}>
                <Txt variant="bodyMed" numberOfLines={2}>{p.fullName}</Txt>
                <Txt variant="micro" color={theme.textMuted}>{p.phone || t('common.noPhone')} · {p.email || t('common.noEmail')}</Txt>
              </View>
              <Tag label={roleLabel[p.role]} color={p.status === 'active' ? theme.brand : theme.danger} bg={p.status === 'active' ? theme.brandSoft : theme.dangerSoft} />
            </Row>
          </Card>
        )}
      />

      {/* S48 تفاصيل المستخدم */}
      <Sheet visible={selUser != null} onClose={() => setSelected(null)} title={selUser?.fullName ?? ''}>
        {selUser && user ? (
          <View style={{ gap: 12 }}>
            <Row center gap={12}>
              <Avatar name={selUser.fullName} color={selUser.avatarColor} size={56} />
              <View style={{ flex: 1 }}>
                <Txt variant="h3">{selUser.fullName}</Txt>
                <Txt variant="caption" color={theme.textSecondary}>{selUser.phone || '—'} · {roleLabel[selUser.role]}</Txt>
                {selUser.email ? (
                  <Txt variant="caption" color={theme.brand} style={{ marginTop: 2 }}>✉️ {selUser.email}</Txt>
                ) : null}
                <Txt variant="micro" color={theme.textMuted} style={{ marginTop: 2 }}>
                  📍 {db.branches.find((b) => b.id === selUser.branchId)?.name ?? t('users.noBranch')}
                </Txt>
              </View>
            </Row>

            {user.role === 'admin' ? (
              <View style={{ gap: 10 }}>
                <Txt variant="caption" color={theme.textSecondary}>{t('users.changeRole')}</Txt>
                <Row gap={6} wrap>
                  {(['student', 'volunteer', 'supervisor', 'admin'] as Role[]).map((role) => (
                    <Btn
                      key={role}
                      title={roleLabel[role]}
                      size="sm"
                      variant={selUser.role === role ? 'primary' : 'ghost'}
                      onPress={selUser.role === role ? undefined : () => { void changeAccess(selUser.id, { role }); }}
                    />
                  ))}
                </Row>

                <Spacer size={4} />
                <Txt variant="caption" color={theme.textSecondary}>🏢 تعيين / تغيير الفرع (إدارة الفرع):</Txt>
                <Row gap={6} wrap>
                  <Chip
                    label={t('users.unassignedBranch')}
                    active={!selUser.branchId}
                    onPress={() => { void changeAccess(selUser.id, { branchId: null }); }}
                  />
                  {db.branches.map((b) => (
                    <Chip
                      key={b.id}
                      label={b.name}
                      active={selUser.branchId === b.id}
                      onPress={() => { void changeAccess(selUser.id, { branchId: b.id }); }}
                    />
                  ))}
                </Row>

                {selUser.id !== user.id ? (
                  <Row gap={8} style={{ marginTop: 8 }}>
                    <Btn
                      title={selUser.status === 'active' ? t('users.deactivate') : t('users.activate')}
                      variant={selUser.status === 'active' ? 'danger' : 'success'}
                      icon={selUser.status === 'active' ? 'pause-circle' : 'play-circle'}
                      onPress={() => {
                        void changeAccess(selUser.id, { status: selUser.status === 'active' ? 'disabled' : 'active' });
                      }}
                    />
                  </Row>
                ) : null}
              </View>
            ) : null}

            <Card glass>
              <Row center gap={8}>
                <Icon name="information-circle" size={15} color={theme.textMuted} />
                <Txt variant="caption" color={theme.textSecondary} style={{ flex: 1 }}>
                  {t('users.sessionsAttended')}: {db.attendance.filter((a) => a.userId === selUser.id && a.status !== 'absent').length}
                </Txt>
              </Row>
            </Card>
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}
