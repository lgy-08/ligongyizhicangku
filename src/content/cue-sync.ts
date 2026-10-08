import type { CueIndex } from '../captions/match';
import type { CaptionCue } from '../captions/types';

export interface CueSyncDeps {
  getTimeMs: () => number;
  onChange: (active: CaptionCue[]) => void;
  raf?: (cb: () => void) => number;
  caf?: (handle: number) => void;
}

/**
 * Keeps the active cue(s) in sync with playback.
 * While playing it checks every animation frame (frame-accurate, unlike timeupdate's ~250 ms);
 * when paused / after seeking, a single update() is enough. onChange fires only when the set changes.
 */
export class CueSync {
  private index: CueIndex | null = null;
  private handle: number | null = null;
  private lastKey = '';
  private readonly raf: (cb: () => void) => number;
  private readonly caf: (handle: number) => void;

  constructor(private readonly deps: CueSyncDeps) {
    this.raf = deps.raf ?? ((cb) => requestAnimationFrame(cb));
    this.caf = deps.caf ?? ((h) => cancelAnimationFrame(h));
  }

  private playing = false;

  get running(): boolean {
    return this.playing;
  }

  setIndex(index: CueIndex | null): void {
    this.index = index;
    this.lastKey = '\u0000'; // force emit
    this.update();
  }

  update(): void {
    const active = this.index ? this.index.activeAt(this.deps.getTimeMs()) : [];
    const key = active.map((c) => c.id).join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.deps.onChange(active);
  }

  play(): void {
    if (this.playing) return;
    this.playing = true;
    const tick = () => {
      if (!this.playing) return;
      this.update();
      if (this.playing) this.handle = this.raf(tick);
    };
    this.handle = this.raf(tick);
  }

  stop(): void {
    this.playing = false;
    if (this.handle !== null) this.caf(this.handle);
    this.handle = null;
    this.update();
  }

  dispose(): void {
    this.playing = false;
    if (this.handle !== null) this.caf(this.handle);
    this.handle = null;
    this.index = null;
  }
}
