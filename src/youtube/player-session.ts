export interface PlayerSnapshot {
  currentTimeMs: number;
  /** null while unknown (NaN) or for live streams (Infinity). */
  durationMs: number | null;
  paused: boolean;
  ended: boolean;
}

export const PLAYER_EVENTS = [
  'play',
  'playing',
  'pause',
  'seeking',
  'seeked',
  'timeupdate',
  'durationchange',
  'loadedmetadata',
  'ended',
  'emptied',
  'ratechange',
] as const;

export type PlayerEventType = (typeof PLAYER_EVENTS)[number];

export type PlayerEventHandler = (type: PlayerEventType, snapshot: PlayerSnapshot) => void;

/**
 * Passive listener set on one <video> element. Never calls play/pause itself and never
 * calls preventDefault/stopPropagation, so YouTube's own handlers are unaffected.
 * All listeners share one AbortController, so dispose() removes every one of them.
 */
export class PlayerSession {
  readonly video: HTMLVideoElement;
  private readonly abort = new AbortController();
  private disposedFlag = false;

  constructor(video: HTMLVideoElement, onEvent: PlayerEventHandler) {
    this.video = video;
    for (const type of PLAYER_EVENTS) {
      video.addEventListener(
        type,
        () => {
          if (!this.disposedFlag) onEvent(type, this.snapshot());
        },
        { signal: this.abort.signal, passive: true },
      );
    }
  }

  get disposed(): boolean {
    return this.disposedFlag;
  }

  snapshot(): PlayerSnapshot {
    const d = this.video.duration;
    const t = this.video.currentTime;
    return {
      currentTimeMs: Number.isFinite(t) ? Math.round(t * 1000) : 0,
      durationMs: Number.isFinite(d) && d > 0 ? Math.round(d * 1000) : null,
      paused: this.video.paused,
      ended: this.video.ended,
    };
  }

  /** Only used for user-initiated "jump to cue" clicks. */
  seekTo(ms: number): void {
    if (this.disposedFlag || !Number.isFinite(ms) || ms < 0) return;
    this.video.currentTime = ms / 1000;
  }

  dispose(): void {
    if (this.disposedFlag) return;
    this.disposedFlag = true;
    this.abort.abort();
  }
}
