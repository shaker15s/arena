/**
 * data/syncGate.ts — بوابة مزامنة واحدة: أي trigger (reconnect/online/push) ينداء request() —
 * لا refreshين في نافذة 1.5s (dedup الـforeground storm).
 */
export class SyncGate {
  private lastAt = 0;
  private deferred = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly subs = new Set<() => void>();

  constructor(private readonly windowMs = 1500) {}

  request(): void {
    const now = Date.now();
    if (now - this.lastAt < this.windowMs) {
      if (!this.deferred) {
        this.deferred = true;
        const delay = Math.max(0, this.windowMs - (now - this.lastAt));
        this.timer = setTimeout(() => {
          this.deferred = false;
          this.lastAt = Date.now();
          const run = [...this.subs];
          run.forEach((f) => f());
        }, delay);
      }
      return;
    }
    this.lastAt = now;
    const run = [...this.subs];
    run.forEach((f) => f());
  }

  onChanged(f: () => void): () => void {
    this.subs.add(f);
    return () => {
      this.subs.delete(f);
    };
  }

  destroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.subs.clear();
  }
}
