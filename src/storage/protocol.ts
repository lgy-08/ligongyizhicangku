/** Messages from content script -> background (service worker). */
export type LlRequest =
  | { type: 'll/kv-get'; key: string }
  | { type: 'll/kv-put'; key: string; value: unknown }
  | { type: 'll/kv-delete'; key: string }
  | { type: 'll/counter-increment'; key: string }
  | { type: 'll/sw-status' };

export type LlResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

export interface KvRecord {
  key: string;
  value: unknown;
  updatedAt: number;
}

export interface SwStartEntry {
  instanceId: string;
  startedAt: number;
}

export interface SwStatus {
  instanceId: string;
  startedAt: number;
  uptimeMs: number;
  /** Most recent service worker starts, newest last. A new entry = the SW was (re)started. */
  recentStarts: SwStartEntry[];
}

export const MAX_KEY_LENGTH = 200;

const TYPES = new Set(['ll/kv-get', 'll/kv-put', 'll/kv-delete', 'll/counter-increment', 'll/sw-status']);

/** Returns null when valid, otherwise a human-readable reason. */
export function validateRequest(msg: unknown): string | null {
  if (msg === null || typeof msg !== 'object') return 'message must be an object';
  const m = msg as Record<string, unknown>;
  if (typeof m.type !== 'string' || !TYPES.has(m.type)) return `unknown message type: ${String(m.type)}`;
  if (m.type === 'll/sw-status') return null;
  if (typeof m.key !== 'string' || m.key.length === 0) return 'key must be a non-empty string';
  if (m.key.length > MAX_KEY_LENGTH) return `key longer than ${MAX_KEY_LENGTH} characters`;
  if (m.type === 'll/kv-put' && !('value' in m)) return 'kv-put requires a value';
  return null;
}

export function isLlMessage(msg: unknown): boolean {
  return msg !== null && typeof msg === 'object' && typeof (msg as { type?: unknown }).type === 'string' &&
    ((msg as { type: string }).type).startsWith('ll/');
}
