import { PlayerSession, type PlayerEventType, type PlayerSnapshot } from './player-session';
import { getWatchVideoId } from './url';

export type WatchStatus =
  | { state: 'idle' }
  | { state: 'waiting-for-player'; videoId: string }
  | { state: 'active'; videoId: string }
  | { state: 'no-player'; videoId: string; waitedMs: number };

export interface WatchControllerDeps {
  /** Locates YouTube's main <video>; return null when absent. */
  findVideo: () => HTMLVideoElement | null;
  /** Called once per attached session. May return a cleanup function. */
  onSessionStart?: (session: PlayerSession, videoId: string) => void | (() => void);
  onPlayerEvent?: (type: PlayerEventType, snapshot: PlayerSnapshot, videoId: string) => void;
  onStatus?: (status: WatchStatus) => void;
  pollIntervalMs?: number;
  timeoutMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

interface Current {
  videoId: string;
  generation: number;
  session: PlayerSession | null;
  cleanup: (() => void) | null;
  timer: unknown;
}

/**
 * Owns at most ONE PlayerSession at a time and resets everything on navigation.
 * handleUrl() is idempotent: calling it repeatedly for the same video does not re-register listeners.
 */
export class WatchController {
  private readonly deps: Required<Pick<WatchControllerDeps, 'pollIntervalMs' | 'timeoutMs' | 'setTimer' | 'clearTimer'>> &
    WatchControllerDeps;
  private current: Current | null = null;
  private generation = 0;
  private disposedFlag = false;
  /** Diagnostics: how many sessions have been created / disposed over the controller lifetime. */
  readonly stats = { sessionsCreated: 0, sessionsDisposed: 0, navigations: 0, cleanupErrors: 0 };

  constructor(deps: WatchControllerDeps) {
    this.deps = {
      pollIntervalMs: 250,
      timeoutMs: 15_000,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      ...deps,
    };
  }

  get activeSession(): PlayerSession | null {
    return this.current?.session ?? null;
  }

  get currentVideoId(): string | null {
    return this.current?.videoId ?? null;
  }

  get liveSessionCount(): number {
    return this.stats.sessionsCreated - this.stats.sessionsDisposed;
  }

  handleUrl(url: string | URL): void {
    if (this.disposedFlag) return;
    const videoId = getWatchVideoId(url);

    if (videoId && this.current?.videoId === videoId) {
      // Same video. Re-attach only if YouTube swapped the <video> element underneath us.
      const s = this.current.session;
      if (s) {
        const found = this.deps.findVideo();
        if (found && found !== s.video) {
          this.teardown();
          this.start(videoId);
        }
      }
      return;
    }

    this.stats.navigations++;
    this.teardown();
    if (!videoId) {
      this.deps.onStatus?.({ state: 'idle' });
      return;
    }
    this.start(videoId);
  }

  private start(videoId: string): void {
    const generation = ++this.generation;
    this.current = { videoId, generation, session: null, cleanup: null, timer: null };
    this.deps.onStatus?.({ state: 'waiting-for-player', videoId });
    const startedAt = Date.now();

    const attempt = () => {
      const cur = this.current;
      if (!cur || cur.generation !== generation || this.disposedFlag) return; // stale
      cur.timer = null;
      const video = this.deps.findVideo();
      if (video) {
        this.attach(cur, video);
        return;
      }
      const waited = Date.now() - startedAt;
      if (waited >= this.deps.timeoutMs) {
        this.deps.onStatus?.({ state: 'no-player', videoId, waitedMs: waited });
        return;
      }
      cur.timer = this.deps.setTimer(attempt, this.deps.pollIntervalMs);
    };
    attempt();
  }

  private attach(cur: Current, video: HTMLVideoElement): void {
    const videoId = cur.videoId;
    const session = new PlayerSession(video, (type, snap) => this.deps.onPlayerEvent?.(type, snap, videoId));
    this.stats.sessionsCreated++;
    cur.session = session;
    const cleanup = this.deps.onSessionStart?.(session, videoId);
    cur.cleanup = typeof cleanup === 'function' ? cleanup : null;
    this.deps.onStatus?.({ state: 'active', videoId });
  }

  private teardown(): void {
    const cur = this.current;
    if (!cur) return;
    this.current = null;
    if (cur.timer !== null) this.deps.clearTimer(cur.timer);
    try {
      cur.cleanup?.();
    } catch (err) {
      // A failing cleanup must not block navigation to the next video.
      this.stats.cleanupErrors++;
      console.error('[LinguaLens] session cleanup failed', err);
    }
    if (cur.session) {
      cur.session.dispose();
      this.stats.sessionsDisposed++;
    }
  }

  dispose(): void {
    if (this.disposedFlag) return;
    this.teardown();
    this.disposedFlag = true;
  }
}
