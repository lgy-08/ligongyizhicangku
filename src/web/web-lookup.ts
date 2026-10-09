import { CardController, type CallFn, type CardActions } from '../content/card-controller';
import type { CardPosition, CardState, CardTarget } from '../content/overlay-state';
import { createStore, type Store } from '../content/store';
import { DEFAULT_SETTINGS, type Settings } from '../vocab/types';
import {
  blockContext,
  classifySelection,
  contextWindow,
  hitWordAtPoint,
  isExcludedTarget,
  isInteractiveTarget,
  placeWebCard,
  sentenceAround,
  wordBounds,
  type RectLike,
  type WordHit,
} from './selection';
import { TranslatorService } from './translator';

/** Small "译" button offered next to a long selection (more than 12 words). */
export interface TranslateOffer {
  x: number;
  y: number;
  text: string;
  rect: RectLike;
}

export interface WebState {
  card: CardState | null;
  settings: Settings;
  /** Short message shown in the corner (activation hint). */
  notice: string | null;
  offer: TranslateOffer | null;
}

export interface WebLookupOptions {
  doc?: Document;
  /** How long the activation hint stays, ms. */
  noticeMs?: number;
  /** Word under a viewport point; injectable for tests (default: caretRangeFromPoint). */
  hitTest?: (x: number, y: number) => WordHit | null;
  /** Machine translation; injectable for tests (default: Chrome's on-device Translator). */
  translator?: Pick<TranslatorService, 'translate'>;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Word / phrase lookup and machine translation on a web page the user activated it on.
 * Listens passively (never preventDefault):
 * - a plain left click on an English word opens its card (setting "网页单击查词", default on);
 * - a finished selection of one word (e.g. double-click) opens the word card;
 * - 2-12 words open the phrase card, which also shows machine translation of the selection and of
 *   its sentence (setting "网页机器翻译", default on);
 * - a longer selection gets a small "译" button (it may just be copying).
 * Links, buttons and form controls, typing areas and code blocks are ignored.
 */
export class WebLookup {
  readonly store: Store<WebState> = createStore<WebState>({ card: null, settings: DEFAULT_SETTINGS, notice: null, offer: null });
  readonly cards: CardController<WebState>;
  /** Card actions including machine translation of a word (used when translation is enabled). */
  readonly actions: CardActions;
  private readonly doc: Document;
  private readonly noticeMs: number;
  private readonly abort = new AbortController();
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly hitTest: (x: number, y: number) => WordHit | null;
  private readonly translator: Pick<TranslatorService, 'translate'>;
  /** Sentence around the current card's word/phrase (context for machine translation). */
  private cardSentence: string | null = null;

  constructor(
    private readonly call: CallFn,
    options: WebLookupOptions = {},
  ) {
    this.doc = options.doc ?? document;
    this.noticeMs = options.noticeMs ?? 4000;
    this.hitTest = options.hitTest ?? ((x, y) => hitWordAtPoint(this.doc, x, y));
    this.translator = options.translator ?? new TranslatorService();
    this.cards = new CardController<WebState>(this.store, call);
    const c = this.cards;
    this.actions = {
      closeCard: () => c.closeCard(),
      setEditing: (v) => c.setEditing(v),
      saveCustomDef: (t) => c.saveCustomDef(t),
      setStatus: (s) => c.setStatus(s),
      machineTranslate: () => this.machineTranslate(),
    };
  }

  private get translateEnabled(): boolean {
    return this.store.get().settings.webTranslate;
  }

