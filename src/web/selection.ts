import { lineWords, MAX_SELECTION_WORDS } from '../dict/phrases';
import type { CardPosition } from '../content/overlay-state';

/** Places where a selection is not a reading selection: typing, editing, code. */
const EXCLUDED_SELECTOR = 'input, textarea, select, option, code, pre, kbd, samp, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';

export function isExcludedTarget(node: Node | null | undefined): boolean {
  if (!node) return false;
  const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
  if (!el) return false;
  if ((el as HTMLElement).isContentEditable) return true;
  return el.closest(EXCLUDED_SELECTOR) !== null;
}

/** Longer selections are treated as "copying text", not as a lookup. */
export const MAX_SELECTION_CHARS = 200;

export type SelectionKind =
  | { kind: 'none' }
  | { kind: 'word'; word: string }
  | { kind: 'phrase'; text: string; from: number; to: number };

/**
 * One English word -> word card; 2..12 words -> phrase card; anything else (empty, long,
 * contains CJK text, no English words) -> ignored.
 */
export function classifySelection(raw: string): SelectionKind {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text || text.length > MAX_SELECTION_CHARS) return { kind: 'none' };
  if (/[぀-ヿ㐀-鿿가-힯]/.test(text)) return { kind: 'none' };
  const words = lineWords(text);
  if (words.length === 0 || words.length > MAX_SELECTION_WORDS) return { kind: 'none' };
  if (words.length === 1) return { kind: 'word', word: words[0]!.text };
  return { kind: 'phrase', text, from: 0, to: words.length - 1 };
}

/**
 * Text around a selected word (at most `max` chars, cut at spaces) plus the word's index among
 * the words of that text, so phrases containing it can be found. Null if the index cannot be
 * determined reliably (e.g. the selection starts in the middle of a word).
 */
export function contextWindow(full: string, start: number, end: number, word: string, max = 400): { text: string; wordIndex: number } | null {
  if (start < 0 || end > full.length || start >= end) return null;
  const room = Math.max(0, max - (end - start));
  let a = Math.max(0, start - Math.floor(room / 2));
  let b = Math.min(full.length, a + max);
  a = Math.max(0, Math.min(a, b - max));
  if (a > 0) {
    const sp = full.indexOf(' ', a);
    if (sp !== -1 && sp < start) a = sp + 1;
  }
  if (b < full.length) {
    const sp = full.lastIndexOf(' ', b);
    if (sp >= end) b = sp;
  }
  const text = full.slice(a, b);
  const words = lineWords(text);
  const wordIndex = lineWords(full.slice(a, start)).length;
  if (words[wordIndex]?.text.toLowerCase() !== word.toLowerCase()) return null;
  return { text, wordIndex };
}

export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * Card position in viewport coordinates: below the selection when there is room (or more room
 * than above), otherwise above it; height capped to the available space so it never covers the
 * selected text.
 */
export function placeWebCard(viewportW: number, viewportH: number, rect: RectLike, cardWidth = 320): CardPosition {
  const x = Math.max(8, Math.min(rect.left + rect.width / 2 - cardWidth / 2, viewportW - cardWidth - 8));
  const below = viewportH - rect.bottom;
  const above = rect.top;
  if (below >= 180 || below >= above) {
    const top = rect.bottom + 6;
    return { x, top, bottom: null, maxHeight: Math.max(100, viewportH - top - 8) };
  }
  return { x, top: null, bottom: viewportH - rect.top + 6, maxHeight: Math.max(100, rect.top - 14) };
}
