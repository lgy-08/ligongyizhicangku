// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { classifyPage } from '../src/web/page-kind';
import { classifySelection, contextWindow, isExcludedTarget, isInteractiveTarget, placeWebCard, wordBounds } from '../src/web/selection';

describe('wordBounds', () => {
  const t = "Don't stop — it's 'quoted' text.";
  it('finds the word around a caret offset, including the right edge of its last letter', () => {
    expect(wordBounds(t, 0)).toEqual({ start: 0, end: 5 }); // Don't
    expect(wordBounds(t, 3)).toEqual({ start: 0, end: 5 });
    expect(wordBounds(t, 5)).toEqual({ start: 0, end: 5 }); // caret right after the word
    expect(wordBounds(t, 6)).toEqual({ start: 6, end: 10 }); // stop
  });
  it('trims surrounding apostrophes / quotes', () => {
    const s = t.indexOf("'quoted'");
    expect(t.slice(...Object.values(wordBounds(t, s + 2)!) as [number, number])).toBe('quoted');
  });
  it('returns null on spaces, punctuation and out of range', () => {
    expect(wordBounds(t, t.indexOf('—'))).toBeNull();
    expect(wordBounds('a  b', 2)).toBeNull();
    expect(wordBounds('123', 1)).toBeNull();
    expect(wordBounds(t, -1)).toBeNull();
    expect(wordBounds(t, 999)).toBeNull();
  });
});

describe('isInteractiveTarget', () => {
  it('detects links, buttons and controls, not plain text', () => {
    document.body.innerHTML = '<p id="p">plain <a id="a" href="#">link <b id="ab">bold</b></a> <a id="na">anchor</a></p><button id="b">x</button><div role="button" id="rb">y</div><summary id="s">z</summary>';
    const $ = (id: string) => document.getElementById(id)!;
    expect(isInteractiveTarget($('p').firstChild)).toBe(false);
    expect(isInteractiveTarget($('a'))).toBe(true);
    expect(isInteractiveTarget($('ab').firstChild)).toBe(true);
    expect(isInteractiveTarget($('na'))).toBe(false); // <a> without href is not a link
    expect(isInteractiveTarget($('b'))).toBe(true);
    expect(isInteractiveTarget($('rb'))).toBe(true);
    expect(isInteractiveTarget($('s'))).toBe(true);
    expect(isInteractiveTarget(null)).toBe(false);
  });
});

describe('classifySelection', () => {
  it('one English word -> word, trimming punctuation', () => {
    expect(classifySelection('  serendipity, ')).toEqual({ kind: 'word', word: 'serendipity' });
    expect(classifySelection('don’t')).toEqual({ kind: 'word', word: 'don’t' });
  });
  it('2..12 words -> phrase with word range', () => {
    expect(classifySelection('give\n up')).toEqual({ kind: 'phrase', text: 'give up', from: 0, to: 1 });
    expect(classifySelection(Array(12).fill('w').join(' '))).toMatchObject({ kind: 'phrase', to: 11 });
  });
  it('ignores long selections (copying), CJK text, numbers and empty selections', () => {
    expect(classifySelection(Array(13).fill('w').join(' '))).toEqual({ kind: 'none' });
    expect(classifySelection('x'.repeat(201))).toEqual({ kind: 'none' });
    expect(classifySelection('这是 give up')).toEqual({ kind: 'none' });
    expect(classifySelection('2026 / 10')).toEqual({ kind: 'none' });
    expect(classifySelection('   ')).toEqual({ kind: 'none' });
  });
});

describe('contextWindow', () => {
  it('returns the surrounding text and the word index', () => {
    const full = 'We are really looking forward to the trip.';
    const start = full.indexOf('looking');
    expect(contextWindow(full, start, start + 7, 'looking')).toEqual({ text: full, wordIndex: 3 });
  });
  it('cuts long paragraphs at spaces around the word', () => {
    const full = `${'alpha '.repeat(200)}target ${'omega '.repeat(200)}`;
    const start = full.indexOf('target');
    const ctx = contextWindow(full, start, start + 6, 'target', 100)!;
    expect(ctx.text.length).toBeLessThanOrEqual(100);
    expect(ctx.text.startsWith('alpha')).toBe(true);
    expect(ctx.text.split(' ')[ctx.wordIndex]).toBe('target');
  });
  it('returns null when the selection does not start at the word', () => {
    const full = 'unbelievable';
    expect(contextWindow(full, 2, 12, 'believable')).toBeNull();
    expect(contextWindow(full, 5, 2, 'x')).toBeNull();
  });
});

describe('placeWebCard', () => {
  it('below the selection when there is room, height capped to the space below', () => {
    expect(placeWebCard(1000, 800, { left: 100, right: 160, top: 100, bottom: 120, width: 60, height: 20 })).toEqual({
      x: 8, // clamped to the left edge
      top: 126,
      bottom: null,
      maxHeight: 666,
    });
  });
  it('above the selection near the bottom of the viewport, never covering it', () => {
    const p = placeWebCard(1000, 800, { left: 500, right: 560, top: 700, bottom: 720, width: 60, height: 20 });
    expect(p).toEqual({ x: 370, top: null, bottom: 106, maxHeight: 686 });
  });
  it('clamps to the right edge', () => {
    expect(placeWebCard(400, 800, { left: 380, right: 395, top: 10, bottom: 30, width: 15, height: 20 }).x).toBe(72);
  });
});

describe('isExcludedTarget', () => {
  it('excludes typing areas and code, not normal text', () => {
    document.body.innerHTML = '<p id="p">text <a id="a">link</a></p><input id="i"><textarea id="t"></textarea><pre><code id="c">x</code></pre><div id="e" contenteditable="true"><span id="es">y</span></div>';
    const $ = (id: string) => document.getElementById(id)!;
    expect(isExcludedTarget($('p').firstChild)).toBe(false);
    expect(isExcludedTarget($('a'))).toBe(false);
    expect(isExcludedTarget($('i'))).toBe(true);
    expect(isExcludedTarget($('t'))).toBe(true);
    expect(isExcludedTarget($('c').firstChild)).toBe(true);
    expect(isExcludedTarget($('es'))).toBe(true);
    expect(isExcludedTarget(null)).toBe(false);
  });
});

describe('classifyPage', () => {
  it.each([
    ['https://en.wikipedia.org/wiki/English', 'web'],
    ['http://example.com/', 'web'],
    ['file:///D:/notes/a.html', 'web'],
    ['https://www.youtube.com/watch?v=abc', 'youtube'],
    ['https://m.youtube.com/', 'youtube'],
    ['chrome://extensions', 'unsupported'],
    ['chrome-extension://abc/options.html', 'unsupported'],
    ['https://chromewebstore.google.com/detail/x', 'unsupported'],
    ['about:blank', 'unsupported'],
    [undefined, 'unsupported'],
    ['not a url', 'unsupported'],
  ])('%s -> %s', (url, kind) => {
    expect(classifyPage(url)).toBe(kind);
  });
});
