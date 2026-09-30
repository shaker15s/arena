import { createNavigationContainerRef } from '@react-navigation/native';
import { screenForNotification } from '../shared/notifyRoute';

export const navigationRef = createNavigationContainerRef<any>();

export function openNotificationRoute(type: string, role?: string | null): void {
  const dest = screenForNotification(type, role);
  if (!dest || !navigationRef.isReady()) return;
  navigationRef.navigate(dest.name, dest.params);
}

/**
 * عودة آمنة: إذا كانت كومة التنقل تحتوي شاشة سابقة يعود إليها،
 * وإلا (مثل فتح رابط عميق أو تحديث الصفحة على الويب) يعود إلى الشاشة الجذرية المناسبة.
 */
export function safeBack(navigation?: any, fallbackRoute?: string): void {
  if (navigation && typeof navigation.canGoBack === 'function' && navigation.canGoBack()) {
    navigation.goBack();
    return;
  }
  if (navigationRef.isReady() && navigationRef.canGoBack()) {
    navigationRef.goBack();
    return;
  }
  const state = navigation?.getState?.() ?? (navigationRef.isReady() ? navigationRef.getRootState() : undefined);
  const routeNames: string[] = Array.isArray(state?.routeNames) ? state.routeNames : [];
  const nav = navigation && typeof navigation.navigate === 'function'
    ? navigation
    : navigationRef.isReady()
      ? navigationRef
      : null;
  if (!nav) return;
  if (fallbackRoute && routeNames.includes(fallbackRoute)) {
    nav.navigate(fallbackRoute);
    return;
  }
  if (routeNames.includes('Tabs')) {
    nav.navigate('Tabs');
    return;
  }
  if (routeNames.includes('SignIn')) {
    nav.navigate('SignIn');
    return;
  }
  if (routeNames.includes('Onboarding')) {
    nav.navigate('Onboarding');
    return;
  }
  nav.navigate('Tabs');
}

