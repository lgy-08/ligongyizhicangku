// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { CueIndex, type CaptionCue } from '../src/captions';
import { CueSync } from '../src/content/cue-sync';
import { OverlayController, type CallFn } from '../src/content/overlay-controller';
import { applyStatus, captionMode, wordClass } from '../src/content/overlay-state';
import { flush, renderCaption } from './helpers/yt-dom';
import { createStore } from '../src/content/store';
import { createIdbStore } from '../src/storage/idb-store';
import type { Annotation, LlRequest } from '../src/storage/protocol';
import { handleRequest } from '../src/storage/router';
import { DEFAULT_SETTINGS } from '../src/vocab/types';
import { PlayerSession } from '../src/youtube/player-session';
import { fixtureDict } from './helpers/dict-fixture';

const cue = (id: string, startMs: number, endMs: number, text = id): CaptionCue => ({
  id,
  startMs,
  endMs,
  text,
  source: 't',
  timingConfidence: 'exact',
});

describe('createStore', () => {
  it('merges patches and notifies subscribers', () => {
    const s = createStore({ a: 1, b: 2 });
    const l = vi.fn();
    const off = s.subscribe(l);
    s.set({ a: 5 });
    s.set((p) => ({ b: p.a + 1 }));
    expect(s.get()).toEqual({ a: 5, b: 6 });
    expect(l).toHaveBeenCalledTimes(2);
    off();
    s.set({ a: 0 });
    expect(l).toHaveBeenCalledTimes(2);
  });
});

describe('CueSync', () => {
  function rig() {
    let t = 0;
    const frames: (() => void)[] = [];
    const onChange = vi.fn();
    const sync = new CueSync({
      getTimeMs: () => t,
      onChange,
      raf: (cb) => frames.push(cb),
      caf: () => {
        frames.length = 0;
      },
    });
    const frame = () => frames.splice(0).forEach((f) => f());
    return { sync, onChange, frame, setT: (v: number) => (t = v), frames };
  }

  it('emits only when the active set changes, frame by frame while playing', () => {
    const r = rig();
    r.sync.setIndex(new CueIndex([cue('a', 0, 1000), cue('b', 1000, 2000)]));
    expect(r.onChange).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'a' })]);
    r.sync.play();
    r.setT(500);
    r.frame();
    expect(r.onChange).toHaveBeenCalledTimes(1);
    r.setT(1000);
    r.frame();
    expect(r.onChange).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'b' })]);
    r.setT(2500);
    r.frame();
    expect(r.onChange).toHaveBeenLastCalledWith([]);
    expect(r.sync.running).toBe(true);
  });

  it('follows seeks while paused via update()', () => {
    const r = rig();
    r.sync.setIndex(new CueIndex([cue('a', 0, 1000), cue('b', 5000, 6000)]));
    r.setT(5500);
    r.sync.update();
    expect(r.onChange).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'b' })]);
    r.setT(100);
    r.sync.update();
    expect(r.onChange).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'a' })]);
  });

  it('stop() and dispose() end the loop; stop inside onChange is safe', () => {
    let t = 0;
    const frames: (() => void)[] = [];
    const sync: CueSync = new CueSync({
      getTimeMs: () => t,
      onChange: (a) => {
        if (a.length === 0 && sync.running) sync.stop();
      },
      raf: (cb) => frames.push(cb),
      caf: () => {},
    });
    sync.setIndex(new CueIndex([cue('a', 0, 1000)]));
    sync.play();
    t = 2000;
    frames.splice(0).forEach((f) => f());
    expect(sync.running).toBe(false);
    expect(frames).toHaveLength(0);
    sync.dispose();
  });
});

