import { CardController, type CallFn } from '../content/card-controller';
import type { CardState, CardTarget } from '../content/overlay-state';
import { createStore, type Store } from '../content/store';
import { DEFAULT_SETTINGS, type Settings } from '../vocab/types';
import { classifySelection, contextWindow, isExcludedTarget, placeWebCard } from './selection';

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
}

/**
 * Word / phrase lookup on any web page the user activated it on.
 * Listens passively (never preventDefault): a finished mouse selection of one English word opens
 * the word card, 2-12 words open the phrase card. Typing areas and code blocks are ignored.
 */
export class WebLookup {
  readonly store: Store<WebState> = createStore<WebState>({ card: null, settings: DEFAULT_SETTINGS, notice: null });
  readonly cards: CardController<WebState>;
  private readonly doc: Document;
  private readonly noticeMs: number;
  private readonly abort = new AbortController();
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly call: CallFn,
    options: WebLookupOptions = {},
  ) {
    this.doc = options.doc ?? document;
    this.noticeMs = options.noticeMs ?? 4000;
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
    this.store.set({ notice: 'LinguaLens 查词已启用：双击单词，或选中 2–12 个词查短语' });
    this.noticeTimer = setTimeout(() => this.store.set({ notice: null }), this.noticeMs);
    const res = await this.call<Settings>({ type: 'll/settings-get' });
    if (res.ok && !this.abort.signal.aborted) this.store.set({ settings: res.data });
  }

  onMouseUp(e: MouseEvent): void {
    if (e.button !== 0) return;
    const sel = this.doc.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    if (isExcludedTarget(e.target as Node | null) || isExcludedTarget(sel.anchorNode) || isExcludedTarget(sel.focusNode)) return;
    const kind = classifySelection(sel.toString());
    if (kind.kind === 'none') return;
    const range = sel.getRangeAt(0);
    const win = this.doc.defaultView ?? window;
    const pos = placeWebCard(win.innerWidth, win.innerHeight, range.getBoundingClientRect());

    if (kind.kind === 'word') {
      let target: CardTarget | null = null;
      const node = range.startContainer;
      if (node.nodeType === 3) {
        const full = (node as Text).data;
        const end = range.endContainer === node ? range.endOffset : full.length;
        const ctx = contextWindow(full, range.startOffset, end, kind.word);
        if (ctx) target = { lineKey: 'web', text: ctx.text, from: ctx.wordIndex, to: ctx.wordIndex };
      }
      void this.cards.openCard(kind.word, pos, target);
    } else {
      void this.cards.openPhraseCard({ lineKey: 'web', text: kind.text, from: kind.from, to: kind.to }, pos);
    }
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
