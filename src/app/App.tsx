import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StatusBar as RNStatusBar, View } from 'react-native';
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
import { RootNavigator } from './RootNavigator';
import { Txt } from '../design/components';
import { AppBackground } from '../design/glass';
import { SUPABASE_ENABLED, exchangeUrlForSession } from '../data/supabase';
import { useI18n } from '../i18n';

/** S01 — Apple-style Splash: اللوجو يتجمع مع توهج ثم fade */
function BootSplash() {
  const { theme, isDark } = useTheme();
  const [phase, setPhase] = useState(0); // 0=appearing, 1=glow, 2=ready
  const logoScale = useRef(new Animated.Value(0.3)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const glowScale = useRef(new Animated.Value(0.5)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const textTranslate = useRef(new Animated.Value(20)).current;

  useEffect(() => {
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
            <Ionicons name="map" size={56} color="#fff" />
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

function ToastHost() {
  const { toasts } = useApp();
  const { theme, isDark } = useTheme();
  if (toasts.length === 0) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: Platform.OS === 'web' ? 16 : 54, left: 16, right: 16, alignItems: 'center', gap: 8, zIndex: 999 }}>
      {toasts.map((t) => (
        <View
          key={t.id}
          style={{
            backgroundColor: t.kind === 'success' ? theme.success : t.kind === 'error' ? theme.danger : t.kind === 'warn' ? theme.warn : isDark ? 'rgba(60,60,67,0.9)' : 'rgba(30,30,30,0.9)',
            paddingHorizontal: 20, paddingVertical: 12, borderRadius: 999,
            maxWidth: 560,
            shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20, shadowOffset: { width: 0, height: 8 },
          }}
        >
          <Txt variant="caption" color="#FFFFFF" align="center">{t.message}</Txt>
        </View>
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
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 }}>
        <Ionicons name="construct" size={54} color={theme.warn} />
        <Txt variant="h2" align="center">{t('common.setupRequired')}</Txt>
        <Txt variant="body" color={theme.textSecondary} align="center">{t('auth.notConfigured')}</Txt>
      </View>
    </AppBackground>
  );
}

function Shell() {
  const { ready } = useApp();
  const { theme, isDark } = useTheme();
  const [fontsLoaded] = useFonts({
    IBMPlexSansArabic_400Regular,
    IBMPlexSansArabic_500Medium,
    IBMPlexSansArabic_600SemiBold,
    IBMPlexSansArabic_700Bold,
  });

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
  if (!SUPABASE_ENABLED) return <SetupRequired />;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <RootNavigator />
      <ToastHost />
    </View>
  );
}

export default function App() {
  return (
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
  );
}
