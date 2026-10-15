/**
 * design/mascot/faten.lines.ts — محرّك حديث فطن (Dialogue Engine)
 *
 * لماذا محرّك منفصل؟ لأن «الشخصية» في أي تطبيق تفشل لسبب واحد: تكرار.
 * المستخدم يسمع نفس الجملة عشر مرات فيكفّ عن قراءتها. هنا نطبّق ثلاث قواعد:
 *
 *   1. **لا تكرار مباشر**: آخر جملتين لكل حالة مُستبعدتان من الاختيار.
 *   2. **المتغيّرات السياقية**: الاسم، عدد الأسابيع، اسم الشارة، اسم الكورس…
 *      فتشعر أن فطن يعرفك فعلًا (نفس أسلوب دوولينجو).
 *   3. **الحكمة الزمنية**: التحيّة تتبع وقت اليوم، ونصيحة اليوم ثابتة طوال اليوم
 *      (محسوبة من رقم اليوم) بدل أن تتغيّر مع كل ضغطة.
 *
 * المحرّك نقي (بلا React ولا React Native) فيُختبر في بيئة Node مباشرة.
 */
import { tStatic, type DictKey } from '../../i18n/core';
import { FatenBehaviorState } from './mascot.types';

export interface FatenLineContext {
  name?: string;
  streakWeeks?: number;
  points?: number;
  badgeTitle?: string;
  courseTitle?: string;
  minutes?: number;
  remaining?: number;
  neededForCert?: number;
  tier?: string;
  title?: string;
  room?: string;
  hour?: number;
}

/** عدد الجمل المكتوبة لكل حالة في القواميس */
const LINES_PER_STATE = 6;

/** آخر جملتين قيلتا لكل حالة — لمنع التكرار المباشر */
const recentLines: Partial<Record<FatenBehaviorState, string[]>> = {};

/** ترتيب دوراني لكل حالة حتى لا تعتمد التجربة على الحظ وحده */
const rotation: Partial<Record<FatenBehaviorState, number>> = {};

function lineKeyFor(state: FatenBehaviorState, index: number): DictKey {
  return `faten.line.${state}.${index}` as DictKey;
}

/**
 * أسماء المتغيّرات المطلوبة لكل جملة حتى لا نعرض «{name}» خامًا لمستخدم بلا اسم.
 * (عيب حقيقي: أي متغيّر غير مُعبّأ يظهر للمستخدم بين قوسين، فنستبعده قبل الاختيار.)
 */
function varsResolvable(text: string, ctx: FatenLineContext): boolean {
  const found = text.match(/\{(\w+)\}/g) ?? [];
  for (const raw of found) {
    const key = raw.slice(1, -1) as keyof FatenLineContext;
    const value = ctx[key];
    if (value === undefined || value === null || value === '') return false;
  }
  return true;
}

const VAR_MAP: Record<string, string> = {
  name: 'name', streakWeeks: 'weeks', points: 'points', badgeTitle: 'badge',
  courseTitle: 'course', minutes: 'minutes', remaining: 'remaining',
  neededForCert: 'n', tier: 'tier', title: 'title', room: 'room',
};

function fill(text: string, ctx: FatenLineContext): string {
  return text.replace(/\{(\w+)\}/g, (_, key: string) => {
    const mapKey = VAR_MAP[key];
    const value = mapKey ? (ctx as Record<string, unknown>)[mapKey] : undefined;
    return value === undefined || value === null ? '' : String(value);
  });
}

/**
 * اختيار جملة فطن المناسبة للحالة الحالية.
 * @param state الحالة الشعورية
 * @param ctx سياق المستخدم الحقيقي (اسمه، ستريكه، شهادته…)
 * @param options `avoidContextVars` لمنع الجمل التي تحتاج متغيّرات (مثل شارات الحالة الفارغة)
 */
export function pickFatenLine(
  state: FatenBehaviorState,
  ctx: FatenLineContext = {},
  options: { avoidContextVars?: boolean } = {},
): string {
  const total = LINES_PER_STATE;
  const recent = recentLines[state] ?? [];
  const start = (rotation[state] ?? 0) % total;

  const candidates: Array<{ key: DictKey; text: string; index: number }> = [];
  for (let offset = 0; offset < total; offset += 1) {
    const index = ((start + offset) % total) + 1;
    const key = lineKeyFor(state, index);
    const text = tStatic(key);
    if (!text || text === key) continue;
    if (options.avoidContextVars && !varsResolvable(text, {})) continue;
    if (!varsResolvable(text, ctx)) continue;
    candidates.push({ key, text, index });
  }

  // لا بديل مطابق للسياق ⇒ نرجّع أول جملة ثابتة (بلا متغيّرات) للحالة
  if (candidates.length === 0) {
    for (let index = 1; index <= total; index += 1) {
      const key = lineKeyFor(state, index);
      const text = tStatic(key);
      if (varsResolvable(text, {})) return fill(text, ctx);
    }
    return '';
  }

  const fresh = candidates.filter((c) => !recent.includes(c.key));
  const pool = fresh.length > 0 ? fresh : candidates;
  const chosen = pool[0];

  recentLines[state] = [chosen.key, ...recent].slice(0, 2);
  rotation[state] = chosen.index % total;
  return fill(chosen.text, ctx);
}

/** تحية فطن بحسب وقت اليوم (تُستخدم عند فتح التطبيق أو أول زيارة للشاشة) */
export function pickFatenGreeting(ctx: FatenLineContext = {}): string {
  const hour = ctx.hour ?? new Date().getHours();
  if (ctx.name) {
    if (hour >= 4 && hour < 12) return fill(tStatic('faten.msg.goodMorning'), ctx);
    if (hour >= 17 || hour < 4) return fill(tStatic('faten.msg.goodEvening'), ctx);
    return fill(tStatic('faten.msg.appOpen'), ctx);
  }
  return fill(tStatic('faten.msg.appOpenNoName'), ctx);
}

const TIP_COUNT = 14;

/**
 * نصيحة اليوم: ثابتة داخل اليوم نفسه، ومتغيّرة يوميًا.
 * (لا عشوائية ⇒ لا «قفزات» عند إعادة الرسم ولا نصائح متضاربة في نفس الجلسة.)
 */
export function tipOfTheDay(seed = 0, now = Date.now()): string {
  const dayIndex = Math.floor(now / 86_400_000);
  const index = Math.abs(dayIndex + seed) % TIP_COUNT + 1;
  const key = `faten.tip.${index}` as DictKey;
  const text = tStatic(key);
  return text && text !== key ? text : '';
}

/** نصيحة جديدة (للضغط اليدوي على فطن) — تتقدّم في القائمة بلا تكرار فوري */
let tipCursor = -1;
export function nextTip(now = Date.now()): string {
  if (tipCursor < 0) {
    tipCursor = Math.abs(Math.floor(now / 86_400_000)) % TIP_COUNT;
  }
  tipCursor = (tipCursor + 1) % TIP_COUNT;
  const key = `faten.tip.${tipCursor + 1}` as DictKey;
  const text = tStatic(key);
  return text && text !== key ? text : '';
}

/** إعادة ضبط الذاكرة — تُستخدم في الاختبارات */
export function resetFatenDialogueMemory(): void {
  for (const key of Object.keys(recentLines)) delete recentLines[key as FatenBehaviorState];
  for (const key of Object.keys(rotation)) delete rotation[key as FatenBehaviorState];
  tipCursor = -1;
}
