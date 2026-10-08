import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { Dictionary } from '../src/dict/dictionary';
import { lemmatize, normalizeWord, ruleCandidates } from '../src/dict/lemmatize';
import { createDictLoader } from '../src/dict/loader';
import { tokenize, uniqueWords } from '../src/dict/tokenize';
import { FIXTURE_DICT_FILE, fixtureDict } from './helpers/dict-fixture';

describe('Dictionary', () => {
  const d = fixtureDict();
  it('returns structured entries', () => {
    expect(d.get('run')).toEqual({ word: 'run', phonetic: 'rʌn', translation: 'v. 跑\nn. 跑步', tags: ['zk', 'gk'], frqRank: 300 });
    expect(d.get('serendipity')!.tags).toEqual([]);
    expect(d.get('nope')).toBeUndefined();
    expect(d.size).toBe(12);
  });
  it('validates the file format', () => {
    expect(() => Dictionary.fromJson(null)).toThrow(/invalid dictionary/);
    expect(() => Dictionary.fromJson({ ...FIXTURE_DICT_FILE, version: 2 })).toThrow(/invalid dictionary/);
    expect(Dictionary.fromJson(JSON.parse(JSON.stringify(FIXTURE_DICT_FILE))).has('go')).toBe(true);
  });
});

describe('normalizeWord', () => {
  it('lowercases, straightens apostrophes, strips possessives', () => {
    expect(normalizeWord('Running')).toBe('running');
    expect(normalizeWord('John’s')).toBe('john');
    expect(normalizeWord("dogs'")).toBe('dogs');
    expect(normalizeWord("don't")).toBe("don't");
    expect(normalizeWord('  ')).toBe('');
  });
});

describe('lemmatize (fixture dictionary)', () => {
  const d = fixtureDict();
  const L = (w: string) => lemmatize(w, d);

  it('running / ran -> run via exchange data (task requirement)', () => {
    expect(L('running')).toEqual({ word: 'running', lemma: 'run', method: 'exchange' });
    expect(L('ran')).toEqual({ word: 'ran', lemma: 'run', method: 'exchange' });
    expect(L('Ran').lemma).toBe('run');
    expect(L('run')).toEqual({ word: 'run', lemma: 'run', method: 'headword' });
  });
  it('irregular forms from exchange data', () => {
    expect(L('went').lemma).toBe('go');
    expect(L('mice').lemma).toBe('mouse');
  });
  it('regular inflections via rules, only when the base is a headword', () => {
    expect(L('walked')).toEqual({ word: 'walked', lemma: 'walk', method: 'rule' });
    expect(L('walking').lemma).toBe('walk');
    expect(L('stopping').lemma).toBe('stop');
    expect(L('stopped').lemma).toBe('stop');
    expect(L('making').lemma).toBe('make');
    expect(L('makes').lemma).toBe('make');
    expect(L('studies').lemma).toBe('study');
    expect(L('studied').lemma).toBe('study');
    expect(L('boxes').lemma).toBe('box');
  });
  it('unknown words fall back to themselves', () => {
    expect(L('blorptastic')).toEqual({ word: 'blorptastic', lemma: 'blorptastic', method: 'none' });
    expect(L('Zorgs').lemma).toBe('zorgs');
  });
  it('is context-free (known limitation): "left" maps to "leave"', () => {
    expect(L('left').lemma).toBe('leave');
  });
  it('rule candidates are ordered and never include the word itself', () => {
    expect(ruleCandidates('stopping')).toEqual(['stop', 'stopp', 'stoppe']);
    expect(ruleCandidates('cats')).toEqual(['cat']);
    expect(ruleCandidates('glass')).toEqual([]);
  });
});

const REAL = fileURLToPath(new URL('../public/dict/ecdict-lite.json', import.meta.url));
describe.skipIf(!existsSync(REAL))('lemmatize (real ECDICT build)', () => {
  const d = Dictionary.fromJson(JSON.parse(readFileSync(REAL, 'utf8')));
  it.each([
    ['running', 'run'],
    ['ran', 'run'],
    ['runs', 'run'],
    ['went', 'go'],
    ['mice', 'mouse'],
    ['children', 'child'],
    ['studies', 'study'],
    ['stopped', 'stop'],
    ['better', 'good'],
    ['was', 'be'],
    ['feet', 'foot'],
  ])('%s -> %s', (w, lemma) => {
    expect(lemmatize(w, d).lemma).toBe(lemma);
  });
  it('has a reasonable size', () => {
    expect(d.size).toBeGreaterThan(30_000);
    expect(d.get('run')!.translation).toContain('跑');
  });
});

describe('tokenize', () => {
  it('round-trips and identifies words', () => {
    const line = "Don't stop—it's 3 o'clock, John's dog-house!";
    const toks = tokenize(line);
    expect(toks.map((t) => t.text).join('')).toBe(line);
    expect(toks.filter((t) => t.isWord).map((t) => t.text)).toEqual(["Don't", 'stop', "it's", "o'clock", "John's", 'dog', 'house']);
  });
  it('handles curly apostrophes, empty and punctuation-only input', () => {
    expect(tokenize('I’m here').filter((t) => t.isWord).map((t) => t.text)).toEqual(['I’m', 'here']);
    expect(tokenize('')).toEqual([]);
    expect(tokenize('... 42!')).toEqual([{ text: '... 42!', isWord: false }]);
  });
  it('uniqueWords keeps first-seen order', () => {
    expect(uniqueWords(['a b a', 'b c'])).toEqual(['a', 'b', 'c']);
  });
});

describe('createDictLoader', () => {
  it('loads once and caches', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(FIXTURE_DICT_FILE)));
    const load = createDictLoader('x', fetchImpl);
    const [a, b] = await Promise.all([load(), load()]);
    expect(a.dict!.has('run')).toBe(true);
    expect(b).toBe(a);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('reports a missing dictionary with guidance and retries later', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(FIXTURE_DICT_FILE)));
    const load = createDictLoader('x', fetchImpl);
    const first = await load();
    expect(first.dict).toBeNull();
    expect(first.error).toMatch(/HTTP 404.*npm run dict/);
    expect((await load()).dict).not.toBeNull();
  });
  it('rejects malformed files', async () => {
    const load = createDictLoader('x', vi.fn().mockResolvedValue(new Response('{"format":"x"}')));
    expect((await load()).error).toMatch(/invalid dictionary/);
  });
});
