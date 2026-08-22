import React, { createContext, useContext, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../data/store';
import { useTheme } from '../design/theme';
import { useI18n } from '../i18n';
import { Txt } from '../design/components';
import { radii, spacing } from '../design/tokens';

import { OnboardingScreen, WelcomeScreen, OtpScreen, CompleteProfileScreen } from '../features/auth/AuthScreens';
import { VerifyScreen } from '../features/verify/VerifyScreen';
import { TodayScreen } from '../features/today/TodayScreen';
import { ExploreScreen, CourseDetailsScreen } from '../features/explore/ExploreScreens';
import { JourneyScreen, JourneyMapScreen, AttendanceHistoryScreen } from '../features/journey/JourneyScreens';
import { ScannerScreen } from '../features/attendance/ScannerScreen';
import { WalletScreen, LeagueScreen, AchievementsScreen, RulesGuideScreen } from '../features/gamification/GamificationScreens';
import { CertificatesScreen, CertificateViewerScreen } from '../features/certificates/CertificatesScreens';
import { ExcusesScreen, ExcusesInboxScreen } from '../features/excuses/ExcusesScreens';
import { NotificationsScreen } from '../features/notifications/NotificationsScreen';
import { ProfileScreen, SupportScreen } from '../features/profile/ProfileScreens';
import { VolunteerTodayScreen, MyBatchesScreen, StudentRecordScreen, SessionsHistoryScreen } from '../features/volunteer/VolunteerScreens';
import { LiveSessionScreen } from '../features/volunteer/LiveSessionScreen';
import { DashboardScreen, OrgManagerScreen, CoursesScreen, BatchesAdminScreen, UsersScreen } from '../features/org/AdminScreens';
import { OrgWizardScreen } from '../features/org/WizardScreen';
import { HubScreen, IssueCertificatesScreen } from '../features/org/HubScreens';

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
const screenOpts = { headerShown: false, animation: 'slide_from_right' as const };

// ─── شريط تبويب زجاجي مخصص + FAB مركزي ───
export interface TabDef {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconActive?: keyof typeof Ionicons.glyphMap;
}

function GlassTabBar({ tabs, active, onSelect, fab, badges }: {
  tabs: TabDef[];
  active: string;
  onSelect: (key: string) => void;
  fab?: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void; label?: string };
  badges?: Record<string, number>;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{
      position: 'absolute', left: 0, right: 0, bottom: 0,
      paddingBottom: Math.max(insets.bottom, 10) + 6,
      paddingTop: 10, paddingHorizontal: 10,
      backgroundColor: theme.glass,
      borderTopWidth: 1, borderTopColor: theme.line,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        {tabs.map((t, i) => {
          const isActive = t.key === active;
          const badge = badges?.[t.key];
          const showFabHere = fab && i === Math.floor(tabs.length / 2);
          return (
            <React.Fragment key={t.key}>
              {showFabHere ? (
                <View style={{ flex: 1, alignItems: 'center' }}>
                  <Pressable
                    onPress={fab.onPress}
                    style={({ pressed }) => ({
                      width: 58, height: 58, borderRadius: 29,
                      backgroundColor: theme.brand,
                      alignItems: 'center', justifyContent: 'center',
                      marginTop: -34,
                      shadowColor: theme.brand, shadowOpacity: 0.4, shadowRadius: 14, shadowOffset: { width: 0, height: 6 },
                      elevation: 10,
                      transform: [{ scale: pressed ? 0.93 : 1 }],
                      borderWidth: 3, borderColor: theme.bg,
                    })}
                  >
                    <Ionicons name={fab.icon} size={26} color="#fff" />
                  </Pressable>
                  {fab.label ? <Txt variant="micro" color={theme.textMuted} style={{ marginTop: 3 }}>{fab.label}</Txt> : null}
                </View>
              ) : null}
              <Pressable
                onPress={() => onSelect(t.key)}
                style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 4, gap: 3 }}
              >
                <View>
                  <Ionicons
                    name={isActive ? (t.iconActive ?? t.icon) : t.icon}
                    size={23}
                    color={isActive ? theme.brand : theme.textMuted}
                  />
                  {badge && badge > 0 ? (
                    <View style={{ position: 'absolute', top: -4, end: -10, backgroundColor: theme.danger, borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
                      <Txt variant="micro" color="#fff" style={{ fontSize: 9 }}>{badge > 9 ? '9+' : badge}</Txt>
                    </View>
                  ) : null}
                </View>
                <Txt variant="micro" color={isActive ? theme.brand : theme.textMuted}>{t.label}</Txt>
              </Pressable>
            </React.Fragment>
          );
        })}
      </View>
    </View>
  );
}

function TabsScaffold({ tabs, renders, initial, fab, badges }: {
  tabs: TabDef[];
  renders: Record<string, () => React.ReactNode>;
  initial: string;
  fab?: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void; label?: string };
  badges?: Record<string, number>;
}) {
  const [tab, setTab] = useState(initial);
  const insets = useSafeAreaInsets();
  const ctx = useMemo(() => ({ tab, setTab }), [tab]);
  return (
    <TabsContext.Provider value={ctx}>
      <View style={{ flex: 1 }}>
        <View style={{ flex: 1, paddingBottom: 80 + Math.max(insets.bottom, 10) * 0 }}>
          {Object.entries(renders).map(([key, render]) => (
            <View key={key} style={{ flex: 1, display: key === tab ? 'flex' : 'none' }}>
              {key === tab ? render() : null}
            </View>
          ))}
        </View>
        <GlassTabBar tabs={tabs} active={tab} onSelect={setTab} fab={fab} badges={badges} />
      </View>
    </TabsContext.Provider>
  );
}

