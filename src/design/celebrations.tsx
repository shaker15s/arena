/**
 * design/celebrations.tsx — لحظات الاحتفال المدروسة نفسيًا (وثيقة 03 S18 / 05 §5.3):
 * كونفيتي جسيمات + رسم ✓ بالأنيميشن + طيران النقاط + انبثاق الشارات.
 * تصميم Apple Liquid Glass.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from './theme';
import { Btn, Txt } from './components';
import { duration, isReducedMotion } from './motion';
import { radii, spacing } from './tokens';
import { useI18n } from '../i18n';

// ── جسيمات الكونفيتي ──
const CONFETTI_COLORS = ['#007AFF', '#5856D6', '#30D158', '#FF9F0A', '#FF3B30', '#FFB800', '#34C759'];

export function ConfettiBurst({ count = 70 }: { count?: number }) {
  const particles = useMemo(() => {
    return Array.from({ length: count }).map((_, i) => ({
      key: i,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      x: new Animated.Value(0),
      y: new Animated.Value(0),
      opacity: new Animated.Value(1),
      dx: (Math.random() - 0.5) * 320,
      dy: -(80 + Math.random() * 300),
      size: 5 + Math.random() * 7,
      round: Math.random() > 0.5,
    }));
  }, [count]);

  useEffect(() => {
    if (isReducedMotion()) return;
    particles.forEach((p) => {
      const delay = Math.random() * 160;
      Animated.parallel([
        Animated.timing(p.x, { toValue: p.dx, duration: duration.celebration + Math.random() * 500, delay, useNativeDriver: true }),
        Animated.timing(p.y, { toValue: 340 + Math.random() * 140, duration: duration.celebration + Math.random() * 500, delay, useNativeDriver: true }),
        Animated.timing(p.opacity, { toValue: 0, duration: duration.celebration + Math.random() * 400, delay: delay + 240, useNativeDriver: true }),
      ]).start();
    });
  }, [particles]);

  if (isReducedMotion()) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 160, alignSelf: 'center', zIndex: 5 }}>
      {particles.map((p) => (
        <Animated.View
          key={p.key}
          style={{
            position: 'absolute',
            width: p.size,
            height: p.round ? p.size : p.size * 1.6,
            borderRadius: p.round ? p.size / 2 : 2,
            backgroundColor: p.color,
            opacity: p.opacity,
            transform: [{ translateX: p.x }, { translateY: p.y }, { rotate: `${(p.key * 47) % 180}deg` }],
          }}
        />
      ))}
    </View>
  );
}

// ── علامة ✓ ترسم نفسها (stroke) ──
export function DrawnCheck({ size = 120, color, onDone }: { size?: number; color: string; onDone?: () => void }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: isReducedMotion() ? 200 : 480,
      useNativeDriver: false,
    }).start(() => onDone?.());
  }, [progress, onDone]);
  const AnimatedPath = Animated.createAnimatedComponent(Path);
  const checkLen = 80;
  const dash = progress.interpolate({ inputRange: [0, 1], outputRange: [checkLen, 0] });
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Circle cx={50} cy={50} r={46} stroke={color} strokeWidth={2.5} fill="none" opacity={0.2} />
      <AnimatedPath
        d="M30 52 L45 66 L72 36"
        stroke={color}
        strokeWidth={7}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        strokeDasharray={`${checkLen}`}
        strokeDashoffset={dash}
      />
    </Svg>
  );
}

// ── نافذة نجاح موحدة (Apple Glass) ──
export function CelebrationModal({
  visible, onClose, title, subtitle, points, streakSafe, emoji = '🎉',
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  points?: number;
  streakSafe?: boolean;
  emoji?: string;
}) {
  const { theme, isDark } = useTheme();
  const { t } = useI18n();
  const [fly, setFly] = useState(false);
  const flyAnim = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0.85)).current;

  useEffect(() => {
    if (visible) {
      cardScale.setValue(isReducedMotion() ? 1 : 0.85);
      if (!isReducedMotion()) Animated.spring(cardScale, { toValue: 1, damping: 15, stiffness: 120, useNativeDriver: true }).start();
      setFly(false);
      flyAnim.setValue(0);
      const t = setTimeout(() => {
        setFly(true);
        Animated.timing(flyAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();
      }, isReducedMotion() ? 100 : 420);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [visible, flyAnim, cardScale]);

  if (!visible) return null;
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.s6 }}>
        <ConfettiBurst />
        <Animated.View style={{
          transform: [{ scale: cardScale }],
          backgroundColor: isDark ? theme.card : theme.card,
          borderRadius: radii.xl,
          padding: spacing.s6,
          alignItems: 'center',
          width: '100%',
          maxWidth: 420,
          borderWidth: 1,
          borderColor: isDark ? 'rgba(84,84,88,0.35)' : 'rgba(255,255,255,0.5)',
          shadowColor: '#000',
          shadowOpacity: 0.15,
          shadowRadius: 30,
          shadowOffset: { width: 0, height: 12 },
          gap: 14,
        }}>
          <DrawnCheck color={theme.success} />
          <Txt variant="h2" align="center">{title}</Txt>
          {subtitle ? <Txt variant="body" color={theme.textSecondary} align="center">{subtitle}</Txt> : null}
          {points != null && fly ? (
            <Animated.View style={{
              backgroundColor: theme.brandSoft,
              borderRadius: radii.pill,
              paddingHorizontal: 20, paddingVertical: 10,
              opacity: flyAnim,
              transform: [{ translateY: flyAnim.interpolate({ inputRange: [0, 1], outputRange: [-30, 0] }) }, { scale: flyAnim.interpolate({ inputRange: [0, 1], outputRange: [1.4, 1] }) }],
            }}>
              <Txt variant="h3" color={theme.brand}>+{points}</Txt>
            </Animated.View>
          ) : null}
          {streakSafe ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="flame" size={18} color={theme.flameFrom} />
              <Text style={{ fontSize: 24 }}>{emoji}</Text>
            </View>
          ) : null}
          <View style={{ alignSelf: 'stretch', marginTop: 10 }}>
            <Btn title={t('common.continue')} onPress={onClose} size="lg" full />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ── انبثاق شارة مكتسبة (Apple Glass) ──
export function BadgeModal({ visible, onClose, badgeName, badgeDesc, rarityLabel, rarityColor, icon }: {
  visible: boolean; onClose: () => void; badgeName: string; badgeDesc: string;
  rarityLabel: string; rarityColor: string; icon: keyof typeof Ionicons.glyphMap;
}) {
  const { theme, isDark } = useTheme();
  const { t } = useI18n();
  const scale = useRef(new Animated.Value(0.3)).current;
  const rotate = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (visible) {
      scale.setValue(isReducedMotion() ? 1 : 0.3);
      rotate.setValue(isReducedMotion() ? 1 : 0);
      if (!isReducedMotion()) {
        Animated.parallel([
          Animated.spring(scale, { toValue: 1, useNativeDriver: true, damping: 9, stiffness: 180 }),
          Animated.spring(rotate, { toValue: 1, useNativeDriver: true, damping: 15, stiffness: 80 }),
        ]).start();
      }
    }
  }, [visible, scale, rotate]);
  if (!visible) return null;

  const rotateDeg = rotate.interpolate({ inputRange: [0, 1], outputRange: ['-15deg', '0deg'] });

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.s6 }}>
        <ConfettiBurst count={50} />
        <Animated.View style={{
          transform: [{ scale }, { rotateY: rotateDeg }],
          backgroundColor: isDark ? theme.card : theme.card,
          borderRadius: radii.xl,
          padding: spacing.s6,
          alignItems: 'center',
          width: '100%',
          maxWidth: 420,
          gap: 14,
          borderWidth: 1,
          borderColor: isDark ? 'rgba(84,84,88,0.35)' : 'rgba(255,255,255,0.5)',
          shadowColor: '#000',
          shadowOpacity: 0.15,
          shadowRadius: 30,
          shadowOffset: { width: 0, height: 12 },
        }}>
          {/* Badge icon with rarity glow */}
          <View style={{ position: 'relative' }}>
            <View style={{
              position: 'absolute', width: 140, height: 140, borderRadius: 70,
              backgroundColor: rarityColor + '15',
              top: -15, left: -15,
            }} />
            <Animated.View style={{
              width: 110, height: 110, borderRadius: 55,
              backgroundColor: rarityColor + '1A',
              borderWidth: 3, borderColor: rarityColor,
              alignItems: 'center', justifyContent: 'center',
              shadowColor: rarityColor,
              shadowOpacity: 0.3,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 6 },
            }}>
              <Ionicons name={icon} size={52} color={rarityColor} />
            </Animated.View>
          </View>
          <Txt variant="caption" color={rarityColor}>{rarityLabel}</Txt>
          <Txt variant="h1" align="center">{badgeName}</Txt>
          <Txt variant="body" color={theme.textSecondary} align="center">{badgeDesc}</Txt>
          <View style={{ alignSelf: 'stretch', marginTop: 10 }}>
            <Btn title={t('common.awesome')} onPress={onClose} size="lg" full />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
