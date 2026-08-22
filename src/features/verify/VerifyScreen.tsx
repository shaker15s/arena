/**
 * features/verify — S05: التحقق العام من الشهادة (جهات التوظيف — بلا تسجيل دخول).
 * متاحة كـ deep link عام: مسار يعمل من أي متصفح غريب.
 */
import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../../data/store';
import { lookupCertificate } from '../../data/engine';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import { Avatar, Btn, Card, FadeIn, Header, Input, Row, Spacer, Txt } from '../../design/components';
import { spacing, radii } from '../../design/tokens';
import { formatDate } from '../../shared/format';

export function VerifyScreen({ navigation, route }: any) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { db } = useApp();
  const [serial, setSerial] = useState<string>(route?.params?.serial ?? '');
  const [result, setResult] = useState<null | 'found' | 'not-found'>(null);
  const [loading, setLoading] = useState(false);

  const check = async () => {
    if (!serial.trim()) return;
    setLoading(true);
    await new Promise((r) => setTimeout(r, 450));
    const found = lookupCertificate(db, serial);
    setResult(found ? 'found' : 'not-found');
    setLoading(false);
  };

  const found = result === 'found' ? lookupCertificate(db, serial) : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <Header title={t('verify.title')} back={navigation.canGoBack?.() ? () => navigation.goBack() : undefined} />
      <ScrollView contentContainerStyle={{ padding: spacing.s5, gap: 16 }}>
        <FadeIn index={0}>
          <Card glass>
            <Row center gap={10}>
              <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: theme.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="shield-checkmark" size={24} color={theme.brand} />
              </View>
              <Txt variant="body" color={theme.textSecondary} style={{ flex: 1 }}>{t('verify.body')}</Txt>
            </Row>
          </Card>
        </FadeIn>

        <FadeIn index={1}>
          <Input
            value={serial}
            onChange={setSerial}
            placeholder={t('verify.serialPlaceholder')}
            icon="key"
          />
        </FadeIn>
        <FadeIn index={2}>
          <Btn title={t('verify.checkNow')} onPress={check} loading={loading} full size="lg" icon="search" />
        </FadeIn>

        {result === 'not-found' ? (
          <FadeIn index={0}>
            <Card color={theme.dangerSoft} style={{ borderColor: theme.danger + '55' }}>
              <Row center gap={12}>
                <Ionicons name="close-circle" size={40} color={theme.danger} />
                <View style={{ flex: 1 }}>
                  <Txt variant="h3" color={theme.danger}>{t('verify.notFound')}</Txt>
                  <Txt variant="caption" color={theme.textSecondary}>{t('verify.notFoundBody')}</Txt>
                </View>
              </Row>
            </Card>
          </FadeIn>
        ) : null}

        {found ? (
          <FadeIn index={0}>
            <Card style={{ borderColor: theme.success + '66', borderWidth: 2 }}>
              <View style={{ alignItems: 'center', gap: 12, paddingVertical: 8 }}>
                <View style={{ backgroundColor: theme.successSoft, borderRadius: radii.pill, paddingHorizontal: 16, paddingVertical: 6 }}>
                  <Row center gap={6}>
                    <Ionicons name="checkmark-circle" size={18} color={theme.success} />
                    <Txt variant="h3" color={theme.success}>{t('verify.verified')}</Txt>
                  </Row>
                </View>
                <Avatar name={found.user.fullName} color={found.user.avatarColor} size={72} />
                <View style={{ alignItems: 'center', gap: 2 }}>
                  <Txt variant="h2" align="center">{found.user.fullName}</Txt>
                  <Txt variant="body" color={theme.textSecondary} align="center">{found.course.title}</Txt>
                </View>
                <View style={{ alignSelf: 'stretch', gap: 8, marginTop: 6 }}>
                  <InfoRow label={t('verify.course')} value={found.course.title} icon="book" />
                  <InfoRow label={t('common.branch')} value={db.branches.find((b) => b.id === found.batch.branchId)?.name ?? ''} icon="business" />
                  <InfoRow label={t('verify.issuedAt')} value={formatDate(found.cert.issuedAt, lang)} icon="calendar" />
                  <InfoRow label={t('certs.serial')} value={found.cert.serial} icon="barcode" />
                </View>
              </View>
            </Card>
          </FadeIn>
        ) : null}
      </ScrollView>
    </View>
  );
}

function InfoRow({ label, value, icon }: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap }) {
  const { theme } = useTheme();
  return (
    <Row center gap={10} style={{ backgroundColor: theme.bg, borderRadius: 12, padding: 12 }}>
      <Ionicons name={icon} size={16} color={theme.textMuted} />
      <Txt variant="caption" color={theme.textMuted} style={{ width: 90 }}>{label}</Txt>
      <Txt variant="bodyMed" style={{ flex: 1 }}>{value}</Txt>
    </Row>
  );
}
