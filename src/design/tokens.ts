/**
 * design/tokens.ts — المصدر الوحيد للألوان/التايب/المسافات (وثيقة 05)
 * تصميم أبل الزجاجي (Liquid Glass) — فخامة وشفافية وسلاسة
 * ممنوع أي لون أو مسافة أو خط حرفي خارج هذا الملف.
 */

export const spacing = {
  s1: 4, s2: 8, s3: 12, s4: 16, s5: 20, s6: 24, s8: 32, s10: 40, s12: 48,
} as const;

export const radii = {
  xl: 32,      // شاشات وحوارات — Apple-style أكبر
  card: 24,    // بطاقات — أكبر وأنعم
  cardSm: 18,  // بطاقات صغيرة
  button: 16,  // أزرار
  pill: 999,   // Chips/حبوب
} as const;

export const sizes = {
  iconSmall: 36,
  iconMedium: 48,
  iconLarge: 76,
  avatarSmall: 32,
  avatarMedium: 48,
  avatarLarge: 72,
  qrCode: 200,
  touchTarget: 44, // الحد الأدنى الموصى به من Apple لإمكانية الوصول
} as const;

/** إعدادات الـ Springs المعتمدة من Apple Fluid Interfaces (WWDC) */
export const springs = {
  default: { damping: 22, stiffness: 260, mass: 1 }, // Critically damped
  bouncy: { damping: 15, stiffness: 180, mass: 1 },  // Momentum / flick
  snappy: { damping: 26, stiffness: 320, mass: 0.8 }, // Fast transitions
} as const;

export type ThemeName = 'light' | 'dark' | 'oled';

export interface ThemeColors {
  brand: string;
  brandDark: string;
  brandSoft: string;
  brandGradientFrom: string;
  brandGradientTo: string;
  brandGradientMid: string;
  teal: string;
  success: string;
  successSoft: string;
  warn: string;
  warnSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;
  infoSoft: string;
  flameFrom: string;
  flameTo: string;
  certGold: string;
  bg: string;
  bgGradientFrom: string;
  bgGradientTo: string;
  card: string;
  glass: string;
  glassHeavy: string;
  glassBorder: string;
  glassShadow: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  line: string;
  overlay: string;
  rarityCommon: string;
  rarityRare: string;
  rarityEpic: string;
  rarityLegendary: string;
  // Apple-specific
  cardElevated: string;
  surfaceGlass: string;
  backdropBlur: string;
  separator: string;
}

export const lightTheme: ThemeColors = {
  brand: '#007AFF',
  brandDark: '#0055D4',
  brandSoft: '#E8F2FF',
  brandGradientFrom: '#007AFF',
  brandGradientTo: '#5856D6',
  brandGradientMid: '#5E5CE6',
  teal: '#30D158',
  success: '#34C759',
  successSoft: '#E8F9ED',
  warn: '#FF9F0A',
  warnSoft: '#FFF4E5',
  danger: '#FF3B30',
  dangerSoft: '#FFECEB',
  info: '#5AC8FA',
  infoSoft: '#E5F5FE',
  flameFrom: '#FF9F0A',
  flameTo: '#FF3B30',
  certGold: '#FFB800',
  bg: '#F5F5FA',
  bgGradientFrom: '#FAFBFF',
  bgGradientTo: '#EEEEF6',
  card: '#FFFFFF',
  glass: 'rgba(255, 255, 255, 0.72)',
  glassHeavy: 'rgba(255, 255, 255, 0.85)',
  glassBorder: 'rgba(255, 255, 255, 0.5)',
  glassShadow: 'rgba(0, 0, 0, 0.06)',
  text: '#1C1C1E',
  textSecondary: '#3C3C43',
  textMuted: '#8E8E93',
  line: 'rgba(60, 60, 67, 0.12)',
  overlay: 'rgba(0, 0, 0, 0.4)',
  rarityCommon: '#8E8E93',
  rarityRare: '#007AFF',
  rarityEpic: '#AF52DE',
  rarityLegendary: '#FF9F0A',
  cardElevated: 'rgba(255, 255, 255, 0.9)',
  surfaceGlass: 'rgba(255, 255, 255, 0.65)',
  backdropBlur: 'rgba(249, 249, 249, 0.94)',
  separator: 'rgba(60, 60, 67, 0.1)',
};

