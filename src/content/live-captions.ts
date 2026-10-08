import { readVisibleCaptionText } from '../youtube/caption-dom-observer';

/** YouTube's rendered caption container. Not a public API; may change. */
export const NATIVE_CAPTION_CONTAINER = '.ytp-caption-window-container';
const CC_BUTTON = '.ytp-subtitles-button';

/** true / false from the CC button's aria-pressed, or null if the button is not found. */
export function readCcState(root: ParentNode): boolean | null {
  const btn = root.querySelector(CC_BUTTON);
  if (!btn) return null;
  return btn.getAttribute('aria-pressed') === 'true';
}

export interface LiveCaptionsOptions {
  root: Element;
  /** Called when the visible text or the CC state changes. */
  onChange: (text: string | null, ccOn: boolean | null) => void;
  MutationObserverImpl?: typeof MutationObserver;
}

/**
 * "Best effort" reader for the captions YouTube is currently rendering (CC must be on).
 * It only knows the CURRENT text: no timeline, no precise sentence boundaries.
 * Optionally makes YouTube's own caption box transparent so the text is not shown twice;
 * the original inline styles are restored on unhide/dispose.
 */
export class LiveCaptions {
  private observer: MutationObserver | null = null;
  private lastText: string | null = null;
  private lastCc: boolean | null = null;
  private hideNative = false;
  private readonly touched = new Map<HTMLElement, { opacity: string; pointerEvents: string }>();

  constructor(private readonly opts: LiveCaptionsOptions) {}

  get text(): string | null {
    return this.lastText;
  }

  start(): void {
    if (this.observer) return;
    const MO = this.opts.MutationObserverImpl ?? globalThis.MutationObserver;
    this.observer = new MO(() => this.sync());
    this.observer.observe(this.opts.root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-pressed'],
    });
    this.sync(true);
  }

  sync(force = false): void {
    if (this.hideNative) this.applyHidden();
    const text = readVisibleCaptionText(this.opts.root);
    const cc = readCcState(this.opts.root);
    if (!force && text === this.lastText && cc === this.lastCc) return;
    this.lastText = text;
    this.lastCc = cc;
    this.opts.onChange(text, cc);
  }

  /** Make YouTube's caption box transparent (true) or restore it (false). */
  setNativeHidden(hidden: boolean): void {
    if (hidden === this.hideNative) return;
    this.hideNative = hidden;
    if (hidden) this.applyHidden();
    else this.restore();
  }

  private applyHidden(): void {
    for (const el of this.opts.root.querySelectorAll<HTMLElement>(NATIVE_CAPTION_CONTAINER)) {
      if (!this.touched.has(el)) {
        this.touched.set(el, { opacity: el.style.opacity, pointerEvents: el.style.pointerEvents });
      }
      if (el.style.opacity !== '0') el.style.setProperty('opacity', '0', 'important');
      if (el.style.pointerEvents !== 'none') el.style.setProperty('pointer-events', 'none', 'important');
    }
  }

  private restore(): void {
    for (const [el, prev] of this.touched) {
      el.style.removeProperty('opacity');
      el.style.removeProperty('pointer-events');
      if (prev.opacity) el.style.opacity = prev.opacity;
      if (prev.pointerEvents) el.style.pointerEvents = prev.pointerEvents;
    }
    this.touched.clear();
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.hideNative = false;
    this.restore();
    this.lastText = null;
    this.lastCc = null;
  }
}