describe('wordClass / applyStatus', () => {
  const a = (status: Annotation['status'], rank: number | null = 100): Annotation => ({ lemma: 'run', status, rank, inDict: true });
  it('maps statuses and rare-word hint', () => {
    expect(wordClass(undefined, DEFAULT_SETTINGS)).toBe('w');
    expect(wordClass(a('unknown'), DEFAULT_SETTINGS)).toBe('w s-unknown');
    expect(wordClass(a('learning'), DEFAULT_SETTINGS)).toBe('w s-learning');
    expect(wordClass(a('known'), DEFAULT_SETTINGS)).toBe('w s-known');
    expect(wordClass(a(null, 20_000), DEFAULT_SETTINGS)).toBe('w'); // hint off by default
    expect(wordClass(a(null, 20_000), { ...DEFAULT_SETTINGS, highlightRare: true })).toBe('w rare');
    expect(wordClass(a(null, 100), { ...DEFAULT_SETTINGS, highlightRare: true })).toBe('w');
  });
  it('updates all surface forms of a lemma and keeps identity when unchanged', () => {
    const ann = { ran: a(null), running: a(null), go: { ...a(null), lemma: 'go' } };
    const next = applyStatus(ann, 'run', 'known');
    expect(next.ran!.status).toBe('known');
    expect(next.running!.status).toBe('known');
    expect(next.go!.status).toBeNull();
    expect(applyStatus(next, 'run', 'known')).toBe(next);
  });
});

/** OverlayController wired to the real router + fake-indexeddb + fixture dictionary. */
function overlayRig(opts: { failLookup?: boolean } = {}) {
  const store = createIdbStore(new IDBFactory());
  const deps = { store, sw: { instanceId: 'x', startedAt: 0 }, appVersion: 't', getDict: async () => ({ dict: fixtureDict(), error: null }) };
  const calls: LlRequest[] = [];
  const call: CallFn = async (msg) => {
    calls.push(msg);
    if (opts.failLookup && msg.type === 'll/lookup') return { ok: false, error: 'boom' };
    return (await handleRequest(msg, deps)) as never;
  };
  const ctl = new OverlayController(call, { settleMs: SETTLE_MS });
  const video = document.createElement('video');
  const state = { t: 0, paused: true };
  Object.defineProperty(video, 'currentTime', { get: () => state.t, set: (v: number) => (state.t = v), configurable: true });
  Object.defineProperty(video, 'paused', { get: () => state.paused, configurable: true });
  video.pause = () => {
    state.paused = true;
  };
  video.play = async () => {
    state.paused = false;
  };
  const session = new PlayerSession(video, () => {});
  return { ctl, store, calls, session, video, state };
}

// Real value is 700 ms. Tests use a shorter one, but long enough that the simulated
// "stale caption" steps reliably happen inside the settle period even on a busy machine.
const SETTLE_MS = 150;
const settle = () => new Promise((r) => setTimeout(r, SETTLE_MS * 2));

const SRT = '1\n00:00:01,000 --> 00:00:03,000\nThe mice ran away\n\n2\n00:00:04,000 --> 00:00:06,000\nWe went running\n';