export const darkTheme: ThemeColors = {
  ...lightTheme,
  brand: '#0A84FF',
  brandDark: '#0066CC',
  brandSoft: '#0D1F3C',
  brandGradientFrom: '#0A84FF',
  brandGradientTo: '#5E5CE6',
  brandGradientMid: '#5E5CE6',
  teal: '#30D158',
  bg: '#000000',
  bgGradientFrom: '#1C1C1E',
  bgGradientTo: '#000000',
  card: '#1C1C1E',
  glass: 'rgba(28, 28, 30, 0.72)',
  glassHeavy: 'rgba(28, 28, 30, 0.88)',
  glassBorder: 'rgba(84, 84, 88, 0.35)',
  glassShadow: 'rgba(0, 0, 0, 0.3)',
  successSoft: '#0D2818',
  warnSoft: '#2D1F00',
  dangerSoft: '#2D0A08',
  infoSoft: '#0A1E2E',
  text: '#FFFFFF',
  textSecondary: '#EBEBF5',
  textMuted: '#8E8E93',
  line: 'rgba(84, 84, 88, 0.25)',
  overlay: 'rgba(0, 0, 0, 0.65)',
  cardElevated: 'rgba(44, 44, 46, 0.8)',
  surfaceGlass: 'rgba(28, 28, 30, 0.65)',
  backdropBlur: 'rgba(22, 22, 24, 0.94)',
  separator: 'rgba(84, 84, 88, 0.2)',
};

export const oledTheme: ThemeColors = {
  ...darkTheme,
  bg: '#000000',
  bgGradientFrom: '#0A0A0A',
  bgGradientTo: '#000000',
  card: '#0C0C0E',
  glass: 'rgba(12, 12, 14, 0.78)',
  glassHeavy: 'rgba(12, 12, 14, 0.92)',
};

export const themes: Record<ThemeName, ThemeColors> = {
  light: lightTheme,
  dark: darkTheme,
  oled: oledTheme,
};

// خط IBM Plex Sans Arabic بأوزانه
export const fonts = {
  regular: 'IBMPlexSansArabic_400Regular',
  medium: 'IBMPlexSansArabic_500Medium',
  semibold: 'IBMPlexSansArabic_600SemiBold',
  bold: 'IBMPlexSansArabic_700Bold',
} as const;

export const typography = {
  display: { fontSize: 36, lineHeight: 44, fontFamily: fonts.bold },
  h1: { fontSize: 28, lineHeight: 36, fontFamily: fonts.bold },
  h2: { fontSize: 22, lineHeight: 28, fontFamily: fonts.semibold },
  h3: { fontSize: 17, lineHeight: 24, fontFamily: fonts.semibold },
  body: { fontSize: 15.5, lineHeight: 24, fontFamily: fonts.regular },
  bodyMed: { fontSize: 15.5, lineHeight: 24, fontFamily: fonts.medium },
  caption: { fontSize: 13, lineHeight: 18, fontFamily: fonts.medium },
  micro: { fontSize: 11, lineHeight: 14, fontFamily: fonts.medium },
  numberHero: { fontSize: 32, lineHeight: 40, fontFamily: fonts.bold },
} as const;

// مستويات مسار (وثيقة 04 §2.3)
export const levels = [
  { level: 1, threshold: 0, color: '#8E8E93' },
  { level: 2, threshold: 100, color: '#30D158' },
  { level: 3, threshold: 300, color: '#5AC8FA' },
  { level: 4, threshold: 700, color: '#CD7F32' },
  { level: 5, threshold: 1500, color: '#C7C7CC' },
  { level: 6, threshold: 3000, color: '#FFB800' },
  { level: 7, threshold: 6000, color: '#BF5AF2' },
  { level: 8, threshold: 12000, color: '#FF375F' },
] as const;

// فئات الدوري (وثيقة 04 §5)
export const leagueTiers = ['bronze', 'silver', 'gold', 'ruby', 'master'] as const;
export type LeagueTier = (typeof leagueTiers)[number];
export const leagueTierColors: Record<LeagueTier, string> = {
  bronze: '#CD7F32',
  silver: '#C7C7CC',
  gold: '#FFB800',
  ruby: '#FF375F',
  master: '#BF5AF2',
};

// دلالات حالات الحضور — ألوان مقدسة (وثيقة 05 §2.3)
export const attendanceColors = {
  present: lightTheme.success,
  late: lightTheme.warn,
  excused: lightTheme.info,
  absent: '#8E8E93',
};

// ═══════════════ Apple Glass Utilities ═══════════════
export const glassEffects = {
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.5)',
    borderRadius: 24,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 } as const,
    elevation: 8,
  },
  cardDark: {
    backgroundColor: 'rgba(28, 28, 30, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(84, 84, 88, 0.35)',
    borderRadius: 24,
  },
  elevated: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    borderRadius: 24,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 12 } as const,
    elevation: 12,
  },
  tabBar: {
    backgroundColor: 'rgba(249, 249, 249, 0.94)',
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(60, 60, 67, 0.12)',
  },
  tabBarDark: {
    backgroundColor: 'rgba(22, 22, 24, 0.94)',
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(84, 84, 88, 0.25)',
  },
} as const;
