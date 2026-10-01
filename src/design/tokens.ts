/**
 * design/tokens.ts — المصدر الوحيد للألوان/التايب/المسافات (وثيقة 05)
 * تصميم أبل الزجاجي (Liquid Glass) — فخامة وشفافية وسلاسة
 */

/**
 * مقياس المسافات الموحّد (DS-01) — نظام واحد فقط: `sN = N × 4px`
 * (هو نفسه المقياس الرقمي في Tailwind). كان عندنا نظامان متوازيان للقيم نفسها
 * (`s4` = `md` = 16) فتباينت الشاشات حسب ذوق كل مطوّر؛ حُذفت الأسماء المكرّرة
 * (xs/sm/md/lg/xl) وحُوِّلت كل الاستخدامات إلى هذا المقياس.
 */
export const spacing = {
  s1: 4, s2: 8, s3: 12, s4: 16, s5: 20, s6: 24, s7: 28, s8: 32, s9: 36, s10: 40, s11: 44, s12: 48,
} as const;

/**
 * مقياس أنصاف الأقطار الموحّد (DS-02) — سلسلة واحدة متصاعدة بلا تكرار:
 * 8 → 12 → 16 → 24 → 32 → ∞.
 * كانت المشاكل: `lg` و`cardSm` كلاهما 18 (تكرار)، و`pill`/`full` تكرار ثانٍ،
 * و`button:16` يكسر ترتيب المقياس (جاء بعد 18). التحويلات المنفّذة على الريبو:
 * button/cardSm → lg، card → xl، xl القديم (32) → xxl، pill → full.
 */
export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  full: 999,
} as const;

export const sizes = {
  iconSmall: 36,
  iconMedium: 48,
  iconLarge: 76,
  avatarSmall: 32,
  avatarMedium: 48,
  avatarLarge: 72,
  qrCode: 200,
  minTarget: 24, // الحد الأدنى الإلزامي WCAG 2.5.8 AA
  touchTarget: 44, // الحد الأدنى الموصى به من Apple لإمكانية الوصول
  iconButton: 44, // معيار أزرار الأيقونات 44×44pt
  ctaButton: 52, // معيار Apple HIG للأزرار التفاعلية الأساسية
  timeField: 64, // حقل ساعة/دقيقة (4 أرقام + مسافة) — يبقى فوق 44px لمسًا
  /** أقصى عرض لإطار المحتوى على الويب/التابلت (ContentFrame) */
  contentMaxWidth: 1120,
} as const;

/**
 * سماكات الحدود الموحّدة (DS-03) — كانت تُكتب حرفيًا: 1 تارة و0.5 تارة بلا قاعدة.
 * hairline للأسطح الزجاجية الخفيفة، thin للبطاقات، medium للحالة المركّزة/الخطأ، thick للأوسمة.
 */
export const borderWidth = {
  hairline: 0.5,
  thin: 1,
  medium: 1.5,
  thick: 2,
} as const;

/**
 * وصفات الظلال الموحّدة (DS-03) — كان كل مكوّن يخترع ظلًا لنفسه
 * (البطاقة 0.07/22، الفقاعة 0.05/16، المبدّل 0.2/5، التبويب 0.05/8).
 * لون الظل يأتي دائمًا من `theme.glassShadow`، وهنا تُضبط الشدة والنصف والإزاحة.
 */
