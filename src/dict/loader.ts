import { Dictionary } from './dictionary';

export interface LoadedDict {
  dict: Dictionary | null;
  error: string | null;
  loadMs: number | null;
}

/**
 * Lazily fetches and parses the bundled dictionary once per service-worker instance.
 * A failed load is not cached, so a later lookup retries (e.g. after `npm run dict` + reload).
 */
export function createDictLoader(url: string, fetchImpl: typeof fetch = fetch): () => Promise<LoadedDict> {
  let pending: Promise<LoadedDict> | null = null;
  return () => {
    if (pending) return pending;
    pending = (async (): Promise<LoadedDict> => {
      const t0 = performance.now();
      try {
        const res = await fetchImpl(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const dict = Dictionary.fromJson(await res.json());
        return { dict, error: null, loadMs: Math.round(performance.now() - t0) };
      } catch (err) {
        pending = null;
        const msg = err instanceof Error ? err.message : String(err);
        return { dict: null, error: `词典未加载（${msg}）。请运行 npm run dict 后重新构建扩展。`, loadMs: null };
      }
    })();
    return pending;
  };
}
