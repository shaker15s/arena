/**
 * design/components/LiquidGlassCard.tsx — بطاقة Liquid Glass مستوحاة من Gluestack v5
 * تجمع بين Blur الحقيقي، والحواف العاكسة للضوء (Specular Border)، والتدرج اللطيف (Gradient Fallback)
 * المنصوص عليها في MASAR_ASSETS_RESEARCH.md
 */
import React from 'react';
import {
  Platform,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme';
import { radii, spacing } from '../tokens';

export interface LiquidGlassCardProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
  glowColor?: string;
  borderColor?: string;
  hasShimmerBorder?: boolean;
}

export function LiquidGlassCard({
  children,
  style,
  intensity = 38,
  glowColor,
  borderColor,
  hasShimmerBorder = true,
}: LiquidGlassCardProps) {
  const { isDark, themeName } = useTheme();
  const oled = themeName === 'oled';

  const isAndroid = Platform.OS === 'android';
  const defaultBorder = borderColor ?? (isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(255, 255, 255, 0.65)');
  const defaultGlow = glowColor ?? (isDark ? 'rgba(0, 122, 255, 0.12)' : 'rgba(0, 122, 255, 0.06)');

  const containerStyle: ViewStyle = {
    borderRadius: radii.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: defaultBorder,
    backgroundColor: isDark
      ? oled
        ? 'rgba(0, 0, 0, 0.85)'
        : 'rgba(15, 23, 42, 0.72)'
      : 'rgba(255, 255, 255, 0.78)',
    shadowColor: isDark ? '#000' : '#007AFF',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: isDark ? 0.45 : 0.08,
    shadowRadius: 20,
    elevation: 4,
  };

  return (
    <View style={[containerStyle, style]}>
      {!isAndroid && (
        <BlurView
          intensity={intensity}
          tint={isDark ? (oled ? 'dark' : 'systemMaterialDark') : 'systemMaterialLight'}
          style={StyleSheet.absoluteFill}
        />
      )}

      {/* تدرج هالة الضوء المحيطي (Ambient Glow) */}
      <LinearGradient
        colors={[defaultGlow, 'transparent', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* الحافة العاكسة العلوية للزجاج (Specular Highlight) */}
      {hasShimmerBorder && (
        <LinearGradient
          colors={[
            'rgba(255, 255, 255, 0.45)',
            'rgba(255, 255, 255, 0.05)',
            'transparent',
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.specularEdge}
          pointerEvents="none"
        />
      )}

      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.md,
  },
  specularEdge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1.5,
  },
});
