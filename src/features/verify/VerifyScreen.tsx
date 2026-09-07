/**
 * features/verify — S05: التحقق العام من الشهادة (جهات التوظيف — بلا تسجيل دخول).
 * متاحة كـ deep link عام: مسار يعمل من أي متصفح غريب.
 */
import React, { useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { verifyCertificate } from '../../data/actions';
import type { VerifiedCertificate } from '../../data/actions';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import { Avatar, Btn, Card, FadeIn, Header, Input, Row, Spacer, Txt } from '../../design/components';
import { spacing, radii } from '../../design/tokens';
import { formatDate } from '../../shared/format';

export function VerifyScreen({ navigation, route }: any) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const [serial, setSerial] = useState<string>(route?.params?.serial ?? '');
  const [result, setResult] = useState<VerifiedCertificate | 'not-found' | 'error' | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const check = async () => {
    const trimmed = serial.trim();
    if (!trimmed) {
      setValidationError(t('verify.emptyError'));
      setResult(null);
      return;
    }
    setValidationError(null);
    setLoading(true);
    try {
      const certificate = await verifyCertificate(trimmed);
      setResult(certificate ?? 'not-found');
    } catch {
      setResult('error');
    } finally {
      setLoading(false);
    }
  };

  const found = result && typeof result !== 'string' ? result : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title={t('verify.title')} back={navigation.canGoBack?.() ? () => navigation.goBack() : undefined} />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.s5,
          gap: 16,
          maxWidth: 680,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        <FadeIn index={0}>
          <View style={{ gap: 6, paddingVertical: 4 }}>
            <Txt variant="body" color={theme.textSecondary}>
              {t('verify.subtitle')}
            </Txt>
            <Txt variant="micro" color={theme.textMuted}>
              {t('verify.serialHint')}
            </Txt>
          </View>
        </FadeIn>

        <FadeIn index={1}>
          <Input
            label={t('certs.serial')}
            value={serial}
            onChange={(value) => {
              setSerial(value);
              if (validationError) setValidationError(null);
              if (result) setResult(null);
            }}
            placeholder={t('verify.serialPlaceholder')}
            icon="key"
            error={validationError ?? undefined}
            onSubmitEditing={check}
            returnKeyType="search"
            autoCapitalize="characters"
          />
        </FadeIn>

        <FadeIn index={2}>
          <Btn
            title={t('verify.checkNow')}
            onPress={check}
            loading={loading}
            full
            size="lg"
            icon="search"
          />
        </FadeIn>

        {result === 'not-found' ? (
          <FadeIn index={0}>
            <Card color={theme.dangerSoft} style={{ borderColor: theme.danger + '55', borderWidth: 1 }}>
              <Row center gap={12}>
                <Ionicons name="alert-circle" size={32} color={theme.danger} />
                <Txt variant="bodyMed" color={theme.danger} style={{ flex: 1, lineHeight: 22 }}>
                  {t('verify.notFound')}
                </Txt>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('common.close')}
                  hitSlop={10}
                  onPress={() => setResult(null)}
                  style={[
                    {
                      padding: 6,
                      borderRadius: radii.full,
                      backgroundColor: theme.danger + '20',
                    },
                    Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null,
                  ]}
                >
                  <Ionicons name="close" size={18} color={theme.danger} />
                </Pressable>
              </Row>
            </Card>
          </FadeIn>
        ) : null}

        {result === 'error' ? (
          <FadeIn index={0}>
            <Card color={theme.warnSoft} style={{ borderColor: theme.warn + '55', borderWidth: 1 }}>
              <Row center gap={12}>
                <Ionicons name="cloud-offline" size={32} color={theme.warn} />
                <Txt variant="bodyMed" color={theme.warn} style={{ flex: 1, lineHeight: 22 }}>
                  {t('common.errorTitle')}
                </Txt>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('common.close')}
                  hitSlop={10}
                  onPress={() => setResult(null)}
                  style={[
                    {
                      padding: 6,
                      borderRadius: radii.full,
                      backgroundColor: theme.warn + '20',
                    },
                    Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null,
                  ]}
                >
                  <Ionicons name="close" size={18} color={theme.warn} />
                </Pressable>
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
                <Avatar name={found.student_name} color={theme.brand} size={72} />
                <View style={{ alignItems: 'center', gap: 2 }}>
                  <Txt variant="h2" align="center">{found.student_name}</Txt>
                  <Txt variant="body" color={theme.textSecondary} align="center">{found.course_title}</Txt>
                </View>
                <View style={{ alignSelf: 'stretch', gap: 8, marginTop: 6 }}>
                  <InfoRow label={t('verify.course')} value={found.course_title} icon="book" />
                  <InfoRow label={t('common.branch')} value={found.branch_name} icon="business" />
                  <InfoRow label={t('verify.issuedAt')} value={formatDate(new Date(found.issued_at).getTime(), lang)} icon="calendar" />
                  <InfoRow label={t('certs.serial')} value={found.serial} icon="barcode" />
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
