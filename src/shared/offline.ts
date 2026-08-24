/**
 * shared/offline.ts — Offline write queue (P0 #3 من التدقيق §8) — النسخة الصحيحة.
 *
 * إصلاحات 2026-08-24:
 *  • كانت `readStore` synchronous وترجع Map فاضية دائمًا على native
 *    (AsyncStorage غير متزامن ولم يكن يُقرأ إطلاقًا) → الطابور كله أصبح async
 *    ويُقرأ فعليًا على كل المنصات.
 *  • الأوامر تُنفَّذ الآن عبر `run_command` الخادمية (0015) التي تسجّل وتنفّذ
 *    ذرّيًا بنفس تحقق RPCs العادية — بدل التسجيل في دفتر لا يقرأه أحد.
 *  • العمليات الحساسة زمنيًا (QR check-in / التوكن الدوّار) تبقى online-only
 *    عمدًا — لا معنى لطابور توكن ينتهي خلال 25 ثانية.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export interface OfflineCommand {
  id: string;             // client-generated uuid (server idempotency key)
  command: string;        // e.g. 'submit_excuse', 'mark_notifications_read'
  payload: Record<string, unknown>;
  deviceCreatedAt: number;
  status: 'pending' | 'applied' | 'failed';
  attemptCount: number;
  lastError?: string;
}

const KEY = 'masar.offline.queue.v2';
/** أقصى محاولات قبل اعتبار الأمر فاشلًا نهائيًا (لا نعيد المحاولة للأبد). */
export const MAX_ATTEMPTS = 5;

async function readRaw(): Promise<string | null> {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    try { return localStorage.getItem(KEY); } catch { return null; }
  }
  try { return await AsyncStorage.getItem(KEY); } catch { return null; }
}

async function readStore(): Promise<Map<string, OfflineCommand>> {
  try {
    const raw = await readRaw();
    const arr: OfflineCommand[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return new Map();
    return new Map(arr.filter((c) => c && typeof c.id === 'string').map((c) => [c.id, c]));
  } catch {
    return new Map();
  }
}

async function writeStore(map: Map<string, OfflineCommand>): Promise<void> {
  const raw = JSON.stringify(Array.from(map.values()));
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    try { localStorage.setItem(KEY, raw); } catch { /* تجاوز حدود التخزين */ }
    return;
  }
  try { await AsyncStorage.setItem(KEY, raw); } catch { /* تجاهل */ }
}

export async function loadCommands(): Promise<OfflineCommand[]> {
  return Array.from((await readStore()).values());
}

/** أنشئ/حدّث أمرًا محليًا (idempotency key = uuid). */
export async function enqueueCommand(command: OfflineCommand): Promise<void> {
  const map = await readStore();
  map.set(command.id, command);
  await writeStore(map);
}

/** مساعد سريع لإنشاء أمر بمعرّف uuid وتخزينه فورًا. */
export async function pushOfflineCommand(command: string, payload: Record<string, unknown> = {}): Promise<OfflineCommand> {
  const id = globalThis.crypto?.randomUUID?.() ?? `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const cmd: OfflineCommand = {
    id, command, payload, deviceCreatedAt: Date.now(),
    status: 'pending', attemptCount: 0,
  };
  await enqueueCommand(cmd);
  return cmd;
}

export async function markApplied(id: string): Promise<void> {
  const map = await readStore();
  const c = map.get(id);
  if (c) { c.status = 'applied'; map.set(id, c); await writeStore(map); }
}

export async function markFailed(id: string, error: string, terminal = false): Promise<void> {
  const map = await readStore();
  const c = map.get(id);
  if (c) {
    c.attemptCount += 1;
    c.lastError = error;
    // terminal = رفضه الخادم بقاعدة عمل (لا معنى للإعادة). غير ذلك يبقى pending
    // ليُعاد في الدورة القادمة حتى MAX_ATTEMPTS ثم يتجمد failed.
    c.status = terminal || c.attemptCount >= MAX_ATTEMPTS ? 'failed' : 'pending';
    map.set(id, c);
    await writeStore(map);
  }
}

/** حذف الأوامر المنتهية الأقدم من يوم حتى لا ينمو السجل بلا حد. */
export async function pruneCommands(): Promise<void> {
  const map = await readStore();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let changed = false;
  for (const [id, c] of map) {
    if ((c.status === 'applied' || c.status === 'failed') && c.deviceCreatedAt < cutoff) {
      map.delete(id);
      changed = true;
    }
  }
  if (changed) await writeStore(map);
}

/** مسح الطابور بالكامل — يُستدعى عند تسجيل الخروج حتى لا تتسرب أوامر مستخدم لآخر. */
export async function clearCommands(): Promise<void> {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    try { localStorage.removeItem(KEY); } catch { /* تجاهل */ }
    return;
  }
  try { await AsyncStorage.removeItem(KEY); } catch { /* تجاهل */ }
}
