import type { CaptionCue } from '../captions/types';

/**
 * Selectors for YouTube's rendered caption overlay. These are NOT a public API and can change
 * at any time; that fragility is one of the findings of LL-001.
 */
export const YT_CAPTION_SELECTORS = {
  window: '.caption-window',
  line: '.caption-visual-line',
  segment: '.ytp-caption-segment',
} as const;

/** Reads the caption text currently rendered by YouTube's player, or null if none is visible. */
export function readVisibleCaptionText(root: ParentNode): string | null {
  const windows = Array.from(root.querySelectorAll(YT_CAPTION_SELECTORS.window));
  const scopes: ParentNode[] = windows.length > 0 ? windows : [root];
  const lines: string[] = [];
  for (const scope of scopes) {
    const lineEls = Array.from(scope.querySelectorAll(YT_CAPTION_SELECTORS.line));
    if (lineEls.length > 0) {
      for (const el of lineEls) pushText(lines, el.textContent);
    } else {
      const segs = Array.from(scope.querySelectorAll(YT_CAPTION_SELECTORS.segment));
      if (segs.length > 0) pushText(lines, segs.map((s) => s.textContent ?? '').join(' '));
    }
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

function pushText(out: string[], raw: string | null | undefined): void {
  const t = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (t) out.push(t);
}

export interface CaptionDomObserverOptions {
  root: Element;
  /** Current media time in ms, read at the moment a change is observed. */
  getTimeMs: () => number;
  onChange?: (visibleText: string | null, estimatedCues: readonly CaptionCue[]) => void;
  source?: string;
  /** Injected for tests; defaults to globalThis.MutationObserver. */
  MutationObserverImpl?: typeof MutationObserver;
}

/**
 * Builds ESTIMATED cues from what YouTube renders on screen:
 * start = media time when text appeared, end = media time when it changed or disappeared.
 * Timing is never "exact": it includes DOM mutation latency and depends on captions being turned on.
 */
export class CaptionDomObserver {
  private readonly opts: CaptionDomObserverOptions;
  private observer: MutationObserver | null = null;
  private open: { text: string; startMs: number } | null = null;
  private lastText: string | null = null;
  private readonly cueList: CaptionCue[] = [];
  private seq = 0;

  constructor(opts: CaptionDomObserverOptions) {
    this.opts = opts;
  }

  get estimatedCues(): readonly CaptionCue[] {
    return this.cueList;
  }

  get visibleText(): string | null {
    return this.lastText;
  }

  start(): void {
    if (this.observer) return;
    const MO = this.opts.MutationObserverImpl ?? globalThis.MutationObserver;
    this.observer = new MO(() => this.sync());
    this.observer.observe(this.opts.root, { childList: true, subtree: true, characterData: true });
    this.sync();
  }

  /** Re-reads the DOM. Called by the observer; exposed for tests and for timeupdate polling. */
  sync(): void {
    const text = readVisibleCaptionText(this.opts.root);
    if (text === this.lastText) return;
    const now = this.opts.getTimeMs();
    this.closeOpen(now);
    if (text) this.open = { text, startMs: now };
    this.lastText = text;
    this.opts.onChange?.(text, this.cueList);
  }

  /**
   * Call on "seeking": the on-screen text no longer belongs to a continuous playback span,
   * so the open cue is closed at the last time before the seek and not extended across it.
   * lastText is kept on purpose: text still on screen from before the seek must not start a new
   * cue at the post-seek time. A new cue starts only when the rendered text actually changes.
   */
  interrupt(lastTimeMs: number): void {
    this.closeOpen(lastTimeMs);
  }

  private closeOpen(endMs: number): void {
    const o = this.open;
    this.open = null;
    if (!o || !(endMs > o.startMs)) return;
    // Avoid duplicates when the same span is replayed after seeking back.
    const dup = this.cueList.some((c) => c.text === o.text && Math.abs(c.startMs - o.startMs) < 500);
    if (dup) return;
    this.cueList.push({
      id: `${this.opts.source ?? 'youtube-dom'}#${++this.seq}`,
      startMs: o.startMs,
      endMs,
      text: o.text,
      source: this.opts.source ?? 'youtube-dom',
      timingConfidence: 'estimated',
    });
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.open = null;
    this.lastText = null;
  }
}
