/**
 * features/certificates — S22 محفظة الشهادات + S23 العارض الرسمي (ختم/سيريال/QR).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, FlatList, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import QRCode from 'react-native-qrcode-svg';
import { toDataURL as qrToDataUrl } from 'qrcode';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { useApp } from '../../data/store';
import { revokeCertificate, reissueCertificate, publicBadgeAssertion } from '../../data/actions';
import { batchOf, courseOf, profileOf } from '../../data/engine';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import { Btn, Card, DisclosureIcon, Empty, FadeIn, Header, Input, Row, Screen, Spacer, Tag, Txt } from '../../design/components';
import { spacing, radii, certPaper } from '../../design/tokens';
import { bidiIsolate, formatDate } from '../../shared/format';
import { duration, isReducedMotion } from '../../design/motion';
import { publicVerifyUrl } from '../../shared/links';
import { CelebrationModal } from '../../design/celebrations';
import { Icon } from '../../design/icons';

export function CertificatesScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { theme } = useTheme();
  const { db, user } = useApp();
  if (!user) return null;
  const mine = db.certificates.filter((c) => c.userId === user.id).sort((a, b) => b.issuedAt - a.issuedAt);

  return (
    <Screen label={t('certs.title')}>
      <Header title={t('certs.title')} back={() => navigation.goBack()} />
      <FlatList
        data={mine}
        keyExtractor={(cert) => cert.id}
        initialNumToRender={10}
        windowSize={5}
        contentContainerStyle={{ padding: spacing.s5, gap: 14, paddingBottom: insets.bottom + spacing.s6 }}
        ListEmptyComponent={<Empty emoji="🎓" title={t('certs.emptyTitle')} />}
        renderItem={({ item: cert, index: i }) => {
          const batch = batchOf(db, cert.batchId);
          const course = batch ? courseOf(db, batch.courseId) : undefined;
          const branch = batch ? db.branches.find((b) => b.id === batch.branchId) : undefined;
          return (
            <FadeIn index={i}>
              <Card onPress={() => navigation.navigate('CertificateViewer', { certId: cert.id })} noPad style={{ overflow: 'hidden' }}>
                <View style={{ height: 8, backgroundColor: theme.certGold }} />
                <View style={{ padding: 16, gap: 8 }}>
                  <Row center gap={12}>
                    <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: theme.warnSoft, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="ribbon" size={26} color={theme.certGold} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Txt variant="h3">{course?.title ?? ''}</Txt>
                      <Txt variant="caption" color={theme.textSecondary}>{branch?.name ?? ''}</Txt>
                    </View>
                    <DisclosureIcon color={theme.textMuted} />
                  </Row>
                  <Row between center>
                    <Row center gap={5}>
                      <Icon name="barcode" size={13} color={theme.textMuted} />
                      <Txt variant="micro" color={theme.textMuted} {...(Platform.OS === 'web' ? ({ lang: 'en', dir: 'ltr' } as any) : {})}>{bidiIsolate(cert.serial)}</Txt>
                    </Row>
                    {cert.status === 'revoked' ? (
                      <Tag label={t('certs.statusRevoked')} color={theme.danger} bg={theme.dangerSoft} icon="ban" />
                    ) : (
                      <Tag label={t('verify.verified')} color={theme.success} bg={theme.successSoft} icon="shield-checkmark" />
                    )}
                  </Row>
                </View>
              </Card>
            </FadeIn>
          );
        }}
      />
    </Screen>
  );
}

// ───────────────────────────── S23 العارض ─────────────────────────────

export function CertificateViewerScreen({ route, navigation }: any) {
  const insets = useSafeAreaInsets();
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const { db, user, toast, refresh } = useApp();
  const certIdParam = route?.params?.certId ?? '';
  const cert = db.certificates.find((c) => c.id === certIdParam || c.serial === certIdParam);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingPng, setExportingPng] = useState(false);
  const [exportingBadge, setExportingBadge] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [reason, setReason] = useState('');
  const [acting, setActing] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const stamp = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(stamp, { toValue: 1, useNativeDriver: true, damping: isReducedMotion() ? 30 : 10, stiffness: 120 }).start();
  }, [stamp]);

  const batch = cert ? batchOf(db, cert.batchId) : undefined;
  const course = batch ? courseOf(db, batch.courseId) : undefined;
  const student = cert ? profileOf(db, cert.userId) : undefined;
  if (!cert || !batch || !course || !student) {
    return (
      <Screen label={t('certs.viewer')}>
        <Header title={t('certs.viewer')} back={() => navigation.goBack()} />
        <Empty emoji="🎓" title={t('common.notFoundTitle')} body={t('common.notFoundBody')} />
      </Screen>
    );
  }
  const branch = db.branches.find((b) => b.id === batch.branchId);
  const verifyUrl = publicVerifyUrl(cert.serial);

  const copyLink = async () => {
    try {
      const value = t('verify.title') + ': ' + cert.serial + ' — ' + verifyUrl;
      if (Platform.OS === 'web' && navigator.clipboard) await navigator.clipboard.writeText(value);
      else await Clipboard.setStringAsync(value);
      setCopied(true);
      toast(t('common.copied'), 'success');
      setTimeout(() => setCopied(false), 1800);
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const exportCertificate = async (share: boolean) => {
    setExporting(true);
    try {
      const qr = await qrToDataUrl(verifyUrl, { margin: 1, width: 240 });
      const esc = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char] ?? char));
      const html = '<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>' +
        '@page{size:A4 landscape;margin:18mm} body{font-family:"IBM Plex Sans Arabic","Cairo",Arial,sans-serif;color:#3D2B00;background:#fff;margin:0}' +
        '.cert{height:155mm;border:6px double #C99B22;padding:18mm;box-sizing:border-box;text-align:center;position:relative;background:#FFFDF5}' +
        'h1{font-size:34px;color:#7A5C00;margin:6px} h2{font-size:28px;margin:10px} p{font-size:17px;color:#7D6A35;margin:8px}' +
        '.course{font-size:25px;font-weight:bold;color:#7A5C00}.footer{display:flex;align-items:center;justify-content:center;gap:30px;margin-top:18px}' +
        '.qr-fixed{position:absolute;bottom:16mm;left:18mm;width:32mm;height:32mm;border:1px solid #E8D59E;padding:2mm;background:#fff;border-radius:4mm}' +
        '.serial{font-family:"JetBrains Mono",monospace;letter-spacing:2px;color:#3D2B00;direction:ltr;unicode-bidi:isolate}' +
        '.seal{border:4px solid #C99B22;border-radius:12px;padding:10px 18px;color:#A67B11;font-weight:bold}' +
        '</style></head><body><div class="cert"><h1>' + esc(t('certs.of')) + '</h1><p>' + esc(t('certs.awardedTo')) + '</p>' +
        '<h2>' + esc(student.fullName) + '</h2><p>' + esc(t('certs.forCompleting')) + '</p><div class="course">' + esc(course.title) + '</div>' +
        '<p>' + esc(branch?.name ?? t('certs.issuedBy')) + ' · ' + esc(formatDate(cert.issuedAt, lang)) + '</p>' +
        '<img class="qr-fixed" src="' + qr + '" alt="QR"/>' +
        '<div class="footer"><div><div class="seal">' + esc(t('verify.verified')) + '</div><p class="serial">' + esc(cert.serial) + '</p></div></div>' +
        '</div></body></html>';

      if (Platform.OS === 'web') {
        await Print.printAsync({ html });
      } else {
        const file = await Print.printToFileAsync({ html, base64: false });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: share ? t('certs.sharePdf') : t('certs.downloadPdf') });
        } else {
          toast(file.uri, 'success');
        }
      }
      setShowCelebration(true);
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setExporting(false);
    }
  };

  const exportCertificatePng = async () => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      await exportCertificate(true);
      return;
    }
    setExportingPng(true);
    try {
      const qrDataUrl = await qrToDataUrl(verifyUrl, { margin: 1, width: 280 });
      const canvas = document.createElement('canvas');
      canvas.width = 1600;
      canvas.height = 1120;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D unsupported');

      // Background & double gold border (@2x resolution)
      ctx.fillStyle = '#FFFDF5';
      ctx.fillRect(0, 0, 1600, 1120);
      ctx.strokeStyle = '#C99B22';
      ctx.lineWidth = 10;
      ctx.strokeRect(44, 44, 1512, 1032);
      ctx.lineWidth = 3;
      ctx.strokeRect(62, 62, 1476, 996);

      ctx.textAlign = 'center';
      ctx.direction = 'rtl';
      ctx.fillStyle = '#7A5C00';
      ctx.font = '700 56px "IBM Plex Sans Arabic", "Cairo", Arial, sans-serif';
      ctx.fillText(t('certs.of'), 800, 210);

      ctx.fillStyle = '#7D6A35';
      ctx.font = '500 30px "IBM Plex Sans Arabic", "Cairo", Arial, sans-serif';
      ctx.fillText(t('certs.awardedTo'), 800, 290);

      ctx.fillStyle = '#3D2B00';
      ctx.font = '700 64px "IBM Plex Sans Arabic", "Cairo", Arial, sans-serif';
      ctx.fillText(student.fullName, 800, 395);

      ctx.fillStyle = '#7D6A35';
      ctx.font = '500 30px "IBM Plex Sans Arabic", "Cairo", Arial, sans-serif';
      ctx.fillText(t('certs.forCompleting'), 800, 485);

      ctx.fillStyle = '#7A5C00';
      ctx.font = '700 46px "IBM Plex Sans Arabic", "Cairo", Arial, sans-serif';
      ctx.fillText(course.title, 800, 565);

      ctx.fillStyle = '#7D6A35';
      ctx.font = '400 28px "IBM Plex Sans Arabic", "Cairo", Arial, sans-serif';
      ctx.fillText((branch?.name ?? t('certs.issuedBy')) + ' · ' + formatDate(cert.issuedAt, lang), 800, 645);

      // Seal & serial
      ctx.strokeStyle = '#C99B22';
      ctx.lineWidth = 5;
      ctx.strokeRect(630, 720, 340, 84);
      ctx.fillStyle = '#A67B11';
      ctx.font = '700 32px "IBM Plex Sans Arabic", "Cairo", Arial, sans-serif';
      ctx.fillText(t('verify.verified'), 800, 773);

      ctx.direction = 'ltr';
      ctx.fillStyle = '#3D2B00';
      ctx.font = '600 28px "JetBrains Mono", monospace';
      ctx.fillText(cert.serial, 800, 865);

      // Draw QR code at fixed bottom-left coordinates (x=110, y=760, 240x240)
      await new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(102, 752, 256, 256);
          ctx.strokeStyle = '#E8D59E';
          ctx.lineWidth = 2;
          ctx.strokeRect(102, 752, 256, 256);
          ctx.drawImage(img, 110, 760, 240, 240);
          resolve();
        };
        img.onerror = () => reject(new Error('QR image load failed'));
        img.src = qrDataUrl;
      });

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('PNG generation failed');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = cert.serial + '.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      setShowCelebration(true);
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setExportingPng(false);
    }
  };

  const exportOpenBadge = async () => {
    setExportingBadge(true);
    try {
      const remoteAssertion = await publicBadgeAssertion(cert.serial).catch(() => null);
      const assertion = remoteAssertion ?? {
        '@context': [
          'https://www.w3.org/ns/credentials/v2',
          'https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json',
        ],
        id: verifyUrl,
        type: ['VerifiableCredential', 'OpenBadgeCredential'],
        issuer: {
          id: 'https://masar.app',
          type: ['Profile'],
          name: branch?.name ?? t('certs.issuedBy'),
        },
        validFrom: new Date(cert.issuedAt).toISOString(),
        credentialSubject: {
          id: 'urn:uuid:' + cert.userId,
          type: ['AchievementSubject'],
          achievement: {
            id: 'https://masar.app/courses/' + course.id,
            type: ['Achievement'],
            name: course.title,
            description: course.description,
          },
        },
      };
      const jsonText = JSON.stringify(assertion, null, 2);
      if (Platform.OS === 'web' && navigator.clipboard) {
        await navigator.clipboard.writeText(jsonText);
      } else {
        await Clipboard.setStringAsync(jsonText);
      }
      toast(t('certs.openBadgeCopied'), 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setExportingBadge(false);
    }
  };

  const isManager = !!user && (user.role === 'admin' || user.role === 'supervisor');

  const doRevoke = async () => {
    if (!reason.trim()) return;
    setActing(true);
    try {
      await revokeCertificate(cert.id, reason.trim());
      await refresh();
      setRevoking(false);
      setReason('');
      toast(t('certs.rejected'), 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setActing(false);
    }
  };

  const doReissue = async () => {
    setActing(true);
    try {
      await reissueCertificate(cert.id);
      await refresh();
      toast(t('certs.reissued'), 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setActing(false);
    }
  };

  return (
    <Screen label={t('certs.viewer')}>
      <Header title={t('certs.viewer')} back={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: spacing.s5, gap: 14, paddingBottom: insets.bottom + spacing.s6 }}>
        <FadeIn index={0}>
          {/* تصميم الشهادة الرسمي */}
          <View style={{
            backgroundColor: certPaper.bg,
            borderRadius: radii.xxl,
            borderWidth: 3, borderColor: theme.certGold,
            padding: 24, alignItems: 'center', gap: 10,
            shadowColor: theme.certGold, shadowOpacity: 0.25, shadowRadius: 24, shadowOffset: { width: 0, height: 8 },
          }}>
            <View style={{ position: 'absolute', top: 12, start: 12, opacity: 0.12 }}>
              <Icon name="map" size={44} color={theme.certGold} />
            </View>
            <View style={{ position: 'absolute', bottom: 12, end: 12, opacity: 0.12 }}>
              <Icon name="map" size={44} color={theme.certGold} />
            </View>

            <Icon name="ribbon" size={40} color={theme.certGold} />
            <Txt variant="h2" color={certPaper.inkSoft} align="center">{t('certs.of')}</Txt>

            <Txt variant="caption" color={certPaper.inkMuted}>{t('certs.awardedTo')}</Txt>
            <Txt variant="display" color={certPaper.ink} align="center">{student.fullName}</Txt>

            <Txt variant="caption" color={certPaper.inkMuted}>{t('certs.forCompleting')}</Txt>
            <Txt variant="h3" color={certPaper.inkSoft} align="center">{course.title}</Txt>

            <Row center gap={6}>
              <Icon name="business" size={13} color={certPaper.inkMuted} />
              <Txt variant="caption" color={certPaper.inkMuted}>{branch?.name ?? t('certs.issuedBy')}</Txt>
            </Row>
            <Txt variant="micro" color={certPaper.inkMuted}>{formatDate(cert.issuedAt, lang)}</Txt>

            <View style={{ height: 1, alignSelf: 'stretch', backgroundColor: certPaper.line, marginVertical: 4 }} />

            <Row center gap={14}>
              <View style={{ backgroundColor: '#fff', padding: 8, borderRadius: 12, borderWidth: 1, borderColor: certPaper.line }}>
                {/* QR يوجّه فعليًا لصفحة التحقق العام — وليس توكنًا ميتًا غير موصول */}
                <QRCode value={verifyUrl} size={88} color={certPaper.ink} backgroundColor="#fff" />
              </View>
              <View style={{ flex: 1, gap: 4, alignItems: 'center' }}>
                {/* الختم ينطبع بأنيميشن */}
                <Animated.View style={{
                  transform: [{ scale: stamp.interpolate({ inputRange: [0, 1], outputRange: [1.8, 1] }) }, { rotate: '-12deg' }],
                  opacity: stamp,
                  borderWidth: 3, borderColor: cert.status === 'revoked' ? theme.danger : theme.certGold,
                  borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6,
                }}>
                  <Txt variant="h3" color={cert.status === 'revoked' ? theme.danger : theme.certGold} align="center">
                    {cert.status === 'revoked' ? t('certs.statusRevoked') : t('verify.verified')}
                  </Txt>
                </Animated.View>
                <Txt variant="micro" color={certPaper.inkMuted} align="center">{t('certs.serial')}</Txt>
                <Txt variant="caption" color={certPaper.ink} style={{ letterSpacing: 1 }} {...(Platform.OS === 'web' ? ({ lang: 'en', dir: 'ltr' } as any) : {})}>{bidiIsolate(cert.serial)}</Txt>
                {cert.status === 'revoked' ? (
                  <Txt variant="micro" color={theme.danger} align="center">{t('certs.revokeHint')}</Txt>
                ) : null}
              </View>
            </Row>
          </View>
        </FadeIn>

        <FadeIn index={2}>
          <Row gap={10}>
            <Btn title={copied ? t('common.copied') : t('certs.copyLink')} icon={copied ? 'checkmark' : 'link'} variant="secondary" onPress={copyLink} full />
            <Btn title={t('certs.downloadPdf')} icon="download" variant="ghost" loading={exporting} onPress={() => { void exportCertificate(false); }} full />
          </Row>
          <Spacer size={8} />
          <Row gap={10}>
            <Btn title={t('certs.downloadPng')} icon="image" variant="ghost" loading={exportingPng} onPress={() => { void exportCertificatePng(); }} full />
            <Btn title={t('certs.openBadge')} icon="shield-checkmark" variant="ghost" loading={exportingBadge} onPress={() => { void exportOpenBadge(); }} full />
          </Row>
          <Spacer size={8} />
          <Btn title={t('certs.sharePdf')} icon="share-social" variant="ghost" loading={exporting} full onPress={() => { void exportCertificate(true); }} />
        </FadeIn>

        {isManager ? (
          <FadeIn index={3}>
            <Card noPad style={{ overflow: 'hidden' }}>
              <View style={{ padding: 16, gap: 10 }}>
                <Txt variant="h3">{t('certs.manage')}</Txt>
                {cert.status === 'active' && !revoking ? (
                  <Btn title={t('certs.revoke')} icon="ban" variant="danger" full onPress={() => setRevoking(true)} />
                ) : null}
                {cert.status === 'revoked' ? (
                  <Btn title={t('certs.reissue')} icon="refresh" variant="success" full loading={acting} onPress={() => { void doReissue(); }} />
                ) : null}
                {revoking ? (
                  <>
                    <Input
                      label={t('certs.revokeReason')}
                      value={reason}
                      onChange={setReason}
                      multiline
                      maxLength={400}
                      placeholder={t('certs.revokeHint')}
                    />
                    <Row gap={10}>
                      <Btn title={t('common.cancel')} variant="ghost" full onPress={() => { setRevoking(false); setReason(''); }} />
                      <Btn title={t('certs.revokeConfirm')} icon="ban" variant="danger" full loading={acting} disabled={!reason.trim()} onPress={() => { void doRevoke(); }} />
                    </Row>
                  </>
                ) : null}
              </View>
            </Card>
          </FadeIn>
        ) : null}
      </ScrollView>

      <CelebrationModal
        visible={showCelebration}
        onClose={() => setShowCelebration(false)}
        title={t('certs.congrats')}
        subtitle={t('certs.of')}
        emoji="🎓"
        fly={false}
      />
    </Screen>
  );
}
