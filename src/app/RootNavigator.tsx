import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, BackHandler, I18nManager, Keyboard, Platform, Pressable, ToastAndroid, View } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { addBreadcrumb } from '../shared/telemetry';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Linking from 'expo-linking';
import { useApp } from '../data/store';
import { useTheme } from '../design/theme';
import { useI18n } from '../i18n';
import { Btn, Card, FadeIn, OfflineQueueBanner, PageSkeleton, Spacer, Txt } from '../design/components';
import { AppBackground, ContentFrame } from '../design/glass';
import { isReducedMotion } from '../design/motion';
import { navBar, radii, spacing } from '../design/tokens';
import { useHaptics } from '../shared/hooks';
import { PUBLIC_APP_URL } from '../shared/links';
import { navigationRef } from './navRef';
import { hasSeenOnboarding } from '../shared/onboarding';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { SkipLink, Screen as SemanticScreen } from '../design/a11y/semantics';
import { announce } from '../design/a11y/announce';

import { OnboardingScreen, SignInScreen, CompleteProfileScreen } from '../features/auth/AuthScreens';
import { VerifyScreen } from '../features/verify/VerifyScreen';
import { TodayScreen } from '../features/today/TodayScreen';
import { ExploreScreen, CourseDetailsScreen } from '../features/explore/ExploreScreens';
import { JourneyScreen, JourneyMapScreen, AttendanceHistoryScreen } from '../features/journey/JourneyScreens';
import { ScannerScreen } from '../features/attendance/ScannerScreen';
import { WalletScreen } from '../features/gamification/GamificationScreens';
import { CertificatesScreen } from '../features/certificates/CertificatesScreens';
import { ExcusesScreen, ExcusesInboxScreen } from '../features/excuses/ExcusesScreens';
import { NotificationsScreen } from '../features/notifications/NotificationsScreen';
import { RequestsScreen } from '../features/notifications/RequestsScreen';
import { ProfileScreen } from '../features/profile/ProfileScreens';
import { VolunteerTodayScreen, MyBatchesScreen } from '../features/volunteer/VolunteerScreens';
import { LiveSessionScreen } from '../features/volunteer/LiveSessionScreen';
import { JoinBatchScreen } from '../features/courses/JoinBatchScreen';
import { Icon } from '../design/icons';

// ─── مغلّف التحميل الكسول (Code Splitting) ───
function lazyScreen(importer: () => Promise<any>, name: string) {
  const LazyComponent = React.lazy(async () => {
    const mod = await importer();
    return { default: mod[name] || mod.default };
  });

  return function LazyScreenWrapper(props: any) {
    const { theme } = useTheme();
    return (
      <React.Suspense
        // PERF-UX: هيكل رمادي مطابق لشكل الصفحة (نمط التطبيقات الكبيرة)
        // بدل دائرة التحميل المجردة — المستخدم يرى هيكل المحتوى أثناء تحميل الكود.
        fallback={
          <View style={{ flex: 1, backgroundColor: theme.bg }}>
            <PageSkeleton />
          </View>
        }
      >
        <LazyComponent {...props} />
      </React.Suspense>
    );
  };
}

// شاشات ثانوية وإدارية مُحمّلة كسولاً عند الطلب لتقليص حزمة الويب
const CourseManagementScreen = lazyScreen(() => import('../features/courses/CourseManagementScreen'), 'CourseManagementScreen');
const OrgWizardScreen = lazyScreen(() => import('../features/org/WizardScreen'), 'OrgWizardScreen');
const DashboardScreen = lazyScreen(() => import('../features/org/AdminScreens'), 'DashboardScreen');
const OrgManagerScreen = lazyScreen(() => import('../features/org/AdminScreens'), 'OrgManagerScreen');
const CoursesScreen = lazyScreen(() => import('../features/org/AdminScreens'), 'CoursesScreen');
const BatchesAdminScreen = lazyScreen(() => import('../features/org/AdminScreens'), 'BatchesAdminScreen');
const UsersScreen = lazyScreen(() => import('../features/org/AdminScreens'), 'UsersScreen');
const HubScreen = lazyScreen(() => import('../features/org/HubScreens'), 'HubScreen');
const IssueCertificatesScreen = lazyScreen(() => import('../features/org/HubScreens'), 'IssueCertificatesScreen');
const LeagueScreen = lazyScreen(() => import('../features/gamification/GamificationScreens'), 'LeagueScreen');
const AchievementsScreen = lazyScreen(() => import('../features/gamification/GamificationScreens'), 'AchievementsScreen');
const RulesGuideScreen = lazyScreen(() => import('../features/gamification/GamificationScreens'), 'RulesGuideScreen');
const CertificateViewerScreen = lazyScreen(() => import('../features/certificates/CertificatesScreens'), 'CertificateViewerScreen');
const StudentRecordScreen = lazyScreen(() => import('../features/volunteer/VolunteerScreens'), 'StudentRecordScreen');
const SessionsHistoryScreen = lazyScreen(() => import('../features/volunteer/VolunteerScreens'), 'SessionsHistoryScreen');
const SupportScreen = lazyScreen(() => import('../features/profile/ProfileScreens'), 'SupportScreen');
const SettingsScreen = lazyScreen(() => import('../features/settings/SettingsScreen'), 'SettingsScreen');
const DisputesScreen = lazyScreen(() => import('../features/disputes/DisputesScreen'), 'DisputesScreen');

