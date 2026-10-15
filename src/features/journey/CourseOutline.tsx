/**
 * features/journey/CourseOutline.tsx — مسار الكورس بنمط دوولينجو/كورسيرا (UX-C1)
 *
 * الفكرة: بدل قائمة محاضرات مسطّحة طويلة، المستخدم يرى **وحدات** قابلة للفتح،
 * كل وحدة فيها تقدّمها الخاص، وتُفتح الوحدة النشطة تلقائيًا. هذا هو ما يجعل
 * «أين أنا؟ وما التالي؟» واضحًا في نصف ثانية، وهو جوهر تنظيم الكورسات.
 *
 * ضمنا في كل محاضرة:
 *   • عقدة دائرية بحالة واضحة (مُنجز/متأخر/جارٍ/مقفول/بعذر/غائب) بأيقونة **ولون
 *     ونص** (لا لون فقط — WCAG 1.4.1).
 *   • خط ربط يتلوّن مع التقدّم (إحساس التقدّم الملموس).
 *   • محتوى المحاضرة (أهداف/محاور/ملخص/موارد) قابل للفتح بعد إتمامها.
 *   • مؤشرات صغيرة: محتوى منشور؟ تغذية راجعة؟ تقرير جاهز؟
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useApp } from '../../data/store';
import { attendanceOf, courseOutline, lectureReportFor } from '../../data/engine';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import { Btn, Card, ProgressBar, Row, Spacer, Tag, Txt } from '../../design/components';
import { MasarMascot, FatenBehaviorState } from '../../design/mascot';
import { Icon } from '../../design/icons';
import { radii, spacing } from '../../design/tokens';
import { formatDate, formatTime } from '../../shared/format';
import type { Lang } from '../../i18n';
import type { OutlineSession, OutlineSessionStatus, OutlineUnit } from '../../data/engine';

const NODE_ICON: Record<OutlineSessionStatus, 'checkmark' | 'time' | 'radio-button-on' | 'lock-closed' | 'shield-checkmark' | 'close' | 'remove'> = {
  done: 'checkmark',
  late: 'time',
  current: 'radio-button-on',
  locked: 'lock-closed',
  excused: 'shield-checkmark',
  absent: 'close',
  cancelled: 'remove',
};

function nodeColors(status: OutlineSessionStatus, theme: ReturnType<typeof useTheme>['theme']) {
  switch (status) {
    case 'done': return { fg: theme.success, bg: theme.successSoft };
    case 'late': return { fg: theme.warn, bg: theme.warnSoft };
    case 'current': return { fg: theme.brand, bg: theme.brandSoft };
    case 'excused': return { fg: theme.info, bg: theme.infoSoft };
    case 'absent': return { fg: theme.danger, bg: theme.dangerSoft };
    case 'cancelled': return { fg: theme.textMuted, bg: theme.fill };
    default: return { fg: theme.textMuted, bg: theme.fill };
  }
}

function UnitHeader({
  unit,
  index,
  open,
  onToggle,
  lang,
}: {
  unit: OutlineUnit;
  index: number;
  open: boolean;
  onToggle: () => void;
  lang: Lang;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const complete = unit.total > 0 && unit.completed === unit.total;
  const hasCurrent = unit.sessions.some((s) => s.status === 'current');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${t('outline.unit', { n: index + 1 })}: ${unit.title}. ${t('outline.unitProgress', { done: unit.completed, total: unit.total })}`}
      onPress={onToggle}
      style={({ pressed }) => [styles.unitHeader, { opacity: pressed ? 0.85 : 1 }]}
    >
      <Card style={{ gap: spacing.s2 }}>
        <Row between center gap={spacing.s3}>
          <Row center gap={spacing.s3} style={{ flex: 1, minWidth: 0 }}>
            <View style={[styles.unitBadge, { backgroundColor: complete ? theme.successSoft : hasCurrent ? theme.brandSoft : theme.fill, borderColor: complete ? theme.success : hasCurrent ? theme.brand : theme.line }]}>
              {complete ? (
                <Icon name="checkmark-done" size={18} color={theme.success} />
              ) : (
                <Txt variant="caption" bold color={hasCurrent ? theme.brand : theme.textSecondary}>{index + 1}</Txt>
              )}
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Txt variant="bodyMed" bold numberOfLines={2}>{unit.title}</Txt>
              <Row center gap={spacing.s2} wrap>
                <Txt variant="micro" color={theme.textMuted}>
                  {t('outline.unitProgress', { done: unit.completed, total: unit.total })}
                </Txt>
                {complete ? <Tag label={t('outline.completedUnit')} color={theme.success} bg={theme.successSoft} /> : null}
                {hasCurrent ? <Tag label={t('outline.currentUnit')} color={theme.brand} bg={theme.brandSoft} /> : null}
              </Row>
            </View>
          </Row>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={theme.textMuted} />
        </Row>
        <ProgressBar progress={unit.progress} height={6} color={complete ? theme.success : theme.brand} />
      </Card>
    </Pressable>
  );
}

function SessionContent({ sessionId }: { sessionId: string }) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const { db } = useApp();
  const content = db.sessionContent.find((c) => c.sessionId === sessionId);

  if (!content) {
    return (
      <Txt variant="micro" color={theme.textMuted} style={{ marginTop: 6 }}>
        {t('outline.noContent')}
      </Txt>
    );
  }

  const section = (title: string, items: string[], icon: 'flag' | 'layers' | 'document-text') => (
    items.length === 0 ? null : (
      <View style={{ gap: 4, marginTop: 8 }}>
        <Row center gap={spacing.s2}>
          <Icon name={icon} size={14} color={theme.brand} />
          <Txt variant="micro" bold color={theme.textSecondary}>{title}</Txt>
        </Row>
        {items.map((item, i) => (
          <Row key={i} gap={spacing.s2} style={{ alignItems: 'flex-start' }}>
            <View style={[styles.bullet, { backgroundColor: theme.brand }]} />
            <Txt variant="micro" color={theme.text} style={{ flex: 1 }}>{item}</Txt>
          </Row>
        ))}
      </View>
    )
  );

  return (
    <View style={{ marginTop: 8, gap: 2 }}>
      {section(t('outline.objectives'), content.objectives ?? [], 'flag')}
      {section(t('outline.topics'), content.topics ?? [], 'layers')}
      {content.summary ? (
        <View style={{ marginTop: 8, gap: 4 }}>
          <Row center gap={spacing.s2}>
            <Icon name="document-text" size={14} color={theme.brand} />
            <Txt variant="micro" bold color={theme.textSecondary}>{t('outline.summary')}</Txt>
          </Row>
          <Txt variant="micro" color={theme.text}>{content.summary}</Txt>
        </View>
      ) : null}
      {(content.resources ?? []).length > 0 ? (
        <View style={{ marginTop: 8, gap: 4 }}>
          <Row center gap={spacing.s2}>
            <Icon name="link" size={14} color={theme.brand} />
            <Txt variant="micro" bold color={theme.textSecondary}>{t('outline.resources')}</Txt>
          </Row>
          {content.resources.map((r, i) => (
            <Txt key={i} variant="micro" color={theme.brand}>{`• ${r.title}`}</Txt>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export interface CourseOutlineProps {
  batchId: string;
  onOpenSession?: (session: OutlineSession) => void;
  onScan?: () => void;
  onExcuse?: (sessionId: string) => void;
}

export function CourseOutline({ batchId, onOpenSession, onScan, onExcuse }: CourseOutlineProps) {
  const { theme } = useTheme();
  const { t, lang } = useI18n();
  const { db, user } = useApp();
  const [closedUnits, setClosedUnits] = useState<Record<string, boolean>>({});

  const outline = useMemo(
    () => (user ? courseOutline(db, batchId, user.id) : null),
    [db, batchId, user],
  );

  if (!user || !outline) return null;

  const isOpen = (unit: OutlineUnit) => {
    if (unit.id in closedUnits) return !closedUnits[unit.id];
    // افتراضيًا: الوحدة النشطة مفتوحة، والباقي مقفول
    return unit.id === outline.activeUnitId;
  };

  const toggle = (unit: OutlineUnit) => {
    setClosedUnits((prev) => ({ ...prev, [unit.id]: isOpen(unit) }));
  };

  return (
    <View style={{ gap: spacing.s3, width: '100%' }}>
      {outline.units.map((unit, unitIndex) => {
        const open = isOpen(unit);
        return (
          <View key={unit.id} style={{ gap: spacing.s2 }}>
            <UnitHeader unit={unit} index={unitIndex} open={open} onToggle={() => toggle(unit)} lang={lang as Lang} />
            {open ? (
              <View style={{ paddingStart: spacing.s3, gap: spacing.s2 }}>
                {unit.sessions.map((sess, i) => {
                  const colors = nodeColors(sess.status, theme);
                  const att = attendanceOf(db, sess.id, user.id);
                  const locked = sess.status === 'locked';
                  const report = sess.reportReady ? lectureReportFor(db, sess.id, user.id) : null;
                  return (
                    <View key={sess.id} style={styles.sessionRow}>
                      {/* خط الربط العمودي */}
                      {i < unit.sessions.length - 1 ? (
                        <View
                          pointerEvents="none"
                          style={[styles.connector, { backgroundColor: sess.status === 'done' || sess.status === 'late' || sess.status === 'excused' ? theme.success : theme.line }]}
                        />
                      ) : null}
                      <View style={[styles.node, { backgroundColor: colors.bg, borderColor: colors.fg }]}>
                        <Icon name={NODE_ICON[sess.status]} size={19} color={colors.fg} />
                      </View>

                      <Card
                        glass={false}
                        style={{
                          flex: 1,
                          borderColor: sess.status === 'current' ? theme.brand : colors.fg + '33',
                          borderWidth: sess.status === 'current' ? 2 : 1,
                          backgroundColor: sess.status === 'current' ? theme.brandSoft + '33' : theme.card,
                        }}
                      >
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${sess.seq}. ${sess.title} — ${t(`map.node${sess.status === 'done' ? 'Done' : sess.status === 'late' ? 'Late' : sess.status === 'current' ? 'Current' : sess.status === 'locked' ? 'Locked' : sess.status === 'excused' ? 'Excused' : 'Absent'}` as any)}`}
                          accessibilityState={{ disabled: locked }}
                          disabled={locked && !sess.hasContent}
                          onPress={() => onOpenSession?.(sess)}
                        >
                          <Row between center gap={spacing.s2}>
                            <Txt variant="bodyMed" style={{ flex: 1 }} numberOfLines={2}>
                              {sess.title}
                            </Txt>
                            <Row center gap={spacing.s1}>
                              <View style={[styles.miniDot, { backgroundColor: colors.fg }]} />
                              <Txt variant="micro" color={colors.fg}>{t(`map.node${sess.status === 'done' ? 'Done' : sess.status === 'late' ? 'Late' : sess.status === 'current' ? 'Current' : sess.status === 'locked' ? 'Locked' : sess.status === 'excused' ? 'Excused' : 'Absent'}` as any)}</Txt>
                            </Row>
                          </Row>
                          <Txt variant="micro" color={theme.textMuted} style={{ marginTop: 3 }}>
                            {`${formatDate(sess.startsAt, lang as Lang)} · ${formatTime(sess.startsAt, lang as Lang)}`}
                          </Txt>

                          {/* شرائح المؤشرات: محتوى / تغذية راجعة / تقرير / نقاط */}
                          <Row center gap={spacing.s2} wrap style={{ marginTop: 6 }}>
                            {sess.hasContent ? <Tag label={t('outline.content')} color={theme.brand} bg={theme.brandSoft} icon="document-text" /> : null}
                            {sess.hasFeedback ? <Tag label={t('feedback.title')} color={theme.success} bg={theme.successSoft} icon="chatbubble-ellipses" /> : null}
                            {sess.points > 0 ? <Tag label={t('outline.sessionPoints', { points: sess.points })} color={theme.warn} bg={theme.warnSoft} icon="star" /> : null}
                          </Row>
                        </Pressable>

                        {sess.status === 'current' && onScan ? (
                          <View style={{ marginTop: 10 }}>
                            <Btn title={t('journey.scanNow')} size="sm" variant="gold" icon="qr-code" full onPress={onScan} />
                          </View>
                        ) : null}

                        {sess.status === 'absent' && onExcuse ? (
                          <Row center gap={spacing.s2} style={{ marginTop: 8 }}>
                            <Txt variant="micro" color={theme.danger} style={{ flex: 1 }}>{t('history.absent')}</Txt>
                            <Btn title={t('excuses.title')} size="sm" variant="ghost" icon="shield" onPress={() => onExcuse(sess.id)} />
                          </Row>
                        ) : null}

                        {locked ? (
                          <Row center gap={spacing.s2} style={{ marginTop: 6 }}>
                            <Icon name="lock-closed" size={12} color={theme.textMuted} />
                            <Txt variant="micro" color={theme.textMuted} style={{ flex: 1 }}>{t('outline.lockedHint')}</Txt>
                          </Row>
                        ) : null}

                        {/* محتوى المحاضرة يظهر للمحاضرات المنجزة أو الجارية فقط */}
                        {(sess.status === 'done' || sess.status === 'late'
                          || sess.status === 'current' || sess.status === 'excused') && sess.hasContent
                          ? <SessionContent sessionId={sess.id} />
                          : null}

                        {report ? (
                          <Row center gap={spacing.s2} style={{ marginTop: 8 }}>
                            <Icon name="bar-chart" size={14} color={theme.brand} />
                            <Txt variant="micro" color={theme.brand}>{t('report.lectureTitle')}</Txt>
                          </Row>
                        ) : null}

                        {att?.note ? (
                          <Txt variant="micro" color={theme.textMuted} style={{ marginTop: 6 }}>{att.note}</Txt>
                        ) : null}
                      </Card>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </View>
        );
      })}

      <Row center gap={spacing.s3} style={[styles.footer, { backgroundColor: theme.brandSoft, borderColor: theme.brand + '33' }]}>
        <MasarMascot
          size={56}
          behavior={(outline.progress >= 1 ? 'achievement' : outline.progress >= 0.5 ? 'streak_fire' : 'ready') as FatenBehaviorState}
          hideFloatingBubble
          liveliness="calm"
        />
        <View style={{ flex: 1, gap: 4 }}>
          <Txt variant="caption" bold>{t('outline.progressTitle')}</Txt>
          <Txt variant="micro" color={theme.textSecondary}>
            {t('outline.unitProgress', { done: outline.completedSessions, total: outline.totalSessions })}
          </Txt>
          <ProgressBar progress={outline.progress} height={6} color={theme.brand} />
        </View>
      </Row>
      <Spacer size={spacing.s2} />
    </View>
  );
}

const styles = StyleSheet.create({
  unitHeader: {
    width: '100%',
  },
  unitBadge: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.s3,
    width: '100%',
  },
  connector: {
    position: 'absolute',
    top: 44,
    bottom: -12,
    start: 20,
    width: 3,
    borderRadius: 2,
  },
  node: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  bullet: {
    width: 5,
    height: 5,
    borderRadius: 3,
    marginTop: 6,
  },
  footer: {
    borderRadius: radii.xl,
    borderWidth: 1,
    padding: spacing.s3,
  },
});
