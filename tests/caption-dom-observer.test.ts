// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptionDomObserver, readVisibleCaptionText } from '../src/youtube/caption-dom-observer';

/** Mimics the structure YouTube renders for captions (observed shape; not a stable API). */
function renderCaption(root: Element, lines: string[] | null) {
  root.querySelector('.ytp-caption-window-container')?.remove();
  if (!lines) return;
  const container = document.createElement('div');
  container.className = 'ytp-caption-window-container';
  const win = document.createElement('div');
  win.className = 'caption-window';
  for (const l of lines) {
    const line = document.createElement('span');
    line.className = 'caption-visual-line';
    const seg = document.createElement('span');
    seg.className = 'ytp-caption-segment';
    seg.textContent = l;
    line.append(seg);
    win.append(line);
  }
  container.append(win);
  root.append(container);
}

let root: HTMLElement;
let now = 0;
beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement('div');
  root.id = 'movie_player';
  document.body.append(root);
  now = 0;
});

const make = () => new CaptionDomObserver({ root, getTimeMs: () => now });

describe('readVisibleCaptionText', () => {
  it('returns null when no captions are rendered (no-caption video / CC off)', () => {
    expect(readVisibleCaptionText(root)).toBeNull();
  });
  it('joins visual lines with newline and normalizes whitespace', () => {
    renderCaption(root, ['  hello   world ', 'second']);
    expect(readVisibleCaptionText(root)).toBe('hello world\nsecond');
  });
  it('falls back to bare segments', () => {
    const seg = document.createElement('span');
    seg.className = 'ytp-caption-segment';
    seg.textContent = 'only segment';
    root.append(seg);
    expect(readVisibleCaptionText(root)).toBe('only segment');
  });
});

describe('CaptionDomObserver', () => {
  it('produces estimated cues from appear/change/disappear times', () => {
    const o = make();
    o.start();
    now = 1000;
    renderCaption(root, ['first']);
    o.sync();
    now = 2500;
    renderCaption(root, ['second']);
    o.sync();
    now = 4000;
    renderCaption(root, null);
    o.sync();

    expect(o.estimatedCues).toEqual([
      { id: 'youtube-dom#1', startMs: 1000, endMs: 2500, text: 'first', source: 'youtube-dom', timingConfidence: 'estimated' },
      { id: 'youtube-dom#2', startMs: 2500, endMs: 4000, text: 'second', source: 'youtube-dom', timingConfidence: 'estimated' },
    ]);
    expect(o.estimatedCues.every((c) => c.timingConfidence === 'estimated')).toBe(true);
    o.dispose();
  });

  it('reacts to real DOM mutations via MutationObserver', async () => {
    const onChange = vi.fn();
    const o = new CaptionDomObserver({ root, getTimeMs: () => now, onChange });
    o.start();
    now = 500;
    renderCaption(root, ['via observer']);
    await new Promise((r) => setTimeout(r, 0));
    expect(onChange).toHaveBeenCalledWith('via observer', expect.any(Array));
    expect(o.visibleText).toBe('via observer');
    o.dispose();
  });

  it('on seek, closes the open cue at the pre-seek time and does not restart it with stale text', () => {
    const o = make();
    o.start();
    now = 1000;
    renderCaption(root, ['before seek']);
    o.sync();
    o.interrupt(1800); // user seeks to 60s; text still on screen
    now = 60_000;
    o.sync(); // same stale text -> no new cue
    now = 60_400;
    renderCaption(root, ['after seek']);
    o.sync();
    now = 61_000;
    renderCaption(root, null);
    o.sync();
    expect(o.estimatedCues.map((c) => [c.text, c.startMs, c.endMs])).toEqual([
      ['before seek', 1000, 1800],
      ['after seek', 60_400, 61_000],
    ]);
  });

  it('does not duplicate cues when the same span is replayed', () => {
    const o = make();
    o.start();
    for (let i = 0; i < 2; i++) {
      now = 1000 + i * 100;
      renderCaption(root, ['repeat']);
      o.sync();
      o.interrupt(2000);
      renderCaption(root, null);
      o.sync();
    }
    expect(o.estimatedCues).toHaveLength(1);
  });

  it('dispose stops observing and drops the open cue (no residue across videos)', async () => {
    const onChange = vi.fn();
    const o = new CaptionDomObserver({ root, getTimeMs: () => now, onChange });
    o.start();
    now = 100;
    renderCaption(root, ['old video']);
    o.sync();
    o.dispose();
    onChange.mockClear();
    renderCaption(root, ['new video text']);
    await new Promise((r) => setTimeout(r, 0));
    expect(onChange).not.toHaveBeenCalled();
    expect(o.visibleText).toBeNull();
  });

  it('missing caption container: no cues, no errors', () => {
    const o = make();
    o.start();
    now = 5000;
    o.sync();
    expect(o.estimatedCues).toEqual([]);
    expect(o.visibleText).toBeNull();
  });
});