// ─── سياق التبويبات الداخلية ───
interface TabsCtx {
  setTab: (tab: string) => void;
  tab: string;
}
const TabsContext = createContext<TabsCtx>({ setTab: () => {}, tab: '' });
export function useTabs() {
  return useContext(TabsContext);
}

const Stack = createNativeStackNavigator<any>();
const screenOpts = {
  headerShown: false,
  animation: (I18nManager.isRTL ? 'slide_from_left' : 'slide_from_right') as any,
  animationDuration: isReducedMotion() ? 90 : 280,
  presentation: 'card' as const,
  contentStyle: { backgroundColor: 'transparent' },
};
const linking = {
  prefixes: [Linking.createURL('/'), ...(PUBLIC_APP_URL ? [PUBLIC_APP_URL] : [])],
  config: {
    screens: {
      Tabs: {
        path: '',
        screens: {
          today: 'today',
          journey: 'journey',
          explore: 'explore',
          gamification: 'gamification',
          profile: 'profile',
          dash: 'dash',
          org: 'org',
          users: 'users',
          hub: 'hub',
          batches: 'batches',
          history: 'history',
        },
      },
      Notifications: 'notifications',
      Requests: 'requests',
      CourseDetails: 'course/:courseId',
      JoinBatch: 'join/:code?',
      JourneyMap: 'journey-map',
      AttendanceHistory: 'attendance-history',
      Scanner: 'scanner',
      Wallet: 'wallet',
      League: 'league',
      Achievements: 'achievements',
      Certificates: 'certificates',
      CertificateViewer: 'certificate/:certId',
      Excuses: 'excuses',
      RulesGuide: 'rules',
      Support: 'support',
      Settings: 'settings',
      Disputes: 'disputes',
      Verify: 'verify',
      Courses: 'admin/courses',
      BatchesAdmin: 'admin/batches',
      CourseManagement: 'admin/course-management',
      StudentRecord: 'student/:studentId',
      SessionsHistory: 'sessions-history',
      IssueCertificates: 'admin/issue-certificates',
      Wizard: 'admin/wizard',
      SignIn: 'signin',
      Onboarding: 'onboarding',
      CompleteProfile: 'complete-profile',
      NotFound: '*',
    },
  },
};

// ─── تعريف التبويب ───
export interface TabDef {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconActive?: keyof typeof Ionicons.glyphMap;
}

const webPointer = Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null;

