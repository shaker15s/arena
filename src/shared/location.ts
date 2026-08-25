// src/shared/location.ts — قراءة موقع الجهاز لتفعيل geofence اختياري.
//
// الخادم يفرض geofence فقط على المجموعات المفعّلة (geofence_enabled=true)، ويعتمد
// على إحداثيات يمرّرها العميل. هذه الوحدة تجرّد قراءة الموقع:
//   - عند تفعيل geofence فعليًا على الأجهزة، ثبّت `expo-location` ثم أعد هذا
//     الملف ليُعيد إحداثيات الجهاز الحقيقية (طالما منحة إذن الموقع).
//   - بدون expo-location تعيد null صراحةً؛ فيرُدّ الخادم على المجموعات المفعّلة
//     بـ `location_required` (سلوك آمن: لا قبول حضور من غير إحداثيات).
export interface DevicePosition {
  lat: number;
  lng: number;
}

export async function getDevicePosition(): Promise<DevicePosition | null> {
  // TODO(device): ضع هنا قراءة expo-location على الناتي بعد تثبيته، مثال:
  //   const { status } = await Location.requestForegroundPermissionsAsync();
  //   if (status !== 'granted') return null;
  //   const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  //   return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  return null;
}