// ─── تبويبات الطالب ───
function StudentTabs({ navigation }: any) {
  const { t } = useI18n();
  const { unreadCount } = useApp();
  return (
    <TabsScaffold
      initial="today"
      tabs={[
        { key: 'today', label: t('tabs.today'), icon: 'home-outline', iconActive: 'home' },
        { key: 'explore', label: t('tabs.explore'), icon: 'compass-outline', iconActive: 'compass' },
        { key: 'journey', label: t('tabs.journey'), icon: 'map-outline', iconActive: 'map' },
        { key: 'profile', label: t('tabs.profile'), icon: 'person-outline', iconActive: 'person' },
      ]}
      fab={{ icon: 'qr-code', label: t('tabs.scan'), onPress: () => navigation.navigate('Scanner') }}
      badges={{ profile: unreadCount > 99 ? 99 : 0 }}
      renders={{
        today: () => <TodayScreen />,
        explore: () => <ExploreScreen />,
        journey: () => <JourneyScreen />,
        profile: () => <ProfileScreen />,
      }}
    />
  );
}

// ─── تبويبات المتطوع ───
function VolunteerTabs() {
  const { t } = useI18n();
  const { db, user } = useApp();
  const pendingExcuses = user
    ? db.excuses.filter((e) => e.status === 'pending').length
    : 0;
  return (
    <TabsScaffold
      initial="today"
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
function AdminTabs() {
  const { t } = useI18n();
  return (
    <TabsScaffold
      initial="dash"
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
      <Stack.Screen name="Tabs" component={StudentTabs} />
      <Stack.Screen name="CourseDetails" component={CourseDetailsScreen} options={{ animation: 'slide_from_bottom' }} />
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
      <Stack.Screen name="StudentRecord" component={StudentRecordScreen} />
      <Stack.Screen name="SessionsHistory" component={SessionsHistoryScreen} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      <Stack.Screen name="Support" component={SupportScreen} />
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
      <Stack.Screen name="IssueCertificates" component={IssueCertificatesScreen} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      <Stack.Screen name="Support" component={SupportScreen} />
      <Stack.Screen name="Verify" component={VerifyScreen} />
    </Stack.Navigator>
  );
}

function AuthStack() {
  return (
    <Stack.Navigator screenOptions={screenOpts} initialRouteName="Onboarding">
      <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ animation: 'fade' }} />
      <Stack.Screen name="Welcome" component={WelcomeScreen} />
      <Stack.Screen name="Otp" component={OtpScreen} />
      <Stack.Screen name="CompleteProfile" component={CompleteProfileScreen} />
      <Stack.Screen name="Verify" component={VerifyScreen} />
    </Stack.Navigator>
  );
}

// ─── الجذر ───
export function RootNavigator() {
  const { user } = useApp();
  const { theme, isDark } = useTheme();

  const navTheme = useMemo(() => ({
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
      background: theme.bg,
      card: theme.card,
      text: theme.text,
      border: theme.line,
      primary: theme.brand,
      notification: theme.brand,
    },
  }), [isDark, theme]);

  return (
    <NavigationContainer theme={navTheme}>
      {!user ? (
        <AuthStack />
      ) : user.role === 'student' ? (
        <StudentStack />
      ) : user.role === 'volunteer' ? (
        <VolunteerStack />
      ) : (
        <AdminStack />
      )}
    </NavigationContainer>
  );
}