// ─── شريط تنقل عائم بحركة موحدة وحالات وصول واضحة ───
function TabButton({ tab, active, badge, onPress, index, total }: {
  tab: TabDef;
  active: boolean;
  badge?: number;
  onPress: () => void;
  /** A11Y-05: يعلن قارئ الشاشة «تبويب i من n» عبر aria-posinset/aria-setsize. */
  index: number;
  total: number;
}) {
  const { theme, isDark } = useTheme();
  const { impactLight } = useHaptics();
  const progress = useRef(new Animated.Value(active ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(progress, {
      toValue: active ? 1 : 0,
      damping: 22,
      stiffness: 250,
      useNativeDriver: true,
    }).start();
  }, [active, progress]);
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected: active }}
      {...(Platform.OS === 'web'
        ? ({ 'aria-posinset': index + 1, 'aria-setsize': total } as unknown as object)
        : {})}
      onPress={() => { impactLight(); onPress(); }}
      style={({ pressed }) => ([
        webPointer,
        {
          flex: 1, minWidth: 0, minHeight: 54, flexShrink: 1,
          alignItems: 'center', justifyContent: 'center', gap: 2,
          paddingHorizontal: 2,
          opacity: pressed ? 0.72 : 1,
        },
      ])}
    >
      <Animated.View pointerEvents="none" style={{
        position: 'absolute', width: 46, height: 34, borderRadius: 17,
        backgroundColor: isDark ? 'rgba(10,132,255,0.17)' : 'rgba(0,122,255,0.11)',
        opacity: progress,
        transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] }) }],
      }} />
      <Animated.View style={{
        position: 'relative',
        transform: [
          { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -1] }) },
          { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) },
        ],
      }}>
        <Icon
          name={active ? (tab.iconActive ?? tab.icon) : tab.icon}
          size={21}
          color={active ? theme.brand : theme.textMuted}
        />
        {badge && badge > 0 ? (
          <View style={{
            position: 'absolute', top: -7, end: -11,
            backgroundColor: theme.danger, borderRadius: 9,
            minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center',
            paddingHorizontal: 4, borderWidth: 2, borderColor: theme.card,
          }}>
            <Txt variant="micro" color="#fff" style={{ fontSize: 9, lineHeight: 11 }}>{badge > 99 ? '99+' : badge}</Txt>
          </View>
        ) : null}
      </Animated.View>
      <Txt variant="micro" color={active ? theme.brand : theme.textMuted} style={{ fontSize: 10, lineHeight: 13, textAlign: 'center' }} numberOfLines={1}>
        {tab.label}
      </Txt>
    </Pressable>
  );
}

function AppleTabBar({ tabs, active, onSelect, fab, badges }: {
  tabs: TabDef[];
  active: string;
  onSelect: (key: string) => void;
  fab?: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void; label?: string };
  badges?: Record<string, number>;
}) {
  const { theme, isDark } = useTheme();
  const { impactMedium } = useHaptics();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const fabScale = useRef(new Animated.Value(1)).current;
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  // A11Y-12 (WCAG 2.4.11): إخفاء الشريط السفلي والـ FAB عند ظهور لوحة المفاتيح على الجوال لمنع حجب الحقل النشط
  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardOpen(true),
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardOpen(false),
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  if (keyboardOpen && Platform.OS !== 'web') return null;

  return (
    <View
      pointerEvents="box-none"
      onLayout={(e) => {
        if (Platform.OS === 'web' && typeof document !== 'undefined') {
          const h = Math.ceil(e.nativeEvent.layout.height);
          if (h > 0) {
            document.documentElement.style.setProperty('--masar-tabbar-h', String(h + 32) + 'px');
          }
        }
      }}
      // A11Y-05: معلم تنقّل حقيقي على الويب (قارئ الشاشة يقفز إليه بـ D/N في NVDA).
      {...(Platform.OS === 'web'
        ? ({ role: 'navigation', 'aria-label': t('a11y.mainNav') } as unknown as object)
        : {})}
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 10, paddingBottom: Math.max(insets.bottom, 8) }}
    >
      <View style={{
        width: '100%', maxWidth: 640, alignSelf: 'center',
        minHeight: 68, borderRadius: 26,
        shadowColor: '#000', shadowOpacity: isDark ? 0.34 : 0.13,
        shadowRadius: 22, shadowOffset: { width: 0, height: 10 }, elevation: 16,
      }}>
        <View style={{ position: 'absolute', inset: 0 as any, borderRadius: 26, overflow: 'hidden' }}>
          <BlurView intensity={isDark ? 55 : 80} tint={isDark ? 'dark' : 'light'} style={{ flex: 1 }} />
          <View pointerEvents="none" style={{
            position: 'absolute', inset: 0 as any,
            backgroundColor: isDark ? 'rgba(24,24,28,0.72)' : 'rgba(255,255,255,0.76)',
            borderWidth: 1, borderColor: theme.glassBorder, borderRadius: 26,
          }} />
        </View>
        <View accessibilityRole="tablist" style={{ flexDirection: 'row', alignItems: 'center', minHeight: 68, paddingHorizontal: 4, paddingVertical: 6 }}>
          {tabs.map((tab, index) => {
            const showFabHere = fab && index === Math.floor(tabs.length / 2);
            return (
              <React.Fragment key={tab.key}>
                {showFabHere ? (
                  <View style={{ flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' }}>
                    <Animated.View style={{ transform: [{ scale: fabScale }], marginTop: -27 }}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={fab.label}
                        onPress={() => { impactMedium(); fab.onPress(); }}
                        onPressIn={() => Animated.spring(fabScale, { toValue: 0.9, damping: 20, stiffness: 280, useNativeDriver: true }).start()}
                        onPressOut={() => Animated.spring(fabScale, { toValue: 1, damping: 18, stiffness: 240, useNativeDriver: true }).start()}
                        style={webPointer}
                      >
                        <LinearGradient
                          colors={[theme.brandGradientFrom, theme.brandGradientTo]}
                          style={{
                            width: 52, height: 52, borderRadius: 18,
                            alignItems: 'center', justifyContent: 'center',
                            borderWidth: 3, borderColor: theme.bg,
                            shadowColor: theme.brand, shadowOpacity: 0.38,
                            shadowRadius: 15, shadowOffset: { width: 0, height: 8 }, elevation: 12,
                          }}
                        >
                          <Icon name={fab.icon} size={23} color="#fff" />
                        </LinearGradient>
                      </Pressable>
                    </Animated.View>
                    {fab.label ? <Txt variant="micro" color={theme.textMuted} style={{ fontSize: 10, lineHeight: 13 }}>{fab.label}</Txt> : null}
                  </View>
                ) : null}
                <TabButton
                  tab={tab}
                  active={tab.key === active}
                  badge={badges?.[tab.key]}
                  index={index}
                  total={tabs.length}
                  onPress={() => onSelect(tab.key)}
                />
              </React.Fragment>
            );
          })}
        </View>
      </View>
    </View>
  );
}