describe('OverlayController', () => {
  it('import -> sync -> annotate; detach leaves no residue', async () => {
    const r = overlayRig();
    r.ctl.attachSession(r.session, 'AAAAAAAAAAA');
    await r.ctl.importFile(new File([SRT], 'a.srt'));
    const s = r.ctl.store.get();
    expect(s.cues).toHaveLength(2);
    expect(s.message).toMatchObject({ kind: 'info', text: expect.stringContaining('2 条字幕') });
    expect(s.annotations.ran).toMatchObject({ lemma: 'run' });
    expect(s.annotations.mice).toMatchObject({ lemma: 'mouse' });

    r.state.t = 4.5;
    r.ctl.onPlayerEvent('seeked');
    expect(r.ctl.store.get().activeCues.map((c) => c.id)).toEqual(['srt-file#2']);

    r.ctl.detachSession();
    const after = r.ctl.store.get();
    expect(after).toMatchObject({ cues: null, activeCues: [], annotations: {}, card: null, fileName: null });
  });

  it('reports parse errors without throwing', async () => {
    const r = overlayRig();
    r.ctl.attachSession(r.session, 'AAAAAAAAAAA');
    await r.ctl.importFile(new File(['WEBVTT\n\n00:00:01.000 --> nope\nx'], 'bad.vtt'));
    expect(r.ctl.store.get().message).toMatchObject({ kind: 'error', text: expect.stringContaining('line 3') });
    expect(r.ctl.store.get().cues).toBeNull();
  });

  it('drops an import that finishes after the video changed', async () => {
    const r = overlayRig();
    r.ctl.attachSession(r.session, 'AAAAAAAAAAA');
    const p = r.ctl.importFile(new File([SRT], 'a.srt'));
    r.ctl.attachSession(r.session, 'BBBBBBBBBBB');
    await p;
    expect(r.ctl.store.get()).toMatchObject({ videoId: 'BBBBBBBBBBB', cues: null });
  });

  it('word card: lookup, mark status (updates all forms), custom definition', async () => {
    const r = overlayRig();
    r.ctl.attachSession(r.session, 'AAAAAAAAAAA');
    await r.ctl.importFile(new File([SRT], 'a.srt'));
    await r.ctl.openCard('ran', 10, 20);
    expect(r.ctl.store.get().card).toMatchObject({ word: 'ran', loading: false, result: { lemma: 'run' } });

    await r.ctl.setStatus('unknown');
    const s = r.ctl.store.get();
    expect(s.card!.result!.vocab).toMatchObject({ lemma: 'run', status: 'unknown' });
    expect(s.annotations.ran!.status).toBe('unknown');
    expect(s.annotations.running!.status).toBe('unknown');
    expect((await r.store.listVocab()).map((v) => v.lemma)).toEqual(['run']);

    await r.ctl.saveCustomDef('跑（过去式）');
    expect(r.ctl.store.get().card!.result!.custom!.text).toBe('跑（过去式）');

    await r.ctl.setStatus(null);
    expect(r.ctl.store.get().annotations.ran!.status).toBeNull();
    expect(await r.store.listVocab()).toEqual([]);
  });

  it('shows lookup errors in the card', async () => {
    const r = overlayRig({ failLookup: true });
    r.ctl.attachSession(r.session, 'AAAAAAAAAAA');
    await r.ctl.openCard('ran', 0, 0);
    expect(r.ctl.store.get().card).toMatchObject({ loading: false, error: 'boom', result: null });
  });

  it('no forced pause by default; pauseOnLookup pauses and resumes', async () => {
    const r = overlayRig();
    r.ctl.attachSession(r.session, 'AAAAAAAAAAA');
    r.state.paused = false;
    await r.ctl.openCard('ran', 0, 0);
    expect(r.state.paused).toBe(false);
    r.ctl.closeCard();

    r.ctl.store.set({ settings: { ...DEFAULT_SETTINGS, pauseOnLookup: true } });
    await r.ctl.openCard('ran', 0, 0);
    expect(r.state.paused).toBe(true);
    r.ctl.closeCard();
    await Promise.resolve();
    expect(r.state.paused).toBe(false);
  });

  it('YouTube captions ("best effort"): live text, annotation of new words only, native box hidden', async () => {
    const r = overlayRig();
    const player = document.createElement('div');
    document.body.append(player);
    const box = renderCaption(player, ['The mice ran'])!;
    r.ctl.attachSession(r.session, 'AAAAAAAAAAA', player);
    let s = r.ctl.store.get();
    expect(captionMode(s)).toBe('youtube');
    expect(s.liveText).toBe('The mice ran');
    expect(box.style.opacity).toBe('0');
    await vi.waitFor(() => expect(r.ctl.store.get().annotations.ran).toMatchObject({ lemma: 'run' }));

    renderCaption(player, ['The mice ran away']);
    await vi.waitFor(() => expect(r.ctl.store.get().annotations.away).toBeDefined());
    const annotateCalls = r.calls.filter((c) => c.type === 'll/annotate') as { words: string[] }[];
    expect(annotateCalls.map((c) => c.words)).toEqual([['The', 'mice', 'ran'], ['away']]);

    await r.ctl.openCard('ran', 0, 0);
    await r.ctl.setStatus('learning');
    s = r.ctl.store.get();
    expect(s.annotations.ran!.status).toBe('learning');
    player.remove();
  });

  it('file import takes over from YouTube captions and gives the native box back; clearing switches back', async () => {
    const r = overlayRig();
    const player = document.createElement('div');
    document.body.append(player);
    renderCaption(player, ['live words']);
    r.ctl.attachSession(r.session, 'AAAAAAAAAAA', player);
    await flush();
    await r.ctl.importFile(new File([SRT], 'a.srt'));
    expect(captionMode(r.ctl.store.get())).toBe('file');
    expect(player.querySelector<HTMLElement>('.ytp-caption-window-container')!.style.opacity).toBe('');

    r.ctl.clearCues();
    expect(captionMode(r.ctl.store.get())).toBe('youtube');
    expect(player.querySelector<HTMLElement>('.ytp-caption-window-container')!.style.opacity).toBe('0');
    await vi.waitFor(() => expect(r.ctl.store.get().annotations.live).toBeDefined());
    player.remove();
  });

  it('turning YouTube captions off restores the native box and is saved; detach restores it too', async () => {
    const r = overlayRig();
    const player = document.createElement('div');
    document.body.append(player);
    const box = renderCaption(player, ['hello'])!;
    r.ctl.attachSession(r.session, 'AAAAAAAAAAA', player);
    expect(box.style.opacity).toBe('0');

    await r.ctl.setYoutubeCaptions(false);
    expect(captionMode(r.ctl.store.get())).toBe('none');
    expect(box.style.opacity).toBe('');
    expect((await r.store.get('settings'))!.value).toMatchObject({ youtubeCaptions: false });

    await r.ctl.setYoutubeCaptions(true);
    expect(box.style.opacity).toBe('0');
    r.ctl.detachSession();
    expect(box.style.opacity).toBe('');
    expect(r.ctl.store.get().liveText).toBeNull();
    player.remove();
  });

  it('transcript of YouTube captions: video order after seeking, no duplicates, gap marker, cleared on video change', async () => {
    const r = overlayRig();
    const player = document.createElement('div');
    document.body.append(player);
    r.ctl.attachSession(r.session, 'AAAAAAAAAAA', player);
    const show = async (sec: number, lines: string[] | null) => {
      r.state.t = sec;
      r.ctl.onPlayerEvent('timeupdate');
      renderCaption(player, lines);
      await flush();
    };
    const seek = (sec: number) => {
      r.ctl.onPlayerEvent('seeking');
      r.state.t = sec;
      r.ctl.onPlayerEvent('seeked');
    };
    const list = () => r.ctl.store.get().transcript.map((i) => (i.kind === 'gap' ? '--gap--' : i.line.text));

    await show(1, ['one']);
    await show(1.25, ['one']);
    await show(1.5, ['one', 'two']);
    await show(1.75, ['two']);
    seek(60);
    await show(60, ['sixty']);
    await settle();
    seek(1);
    await show(1, ['one']); // watched again: no duplicate
    await settle();
    expect(list()).toEqual(['one', 'two', '--gap--', 'sixty']);

    // Next video while the old caption is still on screen: it must not be recorded for the new video.
    r.ctl.attachSession(r.session, 'BBBBBBBBBBB', player);
    expect(r.ctl.store.get().transcript).toEqual([]);
    await show(2, ['one']);
    expect(r.ctl.store.get().transcript).toEqual([]);
    await show(3, ['new video line']);
    expect(list()).toEqual(['new video line']);
    player.remove();
  });

  it('seeking back: the caption from before the seek, re-rendered at the new position, is not recorded there', async () => {
    const r = overlayRig();
    const player = document.createElement('div');
    document.body.append(player);
    r.ctl.attachSession(r.session, 'AAAAAAAAAAA', player);
    const at = async (sec: number, lines: string[] | null) => {
      r.state.t = sec;
      r.ctl.onPlayerEvent('timeupdate');
      renderCaption(player, lines);
      await flush();
    };
    const seek = (sec: number) => {
      r.ctl.onPlayerEvent('seeking');
      r.state.t = sec;
      r.ctl.onPlayerEvent('seeked');
    };
    const lines = () => r.ctl.store.get().transcript.flatMap((i) => (i.kind === 'line' ? [`${i.line.timeMs / 1000}:${i.line.text}`] : []));

    await at(10, ['early sentence']);
    await at(12, ['middle sentence']);
    seek(60);
    await at(60, null);
    await at(60, ['late sentence']);
    await settle();
    expect(lines()).toEqual(['10:early sentence', '12:middle sentence', '60:late sentence']);

    // Seek back to 11 s. YouTube first re-renders the OLD caption ("late sentence") at 11 s, then the right one.
    seek(11);
    await at(11, null);
    await at(11, ['late sentence']);
    await at(11, ['early sentence']);
    await settle();
    await at(12, ['middle sentence']);
    expect(lines()).toEqual(['10:early sentence', '12:middle sentence', '60:late sentence']);
    expect(r.ctl.debugLog.some((l) => l.includes('skip (settling after seek)'))).toBe(true);
    player.remove();
  });

  it('a caption first seen after a seek is recorded at the seek target, in order', async () => {
    const r = overlayRig();
    const player = document.createElement('div');
    document.body.append(player);
    r.ctl.attachSession(r.session, 'AAAAAAAAAAA', player);
    r.state.t = 5;
    renderCaption(player, ['five']);
    await flush();
    r.ctl.onPlayerEvent('seeking');
    r.state.t = 30;
    r.ctl.onPlayerEvent('seeked');
    renderCaption(player, ['thirty']);
    await flush();
    r.state.t = 30.6; // playback continued during the settle period
    await settle();
    const t = r.ctl.store.get().transcript.flatMap((i) => (i.kind === 'line' ? [[i.line.text, i.line.timeMs]] : []));
    expect(t).toEqual([
      ['five', 5000],
      ['thirty', 30000],
    ]);
    player.remove();
  });

  it('does not record captions while an ad is showing', async () => {
    const r = overlayRig();
    const player = document.createElement('div');
    document.body.append(player);
    player.classList.add('ad-showing');
    r.ctl.attachSession(r.session, 'AAAAAAAAAAA', player);
    renderCaption(player, ['buy now']);
    await flush();
    expect(r.ctl.store.get().transcript).toEqual([]);
    player.classList.remove('ad-showing');
    renderCaption(player, ['real content']);
    await flush();
    expect(r.ctl.store.get().transcript.map((i) => (i.kind === 'line' ? i.line.text : '-'))).toEqual(['real content']);
    player.remove();
  });

  it('opens the card below a word in the upper half (top) or above it (bottom)', async () => {
    const r = overlayRig();
    r.ctl.attachSession(r.session, 'AAAAAAAAAAA');
    await r.ctl.openCard('ran', 5, null, 40);
    expect(r.ctl.store.get().card).toMatchObject({ x: 5, top: 40, bottom: null });
    await r.ctl.openCard('mice', 5, 30);
    expect(r.ctl.store.get().card).toMatchObject({ top: null, bottom: 30 });
  });

  it('checks the backup reminder at most once per page', async () => {
    const r = overlayRig();
    r.ctl.attachSession(r.session, 'AAAAAAAAAAA');
    r.ctl.attachSession(r.session, 'BBBBBBBBBBB');
    await new Promise((res) => setTimeout(res, 0));
    expect(r.calls.filter((c) => c.type === 'll/reminder-check')).toHaveLength(1);
  });
});
