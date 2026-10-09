import { describe, expect, it } from 'vitest';
import { findPhrases, lineWords, matchSelection } from '../src/dict/phrases';
import { Dictionary } from '../src/dict/dictionary';
import { FIXTURE_DICT_FILE, fixtureDict } from './helpers/dict-fixture';

const d = fixtureDict();
const phrases = (text: string, opts = {}) => findPhrases(lineWords(text), d, opts).map((h) => [h.phrase, h.start, h.end]);

describe('lineWords', () => {
  it('lists words in UI order and marks punctuation breaks', () => {
    const w = lineWords("Well, I don't-know  give up!");
    expect(w.map((x) => x.text)).toEqual(['Well', 'I', "don't", 'know', 'give', 'up']);
    expect(w.map((x) => x.breakBefore)).toEqual([false, true, false, false, false, false]);
    expect(w[2]!.norm).toBe("don't");
  });
  it('normalizes case and possessives', () => {
    expect(lineWords("John's KIND").map((x) => x.norm)).toEqual(['john', 'kind']);
  });
});

describe('findPhrases', () => {
  it('finds phrases as written and via the first word\'s lemma', () => {
    expect(phrases('please give up now')).toEqual([['give up', 1, 2]]);
    expect(phrases('I gave up')).toEqual([['give up', 1, 2]]);
    expect(phrases('we are looking forward to it')).toEqual([['look forward to', 2, 4]]);
  });

  it('only returns spans containing the clicked word when asked', () => {
    expect(phrases('I gave up', { mustInclude: 2 })).toEqual([['give up', 1, 2]]);
    expect(phrases('I gave up', { mustInclude: 0 })).toEqual([]);
  });

  it('does not cross punctuation', () => {
    expect(phrases('give, up')).toEqual([]);
    expect(phrases('give-up')).toEqual([['give up', 0, 1]]); // hyphen is not a break
  });

  it('prefers the longest phrase and drops phrases inside it', () => {
    expect(phrases('as a matter of fact it is kind of fun')).toEqual([
      ['as a matter of fact', 0, 4],
      ['kind of', 7, 8],
    ]);
  });

  it('restricts to a selection', () => {
    expect(phrases('as a matter of fact it is kind of fun', { within: [6, 9] })).toEqual([['kind of', 7, 8]]);
  });

  it('maps pronouns to the dictionary placeholders one\'s / oneself', () => {
    const d2 = new Dictionary({
      ...FIXTURE_DICT_FILE,
      entries: [...FIXTURE_DICT_FILE.entries, ["one's cup of tea", '', '喜爱的事物', '', 0], ['pull oneself together', '', '振作起来', '', 0], ['hit the nail on the head', '', '一针见血', '', 0]],
    });
    const f = (text: string) => findPhrases(lineWords(text), d2).map((h) => h.phrase);
    expect(f("It's not my cup of tea")).toEqual(["one's cup of tea"]);
    expect(f('You need to pull yourself together')).toEqual(['pull oneself together']);
    expect(f('You hit the nail on the head')).toEqual(['hit the nail on the head']); // 6 words
  });

  it('known limitation: separated phrasal verbs are not matched', () => {
    expect(phrases('I gave it up')).toEqual([]);
  });

  it('handles empty input', () => {
    expect(phrases('')).toEqual([]);
    expect(phrases('...')).toEqual([]);
  });
});

describe('matchSelection', () => {
  const w = lineWords('Honestly I gave up, kind of');
  it('matches the whole selection as one phrase (lemmas allowed)', () => {
    expect(matchSelection(w, d, 2, 3)).toBe('give up');
    expect(matchSelection(w, d, 4, 5)).toBe('kind of');
  });
  it('returns null for non-phrases, single words and ranges over punctuation', () => {
    expect(matchSelection(w, d, 0, 1)).toBeNull();
    expect(matchSelection(w, d, 2, 2)).toBeNull();
    expect(matchSelection(w, d, 3, 4)).toBeNull();
  });
});
