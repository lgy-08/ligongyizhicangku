import type { DictLike } from './dictionary';
import { lemmatize, normalizeWord } from './lemmatize';
import { tokenize } from './tokenize';

/** Longest phrase the dictionary build keeps (scripts/dict-lib.mjs phraseMaxWords). */
export const MAX_PHRASE_WORDS = 6;

/** Dictionary idioms use placeholders: "make up one's mind", "pull oneself together". */
const POSSESSIVES = new Set(['my', 'your', 'his', 'her', 'its', 'our', 'their']);
const REFLEXIVES = new Set(['myself', 'yourself', 'himself', 'herself', 'itself', 'ourselves', 'yourselves', 'themselves']);
const placeholder = (w: string): string => (POSSESSIVES.has(w) ? "one's" : REFLEXIVES.has(w) ? 'oneself' : w);
/** Longest selection accepted for a phrase lookup. */
export const MAX_SELECTION_WORDS = 12;

export interface LineWord {
  /** Surface text as shown. */
  text: string;
  /** Normalized form (lowercase, straight apostrophe, no possessive). */
  norm: string;
  /** true if punctuation (not just spaces/hyphens) separates this word from the previous one. */
  breakBefore: boolean;
}

/** Word tokens of a caption line, with phrase boundaries at punctuation. Indexes match the UI's word order. */
export function lineWords(text: string): LineWord[] {
  const out: LineWord[] = [];
  let sep = '';
  for (const t of tokenize(text)) {
    if (!t.isWord) {
      sep += t.text;
      continue;
    }
    out.push({ text: t.text, norm: normalizeWord(t.text), breakBefore: out.length > 0 && /[^\s-]/.test(sep) });
    sep = '';
  }
  return out;
}

export interface PhraseHit {
  /** Dictionary key, e.g. "give up". */
  phrase: string;
  /** Inclusive word indexes in the line. */
  start: number;
  end: number;
}

/**
 * Spellings tried for a span: as written; first word reduced to its lemma ("gave up" -> "give up",
 * "looking forward to" -> "look forward to"); every word reduced; and each of those with pronouns
 * replaced by the dictionary placeholders ("made up my mind" -> "make up one's mind").
 */
function variants(words: readonly LineWord[], lemmas: readonly string[], start: number, end: number): string[] {
  const norm = words.slice(start, end + 1).map((w) => w.norm);
  const lem = lemmas.slice(start, end + 1);
  const base = [norm, [lem[0]!, ...norm.slice(1)], lem];
  const out = [...base.map((ws) => ws.join(' ')), ...base.map((ws) => ws.map(placeholder).join(' '))];
  return [...new Set(out)];
}

function spanHasBreak(words: readonly LineWord[], start: number, end: number): boolean {
  for (let i = start + 1; i <= end; i++) if (words[i]!.breakBefore) return true;
  return false;
}

export interface FindOptions {
  /** Only spans containing this word index. */
  mustInclude?: number;
  /** Only spans inside [from, to]. */
  within?: [number, number];
  maxWords?: number;
}

/**
 * All dictionary phrases found in the line (2..maxWords words, no punctuation inside),
 * longest first, then left to right. A hit fully inside a longer hit is dropped.
 */
export function findPhrases(words: readonly LineWord[], dict: DictLike, opts: FindOptions = {}): PhraseHit[] {
  const maxWords = opts.maxWords ?? MAX_PHRASE_WORDS;
  const lo = opts.within ? Math.max(0, opts.within[0]) : 0;
  const hi = opts.within ? Math.min(words.length - 1, opts.within[1]) : words.length - 1;
  const lemmas = words.map((w) => (w.norm ? lemmatize(w.norm, dict).lemma : ''));
  const hits: PhraseHit[] = [];
  for (let len = Math.min(maxWords, hi - lo + 1); len >= 2; len--) {
    for (let start = lo; start + len - 1 <= hi; start++) {
      const end = start + len - 1;
      if (opts.mustInclude !== undefined && (opts.mustInclude < start || opts.mustInclude > end)) continue;
      if (spanHasBreak(words, start, end)) continue;
      if (hits.some((h) => h.start <= start && h.end >= end)) continue; // inside a longer hit
      const phrase = variants(words, lemmas, start, end).find((v) => v.includes(' ') && dict.has(v));
      if (phrase) hits.push({ phrase, start, end });
    }
  }
  return hits;
}

/** The whole selection as one phrase, if the dictionary has it (in any of the tried spellings). */
export function matchSelection(words: readonly LineWord[], dict: DictLike, from: number, to: number): string | null {
  if (to <= from || spanHasBreak(words, from, to)) return null;
  const lemmas = words.map((w) => (w.norm ? lemmatize(w.norm, dict).lemma : ''));
  return variants(words, lemmas, from, to).find((v) => dict.has(v)) ?? null;
}
