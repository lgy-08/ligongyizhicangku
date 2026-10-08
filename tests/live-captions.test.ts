// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveCaptions, readCcState } from '../src/content/live-captions';
import { flush, renderCaption, renderCcButton } from './helpers/yt-dom';

let root: HTMLElement;
beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement('div');
  root.id = 'movie_player';
  document.body.append(root);
});

describe('readCcState', () => {
  it('reads aria-pressed, null without a button', () => {
    expect(readCcState(root)).toBeNull();
    renderCcButton(root, true);
    expect(readCcState(root)).toBe(true);
    renderCcButton(root, false);
    expect(readCcState(root)).toBe(false);
  });
});

describe('LiveCaptions', () => {
  it('reports the current caption text and CC state as they change', async () => {
    const onChange = vi.fn();
    renderCcButton(root, false);
    const live = new LiveCaptions({ root, onChange });
    live.start();
    expect(onChange).toHaveBeenLastCalledWith(null, false);

    renderCcButton(root, true);
    await flush();
    expect(onChange).toHaveBeenLastCalledWith(null, true);

    renderCaption(root, ['we were running', 'late again']);
    await flush();
    expect(onChange).toHaveBeenLastCalledWith('we were running\nlate again', true);
    expect(live.text).toBe('we were running\nlate again');

    renderCaption(root, null);
    await flush();
    expect(onChange).toHaveBeenLastCalledWith(null, true);
    live.dispose();
  });

  it('does not re-report unchanged text (e.g. unrelated player mutations)', async () => {
    const onChange = vi.fn();
    const live = new LiveCaptions({ root, onChange });
    renderCaption(root, ['same']);
    live.start();
    onChange.mockClear();
    root.append(document.createElement('div')); // progress bar etc.
    await flush();
    expect(onChange).not.toHaveBeenCalled();
    live.dispose();
  });

  it('hides YouTube’s caption box only on request, re-hides re-created boxes, restores original styles', async () => {
    const live = new LiveCaptions({ root, onChange: () => {} });
    const box = renderCaption(root, ['hello'])!;
    box.style.opacity = '0.9';
    live.start();
    expect(box.style.opacity).toBe('0.9'); // not hidden by default

    live.setNativeHidden(true);
    expect(box.style.opacity).toBe('0');
    expect(box.style.pointerEvents).toBe('none');

    const box2 = renderCaption(root, ['recreated'])!; // YouTube rebuilt the container
    await flush();
    expect(box2.style.opacity).toBe('0');

    live.setNativeHidden(false);
    expect(box2.style.opacity).toBe('');
    expect(box2.style.pointerEvents).toBe('');
    live.dispose();
  });

  it('dispose restores the native caption box and stops observing', async () => {
    const onChange = vi.fn();
    const live = new LiveCaptions({ root, onChange });
    const box = renderCaption(root, ['x'])!;
    live.start();
    live.setNativeHidden(true);
    live.dispose();
    expect(box.style.opacity).toBe('');
    onChange.mockClear();
    renderCaption(root, ['after dispose']);
    await flush();
    expect(onChange).not.toHaveBeenCalled();
    expect(live.text).toBeNull();
  });
});
