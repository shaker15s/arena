/**
 * design/components/BentoGrid.tsx — حاوية Bento Grid العصرية لتخطيط الشاشات
 * تتيح تقسيم الواجهة إلى خانات متجاوبة (كبيرة / متوسطة / صغيرة) بتصميم زجاجي أنيق.
 */
import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle, useWindowDimensions } from 'react-native';
import { spacing } from '../tokens';

export interface BentoGridProps {
  children: React.ReactNode;
  columns?: number;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}

export function BentoGrid({
  children,
  columns = 2,
  gap = spacing.md,
  style,
}: BentoGridProps) {
  const { width } = useWindowDimensions();
  const isMobile = width < 680;
  const activeCols = isMobile ? 1 : columns;

  return (
    <View
      style={[
        styles.gridContainer,
        {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export interface BentoItemProps {
  children: React.ReactNode;
  span?: 1 | 2 | 3 | 'full';
  style?: StyleProp<ViewStyle>;
}

export function BentoItem({
  children,
  span = 1,
  style,
}: BentoItemProps) {
  const { width } = useWindowDimensions();
  const isMobile = width < 680;

  let flexBasis: string = '48%';
  if (isMobile || span === 'full' || span === 2) {
    flexBasis = '100%';
  }

  return (
    <View
      style={[
        styles.itemBase,
        {
          flexBasis: flexBasis as any,
          flexGrow: 1,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  gridContainer: {
    width: '100%',
  },
  itemBase: {
    minWidth: 280,
  },
});
