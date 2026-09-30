/**
 * features/settings — الإعدادات (FUNC-10) + المنطقة والتوقيت (FUNC-16/FUNC-20)
 * + إدارة البيانات: تصدير قبل الحذف (FUNC-14).
 *
 * كل إعداد هنا «مؤثر على كل الشاشات فورًا» كما يطلب معيار القبول:
 *  • اللغة ⇒ مزوّد i18n (يقلب الاتجاه فورًا).
 *  • الثيم ⇒ مزوّد الثيم.
 *  • حجم النص / التباين العالي / تقليل الحركة ⇒ `design/preferences` الذي يكتب
 *    في طبقة الرموز ومحرّك الحركة، فلا تحتاج أي شاشة أن تعرف بالإعداد.
 *  • المنطقة الزمنية ⇒ تُحفظ في الملف الشخصي على الخادم (`set_my_timezone`) لأن
 *    الستريك والتقارير تُحسَب في Cairo افتراضيًا على السيرفر.
 *  • تصدير البيانات ⇒ ملف JSON كامل لملكية المستخدم لبياناته قبل أي حذف.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../../data/store';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import { useA11yPrefs, type TextScale } from '../../design/preferences';
import { Btn, Card, CustomSwitch, FadeIn, Header, Input, Row, Screen, Segmented, Sheet, Txt } from '../../design/components';
import { Icon } from '../../design/icons';
import { radii, spacing } from '../../design/tokens';
import { saveTextFile } from '../../shared/export';
import { setMyTimezone } from '../../data/actions';
import type { ThemePref } from '../../design/theme';

/**
 * مناطق مقترحة للطلاب الحاليين؛ الافتراضي القاهرة كما في سياسة المنتج.
 * الأسماء من القاموس (مفتاح لكل منطقة) فلا نص مضمّن في الكود.
 */
const TIMEZONES: Array<{ value: string; key: 'settings.tzCairo' | 'settings.tzAlexandria' | 'settings.tzRiyadh' | 'settings.tzDubai' | 'settings.tzLondon' | 'settings.tzUtc' }> = [
  { value: 'Africa/Cairo', key: 'settings.tzCairo' },
  { value: 'Africa/Alexandria', key: 'settings.tzAlexandria' },
  { value: 'Asia/Riyadh', key: 'settings.tzRiyadh' },
  { value: 'Asia/Dubai', key: 'settings.tzDubai' },
  { value: 'Europe/London', key: 'settings.tzLondon' },
  { value: 'UTC', key: 'settings.tzUtc' },
];

