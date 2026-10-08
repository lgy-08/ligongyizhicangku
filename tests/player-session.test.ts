// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { PLAYER_EVENTS, PlayerSession } from '../src/youtube/player-session';

function fakeVideo(state: { currentTime?: number; duration?: number; paused?: boolean } = {}) {
  const v = document.createElement('video');
  const s = { currentTime: 0, duration: Number.NaN, paused: true, ended: false, ...state };
  Object.defineProperty(v, 'currentTime', { get: () => s.currentTime, set: (x: number) => (s.currentTime = x), configurable: true });
  Object.defineProperty(v, 'duration', { get: () => s.duration, configurable: true });
  Object.defineProperty(v, 'paused', { get: () => s.paused, configurable: true });
  Object.defineProperty(v, 'ended', { get: () => s.ended, configurable: true });
  return { v, s };
}

describe('PlayerSession', () => {
  it('reports play/pause/seek events with snapshots', () => {
    const { v, s } = fakeVideo({ duration: 120.5 });
    const onEvent = vi.fn();
    new PlayerSession(v, onEvent);

    s.paused = false;
    v.dispatchEvent(new Event('play'));
    s.currentTime = 42.25;
    v.dispatchEvent(new Event('seeked'));
    s.paused = true;
    v.dispatchEvent(new Event('pause'));

    expect(onEvent.mock.calls.map((c) => c[0])).toEqual(['play', 'seeked', 'pause']);
    expect(onEvent.mock.calls[1]![1]).toEqual({ currentTimeMs: 42250, durationMs: 120500, paused: false, ended: false });
    expect(onEvent.mock.calls[2]![1].paused).toBe(true);
  });

  it('maps unknown and live durations to null', () => {
    expect(new PlayerSession(fakeVideo().v, () => {}).snapshot().durationMs).toBeNull();
    expect(new PlayerSession(fakeVideo({ duration: Infinity }).v, () => {}).snapshot().durationMs).toBeNull();
  });

  it('registers exactly one listener per event type and removes all on dispose', () => {
    const { v } = fakeVideo();
    const add = vi.spyOn(v, 'addEventListener');
    const onEvent = vi.fn();
    const session = new PlayerSession(v, onEvent);
    expect(add).toHaveBeenCalledTimes(PLAYER_EVENTS.length);
    expect(new Set(add.mock.calls.map((c) => c[0])).size).toBe(PLAYER_EVENTS.length);

    session.dispose();
    for (const type of PLAYER_EVENTS) v.dispatchEvent(new Event(type));
    expect(onEvent).not.toHaveBeenCalled();
    expect(session.disposed).toBe(true);
    session.dispose(); // idempotent
  });

  it('does not cancel or stop events (passive, no interference)', () => {
    const { v } = fakeVideo();
    new PlayerSession(v, () => {});
    const pageHandler = vi.fn();
    v.addEventListener('play', pageHandler);
    const ev = new Event('play', { cancelable: true, bubbles: true });
    v.dispatchEvent(ev);
    expect(pageHandler).toHaveBeenCalledOnce();
    expect(ev.defaultPrevented).toBe(false);
  });

  it('seekTo sets currentTime only for valid input and not after dispose', () => {
    const { v, s } = fakeVideo();
    const session = new PlayerSession(v, () => {});
    session.seekTo(12_345);
    expect(s.currentTime).toBeCloseTo(12.345);
    session.seekTo(-5);
    session.seekTo(Number.NaN);
    expect(s.currentTime).toBeCloseTo(12.345);
    session.dispose();
    session.seekTo(1000);
    expect(s.currentTime).toBeCloseTo(12.345);
  });
});
