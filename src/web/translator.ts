/**
 * Machine translation with Chrome's built-in, on-device Translator API (en -> zh).
 * Text never leaves the computer. Results are labelled "机器翻译" in the UI and never stored as
 * dictionary definitions.
 *
 * Two backends:
 * - direct: the Translator global is reachable from the extension's isolated world;
 * - bridge: otherwise, a tiny script injected into the page's MAIN world (translator-bridge.ts)
 *   translates on our behalf over window.postMessage.
 */

export type Availability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

export const LANGS = { sourceLanguage: 'en', targetLanguage: 'zh' } as const;

export interface TranslatorBackend {
  readonly name: 'direct' | 'bridge' | string;
  availability(): Promise<Availability>;
  /** Creates the translator (downloading the language pack if needed). Needs a recent user gesture when downloadable. */
  ensure(onProgress: (loaded: number) => void): Promise<void>;
  translate(text: string): Promise<string>;
}

interface TranslatorApi {
  availability(o: typeof LANGS): Promise<Availability>;
  create(o: typeof LANGS & { monitor?: (m: EventTarget) => void }): Promise<{ translate(text: string): Promise<string> }>;
}

/** Shared by the direct backend and the MAIN-world bridge: one translator instance, created once. */
export function apiBackend(api: TranslatorApi, name = 'direct'): TranslatorBackend {
  let instance: Promise<{ translate(text: string): Promise<string> }> | null = null;
  return {
    name,
    availability: () => api.availability(LANGS),
    async ensure(onProgress) {
      instance ??= api
        .create({
          ...LANGS,
          monitor(m) {
            m.addEventListener('downloadprogress', (e) => onProgress((e as Event & { loaded: number }).loaded));
          },
        })
        .catch((err: unknown) => {
          instance = null; // allow a retry (e.g. after a user gesture)
          throw err;
        });
      await instance;
    },
    async translate(text) {
      if (!instance) throw new Error('translator not created');
      return (await instance).translate(text);
    },
  };
}

export function directBackend(g: object = globalThis): TranslatorBackend | null {
  const api = (g as { Translator?: TranslatorApi }).Translator;
  return api && typeof api.create === 'function' ? apiBackend(api, 'direct') : null;
}

// ---------- bridge (isolated world <-> MAIN world) ----------

export const BRIDGE_REQ = 'LINGUALENS_TR_REQ';
export const BRIDGE_RES = 'LINGUALENS_TR_RES';
export const BRIDGE_PROGRESS = 'LINGUALENS_TR_PROGRESS';
export type BridgeOp = 'probe' | 'availability' | 'ensure' | 'translate';

export interface BridgeRequest {
  type: typeof BRIDGE_REQ;
  id: string;
  op: BridgeOp;
  text?: string;
}

export interface BridgeBackend extends TranslatorBackend {
  /** true if the MAIN-world bridge answered and can translate. */
  probe(): Promise<boolean>;
}

/** Client side of the bridge, used from the isolated world. */
export function bridgeBackend(win: Window = window, timeouts = { probe: 800, ensure: 180_000, call: 20_000 }): BridgeBackend {
  let seq = 0;
  const request = <T>(op: BridgeOp, text: string | undefined, timeoutMs: number, onProgress?: (loaded: number) => void) =>
    new Promise<T>((resolve, reject) => {
      const id = `${Date.now().toString(36)}-${++seq}-${Math.random().toString(36).slice(2)}`;
      const timer = setTimeout(() => {
        win.removeEventListener('message', onMessage);
        reject(new Error(op === 'probe' ? 'bridge not available' : `${op} timed out`));
      }, timeoutMs);
      const onMessage = (e: MessageEvent) => {
        const d = e.data as { type?: string; id?: string; ok?: boolean; result?: unknown; error?: string; loaded?: number } | null;
        if (!d || d.id !== id) return;
        if (d.type === BRIDGE_PROGRESS && typeof d.loaded === 'number') {
          onProgress?.(d.loaded);
          return;
        }
        if (d.type !== BRIDGE_RES) return;
        clearTimeout(timer);
        win.removeEventListener('message', onMessage);
        if (d.ok) resolve(d.result as T);
        else reject(Object.assign(new Error(d.error ?? 'bridge error'), { name: (d as { name?: string }).name ?? 'Error' }));
      };
      win.addEventListener('message', onMessage);
      const req: BridgeRequest = { type: BRIDGE_REQ, id, op, ...(text !== undefined ? { text } : {}) };
      win.postMessage(req, '*');
    });
  return {
    name: 'bridge',
    probe: () => request<boolean>('probe', undefined, timeouts.probe).catch(() => false),
    availability: () => request<Availability>('availability', undefined, timeouts.call),
    ensure: (onProgress) => request<void>('ensure', undefined, timeouts.ensure, onProgress),
    translate: (text) => request<string>('translate', text, timeouts.call),
  };
}