function TabScene({ children }: { children: React.ReactNode }) {
  const entrance = useRef(new Animated.Value(isReducedMotion() ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1, duration: isReducedMotion() ? 90 : 220,
      useNativeDriver: true,
    }).start();
  }, [entrance]);
  return (
    <Animated.View style={{
      flex: 1, opacity: entrance,
      transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [7, 0] }) }],
    }}>
      <ErrorBoundary>
        {children}
      </ErrorBoundary>
    </Animated.View>
  );
}

function TabsScaffold({ tabs, renders, initial, fab, badges, maxWidth = 920, requestedTab }: {
  tabs: TabDef[];
  renders: Record<string, () => React.ReactNode>;
  initial: string;
  requestedTab?: string;
  fab?: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void; label?: string };
  badges?: Record<string, number>;
  maxWidth?: number;
}) {
  const [tab, setTab] = useState(initial);
  const insets = useSafeAreaInsets();
  const handledRequest = useRef<string | undefined>(undefined);
  const visitedTabs = useRef<Set<string>>(new Set([initial])).current;
  const lastBackPress = useRef(0);
  const { t } = useI18n();

  // ─── double-back-to-exit: أول back يرجع للتاب الافتراضي، تاني back يخرج ───
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const handler = () => {
      // لو مش في التاب الافتراضي — ارجع للتاب الافتراضي
      if (tab !== initial) {
        visitedTabs.add(initial);
        setTab(initial);
        return true; // handled — لا تخرج
      }
      // لو في التاب الافتراضي — تحقق من double-back
      const now = Date.now();
      if (now - lastBackPress.current < 2000) {
        return false; // لا تتدخل — اسمح بالخروج الطبيعي
      }
      lastBackPress.current = now;
      if (Platform.OS === 'android') {
        try {
          ToastAndroid.show(t('common.pressBackAgainToExit' as any) || 'اضغط مرة أخرى للخروج', ToastAndroid.SHORT);
        } catch {}
      }
      return true; // handled — لا تخرج (أول ضغطة)
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', handler);
    return () => sub.remove();
  }, [tab, initial, visitedTabs, t]);

  useEffect(() => {
    if (requestedTab && requestedTab !== handledRequest.current && renders[requestedTab]) {
      handledRequest.current = requestedTab;
      visitedTabs.add(requestedTab);
      setTab(requestedTab);
    }
  }, [requestedTab, renders, visitedTabs]);

  const handleSelectTab = (newTab: string) => {
    visitedTabs.add(newTab);
    setTab(newTab);
    // A11Y-13: تغيير التبويب إجراء تنقّل لا انتقال كامل — نُعلن اسم التبويب.
    const def = tabs.find((x) => x.key === newTab);
    if (def?.label) {
      announce(def.label, 'polite');
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        document.title = `${def.label} — ${t('common.appName')}`;
      }
    }
  };

  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const def = tabs.find((x) => x.key === tab);
      if (def?.label) {
        document.title = `${def.label} — ${t('common.appName')}`;
      }
    }
  }, [tab, tabs, t]);

  const ctx = useMemo(() => ({ tab, setTab: handleSelectTab }), [tab]);
  const { online, pendingQueueCount, flushOfflineQueue } = useApp();

  return (
    <TabsContext.Provider value={ctx}>
      <View style={{ flex: 1 }}>
        {/* DESIGN-01: الحجز السفلي من توكينز navBar واحد — كان 104 ثابتًا (شريط بلا
          FAB = 76 فعليًا ⇒ 28px شريط رمادي ميت فوق الناف بار) + كل شاشة تضيف
          paddingBottom خاصًا بها (110–130) فتتراكم فجوة 200px+. */}
        <ContentFrame maxWidth={maxWidth} style={{ flex: 1, paddingBottom: (fab ? navBar.height + navBar.fabPoke : navBar.height) + Math.max(insets.bottom, navBar.minPad) }}>
          <OfflineQueueBanner online={online} pendingCount={pendingQueueCount} onSync={() => { void flushOfflineQueue(); }} />
          {tabs.map((t) => {
            const isSelected = t.key === tab;
            if (!visitedTabs.has(t.key) && !isSelected) return null;
            return (
              <View
                key={t.key}
                style={{
                  flex: 1,
                  display: isSelected ? 'flex' : 'none',
                }}
              >
                <TabScene>{renders[t.key]?.()}</TabScene>
              </View>
            );
          })}
        </ContentFrame>
        <AppleTabBar tabs={tabs} active={tab} onSelect={handleSelectTab} fab={fab} badges={badges} />
      </View>
    </TabsContext.Provider>
  );
}

