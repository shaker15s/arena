import { createNavigationContainerRef } from '@react-navigation/native';
import { screenForNotification } from '../shared/notifyRoute';

export const navigationRef = createNavigationContainerRef<any>();

export function openNotificationRoute(type: string, role?: string | null): void {
  const dest = screenForNotification(type, role);
  if (!dest || !navigationRef.isReady()) return;
  navigationRef.navigate(dest.name, dest.params);
}
