import { describe, expect, it, vi } from 'vitest';
import { sendLl } from '../src/storage/client';
import { isLlMessage, validateRequest } from '../src/storage/protocol';
import { handleRequest, MemoryKvStore, type KvStore } from '../src/storage/router';

const sw = { instanceId: 'sw-1', startedAt: 1000 };

describe('validateRequest', () => {
  it('accepts valid messages', () => {
    expect(validateRequest({ type: 'll/kv-get', key: 'a' })).toBeNull();
    expect(validateRequest({ type: 'll/kv-put', key: 'a', value: undefined })).toBeNull();
    expect(validateRequest({ type: 'll/sw-status' })).toBeNull();
  });
  it('rejects invalid messages with reasons', () => {
    expect(validateRequest(null)).toMatch(/object/);
    expect(validateRequest({ type: 'll/nope' })).toMatch(/unknown message type/);
    expect(validateRequest({ type: 'll/kv-get', key: '' })).toMatch(/non-empty/);
    expect(validateRequest({ type: 'll/kv-get', key: 'x'.repeat(201) })).toMatch(/longer than/);
    expect(validateRequest({ type: 'll/kv-put', key: 'a' })).toMatch(/requires a value/);
  });
  it('identifies LinguaLens messages', () => {
    expect(isLlMessage({ type: 'll/kv-get' })).toBe(true);
    expect(isLlMessage({ type: 'other' })).toBe(false);
    expect(isLlMessage('ll/kv-get')).toBe(false);
  });
});

describe('handleRequest (background router)', () => {
  it('put / get / delete round trip', async () => {
    const store = new MemoryKvStore(() => 42);
    expect(await handleRequest({ type: 'll/kv-get', key: 'k' }, store, sw)).toEqual({ ok: true, data: null });
    expect(await handleRequest({ type: 'll/kv-put', key: 'k', value: { a: [1, 2] } }, store, sw)).toEqual({
      ok: true,
      data: { key: 'k', value: { a: [1, 2] }, updatedAt: 42 },
    });
    expect((await handleRequest({ type: 'll/kv-get', key: 'k' }, store, sw)) as { data: unknown }).toMatchObject({
      data: { value: { a: [1, 2] } },
    });
    await handleRequest({ type: 'll/kv-delete', key: 'k' }, store, sw);
    expect(await handleRequest({ type: 'll/kv-get', key: 'k' }, store, sw)).toEqual({ ok: true, data: null });
  });

  it('increments counters', async () => {
    const store = new MemoryKvStore();
    await handleRequest({ type: 'll/counter-increment', key: 'c' }, store, sw);
    const r = await handleRequest({ type: 'll/counter-increment', key: 'c' }, store, sw);
    expect(r).toMatchObject({ ok: true, data: { value: 2 } });
  });

  it('reports SW status with recorded starts', async () => {
    const store = new MemoryKvStore();
    await store.appendSwStart({ instanceId: 'old', startedAt: 1 });
    await store.appendSwStart(sw);
    const r = await handleRequest({ type: 'll/sw-status' }, store, sw, () => 6000);
    expect(r).toEqual({
      ok: true,
      data: { instanceId: 'sw-1', startedAt: 1000, uptimeMs: 5000, recentStarts: [{ instanceId: 'old', startedAt: 1 }, sw] },
    });
  });

  it('returns errors instead of throwing (invalid message, store failure)', async () => {
    const store = new MemoryKvStore();
    expect(await handleRequest({ type: 'll/kv-get' }, store, sw)).toEqual({ ok: false, error: 'key must be a non-empty string' });
    class FailingStore extends MemoryKvStore {
      override get(): Promise<never> {
        return Promise.reject(new DOMException('quota', 'QuotaExceededError'));
      }
    }
    const failing: KvStore = new FailingStore();
    expect(await handleRequest({ type: 'll/kv-get', key: 'x' }, failing, sw)).toEqual({ ok: false, error: 'QuotaExceededError: quota' });
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
