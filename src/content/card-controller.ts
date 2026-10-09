import { lineWords } from '../dict/phrases';
import type { LlRequest, LlResponse, LookupResult, PhraseLookupResult } from '../storage/protocol';
import type { CustomDefinition, VocabRecord, VocabStatus } from '../vocab/types';
import type { CardPosition, CardState, CardTarget } from './overlay-state';
import type { Store } from './store';

export type CallFn = <T>(msg: LlRequest) => Promise<LlResponse<T>>;

/** What the card UI needs; implemented by CardController (and by OverlayController via delegation). */
export interface CardActions {
  closeCard(): void;
  setEditing(editing: boolean): void;
  saveCustomDef(text: string): Promise<void>;
  setStatus(status: VocabStatus | null): Promise<void>;
}

export interface CardHooks {
  /** A card is about to be shown (e.g. pause the video, close menus). */
  onOpen?: () => void;
  /** The card was closed (e.g. resume the video). */
  onClose?: () => void;
  /** A vocabulary status changed (e.g. update highlights). */
  onStatus?: (lemma: string, status: VocabStatus | null) => void;
}

/**
 * Word / phrase card logic shared by the YouTube overlay and web-page lookup.
 * Works on any store whose state has a `card` field. Results that arrive for an older card
 * (or after invalidate()) are dropped.
 */
export class CardController<S extends { card: CardState | null }> implements CardActions {
  private seq = 0;

  constructor(
    private readonly store: Store<S>,
    private readonly call: CallFn,
    private readonly hooks: CardHooks = {},
  ) {}

  private get card(): CardState | null {
    return this.store.get().card;
  }

  private setCard(card: CardState | null): void {
    this.store.set({ card } as Partial<S>);
  }

  /** Drops any pending result (e.g. the video changed). */
  invalidate(): void {
    this.seq++;
  }

  private show(kind: CardState['kind'], word: string, pos: CardPosition, target: CardTarget | null): number {
    this.hooks.onOpen?.();
    this.setCard({
      kind,
      word,
      target,
      x: pos.x,
      top: pos.top,
      bottom: pos.top === null ? (pos.bottom ?? 0) : null,
      maxHeight: pos.maxHeight,
      loading: true,
      result: null,
      phrase: null,
      error: null,
      editing: false,
      saving: false,
    });
    return ++this.seq;
  }

  /**
   * Word card. With `target`, phrases of that line containing the word are looked up too
   * (e.g. clicking "look" in "look forward to").
   */
  async openCard(word: string, pos: CardPosition, target: CardTarget | null = null): Promise<void> {
    const seq = this.show('word', word, pos, target);
    const res = await this.call<LookupResult>({
      type: 'll/lookup',
      word,
      ...(target ? { context: { text: target.text, wordIndex: target.from } } : {}),
    });
    const card = this.card;
    if (seq !== this.seq || !card) return; // stale
    this.setCard(res.ok ? { ...card, loading: false, result: res.data } : { ...card, loading: false, error: res.error });
  }

  /** Phrase card for several words of one line (dictionary only, no machine translation). */
  async openPhraseCard(target: CardTarget, pos: CardPosition): Promise<void> {
    const selection = lineWords(target.text)
      .slice(target.from, target.to + 1)
      .map((w) => w.text)
      .join(' ');
    const seq = this.show('phrase', selection, pos, target);
    const res = await this.call<PhraseLookupResult>({ type: 'll/phrase-lookup', text: target.text, from: target.from, to: target.to });
    const card = this.card;
    if (seq !== this.seq || !card) return; // stale
    this.setCard(res.ok ? { ...card, loading: false, phrase: res.data } : { ...card, loading: false, error: res.error });
  }

  closeCard(): void {
    if (!this.card) return;
    this.seq++;
    this.setCard(null);
    this.hooks.onClose?.();
  }

  async setStatus(status: VocabStatus | null): Promise<void> {
    const card = this.card;
    const r = card?.result;
    if (!card || !r) return;
    const seq = this.seq;
    this.setCard({ ...card, saving: true });
    const res = await this.call<VocabRecord | null>({ type: 'll/vocab-set', lemma: r.lemma, status, word: r.word });
    const now = this.card;
    if (!now || seq !== this.seq) return;
    if (!res.ok) {
      this.setCard({ ...now, saving: false, error: res.error });
      return;
    }
    this.setCard({ ...now, saving: false, error: null, result: { ...r, vocab: res.data } });
    this.hooks.onStatus?.(r.lemma, status);
  }

  setEditing(editing: boolean): void {
    const card = this.card;
    if (card) this.setCard({ ...card, editing });
  }

  async saveCustomDef(text: string): Promise<void> {
    const card = this.card;
    const r = card?.result;
    if (!card || !r) return;
    const seq = this.seq;
    this.setCard({ ...card, saving: true });
    const res = await this.call<CustomDefinition | null>({ type: 'll/custom-def-set', lemma: r.lemma, text });
    const now = this.card;
    if (!now || seq !== this.seq) return;
    this.setCard(
      res.ok
        ? { ...now, saving: false, editing: false, error: null, result: { ...r, custom: res.data } }
        : { ...now, saving: false, error: res.error },
    );
  }
}