// ─── تبويبات الطالب ───
function StudentTabs({ navigation, route }: any) {
  const { t } = useI18n();
  return (
    <TabsScaffold
      initial="today"
      requestedTab={route?.params?.tab}
      maxWidth={780}
      tabs={[
        { key: 'today', label: t('tabs.today'), icon: 'home-outline', iconActive: 'home' },
        { key: 'explore', label: t('tabs.explore'), icon: 'compass-outline', iconActive: 'compass' },
        { key: 'journey', label: t('tabs.journey'), icon: 'map-outline', iconActive: 'map' },
        { key: 'profile', label: t('tabs.profile'), icon: 'person-outline', iconActive: 'person' },
      ]}
      fab={{ icon: 'qr-code', label: t('tabs.scan'), onPress: () => navigation.navigate('Scanner') }}
      renders={{
        today: () => <TodayScreen />,
        explore: () => <ExploreScreen />,
        journey: () => <JourneyScreen />,
        profile: () => <ProfileScreen />,
      }}
    />
  );
}

// ─── تبويبات المتطوع/المدرب ───
function VolunteerTabs({ route }: any) {
  const { t } = useI18n();
  const { db, user } = useApp();
  const pendingExcuses = user
    ? db.excuses.filter((e) => e.status === 'pending').length
    : 0;
  return (
    <TabsScaffold
      initial="today"
      requestedTab={route?.params?.tab}
      maxWidth={940}
      tabs={[
        { key: 'today', label: t('tabs.today'), icon: 'sunny-outline', iconActive: 'sunny' },
        { key: 'batches', label: t('tabs.batches'), icon: 'people-outline', iconActive: 'people' },
        { key: 'live', label: t('tabs.live'), icon: 'play-circle-outline', iconActive: 'play-circle' },
        { key: 'inbox', label: t('tabs.inbox'), icon: 'file-tray-outline', iconActive: 'file-tray' },
        { key: 'profile', label: t('tabs.profile'), icon: 'person-outline', iconActive: 'person' },
      ]}
      badges={{ inbox: pendingExcuses }}
      renders={{
        today: () => <VolunteerTodayScreen />,
        batches: () => <MyBatchesScreen />,
        live: () => <LiveSessionScreen />,
        inbox: () => <ExcusesInboxScreen />,
        profile: () => <ProfileScreen />,
      }}
    />
  );
}

