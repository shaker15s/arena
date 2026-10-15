/**
 * design/mascot/faten.palette.ts — لوحة ألوان صقر مسار «فطن» 3.0
 *
 * كل قيمة لونية للشخصية تعيش هنا فقط (لا ألوان حرفية داخل ملف الرسم).
 * النسخة الداكنة ليست «تعتيماً» — بل إعادة معايرة: ريش أفتح درجة واللمعان أقوى
 * لأن الشخصية تقف على خلفية داكنة تحتاج فصلاً بصرياً واضحاً.
 */
export interface FatenPalette {
  bodyFrom: string; bodyMid: string; bodyTo: string;
  capFrom: string; capMid: string; capTo: string;
  faceFrom: string; faceMid: string; faceTo: string;
  chestFrom: string; chestMid: string; chestTo: string;
  covertFrom: string; covertTo: string;
  primaryFrom: string; primaryTo: string;
  beakFrom: string; beakMid: string; beakTo: string;
  irisFrom: string; irisMid: string; irisTo: string;
  eyeWhite: string; eyeRing: string; pupil: string;
  blush: string;
  featherLine: string; featherShade: string;
  crestFrom: string; crestTo: string;
  aura: string; auraOpacity: number;
  shadow: string; shadowOpacity: number;
  accessoryGold: string; accessoryGoldDark: string; accessoryInk: string;
}

export const FATEN_LIGHT: FatenPalette = {
  bodyFrom: '#A26B34', bodyMid: '#7E4F23', bodyTo: '#563215',
  capFrom: '#6B421C', capMid: '#533214', capTo: '#3E240E',
  faceFrom: '#FFFFFF', faceMid: '#FDF2DF', faceTo: '#F0DCBC',
  chestFrom: '#FFFCF3', chestMid: '#FAEBCE', chestTo: '#EAD2A9',
  covertFrom: '#C08346', covertTo: '#8E5A26',
  primaryFrom: '#85531F', primaryTo: '#4B2C12',
  beakFrom: '#FFE49A', beakMid: '#F9C142', beakTo: '#CE830A',
  irisFrom: '#93DCFF', irisMid: '#0F86E6', irisTo: '#073A73',
  eyeWhite: '#FFFDF7', eyeRing: '#DFA321', pupil: '#05121F',
  blush: '#F79BB8',
  featherLine: '#E3C08C', featherShade: '#3E2410',
  crestFrom: '#6B421C', crestTo: '#A96A32',
  aura: '#F59E0B', auraOpacity: 0.2,
  shadow: '#0F172A', shadowOpacity: 0.12,
  accessoryGold: '#FBBF24', accessoryGoldDark: '#D97706', accessoryInk: '#4E2E13',
};

export const FATEN_DARK: FatenPalette = {
  bodyFrom: '#B87B3E', bodyMid: '#8E5A29', bodyTo: '#63401C',
  capFrom: '#7C4F22', capMid: '#5F3A17', capTo: '#48290F',
  faceFrom: '#FFFFFF', faceMid: '#FDF3E4', faceTo: '#F2DEC1',
  chestFrom: '#FFFDF6', chestMid: '#FBEED4', chestTo: '#EDD6AE',
  covertFrom: '#D09152', covertTo: '#9D662E',
  primaryFrom: '#95601F', primaryTo: '#57340F',
  beakFrom: '#FFE9A8', beakMid: '#FBC94E', beakTo: '#D98C12',
  irisFrom: '#A7E3FF', irisMid: '#2196F3', irisTo: '#0A4A91',
  eyeWhite: '#FFFFFF', eyeRing: '#E9B233', pupil: '#020C18',
  blush: '#F79BB8',
  featherLine: '#EBD1A4', featherShade: '#2C1B08',
  crestFrom: '#7C4F22', crestTo: '#B87B3E',
  aura: '#FBBF24', auraOpacity: 0.26,
  shadow: '#000000', shadowOpacity: 0.28,
  accessoryGold: '#FCD34D', accessoryGoldDark: '#F59E0B', accessoryInk: '#4E2E13',
};
