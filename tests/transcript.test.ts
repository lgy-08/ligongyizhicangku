import { describe, expect, it } from 'vitest';
import { buildTranscriptView, Coverage, LiveTranscript, type TranscriptItem } from '../src/content/transcript';

const texts = (t: LiveTranscript) => t.all.map((l) => l.text);
const view = (items: TranscriptItem[]) => items.map((i) => (i.kind === 'gap' ? '--gap--' : i.line.text));

describe('LiveTranscript', () => {
  it('orders lines by video time, not by when they were seen (seeking back and forth)', () => {
    const t = new LiveTranscript();
    t.add('line at 10s', 10_000);
    t.add('line at 12s', 12_000);
    t.add('line at 60s', 60_000); // user jumped forward
    t.add('line at 30s', 30_000); // then back
    t.add('line at 2s', 2_000); // then to the start
    expect(texts(t)).toEqual(['line at 2s', 'line at 10s', 'line at 12s', 'line at 30s', 'line at 60s']);
  });

  it('does not duplicate lines when a stretch is watched again', () => {
    const t = new LiveTranscript();
    expect(t.add('hello there', 5_000)).toBe('added');
    expect(t.add('general kenobi', 7_000)).toBe('added');
    // seek back, the same captions appear again at (almost) the same video time
    expect(t.add('hello there', 5_040)).toBe('duplicate');
    expect(t.add('general kenobi', 6_980)).toBe('duplicate');
    // seek back into the MIDDLE of a caption: first seen later than originally, still the same line
    expect(t.add('general kenobi', 9_500)).toBe('duplicate');
    expect(t.size).toBe(2);
  });

  it('treats case and punctuation differences as the same line', () => {
    const t = new LiveTranscript();
    t.add("It's fine.", 1_000);
    expect(t.add('it’s fine', 1_200)).toBe('duplicate');
    expect(t.add('IT’S FINE!', 1_300)).toBe('duplicate');
    expect(t.size).toBe(1);
  });

  it('ignores auto-caption text re-wrapped differently on replay (already contained)', () => {
    const t = new LiveTranscript();
    t.add('so we were running', 20_000);
    t.add('late and then the bus', 22_000);
    // replay: YouTube wraps the same words differently
    expect(t.add('running late and then', 21_000)).toBe('contained');
    expect(t.add('were running late', 20_500)).toBe('contained');
    expect(texts(t)).toEqual(['so we were running', 'late and then the bus']);
  });

  it('a long line already recorded at a distant time is a "duplicate-far", a short one may repeat', () => {
    const t = new LiveTranscript();
    t.add('welcome back to the channel everyone', 2_000);
    t.add('Thank you.', 3_000);
    expect(t.add('Welcome back to the channel, everyone!', 300_000)).toBe('duplicate-far');
    expect(t.add('Thank you.', 300_000)).toBe('added');
    expect(texts(t)).toEqual(['welcome back to the channel everyone', 'Thank you.', 'Thank you.']);
  });

  it('the whole-video check follows lines that grew', () => {
    const t = new LiveTranscript();
    t.add('so today we', 1_000);
    t.add('so today we are going to cook', 1_500); // grew
    expect(t.add('so today we are going to cook', 200_000)).toBe('duplicate-far');
    expect(t.add('so today we', 200_000)).toBe('added'); // short (3 words): allowed to repeat far away
    t.clear();
    expect(t.add('so today we are going to cook', 200_000)).toBe('added');
  });

  it('matches prefixes on whole words only', () => {
    const t = new LiveTranscript();
    t.add('the', 1_000);
    expect(t.add('then we left', 1_500)).toBe('added');
    expect(texts(t)).toEqual(['the', 'then we left']);
  });

  it('keeps a sentence that legitimately repeats far apart', () => {
    const t = new LiveTranscript();
    t.add('Thank you.', 3_000);
    t.add('Thank you.', 120_000);
    expect(t.size).toBe(2);
  });

  it('merges auto-generated captions that grow word by word into one line', () => {
    const t = new LiveTranscript();
    t.add('we were', 1_000);
    t.add('we were running', 1_400);
    t.add('we were running late', 1_900);
    expect(t.all).toEqual([{ id: 1, text: 'we were running late', timeMs: 1_000 }]);
    // the line scrolls up and is still visible a few seconds later: no duplicate
    t.add('we were running late', 4_500);
    t.add('and then', 4_500);
    // a shorter prefix seen again (partially re-rendered) is ignored
    t.add('we were running', 5_000);
    expect(texts(t)).toEqual(['we were running late', 'and then']);
  });

  it('normalizes whitespace and ignores empty / invalid input', () => {
    const t = new LiveTranscript();
    expect(t.add('  a   b ', 1)).toBe('added');
    expect(t.add('   ', 2)).toBe('invalid');
    expect(t.add('...', 3)).toBe('invalid');
    expect(t.add('x', Number.NaN)).toBe('invalid');
    expect(texts(t)).toEqual(['a b']);
    t.clear();
    expect(t.size).toBe(0);
  });

  it('keeps insertion order for lines with the same time (two-line captions)', () => {
    const t = new LiveTranscript();
    t.add('first row', 9_000);
    t.add('second row', 9_000);
    expect(texts(t)).toEqual(['first row', 'second row']);
  });
});

describe('Coverage + buildTranscriptView', () => {
  const play = (c: Coverage, from: number, to: number) => {
    for (let x = from; x <= to; x += 250) c.note(x);
  };

  it('no gap markers for continuous playback', () => {
    const c = new Coverage();
    const t = new LiveTranscript();
    play(c, 0, 20_000);
    t.add('a', 2_000);
    t.add('b', 10_000);
    t.add('c', 19_000);
    expect(view(buildTranscriptView(t.all, c))).toEqual(['a', 'b', 'c']);
  });

  it('marks the skipped stretch after seeking forward', () => {
    const c = new Coverage();
    const t = new LiveTranscript();
    play(c, 0, 10_000);
    t.add('before the jump', 8_000);
    c.break(); // seeking
    play(c, 60_000, 70_000);
    t.add('after the jump', 62_000);
    expect(view(buildTranscriptView(t.all, c))).toEqual(['before the jump', '--gap--', 'after the jump']);
  });

  it('the gap disappears once the skipped stretch is watched', () => {
    const c = new Coverage();
    const t = new LiveTranscript();
    play(c, 0, 10_000);
    t.add('a', 8_000);
    c.break();
    play(c, 60_000, 70_000);
    t.add('c', 62_000);
    c.break();
    play(c, 10_000, 60_000); // go back and watch the middle
    t.add('b', 30_000);
    expect(view(buildTranscriptView(t.all, c))).toEqual(['a', 'b', 'c']);
  });

  it('a small seek is tolerated, a real jump is not', () => {
    const c = new Coverage();
    play(c, 0, 5_000);
    c.note(7_000); // +2 s, e.g. a slow timeupdate at 2x speed
    expect(c.covers(0, 7_000)).toBe(true);
    c.break();
    c.note(20_000);
    expect(c.covers(0, 20_000)).toBe(false);
    expect(c.merged()).toEqual([
      [0, 7_000],
      [20_000, 20_000],
    ]);
  });
});
