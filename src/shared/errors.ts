/** Error taxonomy (spec §164) — user-facing category, never dump RPC internals. */
export type ErrorKind = 'user' | 'rule' | 'permission' | 'network' | 'server' | 'unknown';

export function classifyError(message: string): ErrorKind {
  const m = message.toLowerCase();
  if (/network|offline|fetch|timeout|failed to fetch/.test(m)) return 'network';
  if (/permission|unauthorized|forbidden|rls/.test(m)) return 'permission';
  if (/quota|capacity|enrolled|already|bounds|eligible/.test(m)) return 'rule';
  if (/required|invalid|must/.test(m)) return 'user';
  if (/500|internal|postgres/.test(m)) return 'server';
  return 'unknown';
}
