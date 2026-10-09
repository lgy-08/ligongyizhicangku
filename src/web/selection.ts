import { lineWords, MAX_SELECTION_WORDS } from '../dict/phrases';
import type { CardPosition } from '../content/overlay-state';

export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/** Places where a selection is not a reading selection: typing, editing, code. */
const EXCLUDED_SELECTOR = 'input, textarea, select, option, code, pre, kbd, samp, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';

export function isExcludedTarget(node: Node | null | undefined): boolean {
  if (!node) return false;
  const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
  if (!el) return false;
  if ((el as HTMLElement).isContentEditable) return true;
  return el.closest(EXCLUDED_SELECTOR) !== null;
}

/** Clicks on these do something else (navigate, submit, toggle): a single click must not look up. */
const INTERACTIVE_SELECTOR =
  'a[href], button, label, summary, select, option, input, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"]';

export function isInteractiveTarget(node: Node | null | undefined): boolean {
  if (!node) return false;
  const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
  return !!el && el.closest(INTERACTIVE_SELECTOR) !== null;
}

const WORD_CHAR = /[A-Za-z'’]/;

/**
 * Bounds [start, end) of the English word in `text` that contains `offset` (a caret position:
 * a click on the right half of the last letter gives offset === end). Leading/trailing
 * apostrophes are trimmed. Null if there is no word there.
 */
export function wordBounds(text: string, offset: number): { start: number; end: number } | null {
  if (offset < 0 || offset > text.length) return null;
  let i = offset;
  if (!(i < text.length && WORD_CHAR.test(text[i]!)) && i > 0 && WORD_CHAR.test(text[i - 1]!)) i--;
  if (i >= text.length || !WORD_CHAR.test(text[i]!)) return null;
  let start = i;
  let end = i + 1;
  while (start > 0 && WORD_CHAR.test(text[start - 1]!)) start--;
  while (end < text.length && WORD_CHAR.test(text[end]!)) end++;
  while (start < end && /['’]/.test(text[start]!)) start++;
  while (end > start && /['’]/.test(text[end - 1]!)) end--;
  if (start >= end || !/[A-Za-z]/.test(text.slice(start, end))) return null;
  return { start, end };
}

export interface WordHit {
  node: Text;
  start: number;
  end: number;
  rect: RectLike;
}

/**
 * The word under a viewport point, using Chrome's caretRangeFromPoint. The click must land on
 * the word's own glyphs (caretRangeFromPoint also answers for blank space at the end of a line).
 */
export function hitWordAtPoint(doc: Document, x: number, y: number): WordHit | null {
  const d = doc as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
  const caret = d.caretRangeFromPoint?.(x, y);
  if (!caret || caret.startContainer.nodeType !== 3) return null;
  const node = caret.startContainer as Text;
  const b = wordBounds(node.data, caret.startOffset);
  if (!b) return null;
  const range = doc.createRange();
  range.setStart(node, b.start);
  range.setEnd(node, b.end);
  const tol = 2;
  const rects = Array.from(range.getClientRects());
  const hit = rects.find((r) => x >= r.left - tol && x <= r.right + tol && y >= r.top - tol && y <= r.bottom + tol);
  return hit ? { node, start: b.start, end: b.end, rect: range.getBoundingClientRect() } : null;
}

/** Longer selections are treated as "copying text", not as a lookup. */
export const MAX_SELECTION_CHARS = 200;

/** Longest selection offered for machine translation ("译" button). */
export const MAX_LONG_SELECTION_CHARS = 1500;

export type SelectionKind =
  | { kind: 'none' }
  | { kind: 'word'; word: string }
  | { kind: 'phrase'; text: string; from: number; to: number }
  /** More than 12 words: may be copying, so only a small "译" button is offered. */
  | { kind: 'long'; text: string };

/**
 * One English word -> word card; 2..12 words (<= 200 chars) -> phrase card; longer English text
 * (<= 1500 chars) -> "long" (translate on request); empty / CJK / no English words -> ignored.
 */
export function classifySelection(raw: string): SelectionKind {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text || text.length > MAX_LONG_SELECTION_CHARS) return { kind: 'none' };
  if (/[぀-ヿ㐀-鿿가-힯]/.test(text)) return { kind: 'none' };
  const words = lineWords(text);
  if (words.length === 0) return { kind: 'none' };
  if (words.length > MAX_SELECTION_WORDS || text.length > MAX_SELECTION_CHARS) return words.length >= 2 ? { kind: 'long', text } : { kind: 'none' };
  if (words.length === 1) return { kind: 'word', word: words[0]!.text };
  return { kind: 'phrase', text, from: 0, to: words.length - 1 };
}

/**
 * The sentence containing text[start, end): from the previous sentence end (. ! ? or a line break)
 * to the next one, whitespace-normalized and at most `max` chars (cut at spaces around the selection).
 */
export function sentenceAround(text: string, start: number, end: number, max = 300): string {
  if (start < 0 || end > text.length || start >= end) return '';
  let a = start;
  while (a > 0 && !/[.!?]\s/.test(text.slice(a - 2, a)) && text[a - 1] !== '\n') a--;
  let b = end;
  while (b < text.length && !/[.!?]/.test(text[b - 1] ?? '') && text[b] !== '\n') b++;
  // the loop above stops right after a sentence end; also stop at a closing quote/bracket
  while (b < text.length && /["'”’)\]]/.test(text[b]!)) b++;
  let s = text.slice(a, b);
  if (s.length > max) {
    const rel = start - a;
    const from = Math.max(0, rel - Math.floor((max - (end - start)) / 2));
    const cut = s.slice(from, from + max);
    const left = from > 0 ? cut.indexOf(' ') + 1 : 0;
    const right = from + max < s.length ? cut.lastIndexOf(' ') : cut.length;
    s = `${from > 0 ? '…' : ''}${cut.slice(left, right > left ? right : cut.length)}${from + max < s.length ? '…' : ''}`;
  }
  return s.replace(/\s+/g, ' ').trim();
}

const BLOCK_SELECTOR = 'p, li, dd, dt, td, th, blockquote, figcaption, caption, h1, h2, h3, h4, h5, h6, article, section, div';

/** Text of the block around a range and the range's offsets inside it (for sentenceAround). */
export function blockContext(range: Range): { text: string; start: number; end: number } | null {
  const anchor = range.commonAncestorContainer;
  const el = (anchor.nodeType === 1 ? (anchor as Element) : anchor.parentElement)?.closest(BLOCK_SELECTOR);
  if (!el) return null;
  const doc = el.ownerDocument;
  const pre = doc.createRange();
  pre.setStart(el, 0);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  const selected = range.toString().length;
  const text = el.textContent ?? '';
  if (start + selected > text.length) return null;
  return { text, start, end: start + selected };
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
