/**
 * design/mascot/mascot.tokens.ts — لوحة ألوان وهوية صقر مسار «فطن»
 */

export const mascotTokens = {
  light: {
    featherPrimary: '#B45309',       // بني صقري دافئ وأصيل
    featherSecondary: '#D97706',     // تدرج ريش ذهبي كهرماني
    featherHighlight: '#FDE68A',     // لمعان الريش الفاتح
    chestPlumage: '#FFFBEB',         // ريش الصدر النقي
    beakPrimary: '#F59E0B',          // منقار ذهبي حاد
    beakShadow: '#D97706',
    eyeIris: '#0284C7',              // عين ثاقبة زرقاء كلون البراند
    eyePupil: '#0F172A',
    auraGlow: 'rgba(245, 158, 11, 0.25)',
    platformBg: 'rgba(245, 158, 11, 0.12)',
    platformBorder: 'rgba(245, 158, 11, 0.35)',
    flameGradFrom: '#F59E0B',
    flameGradTo: '#DC2626',
    successAura: 'rgba(16, 185, 129, 0.25)',
    alertAura: 'rgba(249, 115, 22, 0.25)',
  },
  dark: {
    featherPrimary: '#D97706',
    featherSecondary: '#F59E0B',
    featherHighlight: '#FEF3C7',
    chestPlumage: '#1E293B',
    beakPrimary: '#FBBF24',
    beakShadow: '#D97706',
    eyeIris: '#38BDF8',
    eyePupil: '#020617',
    auraGlow: 'rgba(245, 158, 11, 0.35)',
    platformBg: 'rgba(245, 158, 11, 0.16)',
    platformBorder: 'rgba(245, 158, 11, 0.45)',
    flameGradFrom: '#FBBF24',
    flameGradTo: '#EF4444',
    successAura: 'rgba(16, 185, 129, 0.35)',
    alertAura: 'rgba(249, 115, 22, 0.35)',
  },
  physics: {
    idleFloatDurationMs: 4200,       // تنفس هادئ متباعد
    blinkIntervalMs: 4800,           // رمش طبيعي كل ~5 ثوانٍ
    gestureDurationMs: 380,          // إيماءة لمرة واحدة عند الحدث
    tapSquashScale: 0.94,
    reactionFadeDurationMs: 250,
  },
} as const;