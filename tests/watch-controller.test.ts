// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WatchController, type WatchStatus } from '../src/youtube/watch-controller';

const A = 'https://www.youtube.com/watch?v=AAAAAAAAAAA';
const A_T = 'https://www.youtube.com/watch?v=AAAAAAAAAAA&t=30s';
const B = 'https://www.youtube.com/watch?v=BBBBBBBBBBB';
const HOME = 'https://www.youtube.com/';

function setup(initialVideo: HTMLVideoElement | null = document.createElement('video')) {
  let video = initialVideo;
  const statuses: WatchStatus[] = [];
  const cleanups: string[] = [];
  const started: string[] = [];
  const events: string[] = [];
  const c = new WatchController({
    findVideo: () => video,
    onSessionStart: (_s, id) => {
      started.push(id);
      return () => cleanups.push(id);
    },
    onPlayerEvent: (type, _snap, id) => events.push(`${id}:${type}`),
    onStatus: (s) => statuses.push(s),
    pollIntervalMs: 100,
    timeoutMs: 1000,
  });
  return {
    c,
    statuses,
    cleanups,
    started,
    events,
    setVideo: (v: HTMLVideoElement | null) => (video = v),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('WatchController', () => {
  it('attaches on a watch page and ignores non-watch pages', () => {
    const t = setup();
    t.c.handleUrl(HOME);
    expect(t.c.activeSession).toBeNull();
    expect(t.statuses.at(-1)).toEqual({ state: 'idle' });
    t.c.handleUrl(A);
    expect(t.c.activeSession).not.toBeNull();
    expect(t.statuses.at(-1)).toEqual({ state: 'active', videoId: 'AAAAAAAAAAA' });
  });

  it('is idempotent for repeated notifications of the same video (no duplicate listeners)', () => {
    const t = setup();
    t.c.handleUrl(A);
    t.c.handleUrl(A);
    t.c.handleUrl(A_T); // same video, different query params
    expect(t.c.stats.sessionsCreated).toBe(1);
    expect(t.c.liveSessionCount).toBe(1);
    t.c.activeSession!.video.dispatchEvent(new Event('play'));
    expect(t.events).toEqual(['AAAAAAAAAAA:play']);
  });

  it('resets state on SPA navigation to another video, reusing the same <video> element', () => {
    const t = setup();
    t.c.handleUrl(A);
    const first = t.c.activeSession!;
    t.c.handleUrl(B);
    expect(first.disposed).toBe(true);
    expect(t.cleanups).toEqual(['AAAAAAAAAAA']);
    expect(t.started).toEqual(['AAAAAAAAAAA', 'BBBBBBBBBBB']);
    expect(t.c.liveSessionCount).toBe(1);

    // Same element: only the new session's listener fires, attributed to the new video.
    t.c.activeSession!.video.dispatchEvent(new Event('pause'));
    expect(t.events).toEqual(['BBBBBBBBBBB:pause']);
  });

  it('tears down when leaving the watch page', () => {
    const t = setup();
    t.c.handleUrl(A);
    t.c.handleUrl(HOME);
    expect(t.c.activeSession).toBeNull();
    expect(t.c.liveSessionCount).toBe(0);
    expect(t.cleanups).toEqual(['AAAAAAAAAAA']);
  });

  it('re-attaches if YouTube replaces the <video> element for the same video', () => {
    const t = setup();
    t.c.handleUrl(A);
    const old = t.c.activeSession!;
    t.setVideo(document.createElement('video'));
    t.c.handleUrl(A);
    expect(old.disposed).toBe(true);
    expect(t.c.activeSession!.video).not.toBe(old.video);
    expect(t.c.liveSessionCount).toBe(1);
  });

  it('waits for a late player, then attaches', () => {
    const t = setup(null);
    t.c.handleUrl(A);
    expect(t.statuses.at(-1)).toEqual({ state: 'waiting-for-player', videoId: 'AAAAAAAAAAA' });
    vi.advanceTimersByTime(300);
    expect(t.c.activeSession).toBeNull();
    t.setVideo(document.createElement('video'));
    vi.advanceTimersByTime(100);
    expect(t.c.activeSession).not.toBeNull();
  });

  it('reports no-player after timeout (missing player scenario) without throwing', () => {
    const t = setup(null);
    t.c.handleUrl(A);
    vi.advanceTimersByTime(1500);
    const last = t.statuses.at(-1)!;
    expect(last.state).toBe('no-player');
    expect(t.c.activeSession).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a pending wait when navigating away (no stale attach)', () => {
    const t = setup(null);
    t.c.handleUrl(A);
    t.c.handleUrl(B);
    t.setVideo(document.createElement('video'));
    vi.advanceTimersByTime(200);
    expect(t.started).toEqual(['BBBBBBBBBBB']);
    expect(t.c.stats.sessionsCreated).toBe(1);
  });

  it('dispose() cleans everything and ignores later URLs', () => {
    const t = setup();
    t.c.handleUrl(A);
    const s = t.c.activeSession!;
    t.c.dispose();
    expect(s.disposed).toBe(true);
    t.c.handleUrl(B);
    expect(t.c.activeSession).toBeNull();
    expect(t.c.liveSessionCount).toBe(0);
  });

  it('survives a throwing cleanup: session disposed and navigation continues', () => {
    const video = document.createElement('video');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = new WatchController({
      findVideo: () => video,
      onSessionStart: () => () => {
        throw new Error('boom');
      },
    });
    c.handleUrl(A);
    const s = c.activeSession!;
    expect(() => c.handleUrl(B)).not.toThrow();
    expect(s.disposed).toBe(true);
    expect(c.currentVideoId).toBe('BBBBBBBBBBB');
    expect(c.stats).toMatchObject({ sessionsDisposed: 1, cleanupErrors: 1 });
    expect(c.liveSessionCount).toBe(1);
    errSpy.mockRestore();
  });

  it('rapid navigation A->B->A->B leaves exactly one live session', () => {
    const t = setup();
    for (const u of [A, B, A, B, HOME, A]) t.c.handleUrl(u);
    expect(t.c.liveSessionCount).toBe(1);
    expect(t.c.stats.sessionsCreated - t.c.stats.sessionsDisposed).toBe(1);
  });
});
