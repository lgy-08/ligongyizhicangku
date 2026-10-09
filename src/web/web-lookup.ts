import { CardController, type CallFn } from '../content/card-controller';
import type { CardPosition, CardState, CardTarget } from '../content/overlay-state';
import { createStore, type Store } from '../content/store';
import { DEFAULT_SETTINGS, type Settings } from '../vocab/types';
import {
  classifySelection,
  contextWindow,
  hitWordAtPoint,
  isExcludedTarget,
  isInteractiveTarget,
  placeWebCard,
  wordBounds,
  type RectLike,
  type WordHit,
} from './selection';

export interface WebState {
  card: CardState | null;
  settings: Settings;
  /** Short message shown in the corner (activation hint). */
  notice: string | null;
}

export interface WebLookupOptions {
  doc?: Document;
  /** How long the activation hint stays, ms. */
  noticeMs?: number;
  /** Word under a viewport point; injectable for tests (default: caretRangeFromPoint). */
  hitTest?: (x: number, y: number) => WordHit | null;
}

/**
 * Word / phrase lookup on any web page the user activated it on.
 * Listens passively (never preventDefault):
 * - a plain left click on an English word opens its card (setting "网页单击查词", default on);
 * - a finished selection of one word (e.g. double-click) opens the word card, 2-12 words the phrase card.
 * Links, buttons and form controls, typing areas and code blocks are ignored.
 */
export class WebLookup {
  readonly store: Store<WebState> = createStore<WebState>({ card: null, settings: DEFAULT_SETTINGS, notice: null });
  readonly cards: CardController<WebState>;
  private readonly doc: Document;
  private readonly noticeMs: number;
  private readonly abort = new AbortController();
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly hitTest: (x: number, y: number) => WordHit | null;

  constructor(
    private readonly call: CallFn,
    options: WebLookupOptions = {},
  ) {
    this.doc = options.doc ?? document;
    this.noticeMs = options.noticeMs ?? 4000;
    this.hitTest = options.hitTest ?? ((x, y) => hitWordAtPoint(this.doc, x, y));
    this.cards = new CardController<WebState>(this.store, call);
  }

  async start(): Promise<void> {
    const win = this.doc.defaultView ?? window;
    const opts = { signal: this.abort.signal, passive: true } as const;
    // Events from our own card are stopped at the shadow host, so these only see page events.
    this.doc.addEventListener('mouseup', (e) => this.onMouseUp(e), opts);
    this.doc.addEventListener('mousedown', () => this.cards.closeCard(), opts);
    this.doc.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.cards.closeCard();
    }, opts);
    win.addEventListener('scroll', () => this.cards.closeCard(), opts);
    const res = await this.call<Settings>({ type: 'll/settings-get' });
    if (this.abort.signal.aborted) return;
    if (res.ok) this.store.set({ settings: res.data });
    const how = this.store.get().settings.webClickLookup ? '单击单词' : '双击单词';
    this.store.set({ notice: `LinguaLens 查词已启用：${how}查释义，选中 2–12 个词查短语` });
    this.noticeTimer = setTimeout(() => this.store.set({ notice: null }), this.noticeMs);
  }

  onMouseUp(e: MouseEvent): void {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey) return;
    const sel = this.doc.getSelection();
    if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
      this.fromSelection(e, sel);
      return;
    }
    if (e.shiftKey || e.detail > 1 || !this.store.get().settings.webClickLookup) return;
    this.fromClick(e);
  }

  /** Plain click: the word under the pointer, unless the click belongs to a link/button/control. */
  private fromClick(e: MouseEvent): void {
    const target = e.target as Node | null;
    if (isExcludedTarget(target) || isInteractiveTarget(target)) return;
    const hit = this.hitTest(e.clientX, e.clientY);
    if (!hit || isExcludedTarget(hit.node) || isInteractiveTarget(hit.node)) return;
    this.openWord(hit.node, hit.start, hit.end, hit.rect);
  }

  /** Finished selection (drag or double-click). */
  private fromSelection(e: MouseEvent, sel: Selection): void {
    if (isExcludedTarget(e.target as Node | null) || isExcludedTarget(sel.anchorNode) || isExcludedTarget(sel.focusNode)) return;
    const kind = classifySelection(sel.toString());
    if (kind.kind === 'none') return;
    const range = sel.getRangeAt(0);
    if (kind.kind === 'word') {
      const node = range.startContainer;
      if (node.nodeType === 3) {
        // Locate the selected word inside its text node to get context for phrase hints.
        const full = (node as Text).data;
        const at = full.indexOf(kind.word, range.startOffset);
        const b = at >= 0 ? wordBounds(full, at) : null;
        if (b && full.slice(b.start, b.end) === kind.word) {
          this.openWord(node as Text, b.start, b.end, range.getBoundingClientRect());
          return;
        }
      }
      void this.cards.openCard(kind.word, this.place(range.getBoundingClientRect()), null);
      return;
    }
    void this.cards.openPhraseCard({ lineKey: 'web', text: kind.text, from: kind.from, to: kind.to }, this.place(range.getBoundingClientRect()));
  }

  private place(rect: RectLike): CardPosition {
    const win = this.doc.defaultView ?? window;
    return placeWebCard(win.innerWidth, win.innerHeight, rect);
  }

  /**
   * Word card for text[start, end) of a text node, with surrounding context for phrase hints.
   * (A double-click shows the card, closes it on the 2nd mousedown and reopens it on the 2nd
   * mouseup: same word, so it simply stays visible.)
   */
  private openWord(node: Text, start: number, end: number, rect: RectLike): void {
    const word = node.data.slice(start, end);
    const ctx = contextWindow(node.data, start, end, word);
    const target: CardTarget | null = ctx ? { lineKey: 'web', text: ctx.text, from: ctx.wordIndex, to: ctx.wordIndex } : null;
    void this.cards.openCard(word, this.place(rect), target);
  }

  dismissNotice(): void {
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.store.set({ notice: null });
  }

  dispose(): void {
    this.abort.abort();
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.cards.closeCard();
  }
}
