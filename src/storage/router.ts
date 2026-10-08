import { validateRequest, type KvRecord, type LlRequest, type LlResponse, type SwStartEntry, type SwStatus } from './protocol';

/** Storage backend used by the background. The real one is IndexedDB; tests use a Map. */
export interface KvStore {
  get(key: string): Promise<KvRecord | undefined>;
  put(key: string, value: unknown): Promise<KvRecord>;
  delete(key: string): Promise<void>;
  /** Atomic read-modify-write inside one transaction. */
  increment(key: string): Promise<KvRecord>;
  appendSwStart(entry: SwStartEntry): Promise<void>;
  recentSwStarts(limit: number): Promise<SwStartEntry[]>;
}

export interface SwInfo {
  instanceId: string;
  startedAt: number;
}

export async function handleRequest(
  msg: unknown,
  store: KvStore,
  sw: SwInfo,
  now: () => number = Date.now,
): Promise<LlResponse> {
  const invalid = validateRequest(msg);
  if (invalid) return { ok: false, error: invalid };
  const req = msg as LlRequest;
  try {
    switch (req.type) {
      case 'll/kv-get':
        return { ok: true, data: (await store.get(req.key)) ?? null };
      case 'll/kv-put':
        return { ok: true, data: await store.put(req.key, req.value) };
      case 'll/kv-delete':
        await store.delete(req.key);
        return { ok: true, data: null };
      case 'll/counter-increment':
        return { ok: true, data: await store.increment(req.key) };
      case 'll/sw-status': {
        const status: SwStatus = {
          instanceId: sw.instanceId,
          startedAt: sw.startedAt,
          uptimeMs: now() - sw.startedAt,
          recentStarts: await store.recentSwStarts(10),
        };
        return { ok: true, data: status };
      }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  }
}

/** In-memory KvStore for unit tests (NOT used in the extension). */
export class MemoryKvStore implements KvStore {
  readonly map = new Map<string, KvRecord>();
  readonly starts: SwStartEntry[] = [];
  constructor(private readonly now: () => number = Date.now) {}
  async get(key: string) {
    return this.map.get(key);
  }
  async put(key: string, value: unknown) {
    const rec = { key, value, updatedAt: this.now() };
    this.map.set(key, rec);
    return rec;
  }
  async delete(key: string) {
    this.map.delete(key);
  }
  async increment(key: string) {
    const prev = this.map.get(key)?.value;
    return this.put(key, (typeof prev === 'number' ? prev : 0) + 1);
  }
  async appendSwStart(entry: SwStartEntry) {
    this.starts.push(entry);
  }
  async recentSwStarts(limit: number) {
    return this.starts.slice(-limit);
  }
}
