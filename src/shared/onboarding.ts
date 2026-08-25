/**
 * shared/onboarding — يحفظ أن المستخدم رأى شاشات الترحيب مرة واحدة.
 * بدونه يبدأ AuthStack دائمًا من الأونبوردينج (الشريحة الأولى) في كل دخول،
 * وتبدو أي فشل في تسجيل الدخول وكأنه «أعادك للبداية».
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'masar.onboarding.v1';

export async function markOnboardingSeen(): Promise<void> {
  try {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') localStorage.setItem(KEY, '1');
    else await AsyncStorage.setItem(KEY, '1');
  } catch { /* تخزين ممتلئ/محجوب — غير حرج */ }
}

export async function hasSeenOnboarding(): Promise<boolean> {
  try {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') return localStorage.getItem(KEY) === '1';
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    return false;
  }
}
