/**
 * features/profile — S27 حسابي + الإعدادات (لغة/ثيم/قواعد/دعم/خروج).
 */
import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useApp } from '../../data/store';
import { balanceOf, levelOf } from '../../data/engine';
import { useTheme } from '../../design/theme';
import { ThemeName } from '../../design/tokens';
import { Lang, useI18n } from '../../i18n';
import {
  Avatar, Btn, Card, CustomSwitch, FadeIn, Header, Input, ListRow, Row,
  Sheet, Spacer, Tag, Txt,
} from '../../design/components';
import { spacing, radii, levels, leagueTierColors } from '../../design/tokens';
import { formatDate } from '../../shared/format';
import { gamifOf } from '../../data/engine';

export function ProfileScreen() {
  const { t, lang, setLang } = useI18n();
  const { theme, themeName, setTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { db, user, logout, resetDemo, online, setOnline, toast } = useApp();
  const [langSheet, setLangSheet] = useState(false);
  const [themeSheet, setThemeSheet] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

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
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.s3, padding: spacing.s5, gap: 12, paddingBottom: 130 }}>
        <Header title={t('profile.title')} />

        {/* بطاقة الهوية */}
        <FadeIn index={0}>
          <Card style={{ alignItems: 'center', paddingVertical: 22, gap: 8 }}>
            <View style={{ borderWidth: 3, borderColor: levelMeta.color, borderRadius: 44, padding: 3 }}>
              <Avatar name={user.fullName} color={user.avatarColor} size={76} />
            </View>
            <Txt variant="h2" align="center">{user.fullName}</Txt>
            <Row center gap={8}>
              <Tag label={roleLabel[user.role]} color={theme.brand} bg={theme.brandSoft} icon="person" />
              <Tag label={`${t('profile.level')} ${level} · ${t(`level.${level}` as any)}`} color={levelMeta.color} bg={levelMeta.color + '1F'} icon="shield-half" />
            </Row>
            <Row gap={22} style={{ marginTop: 6 }}>
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
            icon="language" title={t('common.language')}
            right={<Tag label={lang === 'ar' ? t('common.arabic') : t('common.english')} color={theme.brand} bg={theme.brandSoft} />}
            onPress={() => setLangSheet(true)}
          />
        </FadeIn>
        <FadeIn index={4}>
          <ListRow
            icon="color-palette" title={t('common.theme')}
            right={<Tag label={t(themeName === 'light' ? 'common.themeLight' : themeName === 'dark' ? 'common.themeDark' : 'common.themeOled')} color={theme.brand} bg={theme.brandSoft} />}
            onPress={() => setThemeSheet(true)}
          />
        </FadeIn>
        <FadeIn index={5}>
          <ListRow icon="finger-print" title={t('profile.biometric')} subtitle={t('profile.biometricSoon')} right={<CustomSwitch value={false} onChange={() => toast(t('common.comingInV2'), 'info')} />} />
        </FadeIn>
        <FadeIn index={6}>
          <ListRow icon="notifications" title={t('profile.notifications')} subtitle={t('profile.notifBody')} right={<CustomSwitch value={true} onChange={() => {}} />} />
        </FadeIn>
        <FadeIn index={7}>
          <ListRow icon="game-controller" title={t('profile.rules')} subtitle={t('rules.title')} onPress={() => navigation.navigate('RulesGuide')} />
        </FadeIn>
        <FadeIn index={8}>
          <ListRow icon="help-buoy" title={t('profile.support')} subtitle={t('profile.supportBody')} onPress={() => navigation.navigate('Support')} />
        </FadeIn>

        {/* قسم المطوّر (عرض) */}
        <FadeIn index={9}>
          <Card glass>
            <Txt variant="caption" color={theme.textMuted} style={{ marginBottom: 8 }}>🛠️ {t('common.demoBanner')}</Txt>
            <Row between center>
              <Txt variant="body">{t('common.offlineBanner').split('—')[0]}</Txt>
              <CustomSwitch value={!online} onChange={(v) => setOnline(!v)} color={theme.warn} />
            </Row>
            <Spacer size={10} />
            <Btn title={t('common.resetDemo')} variant="danger" icon="refresh" onPress={() => {
              if (typeof window !== 'undefined') {
                const ok = window.confirm(t('common.resetConfirm'));
                if (!ok) return;
              }
              resetDemo();
            }} />
          </Card>
        </FadeIn>

        <FadeIn index={10}>
          <ListRow icon="log-out" title={t('common.logout')} danger onPress={logout} />
        </FadeIn>

        <Txt variant="micro" color={theme.textMuted} align="center">{t('profile.about')} · v3.0.0</Txt>
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
          {(['light', 'dark', 'oled'] as ThemeName[]).map((th) => (
            <ListRow
              key={th}
              icon={th === 'light' ? 'sunny' : th === 'dark' ? 'moon' : 'contrast'}
              title={t(th === 'light' ? 'common.themeLight' : th === 'dark' ? 'common.themeDark' : 'common.themeOled')}
              right={themeName === th ? <Ionicons name="checkmark-circle" size={22} color={theme.success} /> : undefined}
              onPress={() => { setTheme(th); setThemeSheet(false); }}
            />
          ))}
        </View>
      </Sheet>

      <EditProfileSheet visible={editOpen} onClose={() => setEditOpen(false)} />
    </View>
  );
}

