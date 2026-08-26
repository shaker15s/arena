/**
 * features/profile — S27 حسابي + الإعدادات (لغة/ثيم/قواعد/دعم/خروج).
 */
import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useApp } from '../../data/store';
import * as ImagePicker from 'expo-image-picker';
import { balanceOf, levelOf } from '../../data/engine';
import { ThemePref, useTheme } from '../../design/theme';
import { Lang, useI18n } from '../../i18n';
import {
  Avatar, Btn, Card, CustomSwitch, FadeIn, Header, Input, ListRow, Row,
  Sheet, Spacer, Tag, Txt,
} from '../../design/components';
import { spacing, radii, levels, leagueTierColors } from '../../design/tokens';
import { formatDate, formatTime } from '../../shared/format';
import { gamifOf } from '../../data/engine';

export function ProfileScreen() {
  const { t, lang, setLang } = useI18n();
  const { theme, preference, setTheme, isDark } = useTheme();
  const navigation = useNavigation<any>();
  const { db, user, logout, deleteMyAccount, online, syncing, lastSyncAt, refresh, toast } = useApp();
  const [langSheet, setLangSheet] = useState(false);
  const [themeSheet, setThemeSheet] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [versionTaps, setVersionTaps] = useState(0);
  const [showDevInfo, setShowDevInfo] = useState(false);

  const handleVersionTap = () => {
    setVersionTaps(prev => {
      const next = prev + 1;
      if (next >= 5) {
        setShowDevInfo(prev => !prev);
        return 0;
      }
      return next;
    });
  };

  if (!user) return null;
  const points = balanceOf(db, user.id);
  const { level } = levelOf(db, user.id);
  const gam = gamifOf(db, user.id);
  const levelMeta = levels[level - 1];

  const roleLabel: Record<string, string> = {
    student: t('common.student'),
    volunteer: t('common.volunteer'),
    supervisor: t('common.supervisor'),
    admin: t('common.admin'),
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: spacing.s3, padding: spacing.s5, gap: 12, paddingBottom: 130 }}
        refreshControl={<RefreshControl refreshing={syncing} onRefresh={() => { void refresh(); }} tintColor={theme.brand} />}
      >
        <Header title={t('profile.title')} />

        {/* بطاقة الهوية */}
        <FadeIn index={0}>
          <Card style={{ alignItems: 'center', paddingVertical: 22, gap: 8 }}>
            <View style={{ borderWidth: 3, borderColor: levelMeta.color, borderRadius: 44, padding: 3 }}>
              {user.avatarUrl ? (
                <Image source={{ uri: user.avatarUrl }} style={{ width: 76, height: 76, borderRadius: 38 }} />
              ) : (
                <Avatar name={user.fullName} color={user.avatarColor} size={76} />
              )}
            </View>
            <Txt variant="h2" align="center">{user.fullName}</Txt>
            <Row center gap={8}>
              <Tag label={roleLabel[user.role]} color={theme.brand} bg={theme.brandSoft} icon="person" />
              <Tag label={`${t('profile.level')} ${level} · ${t(`level.${level}` as any)}`} color={levelMeta.color} bg={levelMeta.color + '1F'} icon="shield-half" />
            </Row>
            <Row gap={6} style={{ marginTop: 8, width: '100%' }}>
              <MiniStat label={t('today.pointsLabel')} value={points.toLocaleString()} icon="star" color={theme.certGold} />
              <MiniStat label={t('profile.longestStreak')} value={`${gam.longestStreakWeeks} ${t('common.weeks')}`} icon="flame" color={theme.warn} />
              <MiniStat label={t('profile.memberSince')} value={formatDate(user.joinedAt, lang)} icon="calendar" color={theme.brand} />
            </Row>
          </Card>
        </FadeIn>

        {/* الإعدادات */}
        <FadeIn index={2}>
          <ListRow icon="create" title={t('profile.edit')} onPress={() => setEditOpen(true)} />
        </FadeIn>
        <FadeIn index={3}>
          <ListRow
            icon="mail-unread"
            title={t('requests.title')}
            subtitle={t('requests.officialTitle')}
            onPress={() => navigation.navigate('Requests')}
          />
        </FadeIn>
        <FadeIn index={4}>
          <ListRow
            icon="language" title={t('common.language')}
            right={<Tag label={lang === 'ar' ? t('common.arabic') : t('common.english')} color={theme.brand} bg={theme.brandSoft} />}
            onPress={() => setLangSheet(true)}
          />
        </FadeIn>
        <FadeIn index={4}>
          <ListRow
            icon="color-palette" title={t('common.theme')}
            right={<Tag label={t(preference === 'system' ? 'common.themeSystem' : preference === 'light' ? 'common.themeLight' : preference === 'dark' ? 'common.themeDark' : 'common.themeOled')} color={theme.brand} bg={theme.brandSoft} />}
            onPress={() => setThemeSheet(true)}
          />
        </FadeIn>
        <FadeIn index={5}>
          <ListRow icon="notifications" title={t('profile.notifications')} onPress={() => navigation.navigate('Notifications')} />
        </FadeIn>
        <FadeIn index={7}>
          <ListRow icon="game-controller" title={t('profile.rules')} subtitle={t('rules.title')} onPress={() => navigation.navigate('RulesGuide')} />
        </FadeIn>
        <FadeIn index={8}>
          <ListRow icon="help-buoy" title={t('profile.support')} onPress={() => navigation.navigate('Support')} />
        </FadeIn>

        {/* حالة المزامنة مع الخادم */}
        <FadeIn index={9}>
          <Card glass>
            <Row between center>
              <Row center gap={10}>
                <Ionicons
                  name={!online ? 'cloud-offline' : syncing ? 'sync' : 'cloud-done'}
                  size={18}
                  color={!online ? theme.warn : syncing ? theme.brand : theme.success}
                />
                <Txt variant="body">
                  {!online ? t('common.offlineBanner').split('—')[0] : syncing ? t('common.syncing') : `${t('common.synced')} ${lastSyncAt ? formatTime(lastSyncAt, lang) : '—'}`}
                </Txt>
              </Row>
              <Btn title={t('common.refresh')} variant="ghost" icon="refresh" onPress={() => { void refresh(); }} />
            </Row>
          </Card>
        </FadeIn>

        <FadeIn index={10}>
          <ListRow icon="log-out" title={t('common.logout')} danger onPress={() => setLogoutOpen(true)} />
        </FadeIn>
        <FadeIn index={11}>
          <ListRow icon="trash-outline" title={t('profile.deleteAccount')} subtitle={t('profile.deleteAccountSub')} danger onPress={() => { setDeleteConfirm(''); setDeleteOpen(true); }} />
        </FadeIn>

        <Pressable onPress={handleVersionTap}>
          <Txt variant="micro" color={theme.textMuted} align="center">{t('profile.about')} · v3.2.0</Txt>
        </Pressable>

        {showDevInfo && (
          <FadeIn>
            <Card style={{ marginTop: 4, padding: 12, backgroundColor: isDark ? '#111' : '#EEE', borderColor: theme.brand, borderWidth: 1 }}>
              <Txt variant="h3" color={theme.brand} align="center">Developer Mode</Txt>
              <Spacer size={8} />
              <Txt variant="caption" color={theme.textSecondary}>User ID: {user.id}</Txt>
              <Txt variant="caption" color={theme.textSecondary}>Role: {user.role}</Txt>
              <Txt variant="caption" color={theme.textSecondary}>Connection: {online ? 'Online' : 'Offline'} ({syncing ? 'Syncing' : 'Idle'})</Txt>
              <Txt variant="caption" color={theme.textSecondary}>Last Sync: {lastSyncAt ? new Date(lastSyncAt).toISOString() : 'Never'}</Txt>
            </Card>
          </FadeIn>
        )}
      </ScrollView>

      {/* اللغة */}
      <Sheet visible={langSheet} onClose={() => setLangSheet(false)} title={t('common.language')}>
        <View style={{ gap: 10 }}>
          {(['ar', 'en'] as Lang[]).map((l) => (
            <ListRow
              key={l}
              icon={l === 'ar' ? 'chatbox' : 'chatbubble'}
              title={l === 'ar' ? t('common.arabic') : t('common.english')}
              right={lang === l ? <Ionicons name="checkmark-circle" size={22} color={theme.success} /> : undefined}
              onPress={() => { setLang(l); setLangSheet(false); }}
            />
          ))}
        </View>
      </Sheet>

      {/* الثيم */}
      <Sheet visible={themeSheet} onClose={() => setThemeSheet(false)} title={t('common.theme')}>
        <View style={{ gap: 10 }}>
          {(['system', 'light', 'dark', 'oled'] as ThemePref[]).map((th) => (
            <ListRow
              key={th}
              icon={th === 'system' ? 'phone-portrait' : th === 'light' ? 'sunny' : th === 'dark' ? 'moon' : 'contrast'}
              title={t(th === 'system' ? 'common.themeSystem' : th === 'light' ? 'common.themeLight' : th === 'dark' ? 'common.themeDark' : 'common.themeOled')}
              right={preference === th ? <Ionicons name="checkmark-circle" size={22} color={theme.success} /> : undefined}
              onPress={() => { setTheme(th); setThemeSheet(false); }}
            />
          ))}
        </View>
      </Sheet>

      <Sheet visible={logoutOpen} onClose={() => setLogoutOpen(false)} title={t('profile.logoutConfirm')}>
        <View style={{ gap: 14 }}>
          <Txt variant="body" color={theme.textSecondary}>{t('profile.logoutBody')}</Txt>
          <Row gap={10}>
            <View style={{ flex: 1 }}><Btn title={t('common.cancel')} variant="ghost" full onPress={() => setLogoutOpen(false)} /></View>
            <View style={{ flex: 1 }}><Btn title={t('common.logout')} variant="danger" full icon="log-out" onPress={() => { setLogoutOpen(false); void logout(); }} /></View>
          </Row>
        </View>
      </Sheet>

      <Sheet visible={deleteOpen} onClose={() => setDeleteOpen(false)} title={t('profile.deleteAccount')}>
        <View style={{ gap: 14 }}>
          <Card color={theme.dangerSoft} style={{ borderColor: theme.danger + '55' }}>
            <Row center gap={10}>
              <Ionicons name="warning" size={26} color={theme.danger} />
              <Txt variant="body" color={theme.danger} style={{ flex: 1 }}>{t('profile.deleteBody')}</Txt>
            </Row>
          </Card>
          <Input
            label={t('profile.deleteTypeConfirm')}
            value={deleteConfirm}
            onChange={setDeleteConfirm}
            placeholder="DELETE"
            autoCapitalize="characters"
          />
          {deleteConfirm.toUpperCase() !== 'DELETE' ? (
            <Txt variant="micro" color={theme.textMuted}>{t('profile.deleteHint')}</Txt>
          ) : null}
          <Row gap={10}>
            <View style={{ flex: 1 }}><Btn title={t('common.cancel')} variant="ghost" full onPress={() => setDeleteOpen(false)} /></View>
            <View style={{ flex: 1 }}>
              <Btn
                title={t('profile.deleteAccount')}
                variant="danger" full icon="trash-outline"
                loading={deleting}
                disabled={deleteConfirm.toUpperCase() !== 'DELETE'}
                onPress={async () => {
                  setDeleting(true);
                  const r = await deleteMyAccount(deleteConfirm.toUpperCase());
                  setDeleting(false);
                  if (!r.ok) { toast(r.error ?? t('common.errorTitle'), 'error'); return; }
                  setDeleteOpen(false);
                }}
              />
            </View>
          </Row>
        </View>
      </Sheet>

      <EditProfileSheet visible={editOpen} onClose={() => setEditOpen(false)} />
    </View>
  );
}

