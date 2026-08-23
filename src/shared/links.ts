import { Platform } from 'react-native';
import * as Linking from 'expo-linking';

export const PUBLIC_APP_URL = (process.env.EXPO_PUBLIC_APP_URL ?? '').trim().replace(/\/+$/, '');

function publicUrl(path: string, key: string, value: string): string {
  const query = `${key}=${encodeURIComponent(value)}`;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `${window.location.origin}/${path}?${query}`;
  }
  if (PUBLIC_APP_URL) return `${PUBLIC_APP_URL}/${path}?${query}`;
  return Linking.createURL(path, { queryParams: { [key]: value } });
}

export function publicVerifyUrl(serial: string): string {
  return publicUrl('verify', 'serial', serial);
}

export function publicJoinUrl(code: string): string {
  return publicUrl('join', 'code', code);
}