export function SettingsScreen({ navigation }: any) {
  const { t, lang, setLang } = useI18n();
  const { theme, preference, setTheme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { db, user, toast, deleteMyAccount } = useApp();
  const { textScale, highContrast, reduceMotion, setPrefs, reset } = useA11yPrefs();

  const [tzOpen, setTzOpen] = useState(false);
  const [tz, setTz] = useState<string>('Africa/Cairo');
  const [tzSaving, setTzSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteWord, setDeleteWord] = useState('');
  const [deleting, setDeleting] = useState(false);

  /** نسخة المستخدم من بياناته: كل ما يخصّه من الجداول المحمّلة محليًا. */
  const myData = useMemo(() => {
    if (!user) return null;
    return {
      exported_at: new Date().toISOString(),
      app: 'Masar 3.2.0',
      profile: user,
      enrollments: db.enrollments.filter((e) => e.userId === user.id),
      attendance: db.attendance.filter((a) => a.userId === user.id),
      point_events: db.pointEvents.filter((p) => p.userId === user.id),
      streak_weeks: db.streakWeeks.filter((s) => s.userId === user.id),
      gamification: db.gamification.filter((g) => g.userId === user.id),
      badges: db.userBadges.filter((b) => b.userId === user.id),
      certificates: db.certificates.filter((c) => c.userId === user.id),
      excuses: db.excuses.filter((e) => e.userId === user.id),
      notifications: db.notifications.filter((n) => n.userId === user.id),
    };
  }, [db, user]);

  const exportData = useCallback(async () => {
    if (!myData) return;
    setExporting(true);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const ok = await saveTextFile(
        `masar-my-data-${stamp}.json`,
        JSON.stringify(myData, null, 2),
        'application/json',
        'public.json',
      );
      toast(ok ? t('settings.exportOk') : t('settings.exportFail'), ok ? 'success' : 'error');
    } finally {
      setExporting(false);
    }
  }, [myData, t, toast]);

  const saveTimezone = useCallback(async (value: string) => {
    setTz(value);
    setTzOpen(false);
    setTzSaving(true);
    try {
      const res = await setMyTimezone(value);
      toast(res.ok ? t('settings.tzOk') : t('settings.tzFail'), res.ok ? 'success' : 'error');
    } catch {
      toast(t('settings.tzFail'), 'error');
    } finally {
      setTzSaving(false);
    }
  }, [t, toast]);

  const needWord = t('settings.deleteWord');

  const confirmDelete = useCallback(async () => {
    setDeleting(true);
    try {
      const r = await deleteMyAccount(needWord);
      if (!r.ok) toast(r.error ?? t('settings.deleteFail'), 'error');
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  }, [deleteMyAccount, needWord, t, toast]);

  const tzLabel = useMemo(() => {
    const found = TIMEZONES.find((x) => x.value === tz);
    return found ? t(found.key) : tz;
  }, [tz, t]);

  const themeOptions: Array<{ value: ThemePref; label: string }> = [
    { value: 'system', label: t('settings.themeSystem') },
    { value: 'light', label: t('settings.themeLight') },
    { value: 'dark', label: t('settings.themeDark') },
    { value: 'oled', label: t('settings.themeOled') },
  ];

  const textOptions: Array<{ value: string; label: string }> = [
    { value: '1', label: '100%' },
    { value: '1.15', label: '115%' },
    { value: '1.3', label: '130%' },
  ];

  return (
    <Screen label={t('settings.title')} style={{ flex: 1 }}>
      <Header title={t('settings.title')} back={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.s5, paddingBottom: insets.bottom + 100, gap: 12 }}
      >
        {/* ── المنطقة واللغة ── */}
        <FadeIn index={0}>
          <Card>
            <Row center gap={8} style={{ marginBottom: 10 }}>
              <Icon name="globe-outline" size={18} color={theme.brand} />
              <Txt variant="bodyMed" style={{ flex: 1 }}>{t('settings.regionSection')}</Txt>
            </Row>
            <Segmented
              options={[
                { value: 'ar', label: t('settings.langAr') },
                { value: 'en', label: t('settings.langEn') },
              ]}
              value={lang}
              onChange={(v) => setLang(v as 'ar' | 'en')}
            />
            <View style={{ height: 12 }} />
            <Btn
              title={`${t('settings.timezone')}: ${tzLabel}`}
              variant="secondary"
              icon="time-outline"
              loading={tzSaving}
              onPress={() => setTzOpen(true)}
              accessibilityHint={t('settings.tzHint')}
            />
            <Txt variant="micro" color={theme.textMuted} style={{ marginTop: 8 }}>
              {t('settings.tzNote')}
            </Txt>
          </Card>
        </FadeIn>

        {/* ── المظهر ── */}
        <FadeIn index={1}>
          <Card>
            <Row center gap={8} style={{ marginBottom: 10 }}>
              <Icon name="color-palette-outline" size={18} color={theme.brand} />
              <Txt variant="bodyMed" style={{ flex: 1 }}>{t('settings.appearanceSection')}</Txt>
            </Row>
            <Segmented options={themeOptions} value={preference} onChange={setTheme} />
          </Card>
        </FadeIn>

        {/* ── الإتاحة ── */}
        <FadeIn index={2}>
          <Card>
            <Row center gap={8} style={{ marginBottom: 10 }}>
              <Icon name="accessibility-outline" size={18} color={theme.brand} />
              <Txt variant="bodyMed" style={{ flex: 1 }}>{t('settings.a11ySection')}</Txt>
            </Row>

            <Txt variant="caption" color={theme.textSecondary} style={{ marginBottom: 6 }}>
              {t('settings.textSize')}
            </Txt>
            <Segmented
              options={textOptions}
              value={String(textScale)}
              onChange={(v) => setPrefs({ textScale: Number(v) as TextScale })}
            />
            <Txt variant="micro" color={theme.textMuted} style={{ marginTop: 6 }}>
              {t('settings.textSizeHint')}
            </Txt>

            <View style={{ height: 12 }} />
            <Row between center gap={12}>
              <View style={{ flex: 1 }}>
                <Txt variant="bodyMed">{t('settings.reduceMotion')}</Txt>
                <Txt variant="micro" color={theme.textMuted}>{t('settings.reduceMotionHint')}</Txt>
              </View>
              <CustomSwitch value={reduceMotion} onChange={() => setPrefs({ reduceMotion: !reduceMotion })} />
            </Row>

            <View style={{ height: 12 }} />
            <Row between center gap={12}>
              <View style={{ flex: 1 }}>
                <Txt variant="bodyMed">{t('settings.highContrast')}</Txt>
                <Txt variant="micro" color={theme.textMuted}>{t('settings.highContrastHint')}</Txt>
              </View>
              <CustomSwitch value={highContrast} onChange={() => setPrefs({ highContrast: !highContrast })} />
            </Row>

            <View style={{ height: 12 }} />
            <Btn title={t('settings.resetA11y')} variant="ghost" size="sm" icon="refresh" onPress={reset} />
          </Card>
        </FadeIn>

        {/* ── إدارة البيانات (FUNC-14) ── */}
        <FadeIn index={3}>
          <Card>
            <Row center gap={8} style={{ marginBottom: 10 }}>
              <Icon name="folder-open-outline" size={18} color={theme.brand} />
              <Txt variant="bodyMed" style={{ flex: 1 }}>{t('settings.dataSection')}</Txt>
            </Row>
            <Txt variant="caption" color={theme.textSecondary} style={{ marginBottom: 10 }}>
              {t('settings.dataHint')}
            </Txt>
            <Row gap={10} wrap>
              <Btn
                title={t('settings.exportData')}
                variant="secondary"
                icon="download-outline"
                loading={exporting}
                onPress={() => void exportData()}
              />
              <Btn
                title={t('settings.deleteAccount')}
                variant="danger"
                icon="trash-outline"
                onPress={() => setDeleteOpen(true)}
              />
            </Row>
          </Card>
        </FadeIn>

        <FadeIn index={4}>
          <Btn
            title={t('profile.support')}
            variant="ghost"
            icon="help-buoy-outline"
            onPress={() => navigation.navigate('Support')}
          />
          {Platform.OS === 'web' ? (
            <Txt variant="micro" color={theme.textMuted} align="center" style={{ marginTop: 8 }}>
              {isDark ? t('settings.webDarkNote') : t('settings.webLightNote')}
            </Txt>
          ) : null}
        </FadeIn>
      </ScrollView>

      {/* اختيار المنطقة الزمنية */}
      <Sheet visible={tzOpen} onClose={() => setTzOpen(false)} title={t('settings.timezone')}>
        <View style={{ gap: 8 }}>
          {TIMEZONES.map((zone) => (
            <Card
              key={zone.value}
              onPress={() => void saveTimezone(zone.value)}
              style={{ borderColor: zone.value === tz ? theme.brand : theme.line, borderWidth: zone.value === tz ? 2 : 1 }}
            >
              <Row between center gap={10}>
                <Txt variant="bodyMed" style={{ flex: 1 }}>{t(zone.key)}</Txt>
                {zone.value === tz ? <Icon name="checkmark-circle" size={20} color={theme.brand} /> : null}
              </Row>
            </Card>
          ))}
        </View>
      </Sheet>

      {/* تأكيد الحذف — كلمة مكتوبة + تنبيه صريح، كما تطلب App Store 5.1.1(v) */}
      <Sheet visible={deleteOpen} onClose={() => setDeleteOpen(false)} title={t('settings.deleteAccount')}>
        <View style={{ gap: 12 }}>
          <Row center gap={10}>
            <Icon name="warning" size={24} color={theme.danger} />
            <Txt variant="caption" color={theme.textSecondary} style={{ flex: 1 }}>
              {t('settings.deleteWarning')}
            </Txt>
          </Row>
          <Input
            label={t('settings.deleteTypeWord', { word: needWord })}
            value={deleteWord}
            onChange={setDeleteWord}
            autoCapitalize="characters"
            accessibilityLabel={t('settings.deleteTypeWord', { word: needWord })}
          />
          <Row gap={10}>
            <Btn
              title={t('settings.deleteConfirm')}
              variant="danger"
              loading={deleting}
              disabled={deleteWord.trim() !== needWord}
              onPress={() => void confirmDelete()}
            />
            <Btn title={t('common.cancel')} variant="ghost" onPress={() => setDeleteOpen(false)} />
          </Row>
          <Btn title={t('settings.exportFirst')} variant="secondary" icon="download-outline" onPress={() => void exportData()} />
        </View>
      </Sheet>
    </Screen>
  );
}