/** MAIN-world side: answers bridge requests using the page's Translator global. */
export function createBridgeHandler(getApi: () => TranslatorApi | undefined) {
  let backend: TranslatorBackend | null = null;
  const get = () => {
    const api = getApi();
    if (!api || typeof api.create !== 'function') return null;
    backend ??= apiBackend(api, 'bridge-main');
    return backend;
  };
  return async (req: BridgeRequest, reply: (msg: object) => void): Promise<void> => {
    const respond = (ok: boolean, result?: unknown, err?: unknown) =>
      reply({
        type: BRIDGE_RES,
        id: req.id,
        ok,
        result,
        ...(err ? { error: err instanceof Error ? err.message : String(err), name: err instanceof Error ? err.name : 'Error' } : {}),
      });
    try {
      if (req.op === 'probe') return respond(true, get() !== null);
      const b = get();
      if (!b) return respond(false, undefined, new Error('Translator API not available in this page'));
      if (req.op === 'availability') return respond(true, await b.availability());
      if (req.op === 'ensure') {
        await b.ensure((loaded) => reply({ type: BRIDGE_PROGRESS, id: req.id, loaded }));
        return respond(true);
      }
      if (req.op === 'translate') return respond(true, await b.translate(String(req.text ?? '')));
      respond(false, undefined, new Error(`unknown op ${String(req.op)}`));
    } catch (err) {
      respond(false, undefined, err);
    }
  };
}

// ---------- service used by the UI ----------

export type MtFailure = 'unsupported' | 'unavailable' | 'activation' | 'timeout' | 'error';

export type MtResult = { ok: true; text: string } | { ok: false; reason: MtFailure; error: string };

export const MAX_MT_CHARS = 1500;

function failureMessage(reason: MtFailure, err?: unknown): string {
  switch (reason) {
    case 'unsupported':
      return '本机翻译不可用：当前浏览器或页面不支持 Chrome 内置翻译器。';
    case 'unavailable':
      return '本机翻译不可用：Chrome 表示这台电脑不支持英译中翻译。';
    case 'activation':
      return '首次使用需要下载翻译语言包，请再点一次（需要由点击触发）。';
    case 'timeout':
      return '翻译超时，请稍后再试。';
    default:
      return `翻译失败：${err instanceof Error ? err.message : String(err)}`;
  }
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });

/** Picks the direct backend if the isolated world has Translator, else the MAIN-world bridge if it answers. */
export async function defaultPickBackend(): Promise<TranslatorBackend | null> {
  const direct = directBackend();
  if (direct) return direct;
  const bridge = bridgeBackend();
  return (await bridge.probe()) ? bridge : null;
}

export class TranslatorService {
  private backendPromise: Promise<TranslatorBackend | null> | null = null;
  private ready = false;
  private readonly cache = new Map<string, string>();
  private static readonly CACHE_MAX = 300;

  constructor(
    private readonly pick: () => Promise<TranslatorBackend | null> = defaultPickBackend,
    private readonly timeoutMs = 20_000,
  ) {}

  /** Which backend is in use (for diagnostics), once known. */
  backendName: string | null = null;

  async translate(raw: string, onProgress?: (loaded: number) => void): Promise<MtResult> {
    const text = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_MT_CHARS);
    if (!text) return { ok: false, reason: 'error', error: '没有可翻译的内容' };
    const hit = this.cache.get(text);
    if (hit !== undefined) return { ok: true, text: hit };

    this.backendPromise ??= this.pick().catch(() => null);
    const backend = await this.backendPromise;
    this.backendName = backend?.name ?? null;
    if (!backend) return { ok: false, reason: 'unsupported', error: failureMessage('unsupported') };

    try {
      if (!this.ready) {
        const availability = await backend.availability();
        if (availability === 'unavailable') return { ok: false, reason: 'unavailable', error: failureMessage('unavailable') };
        await backend.ensure((loaded) => onProgress?.(loaded));
        this.ready = true;
      }
      const out = await withTimeout(backend.translate(text), this.timeoutMs);
      this.remember(text, out);
      return { ok: true, text: out };
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      const reason: MtFailure = name === 'NotAllowedError' ? 'activation' : name === 'TimeoutError' ? 'timeout' : 'error';
      return { ok: false, reason, error: failureMessage(reason, err) };
    }
  }

  private remember(text: string, out: string): void {
    if (this.cache.size >= TranslatorService.CACHE_MAX) {
      const first = this.cache.keys().next().value;
      if (first !== undefined) this.cache.delete(first);
    }
    this.cache.set(text, out);
  }
}
