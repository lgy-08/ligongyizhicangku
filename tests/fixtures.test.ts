import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCaptionFile } from '../src/captions';

const read = (name: string) => readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8');

// The fixtures are the files used in the manual Chrome test; make sure they parse as documented.
describe('manual-test fixtures', () => {
  it('sample-en.srt', () => {
    const r = parseCaptionFile(read('sample-en.srt'), 'sample-en.srt');
    expect(r.format).toBe('srt');
    expect(r.cues.map((c) => c.startMs)).toEqual([2000, 6000, 30_000, 60_000]);
    expect(r.cues[3]!.text).toBe('[LL-001 SRT] Line 4 at 1:00 & italic tags stripped');
    expect(r.warnings).toEqual([]);
  });
  it('sample-en.vtt', () => {
    const r = parseCaptionFile(read('sample-en.vtt'), 'sample-en.vtt');
    expect(r.format).toBe('vtt');
    expect(r.cues.map((c) => c.startMs)).toEqual([2000, 6000, 30_000, 60_000]);
    expect(r.cues.every((c) => c.timingConfidence === 'exact')).toBe(true);
  });
  it('broken.srt gives a line-numbered error', () => {
    expect(() => parseCaptionFile(read('broken.srt'), 'broken.srt')).toThrow('[SRT] line 6: invalid start timestamp "00:00:0x,000"');
  });
});
