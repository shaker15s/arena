/**
 * shared/offline.ts — Offline write queue (P0 #3 from the audit §8).
 *
 * The app previously had NO offline-write path: critical writes were gated on
 * `online`, and nothing was durable. This module persists a per-device command
 * log (AsyncStorage on native, localStorage on web) and replays it through the
 * idempotent server RPCs `enqueue_command` / `finish_command` once connectivity
 * returns. Time-sensitive operations (QR check-in / rotating token) still stay
 * online-only by design — there is no point queueing a token that expires in 25s.
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

const KEY = 'masar.offline.queue.v1';

function platformKey(): string {
  return Platform.OS === 'web' ? KEY : KEY;
}

function readStore(): Map<string, OfflineCommand> {
  try {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(KEY);
      const arr: OfflineCommand[] = raw ? JSON.parse(raw) : [];
      return new Map(arr.map((c) => [c.id, c]));
    }
    return new Map<string, OfflineCommand>();
  } catch {
    return new Map();
  }
}

async function writeStore(map: Map<string, OfflineCommand>): Promise<void> {
  const arr = Array.from(map.values());
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch { /* تجاهل */ }
    return;
  }
  try { await AsyncStorage.setItem(KEY, JSON.stringify(arr)); } catch { /* تجاهل */ }
}

export async function loadCommands(): Promise<OfflineCommand[]> {
  return Array.from(readStore().values());
}

/** أنشئ أمرًا محليًا آمنًا (idempotency key = uuid) وخزّنه. إعادته لنفس id يُحدّثه بدل الدمج. */
export async function enqueueCommand(command: OfflineCommand): Promise<void> {
  const map = readStore();
  map.set(command.id, command);
  await writeStore(map);
}

/** مساعد سريع لإنشاء أمر بمعرّف uuid. */
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
  const map = readStore();
  const c = map.get(id);
  if (c) { c.status = 'applied'; map.set(id, c); }
  await writeStore(map);
}

export async function markFailed(id: string, error: string): Promise<void> {
  const map = readStore();
  const c = map.get(id);
  if (c) { c.status = 'failed'; c.lastError = error; c.attemptCount += 1; map.set(id, c); }
  await writeStore(map);
}

/** Drop applied commands older than a day so the log doesn't grow unbounded. */
export async function pruneCommands(): Promise<void> {
  const map = readStore();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, c] of map) {
    if ((c.status === 'applied' || c.status === 'failed') && c.deviceCreatedAt < cutoff) map.delete(id);
  }
  await writeStore(map);
}
