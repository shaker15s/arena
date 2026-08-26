/**
 * features/certificates — S22 محفظة الشهادات + S23 العارض الرسمي (ختم/سيريال/QR).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { toDataURL as qrToDataUrl } from 'qrcode';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { useApp } from '../../data/store';
import { revokeCertificate, reissueCertificate } from '../../data/actions';
import { batchOf, courseOf, profileOf } from '../../data/engine';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import { Btn, Card, DisclosureIcon, Empty, FadeIn, Header, Input, Row, Spacer, Tag, Txt } from '../../design/components';
import { spacing, radii } from '../../design/tokens';
import { formatDate } from '../../shared/format';
import { duration, easing, isReducedMotion } from '../../design/motion';
import { publicVerifyUrl } from '../../shared/links';

export function CertificatesScreen({ navigation }: any) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const { db, user } = useApp();
  if (!user) return null;
  const mine = db.certificates.filter((c) => c.userId === user.id).sort((a, b) => b.issuedAt - a.issuedAt);

  return (
    <View style={{ flex: 1 }}>
      <Header title={t('certs.title')} back={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: spacing.s5, gap: 14 }}>
        {mine.length === 0 ? (
          <Empty emoji="🎓" title={t('certs.emptyTitle')} />
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
                      <DisclosureIcon color={theme.textMuted} />
                    </Row>
                    <Row between center>
                      <Row center gap={5}>
                        <Ionicons name="barcode" size={13} color={theme.textMuted} />
                        <Txt variant="micro" color={theme.textMuted}>{cert.serial}</Txt>
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
  const { db, user, toast, refresh } = useApp();
  const cert = db.certificates.find((c) => c.id === route.params.certId);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [reason, setReason] = useState('');
  const [acting, setActing] = useState(false);
  const stamp = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(stamp, { toValue: 1, useNativeDriver: true, damping: isReducedMotion() ? 30 : 10, stiffness: 120 }).start();
  }, [stamp]);

  if (!cert) return null;
  const batch = batchOf(db, cert.batchId)!;
  const course = courseOf(db, batch.courseId)!;
  const student = profileOf(db, cert.userId)!;
  const branch = db.branches.find((b) => b.id === batch.branchId);
  const verifyUrl = publicVerifyUrl(cert.serial);

  const copyLink = async () => {
    try {
      const value = `${t('verify.title')}: ${cert.serial} — ${verifyUrl}`;
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
      const qr = await qrToDataUrl(verifyUrl, { margin: 1, width: 180 });
      const esc = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char] ?? char));
      const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>
        @page{size:A4 landscape;margin:18mm} body{font-family:Arial,sans-serif;color:#3D2B00;background:#fff;margin:0}
        .cert{height:155mm;border:6px double #C99B22;padding:18mm;box-sizing:border-box;text-align:center;position:relative;background:#FFFDF5}
        h1{font-size:34px;color:#7A5C00;margin:6px} h2{font-size:28px;margin:10px} p{font-size:17px;color:#7D6A35;margin:8px}
        .course{font-size:25px;font-weight:bold;color:#7A5C00}.footer{display:flex;align-items:center;justify-content:center;gap:30px;margin-top:18px}
        .serial{font-family:monospace;letter-spacing:2px;color:#3D2B00}.seal{border:4px solid #C99B22;border-radius:12px;padding:10px;color:#A67B11;font-weight:bold}
      </style></head><body><div class="cert"><h1>${esc(t('certs.of'))}</h1><p>${esc(t('certs.awardedTo'))}</p>
      <h2>${esc(student.fullName)}</h2><p>${esc(t('certs.forCompleting'))}</p><div class="course">${esc(course.title)}</div>
      <p>${esc(branch?.name ?? t('certs.issuedBy'))} · ${esc(formatDate(cert.issuedAt, lang))}</p>
      <div class="footer"><img src="${qr}" width="120" height="120"/><div><div class="seal">${esc(t('verify.verified'))}</div><p class="serial">${esc(cert.serial)}</p></div></div>
      </div></body></html>`;

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
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setExporting(false);
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
    <View style={{ flex: 1 }}>
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
                {/* QR يوجّه فعليًا لصفحة التحقق العام — وليس توكنًا ميتًا غير موصول */}
                <QRCode value={verifyUrl} size={88} color="#3D2B00" backgroundColor="#fff" />
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
                <Txt variant="micro" color="#95804A" align="center">{t('certs.serial')}</Txt>
                <Txt variant="caption" color="#3D2B00" style={{ letterSpacing: 1 }}>{cert.serial}</Txt>
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
    </View>
  );
}