  async start(): Promise<void> {
    const win = this.doc.defaultView ?? window;
    const opts = { signal: this.abort.signal, passive: true } as const;
    const closeAll = () => {
      this.cards.closeCard();
      if (this.store.get().offer) this.store.set({ offer: null });
    };
    // Events from our own card / button are stopped at the shadow host, so these only see page events.
    this.doc.addEventListener('mouseup', (e) => this.onMouseUp(e), opts);
    this.doc.addEventListener('mousedown', closeAll, opts);
    this.doc.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAll();
    }, opts);
    win.addEventListener('scroll', closeAll, opts);
    const res = await this.call<Settings>({ type: 'll/settings-get' });
    if (this.abort.signal.aborted) return;
    if (res.ok) this.store.set({ settings: res.data });
    const how = this.store.get().settings.webClickLookup ? '单击单词' : '双击单词';
    this.store.set({ notice: `LinguaLens 查词已启用：${how}查释义，选中 2–12 个词查短语${this.translateEnabled ? '和机器翻译' : ''}` });
    this.noticeTimer = setTimeout(() => this.store.set({ notice: null }), this.noticeMs);
  }

  onMouseUp(e: MouseEvent): void {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey) return;
    if (this.store.get().offer) this.store.set({ offer: null });
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
    const rect = range.getBoundingClientRect();
    if (kind.kind === 'word') {
      const node = range.startContainer;
      if (node.nodeType === 3) {
        // Locate the selected word inside its text node to get context for phrase hints.
        const full = (node as Text).data;
        const at = full.indexOf(kind.word, range.startOffset);
        const b = at >= 0 ? wordBounds(full, at) : null;
        if (b && full.slice(b.start, b.end) === kind.word) {
          this.openWord(node as Text, b.start, b.end, rect);
          return;
        }
      }
      this.cardSentence = this.sentenceFor(range);
      void this.cards.openCard(kind.word, this.place(rect), null);
      return;
    }
    if (kind.kind === 'long') {
      if (!this.translateEnabled) return;
      const win = this.doc.defaultView ?? window;
      this.store.set({
        offer: {
          x: Math.max(8, Math.min(rect.right - 14, win.innerWidth - 48)),
          y: Math.max(8, Math.min(rect.bottom + 4, win.innerHeight - 36)),
          text: kind.text,
          rect,
        },
      });
      return;
    }
    // phrase: dictionary card + automatic machine translation of the selection and its sentence
    this.cardSentence = this.sentenceFor(range);
    void this.cards.openPhraseCard({ lineKey: 'web', text: kind.text, from: kind.from, to: kind.to }, this.place(rect));
    if (this.translateEnabled) void this.runMt(this.cards.currentSeq, kind.text, this.cardSentence);
  }

  private sentenceFor(range: Range): string | null {
    const ctx = blockContext(range);
    const s = ctx ? sentenceAround(ctx.text, ctx.start, ctx.end) : '';
    return s || null;
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
    const r = this.doc.createRange();
    r.setStart(node, start);
    r.setEnd(node, end);
    this.cardSentence = this.sentenceFor(r);
    void this.cards.openCard(word, this.place(rect), target);
  }

  /** "机器翻译试试" on a word card (offered when the dictionary has nothing). */
  machineTranslate(): void {
    const card = this.store.get().card;
    if (!card || card.kind !== 'word' || card.mt || !this.translateEnabled) return;
    void this.runMt(this.cards.currentSeq, card.word, this.cardSentence);
  }

  /** The "译" button next to a long selection. */
  translateOffer(): void {
    const offer = this.store.get().offer;
    if (!offer) return;
    this.store.set({ offer: null });
    this.cardSentence = null;
    const seq = this.cards.openTextCard(offer.text, this.place(offer.rect));
    void this.runMt(seq, offer.text, null);
  }

  /** Translates `text` (and its sentence as context) into card `seq`, if that card is still open. */
  private async runMt(seq: number, text: string, sentence: string | null): Promise<void> {
    const withSentence = !!sentence && norm(sentence) !== norm(text);
    this.cards.patch(seq, () => ({
      mt: { status: 'loading', ...(withSentence ? { sentence: { source: sentence!, status: 'loading' as const } } : {}) },
    }));
    const r = await this.translator.translate(text, (loaded) =>
      this.cards.patch(seq, (c) => ({ mt: { ...(c.mt ?? { status: 'loading' }), status: 'downloading', progress: loaded } })),
    );
    this.cards.patch(seq, (c) => ({
      mt: r.ok
        ? { ...(c.mt ?? {}), status: 'done', text: r.text, progress: undefined }
        : { status: 'error', error: r.error }, // drop the sentence part too
    }));
    if (!r.ok || !withSentence) return;
    const s = await this.translator.translate(sentence!);
    this.cards.patch(seq, (c) =>
      c.mt?.sentence ? { mt: { ...c.mt, sentence: { ...c.mt.sentence, status: s.ok ? 'done' : 'error', text: s.ok ? s.text : undefined } } } : {},
    );
  }

  dismissNotice(): void {
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.store.set({ notice: null });
  }

  dispose(): void {
    this.abort.abort();
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.cards.closeCard();
    this.store.set({ offer: null });
  }
}
