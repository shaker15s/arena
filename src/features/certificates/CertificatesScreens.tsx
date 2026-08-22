/**
 * features/certificates — S22 محفظة الشهادات + S23 العارض الرسمي (ختم/سيريال/QR).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { useApp } from '../../data/store';
import { batchOf, courseOf, profileOf } from '../../data/engine';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import { Btn, Card, Empty, FadeIn, Header, Row, Spacer, Tag, Txt } from '../../design/components';
import { spacing, radii } from '../../design/tokens';
import { formatDate } from '../../shared/format';
import { duration, easing, isReducedMotion } from '../../design/motion';

export function CertificatesScreen({ navigation }: any) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const { db, user } = useApp();
  if (!user) return null;
  const mine = db.certificates.filter((c) => c.userId === user.id).sort((a, b) => b.issuedAt - a.issuedAt);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title={t('certs.title')} back={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: spacing.s5, gap: 14 }}>
        {mine.length === 0 ? (
          <Empty emoji="🎓" title={t('certs.emptyTitle')} body={t('certs.emptyBody')} />
        ) : (
          mine.map((cert, i) => {
            const batch = batchOf(db, cert.batchId);
            const course = batch ? courseOf(db, batch.courseId) : undefined;
            const branch = batch ? db.branches.find((b) => b.id === batch.branchId) : undefined;
            return (
              <FadeIn key={cert.id} index={i}>
                <Card onPress={() => navigation.navigate('CertificateViewer', { certId: cert.id })} noPad style={{ overflow: 'hidden' }}>
                  <View style={{ height: 8, backgroundColor: theme.certGold }} />
                  <View style={{ padding: 16, gap: 8 }}>
                    <Row center gap={12}>
                      <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: theme.warnSoft, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="ribbon" size={26} color={theme.certGold} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Txt variant="h3">{course?.title ?? ''}</Txt>
                        <Txt variant="caption" color={theme.textSecondary}>{branch?.name ?? ''}</Txt>
                      </View>
                      <Ionicons name="chevron-back" size={18} color={theme.textMuted} />
                    </Row>
                    <Row between center>
                      <Row center gap={5}>
                        <Ionicons name="barcode" size={13} color={theme.textMuted} />
                        <Txt variant="micro" color={theme.textMuted}>{cert.serial}</Txt>
                      </Row>
                      <Tag label={t('verify.verified')} color={theme.success} bg={theme.successSoft} icon="shield-checkmark" />
                    </Row>
                  </View>
                </Card>
              </FadeIn>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

// ───────────────────────────── S23 العارض ─────────────────────────────

export function CertificateViewerScreen({ route, navigation }: any) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { db, toast } = useApp();
  const cert = db.certificates.find((c) => c.id === route.params.certId);
  const [copied, setCopied] = useState(false);
  const stamp = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(stamp, { toValue: 1, useNativeDriver: true, damping: isReducedMotion() ? 30 : 10, stiffness: 120 }).start();
  }, [stamp]);

  if (!cert) return null;
  const batch = batchOf(db, cert.batchId)!;
  const course = courseOf(db, batch.courseId)!;
  const student = profileOf(db, cert.userId)!;
  const branch = db.branches.find((b) => b.id === batch.branchId);
  const verifyUrl = `https://masar.app/verify?serial=${cert.serial}`;

  const copyLink = async () => {
    try {
      if (Platform.OS === 'web' && navigator.clipboard) {
        await navigator.clipboard.writeText(`${t('verify.title')}: ${cert.serial} — ${verifyUrl}`);
      }
      setCopied(true);
      toast(t('common.copied'), 'success');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast(t('common.copied'), 'success');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title={t('certs.viewer')} back={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: spacing.s5, gap: 14, paddingBottom: 40 }}>
        <FadeIn index={0}>
          {/* تصميم الشهادة الرسمي */}
          <View style={{
            backgroundColor: '#FFFDF5',
            borderRadius: radii.xl,
            borderWidth: 3, borderColor: theme.certGold,
            padding: 24, alignItems: 'center', gap: 10,
            shadowColor: theme.certGold, shadowOpacity: 0.25, shadowRadius: 24, shadowOffset: { width: 0, height: 8 },
          }}>
            <View style={{ position: 'absolute', top: 12, start: 12, opacity: 0.12 }}>
              <Ionicons name="map" size={44} color={theme.certGold} />
            </View>
            <View style={{ position: 'absolute', bottom: 12, end: 12, opacity: 0.12 }}>
              <Ionicons name="map" size={44} color={theme.certGold} />
            </View>

            <Ionicons name="ribbon" size={40} color={theme.certGold} />
            <Txt variant="h2" color="#7A5C00" align="center">{t('certs.of')}</Txt>

            <Txt variant="caption" color="#95804A">{t('certs.awardedTo')}</Txt>
            <Txt variant="display" color="#3D2B00" align="center">{student.fullName}</Txt>

            <Txt variant="caption" color="#95804A">{t('certs.forCompleting')}</Txt>
            <Txt variant="h3" color="#7A5C00" align="center">{course.title}</Txt>

            <Row center gap={6}>
              <Ionicons name="business" size={13} color="#95804A" />
              <Txt variant="caption" color="#95804A">{branch?.name ?? t('certs.issuedBy')}</Txt>
            </Row>
            <Txt variant="micro" color="#95804A">{formatDate(cert.issuedAt, lang)}</Txt>

            <View style={{ height: 1, alignSelf: 'stretch', backgroundColor: '#E8D9A8', marginVertical: 4 }} />

            <Row center gap={14}>
              <View style={{ backgroundColor: '#fff', padding: 8, borderRadius: 12, borderWidth: 1, borderColor: '#E8D9A8' }}>
                <QRCode value={`MSRVERIFY:${cert.serial}`} size={88} color="#3D2B00" backgroundColor="#fff" />
              </View>
              <View style={{ flex: 1, gap: 4, alignItems: 'center' }}>
                {/* الختم ينطبع بأنيميشن */}
                <Animated.View style={{
                  transform: [{ scale: stamp.interpolate({ inputRange: [0, 1], outputRange: [1.8, 1] }) }, { rotate: '-12deg' }],
                  opacity: stamp,
                  borderWidth: 3, borderColor: theme.certGold, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6,
                }}>
                  <Txt variant="h3" color={theme.certGold} align="center">{t('verify.verified')}</Txt>
                </Animated.View>
                <Txt variant="micro" color="#95804A" align="center">{t('certs.serial')}</Txt>
                <Txt variant="caption" color="#3D2B00" style={{ letterSpacing: 1 }}>{cert.serial}</Txt>
              </View>
            </Row>
          </View>
        </FadeIn>

        <FadeIn index={1}>
          <Card glass>
            <Row center gap={8}>
              <Ionicons name="information-circle" size={16} color={theme.brand} />
              <Txt variant="caption" color={theme.textSecondary} style={{ flex: 1 }}>{t('certs.verifyHint')}</Txt>
            </Row>
          </Card>
        </FadeIn>

        <FadeIn index={2}>
          <Row gap={10}>
            <Btn title={copied ? t('common.copied') : t('certs.copyLink')} icon={copied ? 'checkmark' : 'link'} variant="secondary" onPress={copyLink} full />
            <Btn title={t('certs.downloadPdf')} icon="download" variant="ghost" onPress={() => toast(t('common.comingInV2'), 'info')} full />
          </Row>
          <Spacer size={8} />
          <Btn title={t('certs.sharePng')} icon="share-social" variant="ghost" full onPress={() => toast(t('common.comingInV2'), 'info')} />
        </FadeIn>
      </ScrollView>
    </View>
  );
}
