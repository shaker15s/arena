/**
 * design/tokens.ts — المصدر الوحيد للألوان/التايب/المسافات (وثيقة 05)
 * ممنوع أي لون أو مسافة أو خط حرفي خارج هذا الملف.
 */

export const spacing = {
  s1: 4, s2: 8, s3: 12, s4: 16, s5: 20, s6: 24, s8: 32, s10: 40, s12: 48,
} as const;

export const radii = {
  xl: 28,      // شاشات وحوارات
  card: 20,    // بطاقات
  cardSm: 16,  // بطاقات صغيرة
  button: 14,  // أزرار
  pill: 999,   // Chips/حبوب
} as const;

export type ThemeName = 'light' | 'dark' | 'oled';

export interface ThemeColors {
  brand: string;
  brandDark: string;
  brandSoft: string;
  brandGradientTo: string;
  teal: string;
  success: string;
  successSoft: string;
  warn: string;
  warnSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;        // سماوي المعذور 🛡️
  infoSoft: string;
  flameFrom: string;
  flameTo: string;
  certGold: string;
  bg: string;
  card: string;
  glass: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  line: string;
  overlay: string;
  // ندرة الشارات
  rarityCommon: string;
  rarityRare: string;
  rarityEpic: string;
  rarityLegendary: string;
}

export const lightTheme: ThemeColors = {
  brand: '#4F46E5',
  brandDark: '#4338CA',
  brandSoft: '#EEF0FE',
  brandGradientTo: '#8B5CF6',
  teal: '#14B8A6',
  success: '#10B981',
  successSoft: '#E7F8F1',
  warn: '#F59E0B',
  warnSoft: '#FEF4E2',
  danger: '#EF4444',
  dangerSoft: '#FDECEC',
  info: '#0EA5E9',
  infoSoft: '#E5F5FE',
  flameFrom: '#F59E0B',
  flameTo: '#EF4444',
  certGold: '#F0B429',
  bg: '#F7F8FC',
  card: '#FFFFFF',
  glass: 'rgba(255,255,255,0.72)',
  text: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#94A3B8',
  line: '#E6E9F2',
  overlay: 'rgba(15,23,42,0.42)',
  rarityCommon: '#94A3B8',
  rarityRare: '#3B82F6',
  rarityEpic: '#A855F7',
  rarityLegendary: '#F0B429',
};

export const darkTheme: ThemeColors = {
  ...lightTheme,
  brand: '#6D64FF',
  brandDark: '#5750E8',
  brandSoft: '#1E2145',
  bg: '#0A0E1A',
  card: '#121826',
  glass: 'rgba(255,255,255,0.06)',
  successSoft: '#0C2B22',
  warnSoft: '#33230A',
  dangerSoft: '#331414',
  infoSoft: '#0B2638',
  text: '#F1F5F9',
  textSecondary: '#A8B0C2',
  textMuted: '#5B6478',
  line: 'rgba(255,255,255,0.08)',
  overlay: 'rgba(0,0,0,0.55)',
};

export const oledTheme: ThemeColors = {
  ...darkTheme,
  bg: '#000000',
  card: '#0B0F18',
};

export const themes: Record<ThemeName, ThemeColors> = {
  light: lightTheme,
  dark: darkTheme,
  oled: oledTheme,
};

// خط IBM Plex Sans Arabic بأوزانه — مفاتيح التحميل من @expo-google-fonts
export const fonts = {
  regular: 'IBMPlexSansArabic_400Regular',
  medium: 'IBMPlexSansArabic_500Medium',
  semibold: 'IBMPlexSansArabic_600SemiBold',
  bold: 'IBMPlexSansArabic_700Bold',
} as const;

export const typography = {
  display: { fontSize: 34, lineHeight: 42, fontFamily: fonts.bold },
  h1: { fontSize: 26, lineHeight: 34, fontFamily: fonts.bold },
  h2: { fontSize: 21, lineHeight: 28, fontFamily: fonts.semibold },
  h3: { fontSize: 17, lineHeight: 24, fontFamily: fonts.semibold },
  body: { fontSize: 15.5, lineHeight: 24, fontFamily: fonts.regular },
  bodyMed: { fontSize: 15.5, lineHeight: 24, fontFamily: fonts.medium },
  caption: { fontSize: 13, lineHeight: 18, fontFamily: fonts.medium },
  micro: { fontSize: 11, lineHeight: 14, fontFamily: fonts.medium },
  numberHero: { fontSize: 28, lineHeight: 34, fontFamily: fonts.bold },
} as const;

// مستويات مسار (وثيقة 04 §2.3)
export const levels = [
  { level: 1, threshold: 0, color: '#94A3B8' },
  { level: 2, threshold: 100, color: '#14B8A6' },
  { level: 3, threshold: 300, color: '#0EA5E9' },
  { level: 4, threshold: 700, color: '#CD7F32' },
  { level: 5, threshold: 1500, color: '#A8B0C2' },
  { level: 6, threshold: 3000, color: '#F0B429' },
  { level: 7, threshold: 6000, color: '#7DD3FC' },
  { level: 8, threshold: 12000, color: '#F0B429' },
] as const;

// فئات الدوري (وثيقة 04 §5)
export const leagueTiers = ['bronze', 'silver', 'gold', 'ruby', 'master'] as const;
export type LeagueTier = (typeof leagueTiers)[number];
export const leagueTierColors: Record<LeagueTier, string> = {
  bronze: '#B0793F',
  silver: '#A8B0C2',
  gold: '#F0B429',
  ruby: '#EF4444',
  master: '#8B5CF6',
};

// دلالات حالات الحضور — ألوان مقدسة (وثيقة 05 §2.3)
export const attendanceColors = {
  present: lightTheme.success,
  late: lightTheme.warn,
  excused: lightTheme.info,
  absent: '#64748B',
};
