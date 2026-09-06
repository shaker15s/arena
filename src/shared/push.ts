// src/shared/push.ts — تسجيل جهاز المستخدم في Expo Push ومعالجة الإشعارات الواردة.
//
// الحدود الأمنية: التوكن يُخزَّن عبر RPC `register_push_token` المرتبطة بـ auth.uid()
// فلا يستطيع مستخدم تسجيل توكن لغيره. هذه الوحدة تتعامل فقط مع الجهاز:
//   - طلب الإذن وقراءة توكن Expo (على أجهزة حقيقية فقط).
//   - قناة إشعارات لأندرويد (إلزامية من Android 8+).
//   - مستمعون للإشعارات الواردة/النقر عليها.
// على الويب أو المحاكي أو عند غياب الحزم يعيد null (سلوك محايد بلا كسر).
import { Platform } from 'react-native';

export type PushPlatform = 'android' | 'ios' | 'web' | 'unknown';

export interface DevicePushToken {
  token: string;
  platform: PushPlatform;
}

export interface PushEvent {
  title?: string;
  body?: string;
  data: Record<string, unknown>;
}

function loadNotifications(): any | null {
  try {
    return require('expo-notifications');
  } catch {
    return null;
  }
}

function loadDevice(): any | null {
  try {
    return require('expo-device');
  } catch {
    return null;
  }
}

function projectId(): string | undefined {
  try {
    const Constants = require('expo-constants').default;
    return (
      Constants?.expoConfig?.extra?.eas?.projectId ??
      Constants?.easConfig?.projectId ??
      undefined
    );
  } catch {
    return undefined;
  }
}

let handlerInstalled = false;

/** يضبط كيفية عرض الإشعار والتطبيق مفتوح — مرة واحدة فقط. */
export function installForegroundHandler(): void {
  if (handlerInstalled) return;
  const Notifications = loadNotifications();
  if (!Notifications?.setNotificationHandler) return;
  handlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
      // حقول قديمة للتوافق مع نسخ SDK الأقدم
      shouldShowAlert: true,
    }),
  });
}

async function ensureAndroidChannel(Notifications: any): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Masar',
      importance: Notifications.AndroidImportance?.DEFAULT ?? 3,
      vibrationPattern: [0, 180, 120, 180],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility?.PUBLIC ?? 1,
    });
  } catch {
    /* قناة غير حرجة */
  }
}

/**
 * يطلب الإذن ويعيد توكن Expo Push للجهاز، أو null إن رُفض الإذن أو كانت البيئة
 * لا تدعم الدفع (ويب/محاكي/حزم غير مثبتة).
 */
export async function getDevicePushToken(): Promise<DevicePushToken | null> {
  if (Platform.OS === 'web') return null;
  const Notifications = loadNotifications();
  if (!Notifications) return null;
  const Device = loadDevice();
  if (Device && Device.isDevice === false) return null; // المحاكي لا يصدر توكن حقيقي

  try {
    installForegroundHandler();
    await ensureAndroidChannel(Notifications);

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted' && existing.canAskAgain !== false) {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return null;

    const pid = projectId();
    const result = await Notifications.getExpoPushTokenAsync(pid ? { projectId: pid } : undefined);
    const token: string | undefined = result?.data;
    if (!token) return null;
    return { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' };
  } catch {
    return null;
  }
}

/**
 * يشترك في الإشعارات الواردة (والتطبيق مفتوح) والنقر عليها.
 * يعيد دالة إلغاء اشتراك؛ آمن الاستدعاء على الويب (لا-أوب).
 */
export function subscribeToPush(handlers: {
  onReceived?: (e: PushEvent) => void;
  onOpened?: (e: PushEvent) => void;
}): () => void {
  const Notifications = loadNotifications();
  if (!Notifications?.addNotificationReceivedListener) return () => {};
  installForegroundHandler();

  const toEvent = (n: any): PushEvent => ({
    title: n?.request?.content?.title ?? undefined,
    body: n?.request?.content?.body ?? undefined,
    data: (n?.request?.content?.data ?? {}) as Record<string, unknown>,
  });

  const subs: Array<{ remove: () => void }> = [];
  try {
    if (handlers.onReceived) {
      subs.push(Notifications.addNotificationReceivedListener((n: any) => handlers.onReceived?.(toEvent(n))));
    }
    if (handlers.onOpened) {
      subs.push(
        Notifications.addNotificationResponseReceivedListener((r: any) =>
          handlers.onOpened?.(toEvent(r?.notification)),
        ),
      );
    }
  } catch {
    /* بيئة بلا دعم */
  }
  return () => {
    for (const s of subs) {
      try {
        s.remove();
      } catch {
        /* تجاهل */
      }
    }
  };
}
