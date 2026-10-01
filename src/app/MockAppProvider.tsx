import React from 'react';
import { View, ScrollView } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../design/theme';
import { A11yPreferencesProvider } from '../design/preferences';
import { I18nProvider } from '../i18n';
import { buildSeedDb, IDS } from '../../scripts/fixtures/seed';
import { CourseManagementScreen } from '../features/courses/CourseManagementScreen';
import { ScannerScreen } from '../features/attendance/ScannerScreen';
import { DashboardScreen } from '../features/org/DashboardScreen';
import { WalletScreen } from '../features/gamification/GamificationScreens';

// Build mock seed DB
const seedDb = buildSeedDb();
const mockAdmin = seedDb.profiles.find((p) => p.id === IDS.admin) || seedDb.profiles[0];
const mockStudent = seedDb.profiles.find((p) => p.id === 'u_omar') || seedDb.profiles[0];

// Custom Mock AppProvider to supply real components with full seed data
export function MockAppProvider({
  children,
  user = mockAdmin,
}: {
  children: React.ReactNode;
  user?: any;
}) {
  const value: any = {
    ready: true,
    configured: true,
    db: seedDb,
    user,
    identity: { email: user.email, authUserId: user.id },
    needsProfile: false,
    authError: null,
    loading: false,
    syncing: false,
    lastSyncAt: Date.now(),
    syncError: null,
    online: true,
    setOnline: () => {},
    toasts: [],
    toast: () => {},
    dismissToast: () => {},
    submitOrQueue: async () => ({ status: 'applied' }),
    pendingQueueCount: 0,
    flushOfflineQueue: async () => {},
    refresh: async () => {},
    signInWithGoogle: async () => ({ ok: true, error: null }),
    signInWithApple: async () => ({ ok: true, error: null }),
    completeProfile: async () => ({ ok: true }),
    updateProfile: async () => ({ ok: true }),
    uploadAvatar: async () => null,
    logout: async () => {},
    deleteMyAccount: async () => ({ ok: true }),
    unreadCount: 3,
    markNotificationsRead: () => {},
  };

  const AppContext = require('../data/store').Ctx || (require('../data/store') as any);
  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}
