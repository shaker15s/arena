/**
 * design/components/XPBar.tsx — شريط نقاط الخبرة المتدرج بشعار المستوى
 * يجمع التدرج اللوني (أزرق → بنفسجي) من التوكنز مع شارة المستوى المضيئة في الطرف
 */
import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme';
import { Txt } from '../components';
import { radii, spacing } from '../tokens';

export interface XPBarProps {
  currentXP: number;
  maxXP?: number;
  level?: number | string;
  levelTitle?: string;
  style?: StyleProp<ViewStyle>;
  height?: number;
}

export function XPBar({
  currentXP = 0,
  maxXP = 100,
  level = 1,
  levelTitle = 'المستوى الأول',
  style,
  height = 14,
}: XPBarProps) {
  const { theme } = useTheme();

  const progressPercent = Math.min(100, Math.max(0, (currentXP / maxXP) * 100));

  return (
    <View style={[styles.container, style]}>
      {/* سطر المعلومات العلوي */}
      <View style={styles.headerRow}>
        <View style={styles.levelBadge}>
          <LinearGradient
            colors={[theme.brandGradientFrom, theme.brandGradientTo]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.levelBadgeGrad}
          >
            <Txt variant="micro" bold color="#FFF">
              Lvl {level}
            </Txt>
          </LinearGradient>
          <Txt variant="caption" bold style={{ marginStart: 6 }}>
            {levelTitle}
          </Txt>
        </View>

        <Txt variant="caption" color={theme.textMuted} style={styles.xpText}>
          {currentXP} / {maxXP} XP
        </Txt>
      </View>

      {/* الشريط المتدرج */}
      <View style={[styles.track, { height, backgroundColor: theme.fillStrong }]}>
        <View style={[styles.fillWrapper, { width: `${progressPercent}%` }]}>
          <LinearGradient
            colors={[theme.brandGradientFrom, theme.brandGradientTo]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
          {/* نقطة وهج بيضاء في نهاية التقدم */}
          <View style={styles.endCapGlow} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs + 2,
  },
  levelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  levelBadgeGrad: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radii.sm,
  },
  xpText: {
    fontVariant: ['tabular-nums'],
  },
  track: {
    width: '100%',
    borderRadius: radii.full,
    overflow: 'hidden',
  },
  fillWrapper: {
    height: '100%',
    borderRadius: radii.full,
    overflow: 'hidden',
    position: 'relative',
  },
  endCapGlow: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: '#FFF',
    opacity: 0.6,
  },
});