function MiniStat({ label, value, icon, color }: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap; color: string }) {
  const { theme } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: 3 }}>
      <Row center gap={4}>
        <Ionicons name={icon} size={13} color={color} />
        <Txt variant="h3">{value}</Txt>
      </Row>
      <Txt variant="micro" color={theme.textMuted}>{label}</Txt>
    </View>
  );
}

function EditProfileSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { db, user, mutate, toast } = useApp();
  const { theme } = useTheme();
  const [name, setName] = useState(user?.fullName ?? '');
  const [saving, setSaving] = useState(false);
  if (!user) return null;
  const save = async () => {
    if (name.trim().length < 3) return;
    setSaving(true);
    await mutate((d) => {
      const p = d.profiles.find((x) => x.id === user.id);
      if (p) p.fullName = name.trim();
    });
    setSaving(false);
    onClose();
    toast(t('common.done') + ' ✓', 'success');
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={t('profile.edit')}>
      <View style={{ gap: 12 }}>
        <Input label={t('complete.fullName')} value={name} onChange={setName} icon="person" />
        <Btn title={t('common.save')} full loading={saving} onPress={save} icon="checkmark" />
      </View>
    </Sheet>
  );
}

// ───────────────────────────── الدعم ─────────────────────────────

export function SupportScreen({ navigation }: any) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const { db } = useApp();
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title={t('profile.support')} back={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: spacing.s5, gap: 12 }}>
        <FadeIn index={0}>
          <Card glass>
            <Row center gap={8}>
              <Ionicons name="help-buoy" size={20} color={theme.brand} />
              <Txt variant="body" color={theme.textSecondary} style={{ flex: 1 }}>{t('profile.supportBody')}</Txt>
            </Row>
          </Card>
        </FadeIn>
        {[
          { q: 'كيف أسجل حضوري؟', a: 'افتح زر «امسح» أثناء الجلسة وامسح رمز QR من شاشة المدرب، أو أدخل كود الـ 6 أرقام. الرمز يتجدد كل 25 ثانية فالرمز المصوّر لا يعمل.' },
          { q: 'ماذا لو غبت؟', a: 'قدّم عذرًا من شاشة «أعذاري» خلال الجلسة التالية. العذر المقبول يحافظ على الستريك بدون نقاط. لو عندك مُجمّد ستُستهلك حمايته تلقائيًا.' },
          { q: 'كيف أكسب الشهادة؟', a: 'احضر النسبة المطلوبة (الحالية مكتوبة في «قواعد اللعبة») وسيصدر المشرف شهادتك بضغطة عند إغلاق المجموعة، بسيريال ورابط تحقق عام.' },
          { q: 'كيف يعمل الدوري؟', a: 'نقاط كل أسبوع تُحسب من الصفر. أعلى المجموعة يصعد وأدناها يهبط. الجدد لهم لوحة «نجوم صاعدة» عادلة.' },
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
