// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CallFn } from '../src/content/card-controller';
import { createIdbStore } from '../src/storage/idb-store';
import type { LlRequest } from '../src/storage/protocol';
import { handleRequest } from '../src/storage/router';
import { wordBounds, type WordHit } from '../src/web/selection';
import { WebLookup } from '../src/web/web-lookup';
import { fixtureDict } from './helpers/dict-fixture';

/**
 * Fake hit test (happy-dom has no layout): the "point" (x, y) means element #id = targets[y], char offset x
 * in its first text node.
 */
const targets: string[] = [];
const fakeHit = (x: number, y: number): WordHit | null => {
  const el = document.getElementById(targets[y] ?? '');
  const node = el?.firstChild;
  if (!node || node.nodeType !== 3) return null;
  const b = wordBounds((node as Text).data, x);
  return b ? { node: node as Text, ...b, rect: { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 } } : null;
};

function rig() {
  const store = createIdbStore(new IDBFactory());
  const deps = { store, sw: { instanceId: 'x', startedAt: 0 }, appVersion: 't', getDict: async () => ({ dict: fixtureDict(), error: null }) };
  const calls: LlRequest[] = [];
  const call: CallFn = async (msg) => {
    calls.push(msg);
    return (await handleRequest(msg, deps)) as never;
  };
  const web = new WebLookup(call, { noticeMs: 20, hitTest: fakeHit });
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

  describe('single click', () => {
    /** Click (no selection) at char offset `offset` of element #id. */
    const clickAt = (id: string, offset: number, init: MouseEventInit = {}) => {
      targets[0] = id;
      document.getSelection()!.removeAllRanges();
      const el = document.getElementById(id)!;
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, detail: 1, clientX: offset, clientY: 0, ...init }));
    };

    beforeEach(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<p id="c">We are looking forward to it.</p><p><a id="link" href="#">give up</a></p><p id="t2">kind of fun</p>',
      );
    });

    it('a click on a word opens its card, with phrase hints from the paragraph', async () => {
      clickAt('c', 'We are lo'.length);
      await until(() => !!r.web.store.get().card?.result);
      const card = r.web.store.get().card!;
      expect(card).toMatchObject({ kind: 'word', word: 'looking', target: { from: 2 } });
      expect(card.result!.phrases.map((p) => p.phrase)).toEqual(['look forward to']);
    });

    it('ignores links, modifier keys, multi-clicks, blank space and other buttons', async () => {
      clickAt('link', 1);
      clickAt('c', 3, { ctrlKey: true });
      clickAt('c', 3, { shiftKey: true });
      clickAt('c', 3, { detail: 2 });
      clickAt('c', 3, { button: 1 });
      clickAt('c', 'We are looking forward to it'.length + 1); // after the final "."
      await new Promise((res) => setTimeout(res, 20));
      expect(r.web.store.get().card).toBeNull();
    });

    it('can be turned off in settings (selection still works)', async () => {
      r.web.store.set({ settings: { ...r.web.store.get().settings, webClickLookup: false } });
      clickAt('t2', 1);
      await new Promise((res) => setTimeout(res, 20));
      expect(r.web.store.get().card).toBeNull();
      selectAndRelease(document.getElementById('t2')!, 0, 7); // "kind of"
      await until(() => !!r.web.store.get().card?.phrase);
      expect(r.web.store.get().card!.phrase!.match!.phrase).toBe('kind of');
    });
  });

  it('dispose removes every listener', async () => {
    r.web.dispose();
    const p = document.getElementById('p')!;
    selectAndRelease(p, 0, 2);
    await new Promise((res) => setTimeout(res, 20));
    expect(r.web.store.get().card).toBeNull();
  });
});
