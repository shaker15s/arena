// src/shared/push.ts — الحصول على توكن Expo Push لتسجيل الجهاز.
//
// لتشغيل الإشعارات الفعلية على الأجهزة: ثبّت `expo-notifications` (و`expo-device`)
// ثم أعد هذا الملف ليعيد توكن الجهاز الحقيقي، واستدعِ `registerPushToken` به بعد
// تسجيل الدخول. بدون تلك الحزم يعيد null فلا يحدث أي تسجيل (سلوك محايد).
export type PushPlatform = 'android' | 'ios' | 'web' | 'unknown';

export async function getDevicePushToken(): Promise<{ token: string; platform: PushPlatform } | null> {
  // TODO(device): بعد تثبيت expo-notifications و expo-device:
  //   await Notifications.requestPermissionsAsync();
  //   const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  //   const t = await Notifications.getExpoPushTokenAsync({ projectId });
  //   const platform = Device.isDevice ? (Platform.OS === 'ios' ? 'ios' : 'android') : 'web';
  //   return { token: t.data, platform };
  return null;
}
