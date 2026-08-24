import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, Platform, StatusBar as RNStatusBar, View } from 'react-native';
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
import { RootNavigator } from './RootNavigator';
import { Txt } from '../design/components';
import { AppBackground, GlassSurface } from '../design/glass';
import { observeReducedMotion, isReducedMotion } from '../design/motion';
import { SUPABASE_ENABLED, exchangeUrlForSession } from '../data/supabase';
import { useI18n } from '../i18n';
import { useHaptics } from '../shared/hooks';

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

function ToastItem({ message, kind }: { message: string; kind: 'info' | 'success' | 'error' | 'warn' }) {
  const { theme, isDark } = useTheme();
  const { notificationError, notificationSuccess } = useHaptics();
  const entrance = useRef(new Animated.Value(isReducedMotion() ? 1 : 0)).current;
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
    <Animated.View style={{
      opacity: entrance,
      transform: [
        { translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) },
        { scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
      ],
      width: '100%', maxWidth: 520,
    }}>
      <GlassSurface
        intensity={isDark ? 55 : 75}
        radius={18}
        tintColor={isDark ? 'rgba(24,24,28,0.92)' : 'rgba(255,255,255,0.94)'}
        style={{
          shadowColor: '#000', shadowOpacity: isDark ? 0.32 : 0.14,
          shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 14,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 13 }}>
          <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: `${color}1F`, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={icon} size={18} color={color} />
          </View>
          <Txt variant="caption" color={theme.text} style={{ flex: 1 }}>{message}</Txt>
        </View>
      </GlassSurface>
    </Animated.View>
  );
}

function ToastHost() {
  const { toasts } = useApp();
  if (toasts.length === 0) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={{ position: 'absolute', top: Platform.OS === 'web' ? 18 : 54, left: 16, right: 16, alignItems: 'center', gap: 8, zIndex: 999 }}
    >
      {toasts.slice(-3).map((toast) => <ToastItem key={toast.id} message={toast.message} kind={toast.kind} />)}
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
    </Animated.View>
  );
}

export default function App() {
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