export const shadows = {
  /** بطاقة قياسية — الظل على الداكن أعمق ليظهر على الخلفية الداكنة */
  card: {
    light: { shadowOpacity: 0.07, shadowRadius: 22, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
    dark: { shadowOpacity: 0.28, shadowRadius: 22, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  },
  /** فقاعة إحصائية زجاجية (StatBubble) */
  bubble: { shadowOpacity: 0.05, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  /** عنصر تحكم مرفوع فوق حشوة (تبويب Segmented النشط) */
  control: { shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 0 },
  /** قرص المبدّل (Switch thumb) */
  thumb: { shadowOpacity: 0.2, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  /** اللوح السفلي — ظل صاعد */
  sheet: { shadowOpacity: 0.28, shadowRadius: 36, shadowOffset: { width: 0, height: -12 }, elevation: 0 },
} as const;

/**
 * شدّات الضبابية الموحّدة (GL-01) — كان الويب blur(20px) لسطح وblur(16px) لآخر.
 * سطح زجاجي واحد = قيمة واحدة.
 */
export const blurIntensity = {
  /** backdrop-filter على الويب — موحّدة لكل الأسطح الزجاجية */
  webSurface: 20,
  /** BlurView الأصلي للأسطح العائمة الافتراضية */
  surface: 40,
  /** بطاقة زجاجية ثقيلة (hero/عائم) */
  heavyCard: { light: 42, dark: 34 },
  /** خلفية اللوح السفلي */
  sheet: { light: 12, dark: 20 },
} as const;

/** مناطق اللمس الموسّعة hitSlop (DS-03) — كانت أرقامًا حرفية متفرقة (4/6/8/10/12) */
export const hitSlop = {
  tight: 4,
  small: 6,
  default: 8,
  comfy: 10,
  generous: 12,
} as const;

/**
 * كرات الخلفية المحيطة (GL-02) — مقاسات ومواضع قياسية موحّدة.
 * أي خلفية جديدة تختار من هنا فقط — ممنوع أرقام سحرية جديدة.
 */
export const orbs = {
  size: { lg: 460, md: 420, sm: 230 },
  position: {
    topRight: { top: -190, right: -115 },
    bottomLeft: { bottom: -180, left: -160 },
    midLeft: { top: '36%' as const, left: -90 },
  },
} as const;

/**
 * مقاسات المكوّنات (CMP-01) — كل الأرقام التي كانت hardcoded داخل المكوّنات
 * (Chip/Tag/Segmented/Input/ListRow/Switch/Stars...). مكوّن جديد يقرأ من هنا.
 */
export const componentTokens = {
  chip: { minHeight: 40, paddingHorizontal: 14, paddingVertical: 9, gap: 6, iconSize: 14 },
  tag: { paddingHorizontal: 10, paddingVertical: 5, gap: 4, iconSize: 12 },
  segmented: { padding: 3, paddingVertical: 9, gap: 6, iconSize: 14 },
  input: {
    minHeight: 54,
    minHeightMultiline: 96,
    paddingHorizontal: 16,
    paddingVertical: 4,
    paddingVerticalMultiline: 12,
    gap: 10,
    iconSize: 20,
  },
  listRow: { minHeight: 68, padding: 14, gap: 12, iconBox: 40, iconSize: 19 },
  switch: {
    width: 52,
    height: 31,
    radius: 16,
    thumb: 26,
    thumbPressed: 31,
    thumbRadius: 13,
    travelStart: 2.5,
    travelEnd: 23,
  },
  stars: { gap: 2 },
  backButton: { size: 44, radius: 15 },
  emptyState: { iconBox: 92, iconBoxRadius: 30, emojiSize: 44 },
  sheet: { maxWidth: 620, grabberWidth: 44, grabberHeight: 5 },
} as const;

/** سلّم الارتفاع والظلال الموحّد (DESIGN 1.2) */
export const elevation = {
  0: { shadowColor: 'transparent', shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0 },
  1: { shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  2: { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  3: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 10 },
  4: { shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 32, shadowOffset: { width: 0, height: 16 }, elevation: 16 },
  none: { shadowColor: 'transparent', shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0 },
  sm: { shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  md: { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  lg: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 10 },
  modal: { shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 32, shadowOffset: { width: 0, height: 16 }, elevation: 16 },
} as const;

/** سلّم الطبقات الرأسية الموحّد (DESIGN 1.2) */
export const zIndex = {
  base: 0,
  sticky: 10,
  header: 20,
  dropdown: 25,
  fab: 30,
  overlay: 35,
  sheet: 40,
  modal: 50,
  toast: 60,
} as const;

/**
 * شريط التبويبات العائم — الأبعاد الثابتة لحساب الحجز السفلي الواحد (DESIGN 1.2).
 * الحجز = الارتفاع + (بار FAB؟ ارتفاع بروزه) + max(safeArea, minPad) —
 * مصدر الحقيقة الوحيد بدل أرقام 104/130 المتناثرة على الشاشات.
 */
export const navBar = {
  height: 68,
  minPad: 8,
  fabPoke: 27,
} as const;

/**
 * توكنز التخطيط المتجاوب (LAYOUT-01) — مصدر واحد للمقاسات.
 *
 * المشكلة التي عولجت: كل شاشة كانت تخمّن عدد الأعمدة بنفسها (صفوف `Row` فيها
 * 4 بطاقات `flex:1`)، فعند عرض 320–360pt ينكمش العمود إلى ~62px بينما الحد
 * الأدنى لمحتواه (أيقونة 46 + حشوة 32) = 78px ⇒ يتجاوز العمودُ عرضه، فتتكدّس
 * البطاقات ويقصّ النص وتخرج العناصر عن الشاشة.
 * القاعدة الجديدة: **أي مجموعة بطاقات متجاورة توضع في `AutoGrid`** وتعلن أدنى
 * عرض عمود لها؛ والمكوّن يقيس عرضه الحقيقي (`onLayout`) ويختار عدد الأعمدة.
 */
export const layout = {
  /** نقاط التوقف المرجعية (pt) — للقراءة والتوثيق والقرارات داخل الشاشات */
  breakpoints: { narrow: 360, compact: 430, tablet: 768, desktop: 1024 },
  /** المسافة الجانبية للمحتوى حسب ضيق الشاشة */
  gutters: { narrow: 14, base: 20, roomy: 24, wide: 32 },
  /**
   * أدنى عرض عمود مقبول لكل نوع بطاقة = الحد الأدنى لمحتواها (أيقونة/نص + حشوة).
   * أقل من هذا الرقم يبدأ القصّ والالتفاف القبيح، لذا تنزل الشبكة لعمود أقل.
   */
  minColumn: { stat: 74, action: 78, wide: 140 },
} as const;

/**
 * عدد الأعمدة الذي يتّسع فعلًا لعرض معطى (LAYOUT-01).
 *
 * دالة نقية (بلا React Native) حتى تختبرها `scripts/layout.test.ts` مباشرة:
 *   • لا تختار أبدًا عدد أعمدة يجعل أي عمود أضيق من `minColumnWidth`.
 *   • تختار أكبر عدد ممكن (لا تترك مساحة ميتة).
 *   • لا تتجاوز عدد العناصر (عمود فارغ = ثقب في التصميم).
 *   • تتجنب «اليتيم»: 4 عناصر في 3 أعمدة تترك عنصرًا وحيدًا في الصف الثاني،
 *     فتنزل إلى عمودين (2×2 متوازنة) — أثبتت تجارب أبل أن الشبكة المتوازنة
 *     تُقرأ أسرع من صف ناقص.
 */
export function columnsFor(
  width: number,
  count: number,
  minColumnWidth: number,
  gap: number,
): number {
  if (!Number.isFinite(width) || width <= 0 || count <= 0) return 1;
  const total = Math.floor(count);
  const fit = Math.floor((width + gap) / (minColumnWidth + gap));
  const base = Math.max(1, Math.min(total, fit));
  if (base > 1 && total % base === 1) return base - 1;
  return base;
}

/** درجات الزجاج القياسية (DESIGN 1.3) */
export const glassLevels = {
  thin: { intensity: 20, opacityLight: 0.55, opacityDark: 0.58 },
  subtle: { intensity: 20, opacityLight: 0.55, opacityDark: 0.58 },
  regular: { intensity: 40, opacityLight: 0.72, opacityDark: 0.72 },
  thick: { intensity: 64, opacityLight: 0.88, opacityDark: 0.88 },
  heavy: { intensity: 64, opacityLight: 0.88, opacityDark: 0.88 },
  fallback: { intensity: 0, opacityLight: 0.94, opacityDark: 0.94 },
} as const;

/** توكنز الحركة الموحّدة (DESIGN-06) */
export const motionTokens = {
  duration: {
    instant: 80,
    fast: 160,
    normal: 240,
    slow: 380,
  },
  easing: {
    standard: [0.2, 0, 0, 1] as const,
    decelerate: [0, 0, 0.2, 1] as const,
    accelerate: [0.4, 0, 1, 1] as const,
  },
} as const;

/** خاصية الأرقام الجدولية الموحّدة للعدادات والجداول (DESIGN 1.5) */
export const tabularNums = {
  fontVariant: ['tabular-nums'] as ('tabular-nums')[],
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
  /** لون التمايز الثانوي (Amber/مسار) — D2 */
  accent: string;
  accentDark: string;
  accentSoft: string;
  accentGradientFrom: string;
  accentGradientTo: string;
  onBrand: string;
  onSuccess: string;
  onDark: string;
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
  /** خلفية ذهبية ناعمة لحظة أهلية/حصول الشهادة */
  certSoft: string;
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
  /**
   * A11Y-20/21 — طبقة النصوص الدلالية.
   * كل لون هنا مضمون ≥ 4.5:1 على الخلفيتين `card` و`bg` في الثيم نفسه.
   * الألوان العلامية (brand/success/warn/danger/accent) تبقى للخلفيات والحدود
   * والأيقونات ونصوص العرض الكبيرة؛ أما **النصوص الصغيرة** فتستخدم هذه الطبقة.
   * البوابة: `node scripts/check-contrast.js` تفشل لو انكسر أي زوج.
   */
  textSuccess: string;
  textWarn: string;
  textDanger: string;
  textAccent: string;
  /** أزرق نصّي يمرّ 4.5:1 (لروابط ونصوص brand) */
  brandText: string;
  /** خلفية الزر الأساسي — مضمونة مع `onBrand` الأبيض ≥ 4.5:1 */
  actionPrimary: string;
  actionPrimaryTo: string;
  /** خلفيات الإجراءات الدلالية — مضمونة مع نص أبيض ≥ 4.5:1 */
  actionSuccess: string;
  actionDanger: string;
  /**
   * لون حلقة التركيز (WCAG 2.4.7 / 2.4.13 / 1.4.11): يجب ≥ 3:1 مع الخلفية.
   * القيمة تُطبَّق في CSS الويب (public/index.html) أيضًا، وبوابة check-a11y.js
   * تفشل إن تباعدت القيمتان — مصدر واحد للحقيقة.
   */
  focusRing: string;
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
  /** حشوة تحكم خفيفة (chips، segmented، أزرار ثانوية، حقول) */
  fill: string;
  /** حشوة تحكم أثقل (داكن دائمًا أعمق) */
  fillStrong: string;
  /** حد الحشوات الخفيفة */
  fillBorder: string;
  /** كرات الخلفية المحيطة — الأزرق والبنفسجي والأخضر */
  orbPrimary: string;
  orbSecondary: string;
  orbTertiary: string;
}

export const lightTheme: ThemeColors = {
  brand: '#007AFF',
  brandDark: '#0055D4',
  brandSoft: '#E8F2FF',
  brandGradientFrom: '#007AFF',
  brandGradientTo: '#5856D6',
  brandGradientMid: '#5E5CE6',
  accent: '#F59E0B',
  accentDark: '#D97706',
  accentSoft: '#FEF3C7',
  accentGradientFrom: '#F59E0B',
  accentGradientTo: '#EA580C',
  onBrand: '#FFFFFF',
  onSuccess: '#FFFFFF',
  onDark: '#FFFFFF',
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
  certSoft: 'rgba(255, 215, 0, 0.18)',
  bg: '#F5F5FA',
  bgGradientFrom: '#FAFBFF',
  bgGradientTo: '#EEEEF6',
  card: '#FFFFFF',
  glass: 'rgba(255, 255, 255, 0.72)',
  glassHeavy: 'rgba(255, 255, 255, 0.85)',
  glassBorder: 'rgba(255, 255, 255, 0.5)',
  // لون الظل الخام — تُضبط شدته عبر shadowOpacity من توكنز `shadows` (CMP-02).
  // كانت rgba بألفا مدمجة ولا تُستخدم فعليًا؛ المكوّنات كانت تكتب '#000' حرفيًا.
  glassShadow: '#000000',
  text: '#1C1C1E',
  textSecondary: '#3C3C43',
  // كان #8E8E93 = 3.26:1 على الأبيض و3.00:1 على bg (يخالف WCAG 1.4.3) → #6E6E73 = 5.07:1 / 4.67:1
  textMuted: '#6E6E73',
  textSuccess: '#1F7A36',
  textWarn: '#B45309',
  textDanger: '#C0392B',
  textAccent: '#A8440A',
  brandText: '#0055D4',
  actionPrimary: '#0066CC',
  actionPrimaryTo: '#4B49C8',
  actionSuccess: '#1F7A36',
  actionDanger: '#C0392B',
  focusRing: '#0066CC',
  line: 'rgba(60, 60, 67, 0.12)',
  overlay: 'rgba(0, 0, 0, 0.4)',
  rarityCommon: '#6E6E73',
  rarityRare: '#007AFF',
  rarityEpic: '#AF52DE',
  rarityLegendary: '#FF9F0A',
  cardElevated: 'rgba(255, 255, 255, 0.9)',
  surfaceGlass: 'rgba(255, 255, 255, 0.65)',
  backdropBlur: 'rgba(249, 249, 249, 0.94)',
  separator: 'rgba(60, 60, 67, 0.18)',
  fill: 'rgba(120, 120, 128, 0.12)',
  fillStrong: 'rgba(120, 120, 128, 0.2)',
  fillBorder: 'rgba(60, 60, 67, 0.15)',
  orbPrimary: 'rgba(0, 122, 255, 0.085)',
  orbSecondary: 'rgba(88, 86, 214, 0.065)',
  orbTertiary: 'rgba(48, 209, 88, 0.035)',
};

export const darkTheme: ThemeColors = {
  ...lightTheme,
  brand: '#0A84FF',
  brandDark: '#0066CC',
  brandSoft: '#0D1F3C',
  brandGradientFrom: '#0A84FF',
  brandGradientTo: '#5E5CE6',
  brandGradientMid: '#5E5CE6',
  accent: '#FBBF24',
  accentDark: '#F59E0B',
  accentSoft: '#451A03',
  accentGradientFrom: '#FBBF24',
  accentGradientTo: '#F59E0B',
  teal: '#30D158',
  bg: '#000000',
  certSoft: 'rgba(255, 215, 0, 0.12)',
  bgGradientFrom: '#1C1C1E',
  bgGradientTo: '#000000',
  card: '#1C1C1E',
  glass: 'rgba(28, 28, 30, 0.72)',
  glassHeavy: 'rgba(28, 28, 30, 0.88)',
  glassBorder: 'rgba(84, 84, 88, 0.35)',
  glassShadow: '#000000',
  successSoft: '#0D2818',
  warnSoft: '#2D1F00',
  dangerSoft: '#2D0A08',
  infoSoft: '#0A1E2E',
  text: '#FFFFFF',
  textSecondary: '#EBEBF5',
  // #8E8E93 على #1C1C1E = 5.22:1 لكنه يهبط على بطاقات أوضح؛ #AEAEB2 = 7.69:1
  textMuted: '#AEAEB2',
  textSuccess: '#30D158',
  textWarn: '#FF9F0A',
  textDanger: '#FF453A',
  textAccent: '#FBBF24',
  brandText: '#6FB3FF',
  // DS-06: ألوان أزرار التعبئة كانت مُعايرة للخلفية الفاتحة فتبدو «ميتة» على الداكن.
  // القيم الجديدة أفتح وأكثر حيوية، وكلها مضمونة ≥ 4.5:1 مع النص الأبيض
  // (primary 4.78 / success 4.52 / danger 4.83 — بوابة check-contrast تتحقق).
  actionPrimary: '#0070E0',
  actionPrimaryTo: '#4B49C8',
  actionSuccess: '#108930',
  actionDanger: '#D92D20',
  focusRing: '#6FB3FF',
  line: 'rgba(84, 84, 88, 0.25)',
  overlay: 'rgba(0, 0, 0, 0.65)',
  cardElevated: 'rgba(44, 44, 46, 0.8)',
  surfaceGlass: 'rgba(28, 28, 30, 0.65)',
  backdropBlur: 'rgba(22, 22, 24, 0.94)',
  separator: 'rgba(84, 84, 88, 0.2)',
  fill: 'rgba(120, 120, 128, 0.24)',
  fillStrong: 'rgba(120, 120, 128, 0.32)',
  fillBorder: 'rgba(84, 84, 88, 0.3)',
  orbPrimary: 'rgba(10, 132, 255, 0.12)',
  orbSecondary: 'rgba(94, 92, 230, 0.1)',
  orbTertiary: 'rgba(48, 209, 88, 0.055)',
};

export const oledTheme: ThemeColors = {
  ...darkTheme,
  bg: '#000000',
  bgGradientFrom: '#0A0A0A',
  bgGradientTo: '#000000',
  card: '#0C0C0E',
  glass: 'rgba(12, 12, 14, 0.78)',
  glassHeavy: 'rgba(12, 12, 14, 0.92)',
  // DS-07: على الأسود الخالص كانت حدود/فواصل/حشوات الداكن العادي أفتح من اللازم
  // فتُزعج العين — نخفتها هنا (ألوان النصوص تبقى كما هي حفاظًا على التباين ≥ 4.5).
  glassBorder: 'rgba(84, 84, 88, 0.22)',
  cardElevated: 'rgba(24, 24, 26, 0.8)',
  surfaceGlass: 'rgba(12, 12, 14, 0.65)',
  backdropBlur: 'rgba(8, 8, 10, 0.94)',
  separator: 'rgba(84, 84, 88, 0.14)',
  line: 'rgba(84, 84, 88, 0.15)',
  fill: 'rgba(120, 120, 128, 0.16)',
  fillStrong: 'rgba(120, 120, 128, 0.24)',
  fillBorder: 'rgba(84, 84, 88, 0.2)',
};

export const themes: Record<ThemeName, ThemeColors> = {
  light: lightTheme,
  dark: darkTheme,
  oled: oledTheme,
};

/** ورق الشهادة — ألوان ثابتة عبر الثيمات (تطابق قالب PDF المُصدَّر) */
export const certPaper = {
  bg: '#FFFDF5',
  ink: '#3D2B00',
  inkSoft: '#7A5C00',
  inkMuted: '#95804A',
  line: '#E8D9A8',
} as const;

// خط IBM Plex Sans Arabic بأوزانه
export const fonts = {
  regular: 'IBMPlexSansArabic_400Regular',
  medium: 'IBMPlexSansArabic_500Medium',
  semibold: 'IBMPlexSansArabic_600SemiBold',
  bold: 'IBMPlexSansArabic_700Bold',
} as const;

/**
 * سلم التايبوغرافيا — مضبوط للعربية:
 * - أحجام أصغر وأكثر توازنًا (كانت كبيرة فوق الحد على الموبايل).
 * - line-height أوسع نسبيًا حتى لا تُقطع الحروف العربية (امتدادات صاعدة/نازلة + تشكيل).
 * - لا قيم كسرية في الحجم حتى لا يهتز رسم الحروف.
 */
export const typography = {
  display: { fontSize: 30, lineHeight: 40, fontFamily: fonts.bold },
  h1: { fontSize: 24, lineHeight: 33, fontFamily: fonts.bold },
  h2: { fontSize: 20, lineHeight: 29, fontFamily: fonts.semibold },
  // DS-05: كان 16 — يفصله 1px فقط عن body (15) فلا يُقرأ كعنوان. الآن 17 لهرمية أوضح.
  h3: { fontSize: 17, lineHeight: 26, fontFamily: fonts.semibold },
  body: { fontSize: 15, lineHeight: 24, fontFamily: fonts.regular },
  bodyMed: { fontSize: 15, lineHeight: 24, fontFamily: fonts.medium },
  caption: { fontSize: 13, lineHeight: 20, fontFamily: fonts.medium },
  micro: { fontSize: 11, lineHeight: 17, fontFamily: fonts.medium },
  numberHero: { fontSize: 28, lineHeight: 36, fontFamily: fonts.bold },
  // DS-v2 (خطة الإصلاح 2026-10-01): أرقام بطاقات KPI — أصغر من numberHero
  // ولها الوزن نفسه — تُستخدم في التقارير ومركز الإحصائيات (tabular-nums).
  numberCard: { fontSize: 18, lineHeight: 24, fontFamily: fonts.semibold },
} as const;

/** سلّم التايبوغرافيا القياسي مع ربط lineHeight ≥ 1.45 للعربية (DESIGN 1.4) */
export const typeScale = {
  xs: typography.micro,
  sm: typography.caption,
  md: typography.body,
  lg: typography.h3,
  xl: typography.h2,
  h1: typography.h1,
  display: typography.display,
} as const;

/**
 * مقياس واجهة حسب عرض الشاشة — علاج «الأبعاد كبيرة على بعض المقاسات».
 * القاعدة عرض 390pt (iPhone 14/15). نقلّص على الشاشات الضيقة جدًا (SE/Android 360pt)
 * ونكبّر قليلًا جدًا على التابلت، مع حدود ضيقة حتى لا ينكسر التخطيط.
 * ملاحظة عربية: النتائج تُقرَّب لأعداد صحيحة — القيم الكسرية تجعل رسم الحروف
 * العربية يهتز ويقصّ الامتدادات على أندرويد.
 */
export const BASE_WIDTH = 390;

export function uiScale(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 1;
  const raw = width / BASE_WIDTH;
  return Math.min(1.08, Math.max(0.92, raw));
}

/** يقيس حجم/ارتفاع سطر النص مع تقريب صحيح وحد أدنى مقروء (11px). */
/**
 * معامل حجم النص الذي يختاره المستخدم (FUNC-10 / WCAG 1.4.4).
 * يُضبط من `design/preferences.tsx` ويُقرأ هنا حتى يُطبَّق على كل نص في التطبيق
 * بلا لمس أي شاشة.
 */
let userTextScale = 1;
export function setTextScale(scale: number): void {
  userTextScale = Math.min(1.5, Math.max(1, Number.isFinite(scale) ? scale : 1));
}
export function getTextScale(): number {
  return userTextScale;
}

export function scaleType(
  base: { fontSize: number; lineHeight: number },
  width: number,
): { fontSize: number; lineHeight: number } {
  const k = uiScale(width) * userTextScale;
  if (k === 1) return { fontSize: base.fontSize, lineHeight: base.lineHeight };
  const fontSize = Math.max(11, Math.round(base.fontSize * k));
  // نحافظ على نسبة السطر الأصلية (مهمة للعربية) بدل تقليصها بشكل مستقل.
  const ratio = base.lineHeight / base.fontSize;
  return { fontSize, lineHeight: Math.round(fontSize * ratio) };
}

/** يقيس مسافة/حشوة بنفس المعامل — للحفاظ على الإيقاع البصري. */
export function scaleSpace(value: number, width: number): number {
  return Math.round(value * uiScale(width));
}

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
  absent: '#6E6E73',
};

// ═══════════════ Apple Glass Utilities ═══════════════
export const glassEffects = {
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.5)',
    borderRadius: radii.xl,
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
    borderRadius: radii.xl,
  },
  elevated: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    borderRadius: radii.xl,
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
