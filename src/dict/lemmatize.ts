import type { DictLike } from './dictionary';

export type LemmaMethod = 'exchange' | 'headword' | 'rule' | 'none';

export interface LemmaResult {
  /** Normalized surface form (lowercase, straight apostrophe, possessive removed). */
  word: string;
  lemma: string;
  method: LemmaMethod;
}

/** Lowercase, curly -> straight apostrophe, strip possessive "'s" / trailing "'". */
export function normalizeWord(raw: string): string {
  let w = raw.trim().toLowerCase().replace(/[‘’ʼ]/g, "'");
  w = w.replace(/^'+|'+$/g, '');
  if (w.endsWith("'s") && w.length > 2) w = w.slice(0, -2);
  return w;
}

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

/** Candidate base forms for regular inflections, most specific first. */
export function ruleCandidates(w: string): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    if (s.length >= 2 && s !== w && !out.includes(s)) out.push(s);
  };
  if (w.endsWith('ies') && w.length > 4) add(`${w.slice(0, -3)}y`);
  if (w.endsWith('ied') && w.length > 4) add(`${w.slice(0, -3)}y`);
  if (w.endsWith('ing') && w.length > 4) {
    const stem = w.slice(0, -3);
    if (stem.length >= 2 && stem.at(-1) === stem.at(-2) && !VOWELS.has(stem.at(-1)!)) add(stem.slice(0, -1)); // stopping -> stop
    add(stem); // walking -> walk
    add(`${stem}e`); // making -> make
  }
  if (w.endsWith('ed') && w.length > 3) {
    const stem = w.slice(0, -2);
    if (stem.length >= 2 && stem.at(-1) === stem.at(-2) && !VOWELS.has(stem.at(-1)!)) add(stem.slice(0, -1)); // planned -> plan
    add(stem); // walked -> walk
    add(w.slice(0, -1)); // liked -> like
  }
  if (w.endsWith('es') && w.length > 3) add(w.slice(0, -2)); // boxes -> box
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) add(w.slice(0, -1)); // cats -> cat
  if (w.endsWith('er') && w.length > 4) add(w.slice(0, -2));
  if (w.endsWith('est') && w.length > 5) add(w.slice(0, -3));
  return out;
}

/**
 * Lemma lookup order:
 * 1. ECDICT exchange data (handles irregulars: ran -> run, mice -> mouse, went -> go)
 * 2. the word itself, when it is a dictionary headword
 * 3. regular-inflection rules, accepted only if the candidate is a headword
 * 4. otherwise the normalized word itself (method "none")
 * Context-free by design: "left" maps to "leave" even when it means the direction.
 */
export function lemmatize(raw: string, dict: DictLike): LemmaResult {
  const word = normalizeWord(raw);
  if (!word) return { word, lemma: word, method: 'none' };
  const ex = dict.lemmaOf(word);
  if (ex) return { word, lemma: ex, method: 'exchange' };
  if (dict.has(word)) return { word, lemma: word, method: 'headword' };
  for (const c of ruleCandidates(word)) {
    if (dict.has(c)) return { word, lemma: dict.lemmaOf(c) ?? c, method: 'rule' };
  }
  return { word, lemma: word, method: 'none' };
}
