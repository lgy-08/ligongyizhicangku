import { describe, expect, it } from 'vitest';
import { CueIndex, formatTimestamp, parseTimestamp, sortCues, type CaptionCue } from '../src/captions';

const cue = (id: string, startMs: number, endMs: number): CaptionCue => ({
  id,
  startMs,
  endMs,
  text: id,
  source: 'test',
  timingConfidence: 'exact',
});

describe('timestamps', () => {
  it('parses supported forms', () => {
    expect(parseTimestamp('00:00:01,000')).toBe(1000);
    expect(parseTimestamp('01:02:03.004')).toBe(3_723_004);
    expect(parseTimestamp('02:03.4')).toBe(123_400);
    expect(parseTimestamp('00:00:01')).toBe(1000);
  });
  it('rejects invalid forms', () => {
    for (const bad of ['', '1', 'aa:bb:cc', '00:60:00,000', '00:00:01,0000', '00:00:01;000']) {
      expect(parseTimestamp(bad), bad).toBeNull();
    }
  });
  it('formats', () => {
    expect(formatTimestamp(3_723_004)).toBe('1:02:03.004');
    expect(formatTimestamp(61_500)).toBe('01:01.500');
  });
});

describe('sortCues', () => {
  it('sorts by start then end and is stable', () => {
    const a = cue('a', 1000, 3000);
    const b = cue('b', 1000, 2000);
    const c = cue('c', 0, 500);
    const d = cue('d', 1000, 2000);
    expect(sortCues([a, b, c, d]).map((x) => x.id)).toEqual(['c', 'b', 'd', 'a']);
  });
});

describe('CueIndex', () => {
  const idx = new CueIndex([cue('c3', 5000, 6000), cue('c1', 0, 2000), cue('c2', 2000, 4000)]);

  it('finds the active cue with half-open intervals', () => {
    expect(idx.activeAt(0).map((c) => c.id)).toEqual(['c1']);
    expect(idx.activeAt(1999).map((c) => c.id)).toEqual(['c1']);
    expect(idx.activeAt(2000).map((c) => c.id)).toEqual(['c2']);
    expect(idx.activeAt(4500)).toEqual([]);
    expect(idx.activeAt(6000)).toEqual([]);
    expect(idx.activeAt(-1)).toEqual([]);
    expect(idx.activeAt(Number.NaN)).toEqual([]);
  });

  it('handles seeking backwards and forwards (stateless lookup)', () => {
    expect(idx.activeAt(5500)[0]!.id).toBe('c3');
    expect(idx.activeAt(500)[0]!.id).toBe('c1');
    expect(idx.activeAt(3000)[0]!.id).toBe('c2');
  });

  it('returns all overlapping cues, including a long early cue', () => {
    const o = new CueIndex([cue('long', 0, 10_000), cue('s1', 1000, 2000), cue('s2', 3000, 4000), cue('s3', 3500, 5000)]);
    expect(o.activeAt(3600).map((c) => c.id)).toEqual(['long', 's2', 's3']);
    expect(o.activeAt(2500).map((c) => c.id)).toEqual(['long']);
    expect(o.activeAt(10_000)).toEqual([]);
  });

  it('nextAfter returns the first cue starting at or after t', () => {
    const o = new CueIndex([cue('a', 1000, 2000), cue('b', 3000, 4000), cue('b2', 3000, 3500)]);
    expect(o.nextAfter(0)!.id).toBe('a');
    expect(o.nextAfter(1000)!.id).toBe('a');
    expect(o.nextAfter(1500)!.id).toBe('b2');
    expect(o.nextAfter(5000)).toBeNull();
  });

  it('works when empty', () => {
    const e = new CueIndex([]);
    expect(e.size).toBe(0);
    expect(e.activeAt(1000)).toEqual([]);
    expect(e.nextAfter(0)).toBeNull();
  });

  it('scales: 10k cues lookup', () => {
    const many = Array.from({ length: 10_000 }, (_, i) => cue(`k${i}`, i * 1000, i * 1000 + 900));
    const big = new CueIndex(many);
    expect(big.activeAt(5_000_450)[0]!.id).toBe('k5000');
    expect(big.activeAt(5_000_950)).toEqual([]);
  });
});
