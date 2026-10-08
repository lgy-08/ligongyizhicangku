export interface Token {
  text: string;
  /** true for English words (letters, inner apostrophes); false for spaces/punctuation/numbers. */
  isWord: boolean;
}

// Letters with optional inner apostrophes (don't, it's, rock'n'roll). Hyphenated words split into parts.
const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;

/** Splits a caption line into word and non-word tokens; concatenating all tokens gives the input back. */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  for (const m of text.matchAll(WORD_RE)) {
    const i = m.index;
    if (i > last) out.push({ text: text.slice(last, i), isWord: false });
    out.push({ text: m[0], isWord: true });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), isWord: false });
  return out;
}

/** Unique word tokens of many lines, in first-seen order. */
export function uniqueWords(lines: Iterable<string>): string[] {
  const seen = new Set<string>();
  for (const line of lines) {
    for (const t of tokenize(line)) if (t.isWord) seen.add(t.text);
  }
  return [...seen];
}
