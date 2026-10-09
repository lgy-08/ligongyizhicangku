import { describe, expect, it, vi } from 'vitest';
import {
  apiBackend,
  BRIDGE_PROGRESS,
  BRIDGE_REQ,
  BRIDGE_RES,
  bridgeBackend,
  createBridgeHandler,
  directBackend,
  TranslatorService,
  type Availability,
  type BridgeRequest,
  type TranslatorBackend,
} from '../src/web/translator';

/** Fake of Chrome's Translator global. */
function fakeApi(opts: { availability?: Availability; createError?: Error; translate?: (t: string) => string; progress?: number[] } = {}) {
  const created = vi.fn();
  const api = {
    availability: vi.fn(async () => opts.availability ?? 'downloadable'),
    create: vi.fn(async (o: { monitor?: (m: EventTarget) => void }) => {
      created();
      if (opts.createError) throw opts.createError;
      const target = new EventTarget();
      o.monitor?.(target);
      for (const p of opts.progress ?? []) target.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded: p }));
      return { translate: vi.fn(async (t: string) => (opts.translate ?? ((x) => `译:${x}`))(t)) };
    }),
  };
  return { api, created };
}

describe('apiBackend / directBackend', () => {
  it('creates once, reports download progress, translates', async () => {
    const { api, created } = fakeApi({ progress: [0.5, 1] });
    const b = apiBackend(api);
    const progress: number[] = [];
    await b.ensure((p) => progress.push(p));
    await b.ensure(() => {});
    expect(created).toHaveBeenCalledTimes(1);
    expect(progress).toEqual([0.5, 1]);
    expect(await b.translate('hi')).toBe('译:hi');
    expect(api.availability).not.toHaveBeenCalled();
    expect(await b.availability()).toBe('downloadable');
  });
  it('allows a retry after a failed create', async () => {
    const { api } = fakeApi({ createError: Object.assign(new Error('needs gesture'), { name: 'NotAllowedError' }) });
    const b = apiBackend(api);
    await expect(b.ensure(() => {})).rejects.toThrow('needs gesture');
    await expect(b.ensure(() => {})).rejects.toThrow('needs gesture');
    expect(api.create).toHaveBeenCalledTimes(2);
  });
  it('directBackend only when a Translator global exists', () => {
    expect(directBackend({})).toBeNull();
    expect(directBackend({ Translator: fakeApi().api })!.name).toBe('direct');
  });
});

describe('TranslatorService', () => {
  const svc = (b: TranslatorBackend | null, timeout = 1000) => new TranslatorService(async () => b, timeout);

  it('checks availability, prepares once, caches results', async () => {
    const { api } = fakeApi({ progress: [0.3] });
    const b = apiBackend(api);
    const spy = vi.spyOn(b, 'translate');
    const s = svc(b);
    const progress: number[] = [];
    expect(await s.translate('  break   the ice ', (p) => progress.push(p))).toEqual({ ok: true, text: '译:break the ice' });
    expect(await s.translate('break the ice')).toEqual({ ok: true, text: '译:break the ice' });
    expect(spy).toHaveBeenCalledTimes(1); // cached
    expect(api.availability).toHaveBeenCalledTimes(1);
    expect(progress).toEqual([0.3]);
  });

  it('explains every failure in Chinese', async () => {
    expect(await svc(null).translate('x')).toMatchObject({ ok: false, reason: 'unsupported', error: expect.stringContaining('不支持') });
    expect(await svc(apiBackend(fakeApi({ availability: 'unavailable' }).api)).translate('x')).toMatchObject({ ok: false, reason: 'unavailable' });
    const gesture = apiBackend(fakeApi({ createError: Object.assign(new Error('x'), { name: 'NotAllowedError' }) }).api);
    expect(await svc(gesture).translate('x')).toMatchObject({ ok: false, reason: 'activation', error: expect.stringContaining('再点一次') });
    const slow: TranslatorBackend = {
      name: 'slow',
      availability: async () => 'available',
      ensure: async () => {},
      translate: () => new Promise(() => {}),
    };
    expect(await svc(slow, 20).translate('x')).toMatchObject({ ok: false, reason: 'timeout' });
    const broken = apiBackend(fakeApi({ translate: () => { throw new Error('boom'); } }).api);
    expect(await svc(broken).translate('x')).toMatchObject({ ok: false, reason: 'error', error: '翻译失败：boom' });
    expect(await svc(broken).translate('   ')).toMatchObject({ ok: false, error: '没有可翻译的内容' });
  });

  it('limits input length to 1500 characters', async () => {
    const seen: string[] = [];
    const s = svc(apiBackend(fakeApi({ translate: (t) => (seen.push(t), 'ok') }).api));
    await s.translate('a'.repeat(3000));
    expect(seen[0]!.length).toBe(1500);
  });
});

/** Minimal window: postMessage delivers asynchronously to every listener (both "worlds" share it). */
function fakeWindow() {
  const listeners = new Set<(e: MessageEvent) => void>();
  const win = {
    addEventListener: (_: string, fn: (e: MessageEvent) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (e: MessageEvent) => void) => listeners.delete(fn),
    postMessage: (data: unknown) => setTimeout(() => [...listeners].forEach((l) => l({ data, source: win } as unknown as MessageEvent)), 0),
  };
  return win;
}

describe('bridge (isolated world <-> MAIN world)', () => {
  function wire(api: ReturnType<typeof fakeApi>['api'] | undefined) {
    const win = fakeWindow();
    const handle = createBridgeHandler(() => api);
    win.addEventListener('message', (e) => {
      const d = e.data as BridgeRequest;
      if (d?.type === BRIDGE_REQ) void handle(d, (m) => win.postMessage(m));
    });
    return bridgeBackend(win as unknown as Window, { probe: 100, ensure: 500, call: 500 });
  }

  it('probes, prepares with progress and translates through the bridge', async () => {
    const b = wire(fakeApi({ progress: [0.25, 1] }).api);
    expect(await b.probe()).toBe(true);
    expect(await b.availability()).toBe('downloadable');
    const progress: number[] = [];
    await b.ensure((p) => progress.push(p));
    expect(progress).toEqual([0.25, 1]);
    expect(await b.translate('kind of')).toBe('译:kind of');
  });

  it('probe is false without a bridge or without the API; errors keep their name', async () => {
    expect(await bridgeBackend(fakeWindow() as unknown as Window, { probe: 30, ensure: 30, call: 30 }).probe()).toBe(false);
    expect(await wire(undefined).probe()).toBe(false);
    const b = wire(fakeApi({ createError: Object.assign(new Error('gesture'), { name: 'NotAllowedError' }) }).api);
    await expect(b.ensure(() => {})).rejects.toMatchObject({ name: 'NotAllowedError', message: 'gesture' });
  });

  it('the handler answers with matching ids and progress messages', async () => {
    const replies: object[] = [];
    const handle = createBridgeHandler(() => fakeApi({ progress: [1] }).api);
    await handle({ type: BRIDGE_REQ, id: 'a', op: 'ensure' }, (m) => replies.push(m));
    expect(replies).toEqual([
      { type: BRIDGE_PROGRESS, id: 'a', loaded: 1 },
      { type: BRIDGE_RES, id: 'a', ok: true, result: undefined },
    ]);
  });
});
