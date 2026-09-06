/**
 * design/components/StreakCalendarGrid.tsx — شبكة أيام الستريك بنمط GitHub Heatmap
 * تعرض أسابيع وأيام التدريب (حضور، غياب، بونص، مستقبل) في شكل مربعات زجاجية ملونة.
 */
import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { Txt } from '../components';
import { radii, spacing } from '../tokens';

export type DayStatus = 'attended' | 'bonus' | 'absent' | 'excused' | 'empty';

export interface StreakDayItem {
  dateKey: string;
  dayName?: string;
  status: DayStatus;
}

export interface StreakCalendarGridProps {
  days?: StreakDayItem[];
  weeksCount?: number;
  style?: StyleProp<ViewStyle>;
}

const DEFAULT_DAYS: StreakDayItem[] = [
  { dateKey: '1', status: 'attended' },
  { dateKey: '2', status: 'attended' },
  { dateKey: '3', status: 'bonus' },
  { dateKey: '4', status: 'attended' },
  { dateKey: '5', status: 'attended' },
  { dateKey: '6', status: 'attended' },
  { dateKey: '7', status: 'empty' },
  { dateKey: '8', status: 'attended' },
  { dateKey: '9', status: 'attended' },
  { dateKey: '10', status: 'attended' },
  { dateKey: '11', status: 'excused' },
  { dateKey: '12', status: 'attended' },
  { dateKey: '13', status: 'attended' },
  { dateKey: '14', status: 'empty' },
];

export function StreakCalendarGrid({
  days = DEFAULT_DAYS,
  style,
}: StreakCalendarGridProps) {
  const { theme, isDark } = useTheme();

  const getStatusColor = (status: DayStatus) => {
    switch (status) {
      case 'attended':
        return theme.success;
      case 'bonus':
        return '#F59E0B'; // لون الستريك الناري المعتمد
      case 'absent':
        return theme.danger;
      case 'excused':
        return theme.info;
      default:
        return isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';
    }
  };

  return (
    <View style={[styles.container, style]}>
      <View style={styles.gridRow}>
        {days.map((item, i) => (
          <View
            key={i}
            style={[
              styles.dayBox,
              {
                backgroundColor: getStatusColor(item.status),
                borderColor:
                  item.status !== 'empty'
                    ? 'rgba(255, 255, 255, 0.25)'
                    : 'transparent',
              },
            ]}
          />
        ))}
      </View>

      {/* دليل الحالات السفلي */}
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: theme.success }]} />
          <Txt variant="micro" color={theme.textMuted}>
            حضور
          </Txt>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#F59E0B' }]} />
          <Txt variant="micro" color={theme.textMuted}>
            ستريك نار
          </Txt>
        </View>
        <View style={styles.legendItem}>
          <View
            style={[
              styles.legendDot,
              {
                backgroundColor: isDark
                  ? 'rgba(255, 255, 255, 0.1)'
                  : 'rgba(0, 0, 0, 0.08)',
              },
            ]}
          />
          <Txt variant="micro" color={theme.textMuted}>
            قادم
          </Txt>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  gridRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  dayBox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 1,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: spacing.sm,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