function MiniStat({ label, value, icon, color }: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap; color: string }) {
  const { theme } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 3, minWidth: 0 }}>
      <Row center gap={4}>
        <Ionicons name={icon} size={13} color={color} />
        <Txt variant="h3" numberOfLines={1} style={{ fontSize: 15 }}>{value}</Txt>
      </Row>
      <Txt variant="micro" color={theme.textMuted}>{label}</Txt>
    </View>
  );
}

function EditProfileSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { user, updateProfile, uploadAvatar, toast } = useApp();
  const { theme, isDark } = useTheme();
  const [name, setName] = useState(user?.fullName ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [avatar, setAvatar] = useState<string | null>(user?.avatarUrl ?? null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  React.useEffect(() => {
    if (visible && user) {
      setName(user.fullName);
      setPhone(user.phone);
      setAvatar(user.avatarUrl ?? null);
      setError('');
    }
  }, [visible, user]);

  if (!user) return null;

  const pick = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7 });
    if (res.canceled || !res.assets?.[0]?.uri) return;
    setUploading(true);
    const url = await uploadAvatar(res.assets[0].uri);
    setUploading(false);
    if (url) setAvatar(url);
  };

  const save = async () => {
    if (name.trim().split(/\s+/).length < 2) { setError(t('complete.nameError')); return; }
    if (!/^01\d{9}$/.test(phone.trim())) { setError(t('complete.phoneError')); return; }
    setSaving(true);
    const r = await updateProfile({ fullName: name.trim(), phone: phone.trim(), avatarUrl: avatar });
    setSaving(false);
    if (!r.ok) { setError(r.error ?? t('common.errorTitle')); return; }
    onClose();
    toast(t('complete.saved'), 'success');
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t('profile.edit')}>
      <View style={{ gap: 14 }}>
        <Pressable onPress={pick} style={{ alignSelf: 'center' }}>
          <View style={{
            width: 88, height: 88, borderRadius: 44, overflow: 'hidden',
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: isDark ? 'rgba(120,120,128,0.24)' : 'rgba(120,120,128,0.12)',
            borderWidth: 2, borderColor: theme.brand,
          }}>
            {uploading ? <ActivityIndicator color={theme.brand} />
              : avatar ? <Image source={{ uri: avatar }} style={{ width: '100%', height: '100%' }} />
              : <Ionicons name="camera" size={30} color={theme.brand} />}
          </View>
        </Pressable>

        <Card glass>
          <Row center gap={10}>
            <Ionicons name="mail" size={16} color={theme.brand} />
            <View style={{ flex: 1 }}>
              <Txt variant="micro" color={theme.textMuted}>{t('common.email')}</Txt>
              <Txt variant="bodyMed">{user.email ?? '—'}</Txt>
            </View>
            <Ionicons name="lock-closed" size={14} color={theme.textMuted} />
          </Row>
        </Card>

        <Input label={t('complete.fullName')} value={name} onChange={setName} icon="person" />
        <Input
          label={t('common.phone')}
          value={phone}
          onChange={(v) => { setPhone(v.replace(/[^\d]/g, '')); setError(''); }}
          keyboardType="phone-pad"
          icon="call"
          maxLength={11}
        />
        {error ? <Txt variant="caption" color={theme.danger}>{error}</Txt> : null}
        <Btn title={t('common.save')} full loading={saving} onPress={save} icon="checkmark" />
      </View>
    </Sheet>
  );
}
export function SupportScreen({ navigation }: any) {
  const { t } = useI18n();
  const { theme } = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <Header title={t('profile.support')} back={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: spacing.s5, gap: 12 }}>
        {[
          { q: t('support.attendanceQ'), a: t('support.attendanceA') },
          { q: t('support.absenceQ'), a: t('support.absenceA') },
          { q: t('support.certificateQ'), a: t('support.certificateA') },
          { q: t('support.leagueQ'), a: t('support.leagueA') },
        ].map((f, i) => (
          <FadeIn key={i} index={i + 1}>
            <Card>
              <Row center gap={8}>
                <Ionicons name="help-circle" size={18} color={theme.brand} />
                <Txt variant="bodyMed" style={{ flex: 1 }}>{f.q}</Txt>
              </Row>
              <Spacer size={6} />
              <Txt variant="caption" color={theme.textSecondary}>{f.a}</Txt>
            </Card>
          </FadeIn>
        ))}
      </ScrollView>
    </View>
  );
}

export { formatDate };
