import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StatusBar as RNStatusBar, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import { Ionicons } from '@expo/vector-icons';
import { ThemeProvider, useTheme } from '../design/theme';
import { I18nProvider } from '../i18n';
import { AppProvider, useApp } from '../data/store';
import { RootNavigator } from './RootNavigator';
import { Txt } from '../design/components';

/** S01 — Splash: اللوجو يتوهج ثم ينتقل */
function BootSplash() {
  const { theme } = useTheme();
  const glow = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.8)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(glow, { toValue: 1, duration: 900, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, damping: 12, stiffness: 120, useNativeDriver: true }),
    ]).start();
  }, [glow, scale]);
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{
        width: 120, height: 120, borderRadius: 34,
        backgroundColor: theme.brand,
        alignItems: 'center', justifyContent: 'center',
        opacity: glow,
        transform: [{ scale }],
        shadowColor: theme.brand, shadowOpacity: 0.55, shadowRadius: 40, shadowOffset: { width: 0, height: 0 },
        elevation: 20,
      }}>
        <Ionicons name="map" size={60} color="#fff" />
      </Animated.View>
      <View style={{ height: 18 }} />
      <Txt variant="h1">مسار</Txt>
      <Txt variant="caption" color={theme.textSecondary}>منظومة تنظيم مراكز التدريب</Txt>
    </View>
  );
}

function ToastHost() {
  const { toasts } = useApp();
  const { theme } = useTheme();
  if (toasts.length === 0) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: Platform.OS === 'web' ? 16 : 54, left: 16, right: 16, alignItems: 'center', gap: 8, zIndex: 999 }}>
      {toasts.map((t) => (
        <View
          key={t.id}
          style={{
            backgroundColor: t.kind === 'success' ? theme.success : t.kind === 'error' ? theme.danger : t.kind === 'warn' ? theme.warn : '#1E293B',
            paddingHorizontal: 18, paddingVertical: 11, borderRadius: 999,
            maxWidth: 560,
            shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
          }}
        >
          <Txt variant="caption" color="#FFFFFF" align="center">{t.message}</Txt>
        </View>
      ))}
    </View>
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

  if (!fontsLoaded || !ready) return <BootSplash />;

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
