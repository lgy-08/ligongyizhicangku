import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { sendLl } from '../src/storage/client';
import { createIdbStore, DB_NAME } from '../src/storage/idb-store';
import { isLlMessage, validateRequest, type LookupResult } from '../src/storage/protocol';
import { handleRequest, LAST_EXPORT_KEY, type RouterDeps, type Store } from '../src/storage/router';
import type { BackupFile } from '../src/vocab/backup';
import { DEFAULT_SETTINGS } from '../src/vocab/types';
import { fixtureDict } from './helpers/dict-fixture';

const sw = { instanceId: 'sw-1', startedAt: 1000 };
const DAY = 86_400_000;

function setup(overrides: Partial<RouterDeps> = {}) {
  // Router and store share one clock, so record timestamps and "now" agree.
  const store = createIdbStore(new IDBFactory(), { now: overrides.now });
  const deps: RouterDeps = {
    store,
    sw,
    appVersion: '0.0.1',
    getDict: async () => ({ dict: fixtureDict(), error: null }),
    ...overrides,
  };
  const req = <T = unknown>(msg: unknown) => handleRequest(msg, deps) as Promise<{ ok: true; data: T } | { ok: false; error: string }>;
  return { store, deps, req };
}

const data = <T>(r: { ok: boolean; data?: T; error?: string }): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`);
  return r.data as T;
};

describe('validateRequest', () => {
  it('accepts valid messages', () => {
    for (const m of [
      { type: 'll/kv-get', key: 'a' },
      { type: 'll/kv-put', key: 'a', value: undefined },
      { type: 'll/sw-status' },
      { type: 'll/lookup', word: 'Running' },
      { type: 'll/annotate', words: ['a', 'b'] },
      { type: 'll/vocab-set', lemma: 'run', status: 'known' },
      { type: 'll/vocab-set', lemma: "don't", status: null, word: "Don't" },
      { type: 'll/custom-def-set', lemma: 'run', text: '' },
      { type: 'll/settings-set', settings: {} },
      { type: 'll/import', data: null },
      { type: 'll/reminder-dismiss', disable: false },
      { type: 'll/export' },
    ]) {
      expect(validateRequest(m), JSON.stringify(m)).toBeNull();
    }
  });
  it('rejects invalid messages with reasons', () => {
    expect(validateRequest(null)).toMatch(/object/);
    expect(validateRequest({ type: 'll/nope' })).toMatch(/unknown message type/);
    expect(validateRequest({ type: 'll/kv-get', key: '' })).toMatch(/non-empty/);
    expect(validateRequest({ type: 'll/kv-get', key: 'x'.repeat(201) })).toMatch(/longer than/);
    expect(validateRequest({ type: 'll/kv-put', key: 'a' })).toMatch(/requires a value/);
    expect(validateRequest({ type: 'll/lookup', word: '' })).toMatch(/word/);
    expect(validateRequest({ type: 'll/annotate', words: [1] })).toMatch(/non-empty string/);
    expect(validateRequest({ type: 'll/annotate', words: Array(20_001).fill('a') })).toMatch(/too many/);
    expect(validateRequest({ type: 'll/vocab-set', lemma: 'Run', status: 'known' })).toMatch(/lowercase/);
    expect(validateRequest({ type: 'll/vocab-set', lemma: 'run', status: 'maybe' })).toMatch(/status/);
    expect(validateRequest({ type: 'll/custom-def-set', lemma: 'run', text: 'x'.repeat(2001) })).toMatch(/2000/);
    expect(validateRequest({ type: 'll/reminder-dismiss' })).toMatch(/boolean/);
    expect(validateRequest({ type: 'll/lookup', word: 'a', context: { text: 'a', wordIndex: -1 } })).toMatch(/context/);
    expect(validateRequest({ type: 'll/lookup', word: 'a', context: { text: '', wordIndex: 0 } })).toMatch(/context/);
    expect(validateRequest({ type: 'll/phrase-lookup', text: 'a b', from: 2, to: 1 })).toMatch(/from <= to/);
    expect(validateRequest({ type: 'll/phrase-lookup', text: 'x', from: 0, to: 12 })).toMatch(/at most 12/);
    expect(validateRequest({ type: 'll/phrase-lookup', text: 'x'.repeat(501), from: 0, to: 1 })).toMatch(/text/);
    expect(validateRequest({ type: 'll/phrase-lookup', text: 'give up', from: 0, to: 1 })).toBeNull();
  });
  it('identifies LinguaLens messages', () => {
    expect(isLlMessage({ type: 'll/kv-get' })).toBe(true);
    expect(isLlMessage({ type: 'other' })).toBe(false);
    expect(isLlMessage('ll/kv-get')).toBe(false);
  });
});

describe('IndexedDB store (fake-indexeddb)', () => {
  it('kv round trip and atomic increment', async () => {
    const { store } = setup();
    expect(await store.get('k')).toBeUndefined();
    await store.put('k', { a: [1] });
    expect((await store.get('k'))!.value).toEqual({ a: [1] });
    await store.increment('c');
    expect((await store.increment('c')).value).toBe(2);
    await store.delete('k');
    expect(await store.get('k')).toBeUndefined();
  });

  it('keeps only the last 50 SW start entries', async () => {
    const { store } = setup();
    for (let i = 0; i < 55; i++) await store.appendSwStart({ instanceId: `i${i}`, startedAt: i });
    const recent = await store.recentSwStarts(100);
    expect(recent).toHaveLength(50);
    expect(recent.at(-1)!.instanceId).toBe('i54');
  });

  it('vocab: preserves createdAt across updates, null deletes, batch get', async () => {
    const { store } = setup();
    const first = (await store.setVocab('run', 'unknown', 'running'))!;
    await new Promise((r) => setTimeout(r, 5));
    const second = (await store.setVocab('run', 'known'))!;
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
    expect(second.lastWord).toBe('running');
    await store.setVocab('go', 'learning');
    const many = await store.getVocabMany(['run', 'go', 'absent']);
    expect([...many.keys()].sort()).toEqual(['go', 'run']);
    expect(await store.setVocab('run', null)).toBeNull();
    expect((await store.listVocab()).map((v) => v.lemma)).toEqual(['go']);
  });

  it('custom definitions: set, trim, delete with empty text', async () => {
    const { store } = setup();
    expect((await store.setCustomDef('zorg', '  外星词  '))!.text).toBe('外星词');
    expect((await store.getCustomDef('zorg'))!.text).toBe('外星词');
    expect(await store.setCustomDef('zorg', '   ')).toBeNull();
    expect(await store.listCustomDefs()).toEqual([]);
  });

  it('upgrades a v1 (LL-001) database without losing data', async () => {
    const factory = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const req = factory.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('kv', { keyPath: 'key' });
        req.result.createObjectStore('sw_log', { autoIncrement: true });
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put({ key: 'll001-counter', value: 3, updatedAt: 1 });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
      req.onerror = () => reject(req.error);
    });
    const store = createIdbStore(factory);
    expect((await store.get('ll001-counter'))!.value).toBe(3);
    await store.setVocab('run', 'known');
    expect((await store.listVocab()).length).toBe(1);
  });
});

describe('handleRequest: dictionary + vocabulary', () => {
  it('lookup: running -> run with entries, vocab and custom definition', async () => {
    const { req } = setup();
    await req({ type: 'll/vocab-set', lemma: 'run', status: 'learning', word: 'running' });
    await req({ type: 'll/custom-def-set', lemma: 'run', text: '我的释义' });
    const r = data<LookupResult>(await req({ type: 'll/lookup', word: 'Running' }));
    expect(r).toMatchObject({
      query: 'Running',
      word: 'running',
      lemma: 'run',
      method: 'exchange',
      dictAvailable: true,
      dictError: null,
      custom: { lemma: 'run', text: '我的释义' },
      vocab: { lemma: 'run', status: 'learning', lastWord: 'running' },
    });
    expect(r.lemmaEntry!.translation).toContain('跑');
    expect(r.wordEntry!.translation).toBe('n. 赛跑'); // "running" is itself a headword
  });

  it('lookup: word missing from the dictionary -> no entries (UI shows 暂无释义)', async () => {
    const { req } = setup();
    const r = data<LookupResult>(await req({ type: 'll/lookup', word: 'blorptastic' }));
    expect(r).toMatchObject({ lemma: 'blorptastic', method: 'none', lemmaEntry: null, wordEntry: null, custom: null, vocab: null });
  });

  it('lookup without dictionary still works and explains why', async () => {
    const { req } = setup({ getDict: async () => ({ dict: null, error: '词典未加载（HTTP 404）' }) });
    const r = data<LookupResult>(await req({ type: 'll/lookup', word: 'ran' }));
    expect(r).toMatchObject({ lemma: 'ran', dictAvailable: false, dictError: '词典未加载（HTTP 404）', lemmaEntry: null });
    expect((await req({ type: 'll/lookup', word: "'" })).ok).toBe(false);
  });

  it('lookup with line context also returns the phrases containing the word', async () => {
    const { req } = setup();
    const r = data<LookupResult>(await req({ type: 'll/lookup', word: 'gave', context: { text: 'I gave up, kind of', wordIndex: 1 } }));
    expect(r.lemma).toBe('give');
    expect(r.phrases.map((p) => [p.phrase, p.entry.translation])).toEqual([['give up', '放弃, 停止']]);
    const none = data<LookupResult>(await req({ type: 'll/lookup', word: 'I', context: { text: 'I gave up', wordIndex: 0 } }));
    expect(none.phrases).toEqual([]);
    const noCtx = data<LookupResult>(await req({ type: 'll/lookup', word: 'gave' }));
    expect(noCtx.phrases).toEqual([]);
  });

  it('phrase-lookup: whole selection, inner phrases, or nothing', async () => {
    const { req } = setup();
    const text = 'As a matter of fact I gave up, kind of';
    expect(data(await req({ type: 'll/phrase-lookup', text, from: 6, to: 7 }))).toMatchObject({
      selection: 'gave up',
      match: { phrase: 'give up', entry: { translation: '放弃, 停止' } },
      inner: [],
      dictAvailable: true,
    });
    const inner = data<{ match: unknown; inner: { phrase: string }[] }>(await req({ type: 'll/phrase-lookup', text, from: 0, to: 6 }));
    expect(inner.match).toBeNull();
    expect(inner.inner.map((p) => p.phrase)).toEqual(['as a matter of fact']);
    expect(data(await req({ type: 'll/phrase-lookup', text, from: 4, to: 5 }))).toMatchObject({ selection: 'fact I', match: null, inner: [] });
  });

  it('phrase-lookup without dictionary explains why', async () => {
    const { req } = setup({ getDict: async () => ({ dict: null, error: '词典未加载' }) });
    expect(data(await req({ type: 'll/phrase-lookup', text: 'give up', from: 0, to: 1 }))).toMatchObject({
      match: null,
      dictAvailable: false,
      dictError: '词典未加载',
    });
  });

  it('define returns dictionary meanings for many words (vocabulary book)', async () => {
    const { req } = setup();
    expect(data(await req({ type: 'll/define', words: ['run', 'give up', 'zzz'] }))).toEqual({
      entries: {
        run: { phonetic: 'rʌn', translation: 'v. 跑\nn. 跑步' },
        'give up': { phonetic: '', translation: '放弃, 停止' },
      },
      dictAvailable: true,
      dictError: null,
    });
    const noDict = setup({ getDict: async () => ({ dict: null, error: '词典未加载' }) });
    expect(data(await noDict.req({ type: 'll/define', words: ['run'] }))).toEqual({ entries: {}, dictAvailable: false, dictError: '词典未加载' });
    expect(validateRequest({ type: 'll/define', words: 'run' })).toMatch(/array/);
  });

  it('annotate maps every surface form to lemma, status, rank', async () => {
    const { req } = setup();
    await req({ type: 'll/vocab-set', lemma: 'run', status: 'unknown' });
    const a = data<Record<string, unknown>>(await req({ type: 'll/annotate', words: ['ran', 'Running', 'go', 'zzz'] }));
    expect(a).toEqual({
      ran: { lemma: 'run', status: 'unknown', rank: 300, inDict: true },
      Running: { lemma: 'run', status: 'unknown', rank: 300, inDict: true },
      go: { lemma: 'go', status: null, rank: 50, inDict: true },
      zzz: { lemma: 'zzz', status: null, rank: null, inDict: false },
    });
  });

  it('settings: defaults, sanitized updates', async () => {
    const { req } = setup();
    expect(data(await req({ type: 'll/settings-get' }))).toEqual(DEFAULT_SETTINGS);
    expect(data(await req({ type: 'll/settings-set', settings: { pauseOnLookup: true, backupReminderDays: 'x' } }))).toEqual({
      ...DEFAULT_SETTINGS,
      pauseOnLookup: true,
    });
    expect(data(await req({ type: 'll/settings-get' }))).toMatchObject({ pauseOnLookup: true });
  });
});

describe('handleRequest: export / import (JSON with version)', () => {
  it('export -> import into a fresh profile restores everything', async () => {
    const a = setup();
    await a.req({ type: 'll/vocab-set', lemma: 'run', status: 'known', word: 'ran' });
    await a.req({ type: 'll/vocab-set', lemma: 'go', status: 'learning' });
    await a.req({ type: 'll/custom-def-set', lemma: 'zorg', text: '外星词' });
    await a.req({ type: 'll/settings-set', settings: { highlightRare: true } });
    const backup = data<BackupFile>(await a.req({ type: 'll/export' }));
    expect(backup).toMatchObject({ format: 'lingualens-backup', schemaVersion: 1, appVersion: '0.0.1' });
    expect(backup.vocab.map((v) => v.lemma)).toEqual(['go', 'run']);
    expect((await a.store.get(LAST_EXPORT_KEY))!.value).toEqual(expect.any(Number));

    const b = setup();
    const json = JSON.parse(JSON.stringify(backup));
    expect(data(await b.req({ type: 'll/import', data: json }))).toEqual({
      vocab: { added: 2, updated: 0, unchanged: 0 },
      customDefinitions: { added: 1, updated: 0, unchanged: 0 },
      skipped: [],
      settingsImported: true,
    });
    expect((await b.store.listVocab()).map((v) => [v.lemma, v.status]).sort()).toEqual([
      ['go', 'learning'],
      ['run', 'known'],
    ]);
    expect(data(await b.req({ type: 'll/settings-get' }))).toMatchObject({ highlightRare: true });
    // Importing the same file again changes nothing.
    expect(data(await b.req({ type: 'll/import', data: json }))).toMatchObject({ vocab: { added: 0, updated: 0, unchanged: 2 } });
  });

  it('import keeps newer local records', async () => {
    const { req, store } = setup();
    await store.putMany([{ lemma: 'run', status: 'known', createdAt: 1, updatedAt: 5000 }], []);
    const r = data(
      await req({
        type: 'll/import',
        data: { format: 'lingualens-backup', schemaVersion: 1, vocab: [{ lemma: 'run', status: 'unknown', createdAt: 1, updatedAt: 10 }] },
      }),
    );
    expect(r).toMatchObject({ vocab: { added: 0, updated: 0, unchanged: 1 }, settingsImported: false });
    expect((await store.listVocab())[0]!.status).toBe('known');
  });

  it('import rejects invalid files with a clear error', async () => {
    const { req } = setup();
    expect(await req({ type: 'll/import', data: { format: 'x' } })).toMatchObject({ ok: false, error: expect.stringContaining('不是 LinguaLens 备份文件') });
  });
});

describe('handleRequest: backup reminder', () => {
  it('reminds once after the period, then stays quiet; dismiss can disable', async () => {
    let now = Date.now();
    const { req } = setup({ now: () => now });
    expect(data(await req({ type: 'll/reminder-check' }))).toMatchObject({ remind: false }); // no data yet
    await req({ type: 'll/vocab-set', lemma: 'run', status: 'known' });
    expect(data(await req({ type: 'll/reminder-check' }))).toMatchObject({ remind: false }); // too early
    now += 31 * DAY;
    expect(data(await req({ type: 'll/reminder-check' }))).toEqual({ remind: true, daysSinceExport: 31 });
    expect(data(await req({ type: 'll/reminder-check' }))).toMatchObject({ remind: false }); // already shown
    now += 31 * DAY;
    await req({ type: 'll/reminder-dismiss', disable: true });
    expect(data(await req({ type: 'll/reminder-check' }))).toMatchObject({ remind: false });
    expect(data(await req({ type: 'll/settings-get' }))).toMatchObject({ backupReminderDays: 0 });
  });

  it('exporting resets the reminder clock', async () => {
    let now = Date.now();
    const { req } = setup({ now: () => now });
    await req({ type: 'll/vocab-set', lemma: 'run', status: 'known' });
    now += 40 * DAY;
    await req({ type: 'll/export' });
    now += 5 * DAY;
    expect(data(await req({ type: 'll/reminder-check' }))).toEqual({ remind: false, daysSinceExport: 5 });
  });
});

describe('handleRequest: diagnostics + errors', () => {
  it('reports SW status with recorded starts', async () => {
    const { req, store, deps } = setup();
    await store.appendSwStart({ instanceId: 'old', startedAt: 1 });
    await store.appendSwStart(sw);
    const r = await handleRequest({ type: 'll/sw-status' }, { ...deps, now: () => 6000 });
    expect(r).toEqual({ ok: true, data: { instanceId: 'sw-1', startedAt: 1000, uptimeMs: 5000, recentStarts: [{ instanceId: 'old', startedAt: 1 }, sw] } });
    expect(data(await req({ type: 'll/counter-increment', key: 'c' }))).toMatchObject({ value: 1 });
  });

  it('returns errors instead of throwing', async () => {
    const { deps } = setup();
    expect(await handleRequest({ type: 'll/kv-get' }, deps)).toEqual({ ok: false, error: 'key must be a non-empty string' });
    const failing: Store = { ...deps.store, listVocab: () => Promise.reject(new DOMException('quota', 'QuotaExceededError')) };
    expect(await handleRequest({ type: 'll/vocab-list' }, { ...deps, store: failing })).toEqual({ ok: false, error: 'QuotaExceededError: quota' });
    expect(await handleRequest({ type: 'll/open-options' }, deps)).toEqual({ ok: false, error: 'openOptions not available' });
  });
});

describe('sendLl (content-script client)', () => {
  it('passes through responses', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, data: 1 });
    expect(await sendLl(send, { type: 'll/sw-status' })).toEqual({ ok: true, data: 1 });
  });
  it('converts transport errors (e.g. invalidated context) to ok:false', async () => {
    const send = vi.fn().mockRejectedValue(new Error('Extension context invalidated.'));
    expect(await sendLl(send, { type: 'll/sw-status' })).toEqual({ ok: false, error: 'Extension context invalidated.' });
  });
  it('flags empty responses (no listener answered)', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await sendLl(send, { type: 'll/sw-status' })).toMatchObject({ ok: false });
  });
  it('times out', async () => {
    vi.useFakeTimers();
    const p = sendLl(() => new Promise(() => {}), { type: 'll/sw-status' }, 1000);
    vi.advanceTimersByTime(1001);
    expect(await p).toEqual({ ok: false, error: 'no response within 1000ms' });
    vi.useRealTimers();
  });
});
