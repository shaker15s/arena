import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, I18nManager, Platform, Pressable, View } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useApp } from '../data/store';
import { useTheme } from '../design/theme';
import { useI18n } from '../i18n';
import { Btn, Card, FadeIn, Txt } from '../design/components';
import { AppBackground, ContentFrame } from '../design/glass';
import { isReducedMotion } from '../design/motion';
import { radii, spacing } from '../design/tokens';
import { useHaptics } from '../shared/hooks';
import { PUBLIC_APP_URL } from '../shared/links';
import { hasSeenOnboarding } from '../shared/onboarding';

import { OnboardingScreen, SignInScreen, CompleteProfileScreen } from '../features/auth/AuthScreens';
import { VerifyScreen } from '../features/verify/VerifyScreen';
import { TodayScreen } from '../features/today/TodayScreen';
import { ExploreScreen, CourseDetailsScreen } from '../features/explore/ExploreScreens';
import { JourneyScreen, JourneyMapScreen, AttendanceHistoryScreen } from '../features/journey/JourneyScreens';
import { ScannerScreen } from '../features/attendance/ScannerScreen';
import { WalletScreen, LeagueScreen, AchievementsScreen, RulesGuideScreen } from '../features/gamification/GamificationScreens';
import { CertificatesScreen, CertificateViewerScreen } from '../features/certificates/CertificatesScreens';
import { ExcusesScreen, ExcusesInboxScreen } from '../features/excuses/ExcusesScreens';
import { NotificationsScreen } from '../features/notifications/NotificationsScreen';
import { RequestsScreen } from '../features/notifications/RequestsScreen';
import { ProfileScreen, SupportScreen } from '../features/profile/ProfileScreens';
import { VolunteerTodayScreen, MyBatchesScreen, StudentRecordScreen, SessionsHistoryScreen } from '../features/volunteer/VolunteerScreens';
import { LiveSessionScreen } from '../features/volunteer/LiveSessionScreen';
import { DashboardScreen, OrgManagerScreen, CoursesScreen, BatchesAdminScreen, UsersScreen } from '../features/org/AdminScreens';
import { OrgWizardScreen } from '../features/org/WizardScreen';
import { HubScreen, IssueCertificatesScreen } from '../features/org/HubScreens';
import { CourseManagementScreen } from '../features/courses/CourseManagementScreen';
import { JoinBatchScreen } from '../features/courses/JoinBatchScreen';

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
};
const linking = {
  prefixes: [Linking.createURL('/'), ...(PUBLIC_APP_URL ? [PUBLIC_APP_URL] : [])],
  config: { screens: { Verify: 'verify', JoinBatch: 'join' } },
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
function TabButton({ tab, active, badge, onPress }: {
  tab: TabDef;
  active: boolean;
  badge?: number;
  onPress: () => void;
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
        <Ionicons
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
  const insets = useSafeAreaInsets();
  const fabScale = useRef(new Animated.Value(1)).current;

  return (
    <View
      pointerEvents="box-none"
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
                          <Ionicons name={fab.icon} size={23} color="#fff" />
                        </LinearGradient>
                      </Pressable>
                    </Animated.View>
                    {fab.label ? <Txt variant="micro" color={theme.textMuted} style={{ fontSize: 10, lineHeight: 13 }}>{fab.label}</Txt> : null}
                  </View>
                ) : null}
                <TabButton tab={tab} active={tab.key === active} badge={badges?.[tab.key]} onPress={() => onSelect(tab.key)} />
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
      {children}
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
  };

  const ctx = useMemo(() => ({ tab, setTab: handleSelectTab }), [tab]);

  return (
    <TabsContext.Provider value={ctx}>
      <AppBackground>
        <ContentFrame maxWidth={maxWidth} style={{ flex: 1, paddingBottom: 104 + Math.max(insets.bottom, 8) }}>
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
      </AppBackground>
    </TabsContext.Provider>
  );
}

// ─── تبويبات الطالب ───
function StudentTabs({ navigation, route }: any) {
  const { t } = useI18n();
  const { unreadCount } = useApp();
  return (
    <TabsScaffold
      initial="today"
      requestedTab={route.params?.tab}
      maxWidth={780}
      tabs={[
        { key: 'today', label: t('tabs.today'), icon: 'home-outline', iconActive: 'home' },
        { key: 'explore', label: t('tabs.explore'), icon: 'compass-outline', iconActive: 'compass' },
        { key: 'journey', label: t('tabs.journey'), icon: 'map-outline', iconActive: 'map' },
        { key: 'profile', label: t('tabs.profile'), icon: 'person-outline', iconActive: 'person' },
      ]}
      fab={{ icon: 'qr-code', label: t('tabs.scan'), onPress: () => navigation.navigate('Scanner') }}
      badges={{ profile: Math.min(unreadCount, 99) }}
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
  const { db, user, unreadCount } = useApp();
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
      badges={{ inbox: pendingExcuses, profile: Math.min(unreadCount, 99) }}
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
  const { unreadCount } = useApp();
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
      badges={{ profile: Math.min(unreadCount, 99) }}
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
      <Stack.Screen name="Tabs" component={StudentTabs} />
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
      <Stack.Screen name="Verify" component={VerifyScreen} />
    </Stack.Navigator>
  );
}

function VolunteerStack() {
  return (
    <Stack.Navigator screenOptions={screenOpts}>
      <Stack.Screen name="Tabs" component={VolunteerTabs} />
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
      <Stack.Screen name="Verify" component={VerifyScreen} />
      <Stack.Screen name="JoinBatch" component={JoinBatchScreen} />
    </Stack.Navigator>
  );
}

function AdminStack() {
  return (
    <Stack.Navigator screenOptions={screenOpts}>
      <Stack.Screen name="Tabs" component={AdminTabs} />
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
      <Stack.Screen name="Verify" component={VerifyScreen} />
      <Stack.Screen name="JoinBatch" component={JoinBatchScreen} />
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
    </Stack.Navigator>
  );
}

function DisabledAccountScreen() {
  const { logout } = useApp();
  const { theme } = useTheme();
  const { t } = useI18n();
  return (
    <AppBackground>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <FadeIn style={{ width: '100%', maxWidth: 520 }}>
          <Card solid style={{ alignItems: 'center', padding: 30, gap: 14 }}>
            <View style={{ width: 82, height: 82, borderRadius: 26, backgroundColor: theme.dangerSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="lock-closed" size={38} color={theme.danger} />
            </View>
            <Txt variant="h2" align="center">{t('account.disabledTitle')}</Txt>
            <Txt variant="body" color={theme.textSecondary} align="center">{t('account.disabledBody')}</Txt>
            <Btn title={t('common.logout')} variant="danger" full icon="log-out" onPress={() => { void logout(); }} />
          </Card>
        </FadeIn>
      </View>
    </AppBackground>
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

// ─── الجذر ───
export function RootNavigator() {
  const { user, needsProfile } = useApp();
  const { theme, isDark } = useTheme();

  const navTheme = useMemo(() => ({
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
      background: theme.bg,
      card: theme.card,
      text: theme.text,
      border: theme.separator,
      primary: theme.brand,
      notification: theme.brand,
    },
  }), [isDark, theme]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ flex: 1, width: '100%', maxWidth: 1180, alignSelf: 'center' }}>
        <NavigationContainer theme={navTheme} linking={linking}>
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
      </View>
    </View>
  );
}