// ─── تبويبات المشرف/الأدمن ───
function AdminTabs({ route }: any) {
  const { t } = useI18n();
  return (
    <TabsScaffold
      initial="dash"
      requestedTab={route?.params?.tab}
      maxWidth={1120}
      tabs={[
        { key: 'dash', label: t('tabs.dashboard'), icon: 'grid-outline', iconActive: 'grid' },
        { key: 'org', label: t('tabs.org'), icon: 'business-outline', iconActive: 'business' },
        { key: 'users', label: t('tabs.users'), icon: 'people-circle-outline', iconActive: 'people-circle' },
        { key: 'hub', label: t('tabs.hub'), icon: 'options-outline', iconActive: 'options' },
        { key: 'profile', label: t('tabs.profile'), icon: 'person-outline', iconActive: 'person' },
      ]}
      renders={{
        dash: () => <DashboardScreen />,
        org: () => <OrgManagerScreen />,
        users: () => <UsersScreen />,
        hub: () => <HubScreen />,
        profile: () => <ProfileScreen />,
      }}
    />
  );
}

// ─── ستاكات الأدوار ───
function StudentStack() {
  return (
    <Stack.Navigator screenOptions={screenOpts}>
      <Stack.Screen name="Tabs" component={StudentTabs} options={{ gestureEnabled: false }} />
      <Stack.Screen name="CourseDetails" component={CourseDetailsScreen} options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="JoinBatch" component={JoinBatchScreen} />
      <Stack.Screen name="JourneyMap" component={JourneyMapScreen} />
      <Stack.Screen name="AttendanceHistory" component={AttendanceHistoryScreen} />
      <Stack.Screen name="Scanner" component={ScannerScreen} options={{ animation: 'fade_from_bottom', presentation: 'fullScreenModal' }} />
      <Stack.Screen name="Wallet" component={WalletScreen} />
      <Stack.Screen name="League" component={LeagueScreen} />
      <Stack.Screen name="Achievements" component={AchievementsScreen} />
      <Stack.Screen name="Certificates" component={CertificatesScreen} />
      <Stack.Screen name="CertificateViewer" component={CertificateViewerScreen} options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="Excuses" component={ExcusesScreen} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      <Stack.Screen name="Requests" component={RequestsScreen} />
      <Stack.Screen name="RulesGuide" component={RulesGuideScreen} />
      <Stack.Screen name="Support" component={SupportScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="Disputes" component={DisputesScreen} />
      <Stack.Screen name="Verify" component={VerifyScreen} />
      <Stack.Screen name="NotFound" component={NotFoundScreen} />
    </Stack.Navigator>
  );
}

function VolunteerStack() {
  return (
    <Stack.Navigator screenOptions={screenOpts}>
      <Stack.Screen name="Tabs" component={VolunteerTabs} options={{ gestureEnabled: false }} />
      <Stack.Screen name="Courses" component={CoursesScreen} />
      <Stack.Screen name="BatchesAdmin" component={BatchesAdminScreen} />
      <Stack.Screen name="CourseDetails" component={CourseDetailsScreen} />
      <Stack.Screen name="StudentRecord" component={StudentRecordScreen} />
      <Stack.Screen name="SessionsHistory" component={SessionsHistoryScreen} />
      <Stack.Screen name="CourseManagement" component={CourseManagementScreen} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      <Stack.Screen name="Requests" component={RequestsScreen} />
      <Stack.Screen name="RulesGuide" component={RulesGuideScreen} />
      <Stack.Screen name="Support" component={SupportScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="Disputes" component={DisputesScreen} />
      <Stack.Screen name="Verify" component={VerifyScreen} />
      <Stack.Screen name="JoinBatch" component={JoinBatchScreen} />
      <Stack.Screen name="NotFound" component={NotFoundScreen} />
    </Stack.Navigator>
  );
}

function AdminStack() {
  return (
    <Stack.Navigator screenOptions={screenOpts}>
      <Stack.Screen name="Tabs" component={AdminTabs} options={{ gestureEnabled: false }} />
      <Stack.Screen name="Wizard" component={OrgWizardScreen} options={{ animation: 'slide_from_bottom', presentation: 'fullScreenModal' }} />
      <Stack.Screen name="Courses" component={CoursesScreen} />
      <Stack.Screen name="BatchesAdmin" component={BatchesAdminScreen} />
      <Stack.Screen name="CourseManagement" component={CourseManagementScreen} />
      <Stack.Screen name="StudentRecord" component={StudentRecordScreen} />
      <Stack.Screen name="IssueCertificates" component={IssueCertificatesScreen} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      <Stack.Screen name="Requests" component={RequestsScreen} />
      <Stack.Screen name="RulesGuide" component={RulesGuideScreen} />
      <Stack.Screen name="Support" component={SupportScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="Disputes" component={DisputesScreen} />
      <Stack.Screen name="Verify" component={VerifyScreen} />
      <Stack.Screen name="JoinBatch" component={JoinBatchScreen} />
      <Stack.Screen name="NotFound" component={NotFoundScreen} />
    </Stack.Navigator>
  );
}

function AuthStack() {
  const { authError } = useApp();
  const [initial, setInitial] = useState<'Onboarding' | 'SignIn' | null>(null);

  // الأونبوردينج يظهر مرة واحدة فقط: من رآه (أو حاول الدخول للتو وفشل)
  // يبدأ من شاشة الدخول مباشرة بدل إعادته للشريحة الأولى كل مرة.
  useEffect(() => {
    let isMounted = true;
    void (async () => {
      const seen = await hasSeenOnboarding();
      if (isMounted) setInitial(seen || authError ? 'SignIn' : 'Onboarding');
    })();
    return () => { isMounted = false; };
  }, [authError]);

  if (!initial) return null;

  return (
    <Stack.Navigator screenOptions={screenOpts} initialRouteName={initial}>
      <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ animation: 'fade' }} />
      <Stack.Screen name="SignIn" component={SignInScreen} />
      <Stack.Screen name="Verify" component={VerifyScreen} />
      <Stack.Screen name="JoinBatch" component={JoinBatchScreen} />
      <Stack.Screen name="NotFound" component={NotFoundScreen} />
    </Stack.Navigator>
  );
}

function NotFoundScreen({ navigation }: any) {
  const { user } = useApp();
  const { theme } = useTheme();
  const { t } = useI18n();
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <FadeIn style={{ width: '100%', maxWidth: 480 }}>
          <Card solid style={{ alignItems: 'center', padding: 32, gap: 16 }}>
            <View
              style={{
                width: 80,
                height: 80,
                borderRadius: 28,
                backgroundColor: theme.brandSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="compass-outline" size={40} color={theme.brand} />
            </View>
            <Txt variant="h1" align="center">{t('common.notFoundTitle')}</Txt>
            <Txt variant="body" color={theme.textSecondary} align="center" style={{ lineHeight: 22 }}>
              {t('common.notFoundBody')}
            </Txt>
            <Spacer size={12} />
            <Btn
              title={t('common.backToHome')}
              variant="primary"
              full
              size="lg"
              icon="home"
              onPress={() => {
                if (navigation.canGoBack?.()) {
                  navigation.goBack();
                } else {
                  navigation.navigate?.(user ? 'Tabs' : 'SignIn');
                }
              }}
            />
          </Card>
        </FadeIn>
      </View>
    </View>
  );
}

function DisabledAccountScreen() {
  const { logout } = useApp();
  const { theme } = useTheme();
  const { t } = useI18n();
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <FadeIn style={{ width: '100%', maxWidth: 520 }}>
          <Card solid style={{ alignItems: 'center', padding: 30, gap: 14 }}>
            <View style={{ width: 82, height: 82, borderRadius: 26, backgroundColor: theme.dangerSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="lock-closed" size={38} color={theme.danger} />
            </View>
            <Txt variant="h2" align="center">{t('account.disabledTitle')}</Txt>
            <Txt variant="body" color={theme.textSecondary} align="center">{t('account.disabledBody')}</Txt>
            <Btn title={t('common.logout')} variant="danger" full icon="log-out" onPress={() => { void logout(); }} />
          </Card>
        </FadeIn>
      </View>
    </View>
  );
}

/** بعد الدخول بجوجل مباشرة: إكمال البيانات (موبايل/اسم/صورة/فرع) */
function CompleteProfileStack() {
  return (
    <Stack.Navigator screenOptions={screenOpts}>
      <Stack.Screen name="CompleteProfile" component={CompleteProfileScreen} />
    </Stack.Navigator>
  );
}

/** معرّف معلم المحتوى الرئيسي (هدف رابط «تخطَّ إلى المحتوى» وفحوص DOM). */
export const MAIN_LANDMARK_ID = 'masar-main';

const ROUTE_TITLE_KEYS: Record<string, string> = {
  Onboarding: 'onboarding.o1Title',
  SignIn: 'auth.welcomeTitle',
  CompleteProfile: 'complete.title',
  CourseDetails: 'tabs.explore',
  JoinBatch: 'joinCode.title',
  JourneyMap: 'journey.map',
  AttendanceHistory: 'history.title',
  Scanner: 'tabs.scan',
  Wallet: 'wallet.title',
  League: 'league.title',
  Achievements: 'achievements.title',
  Certificates: 'certs.title',
  CertificateViewer: 'certs.title',
  Excuses: 'excuses.title',
  Notifications: 'profile.notifications',
  Requests: 'requests.title',
  RulesGuide: 'rules.title',
  Support: 'profile.support',
  Settings: 'profile.settings',
  Disputes: 'disputes.title',
  Verify: 'verify.title',
  Courses: 'org.courses',
  BatchesAdmin: 'org.batches',
  CourseManagement: 'org.courses',
  StudentRecord: 'volunteer.studentRecord',
  SessionsHistory: 'volunteer.sessionsHistory',
  IssueCertificates: 'certs.issueTitle',
  Wizard: 'wizard.title',
  NotFound: 'common.notFoundTitle',
};

// ─── الجذر ───
export function RootNavigator() {
  const { user, needsProfile } = useApp();
  const { theme, isDark } = useTheme();
  const { t } = useI18n();

  const resolveRouteTitle = useCallback(
    (routeName?: string) => {
      const appName = t('common.appName');
      if (!routeName || routeName === 'Tabs') return appName;
      const key = ROUTE_TITLE_KEYS[routeName];
      return key ? `${t(key as any)} — ${appName}` : appName;
    },
    [t],
  );

  const navTheme = useMemo(() => ({
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
      background: 'transparent',
      card: theme.card,
      text: theme.text,
      border: theme.separator,
      primary: theme.brand,
      notification: theme.brand,
    },
  }), [isDark, theme]);

  return (
    <AppBackground>
      {/*
        A11Y-04/11: معلم `main` واحد للصفحة (WAI-ARIA: معلم main واحد لكل صفحة)
        يغلّف كل الشاشات الـ37، مع هدف رابط «تخطَّ إلى المحتوى» (WCAG 2.4.1).
      */}
      <SkipLink label={t('a11y.skipToContent')} targetId={MAIN_LANDMARK_ID} />
      <SemanticScreen
        id={MAIN_LANDMARK_ID}
        label={t('a11y.mainContent')}
        style={{ width: '100%', maxWidth: 1180, alignSelf: 'center' }}
      >
        <NavigationContainer
          ref={navigationRef}
          theme={navTheme}
          linking={linking}
          documentTitle={{
            formatter: (_options, route) => resolveRouteTitle(route?.name),
          }}
          // اسم الشاشة فقط (لا وسائط) — يعطي تقارير الأعطال مسار المستخدم
          // دون تسريب أي معرّفات أو محتوى.
          onStateChange={(state) => {
            const route = state?.routes?.[state.index ?? 0];
            if (route?.name) {
              addBreadcrumb('nav', route.name);
              if (Platform.OS === 'web' && typeof document !== 'undefined' && route.name !== 'Tabs') {
                document.title = resolveRouteTitle(route.name);
              }
            }
          }}
        >
          {needsProfile ? (
            <CompleteProfileStack />
          ) : !user ? (
            <AuthStack />
          ) : user.status === 'disabled' ? (
            <DisabledAccountScreen />
          ) : user.role === 'student' ? (
            <StudentStack />
          ) : user.role === 'volunteer' ? (
            <VolunteerStack />
          ) : (
            <AdminStack />
          )}
        </NavigationContainer>
      </SemanticScreen>
    </AppBackground>
  );
}
