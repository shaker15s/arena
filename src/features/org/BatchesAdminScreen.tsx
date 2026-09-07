import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../../data/store';
import {
  courseOf, isBatchComplete, profileOf, seatCounts,
} from '../../data/engine';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import {
  Btn, Card, FadeIn, Header, ProgressBar, Row, Spacer, Tag, Txt,
} from '../../design/components';
import { MasarMascot } from '../../design/mascot';
import { spacing } from '../../design/tokens';
import { BatchFormSheet } from './BatchFormSheet';

export function BatchesAdminScreen({ navigation }: any) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const { db } = useApp();
  const [creating, setCreating] = useState(false);

  return (
    <View style={{ flex: 1 }}>
      <Header title={t('batchAdm.title')} back={() => navigation.goBack()} right={<Btn title={t('batchAdm.new')} size="sm" icon="add" onPress={() => setCreating(true)} />} />
      <ScrollView contentContainerStyle={{ padding: spacing.s5, gap: 12, paddingBottom: spacing.s8 }}>
        {db.batches.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 30 }}>
            <MasarMascot size={90} mode="greeting" interactive hideFloatingBubble />
            <View style={{ height: 12 }} />
            <Txt variant="body" color={theme.textSecondary} align="center">
              {t('batchAdm.title')}
            </Txt>
            <Spacer size={16} />
            <Btn title={t('batchAdm.new')} onPress={() => setCreating(true)} />
          </View>
        ) : null}
        {db.batches.map((b, i) => {
          const course = courseOf(db, b.courseId)!;
          const instructor = profileOf(db, b.instructorId);
          const seats = seatCounts(db, b.id);
          const statusMeta = b.status === 'active' ? { label: t('common.active'), color: theme.success, bg: theme.successSoft }
            : b.status === 'completed' && isBatchComplete(db, b.id) ? { label: t('common.closedStatus'), color: theme.brand, bg: theme.brandSoft }
            : b.status === 'completed' ? { label: t('common.errorTitle'), color: theme.danger, bg: theme.dangerSoft }
            : b.status === 'scheduled' ? { label: t('common.scheduledStatus'), color: theme.warn, bg: theme.warnSoft }
            : { label: t('common.archived'), color: theme.textMuted, bg: theme.bg };
          return (
            <FadeIn key={b.id} index={i}>
              <Card onPress={() => navigation.navigate('CourseManagement', { batchId: b.id })}>
                <Row center gap={12}>
                  <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: course.color + '22', alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="people" size={22} color={course.color} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt variant="bodyMed">{course.title}</Txt>
                    <Txt variant="micro" color={theme.textMuted}>{instructor?.fullName} · {b.room}</Txt>
                    <Txt variant="micro" color={theme.textMuted}>{b.schedule.days.map((d) => t(`dayShort.${d}` as any)).join(' + ')} {b.schedule.time}</Txt>
                  </View>
                  <Tag label={statusMeta.label} color={statusMeta.color} bg={statusMeta.bg} />
                </Row>
                <Spacer size={10} />
                <Row between>
                  <Txt variant="micro" color={theme.textMuted}>{t('batchAdm.occupancy')}</Txt>
                  <Txt variant="micro" color={theme.textMuted}>{seats.taken}/{b.capacity}{seats.waitlist > 0 ? ` · ⏳${seats.waitlist}` : ''}</Txt>
                </Row>
                <Spacer size={5} />
                <ProgressBar progress={seats.taken / b.capacity} height={6} color={course.color} />
                <Spacer size={8} />
                <Row center gap={6}>
                  <Ionicons name="link" size={12} color={theme.teal} />
                  <Txt variant="micro" color={theme.teal}>{t('batchAdm.joinCode')}: {b.joinCode}</Txt>
                </Row>
              </Card>
            </FadeIn>
          );
        })}
      </ScrollView>
      <BatchFormSheet visible={creating} onClose={() => setCreating(false)} />
    </View>
  );
}
