import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, PanResponder, Platform, Pressable, StatusBar as RNStatusBar, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  useFonts,
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { ThemeProvider, useTheme } from '../design/theme';
import { I18nProvider } from '../i18n';
import { AppProvider, useApp } from '../data/store';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { installGlobalHandlers, setTelemetrySink } from '../shared/telemetry';
import { logClientError } from '../data/actions';
import { RootNavigator } from './RootNavigator';
import { Txt } from '../design/components';
import { AppBackground, GlassSurface } from '../design/glass';
import { observeReducedMotion, isReducedMotion } from '../design/motion';
import { SUPABASE_ENABLED, exchangeUrlForSession } from '../data/supabase';
import { useI18n } from '../i18n';
import { useHaptics } from '../shared/hooks';
import { BadgeModal } from '../design/celebrations';
import type { Badge } from '../data/types';

/** S01 — Apple-style Splash: اللوجو يتجمع مع توهج ثم fade */
function BootSplash() {
  const { theme, isDark } = useTheme();
  const logoScale = useRef(new Animated.Value(0.3)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const glowScale = useRef(new Animated.Value(0.5)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const textTranslate = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    if (isReducedMotion()) {
      logoScale.setValue(1);
      logoOpacity.setValue(1);
      textOpacity.setValue(1);
      textTranslate.setValue(0);
      return;
    }
    // Phase 0: Logo appears with spring
    Animated.parallel([
      Animated.spring(logoScale, { toValue: 1, damping: 12, stiffness: 100, useNativeDriver: true, delay: 100 }),
      Animated.timing(logoOpacity, { toValue: 1, duration: 400, easing: Easing.out(Easing.ease), useNativeDriver: true, delay: 100 }),
    ]).start(() => {
      // Phase 1: Glow expands
      Animated.parallel([
        Animated.timing(glowScale, { toValue: 2.5, duration: 800, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(glowOpacity, { toValue: 0.4, duration: 400, useNativeDriver: true }),
        Animated.timing(glowOpacity, { toValue: 0, duration: 400, delay: 500, useNativeDriver: true }),
      ]).start();
      // Phase 1.5: Text appears
      Animated.parallel([
        Animated.timing(textOpacity, { toValue: 1, duration: 400, useNativeDriver: true, delay: 300 }),
        Animated.spring(textTranslate, { toValue: 0, damping: 20, stiffness: 100, useNativeDriver: true, delay: 300 }),
      ]).start();
    });
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <LinearGradient
        colors={isDark ? ['#1C1C1E', '#000000'] : ['#FFFFFF', '#F2F2F7']}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
      >
        {/* Glow orb behind logo */}
        <Animated.View style={{
          position: 'absolute',
          width: 200, height: 200, borderRadius: 100,
          backgroundColor: theme.brand,
          opacity: glowOpacity,
          transform: [{ scale: glowScale }],
        }} />

        {/* Main logo */}
        <Animated.View style={{
          width: 120, height: 120, borderRadius: 34,
          alignItems: 'center', justifyContent: 'center',
          opacity: logoOpacity,
          transform: [{ scale: logoScale }],
        }}>
          <LinearGradient
            colors={[theme.brandGradientFrom, theme.brandGradientTo]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              width: 120, height: 120, borderRadius: 34,
              alignItems: 'center', justifyContent: 'center',
              shadowColor: theme.brand,
              shadowOpacity: 0.4,
              shadowRadius: 30,
              shadowOffset: { width: 0, height: 12 },
              elevation: 16,
            }}
          >
            <Image source={require('../../assets/adaptive-icon.png')} style={{ width: 82, height: 82 }} resizeMode="contain" />
          </LinearGradient>
        </Animated.View>

        {/* Text */}
        <Animated.View style={{
          marginTop: 20,
          opacity: textOpacity,
          transform: [{ translateY: textTranslate }],
          alignItems: 'center',
          gap: 6,
        }}>
          <Txt variant="h1" color={theme.text}>مسار</Txt>
          <Txt variant="caption" color={theme.textMuted}>منظومة تنظيم مراكز التدريب</Txt>
        </Animated.View>
      </LinearGradient>
    </View>
  );
}

function ToastItem({
  id,
  message,
  kind,
  onDismiss,
}: {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error' | 'warn';
  onDismiss: (id: number) => void;
}) {
  const { theme, isDark } = useTheme();
  const { notificationError, notificationSuccess, impactLight } = useHaptics();
  const entrance = useRef(new Animated.Value(isReducedMotion() ? 1 : 0)).current;
  const panX = useRef(new Animated.Value(0)).current;
  const panY = useRef(new Animated.Value(0)).current;
  const isDismissing = useRef(false);

  const dismiss = () => {
    if (isDismissing.current) return;
    isDismissing.current = true;
    try {
      impactLight();
    } catch {}
    Animated.timing(entrance, {
      toValue: 0,
      duration: 160,
      useNativeDriver: true,
    }).start(() => {
      onDismiss(id);
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) > 10 || gesture.dy < -10,
      onPanResponderMove: (_, gesture) => {
        panX.setValue(gesture.dx);
        if (gesture.dy < 0) {
          panY.setValue(gesture.dy);
        }
      },
      onPanResponderRelease: (_, gesture) => {
        if (Math.abs(gesture.dx) > 80 || gesture.dy < -40 || gesture.vx > 0.8 || gesture.vy < -0.8) {
          dismiss();
        } else {
          Animated.parallel([
            Animated.spring(panX, { toValue: 0, damping: 15, stiffness: 200, useNativeDriver: true }),
            Animated.spring(panY, { toValue: 0, damping: 15, stiffness: 200, useNativeDriver: true }),
          ]).start();
        }
      },
    })
  ).current;

  useEffect(() => {
    if (kind === 'success') notificationSuccess();
    if (kind === 'error') notificationError();
    Animated.spring(entrance, {
      toValue: 1,
      damping: 20,
      stiffness: 220,
      useNativeDriver: true,
    }).start();
  }, [entrance, kind, notificationError, notificationSuccess]);

  const color = kind === 'success' ? theme.success
    : kind === 'error' ? theme.danger
    : kind === 'warn' ? theme.warn
    : theme.brand;
  const icon = kind === 'success' ? 'checkmark-circle'
    : kind === 'error' ? 'alert-circle'
    : kind === 'warn' ? 'warning'
    : 'information-circle';

  return (
    <Animated.View
      {...panResponder.panHandlers}
      style={{
        opacity: entrance,
        transform: [
          { translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) },
          { translateY: panY },
          { translateX: panX },
          { scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
        ],
        width: '100%',
        maxWidth: 520,
      }}
    >
      <GlassSurface
        intensity={isDark ? 65 : 85}
        radius={18}
        tintColor={isDark ? 'rgba(24,24,28,0.94)' : 'rgba(255,255,255,0.96)'}
        style={{
          shadowColor: '#000',
          shadowOpacity: isDark ? 0.35 : 0.16,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 10 },
          elevation: 14,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12 }}>
          <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: `${color}1F`, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={icon} size={18} color={color} />
          </View>
          <Txt variant="caption" color={theme.text} style={{ flex: 1, fontWeight: '500' }}>
            {message}
          </Txt>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إغلاق الإشعار"
            hitSlop={8}
            onPress={dismiss}
            style={({ pressed }) => ({
              padding: 4,
              borderRadius: 12,
              backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons name="close" size={16} color={theme.textSecondary} />
          </Pressable>
        </View>
      </GlassSurface>
    </Animated.View>
  );
}

function ToastHost() {
  const { toasts, dismissToast } = useApp();
  if (toasts.length === 0) return null;
  return (
    <View
      pointerEvents="box-none"
      accessibilityLiveRegion="polite"
      style={{ position: 'absolute', top: Platform.OS === 'web' ? 18 : 54, left: 16, right: 16, alignItems: 'center', gap: 8, zIndex: 999 }}
    >
      {toasts.slice(-3).map((toast) => (
        <ToastItem
          key={toast.id}
          id={toast.id}
          message={toast.message}
          kind={toast.kind}
          onDismiss={dismissToast}
        />
      ))}
    </View>
  );
}

/** شاشة تظهر فقط لو مفاتيح Supabase ناقصة — بدل تشغيل بيانات وهمية */
function SetupRequired() {
  const { theme } = useTheme();
  const { t } = useI18n();
  return (
    <AppBackground>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <GlassSurface intensity={70} radius={32} style={{ width: '100%', maxWidth: 520 }}>
          <View style={{ alignItems: 'center', padding: 30, gap: 14 }}>
            <LinearGradient
              colors={[theme.warn, theme.danger]}
              style={{ width: 82, height: 82, borderRadius: 26, alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name="construct" size={38} color="#fff" />
            </LinearGradient>
            <Txt variant="h2" align="center">{t('common.setupRequired')}</Txt>
            <Txt variant="body" color={theme.textSecondary} align="center">{t('auth.notConfigured')}</Txt>
            <View style={{ width: 46, height: 4, borderRadius: 2, backgroundColor: theme.warn, marginTop: 4 }} />
          </View>
        </GlassSurface>
      </View>
    </AppBackground>
  );
}

function GlobalBadgeCelebrationHost() {
  const { db, user } = useApp();
  const { lang, t } = useI18n();
  const { theme } = useTheme();
  const [activeBadge, setActiveBadge] = useState<Badge | null>(null);
  const knownBadgesRef = useRef<Set<string>>(new Set());
  const isFirstLoadRef = useRef(true);

  const rarityColor = (r: string) =>
    r === 'legendary' ? theme.rarityLegendary : r === 'epic' ? theme.rarityEpic : r === 'rare' ? theme.rarityRare : theme.rarityCommon;

  useEffect(() => {
    if (!user) return;
    const myBadges = db.userBadges.filter((b) => b.userId === user.id);
    if (isFirstLoadRef.current) {
      myBadges.forEach((b) => knownBadgesRef.current.add(b.badgeCode));
      isFirstLoadRef.current = false;
      return;
    }
    const newlyAdded = myBadges.find((b) => !knownBadgesRef.current.has(b.badgeCode));
    if (newlyAdded) {
      knownBadgesRef.current.add(newlyAdded.badgeCode);
      const badgeInfo = db.badges.find((b) => b.code === newlyAdded.badgeCode);
      if (badgeInfo) {
        setActiveBadge(badgeInfo);
      }
    }
  }, [db.userBadges, db.badges, user]);

  if (!activeBadge) return null;

  return (
    <BadgeModal
      visible={Boolean(activeBadge)}
      onClose={() => setActiveBadge(null)}
      badgeName={lang === 'ar' ? activeBadge.nameAr : activeBadge.nameEn}
      badgeDesc={lang === 'ar' ? activeBadge.descAr : activeBadge.descEn}
      rarityLabel={t(`achievements.rarity.${activeBadge.rarity}` as any)}
      rarityColor={rarityColor(activeBadge.rarity)}
      icon={activeBadge.icon as any}
    />
  );
}

function Shell() {
  const { ready } = useApp();
  const { theme, isDark } = useTheme();
  const reveal = useRef(new Animated.Value(0)).current;
  const [fontsLoaded] = useFonts({
    IBMPlexSansArabic_400Regular,
    IBMPlexSansArabic_500Medium,
    IBMPlexSansArabic_600SemiBold,
    IBMPlexSansArabic_700Bold,
  });

  useEffect(() => observeReducedMotion(), []);

  useEffect(() => {
    if (!fontsLoaded || !ready) return;
    Animated.timing(reveal, {
      toValue: 1,
      duration: isReducedMotion() ? 100 : 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [fontsLoaded, ready, reveal]);

  // التقاط رابط رجوع Google على الموبايل (deep link)
  useEffect(() => {
    if (Platform.OS === 'web' || !SUPABASE_ENABLED) return;
    const handle = (url: string | null) => {
      if (url && (url.includes('code=') || url.includes('access_token='))) void exchangeUrlForSession(url);
    };
    void Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, []);

  if (!fontsLoaded || !ready) return <BootSplash />;

  return (
    <Animated.View style={{
      flex: 1,
      backgroundColor: theme.bg,
      opacity: reveal,
      transform: [{ scale: reveal.interpolate({ inputRange: [0, 1], outputRange: [0.992, 1] }) }],
    }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {SUPABASE_ENABLED ? <RootNavigator /> : <SetupRequired />}
      <ToastHost />
      <GlobalBadgeCelebrationHost />
    </Animated.View>
  );
}

/**
 * يوصّل الرصد بالخادم مرة واحدة قبل تركيب الشجرة (OPS-01).
 * خارج المكوّن عمدًا: يجب أن يلتقط حتى الأعطال أثناء أول رندر.
 */
setTelemetrySink((event) => {
  if (!SUPABASE_ENABLED) return;
  void logClientError({
    message: event.message,
    stack: event.stack,
    componentStack: event.componentStack,
    fatal: event.fatal,
    platform: event.platform,
    appVersion: event.appVersion,
    breadcrumbs: event.breadcrumbs,
  });
});

export default function App() {
  // مستمعو الأخطاء غير الملتقطة (rejection/ErrorUtils) — يُزالون عند التفكيك.
  useEffect(() => installGlobalHandlers(), []);

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <ThemeProvider>
          <I18nProvider>
            <AppProvider>
              <RNStatusBar barStyle="default" />
              <Shell />
            </AppProvider>
          </I18nProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
