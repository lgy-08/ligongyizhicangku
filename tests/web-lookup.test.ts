// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CallFn } from '../src/content/card-controller';
import { createIdbStore } from '../src/storage/idb-store';
import type { LlRequest } from '../src/storage/protocol';
import { handleRequest } from '../src/storage/router';
import { WebLookup } from '../src/web/web-lookup';
import { fixtureDict } from './helpers/dict-fixture';

function rig() {
  const store = createIdbStore(new IDBFactory());
  const deps = { store, sw: { instanceId: 'x', startedAt: 0 }, appVersion: 't', getDict: async () => ({ dict: fixtureDict(), error: null }) };
  const calls: LlRequest[] = [];
  const call: CallFn = async (msg) => {
    calls.push(msg);
    return (await handleRequest(msg, deps)) as never;
  };
  const web = new WebLookup(call, { noticeMs: 20 });
  return { web, store, calls };
}

/** Selects [start, end) of the first text node of `el`, then releases the mouse on it. */
function selectAndRelease(el: Element, start: number, end: number, button = 0) {
  const text = el.firstChild as Text;
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, end);
  const sel = document.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button }));
}

const until = async (fn: () => boolean) => {
  for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 5));
};

let r: ReturnType<typeof rig>;
beforeEach(async () => {
  document.body.innerHTML =
    '<p id="p">We are looking forward to it, honestly I gave up.</p><input id="in" value="give up"><pre id="code">give up</pre>';
  r = rig();
  await r.web.start();
});
afterEach(() => r.web.dispose());

describe('WebLookup', () => {
  it('a selected word opens the word card, with phrases from the surrounding text', async () => {
    const p = document.getElementById('p')!;
    const text = p.textContent!;
    const s = text.indexOf('looking');
    selectAndRelease(p, s, s + 7);
    await until(() => !!r.web.store.get().card?.result);
    const card = r.web.store.get().card!;
    expect(card).toMatchObject({ kind: 'word', word: 'looking', result: { lemma: 'look' } });
    expect(card.result!.phrases.map((x) => x.phrase)).toEqual(['look forward to']);
    expect(card.target).toMatchObject({ lineKey: 'web', from: 2, to: 2 });
  });

  it('selecting several words opens the phrase card (lemmas allowed)', async () => {
    const p = document.getElementById('p')!;
    const s = p.textContent!.indexOf('gave up');
    selectAndRelease(p, s, s + 7);
    await until(() => !!r.web.store.get().card?.phrase);
    expect(r.web.store.get().card).toMatchObject({ kind: 'phrase', word: 'gave up', phrase: { match: { phrase: 'give up' } } });
  });

  it('marking a status from a web card stores it in the shared vocabulary book', async () => {
    const p = document.getElementById('p')!;
    const s = p.textContent!.indexOf('honestly');
    selectAndRelease(p, s, s + 8);
    await until(() => !!r.web.store.get().card?.result);
    await r.web.cards.setStatus('unknown');
    expect((await r.store.listVocab()).map((v) => [v.lemma, v.status])).toEqual([['honestly', 'unknown']]);
  });

  it('ignores typing areas, code, collapsed selections, right clicks and long selections', async () => {
    const code = document.getElementById('code')!;
    selectAndRelease(code, 0, 7);
    const p = document.getElementById('p')!;
    selectAndRelease(p, 3, 3); // collapsed
    selectAndRelease(p, 0, 6, 2); // right button
    document.getElementById('in')!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    p.textContent = Array(20).fill('word').join(' ');
    selectAndRelease(p, 0, p.textContent.length); // 20 words: copying, not a lookup
    await new Promise((res) => setTimeout(res, 20));
    expect(r.web.store.get().card).toBeNull();
    expect(r.calls.filter((c) => c.type === 'll/lookup' || c.type === 'll/phrase-lookup')).toEqual([]);
  });

  it('closes the card on a click elsewhere, Escape or scrolling', async () => {
    const p = document.getElementById('p')!;
    const open = async () => {
      selectAndRelease(p, 0, 2);
      await until(() => !!r.web.store.get().card);
    };
    await open();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(r.web.store.get().card).toBeNull();
    await open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(r.web.store.get().card).toBeNull();
    await open();
    window.dispatchEvent(new Event('scroll'));
    expect(r.web.store.get().card).toBeNull();
  });

  it('shows a short activation notice and loads settings', async () => {
    expect(r.web.store.get().notice).toMatch(/查词已启用/);
    await until(() => r.web.store.get().notice === null);
    expect(r.web.store.get().notice).toBeNull();
    expect(r.calls.some((c) => c.type === 'll/settings-get')).toBe(true);
  });

  it('dispose removes every listener', async () => {
    r.web.dispose();
    const p = document.getElementById('p')!;
    selectAndRelease(p, 0, 2);
    await new Promise((res) => setTimeout(res, 20));
    expect(r.web.store.get().card).toBeNull();
  });
});
