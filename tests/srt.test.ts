import { describe, expect, it } from 'vitest';
import { CaptionParseError, parseSrt, parseSrtDetailed } from '../src/captions';

const BASIC = `1
00:00:01,000 --> 00:00:03,500
Hello world.

2
00:00:04,000 --> 00:00:06,000
Second line
spans two rows.
`;

describe('parseSrt', () => {
  it('parses basic cues with exact timing', () => {
    const cues = parseSrt(BASIC);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({
      id: 'srt-file#1',
      startMs: 1000,
      endMs: 3500,
      text: 'Hello world.',
      source: 'srt-file',
      timingConfidence: 'exact',
    });
    expect(cues[1]!.text).toBe('Second line\nspans two rows.');
  });

  it('handles BOM and CRLF', () => {
    const input = '﻿' + BASIC.replace(/\n/g, '\r\n');
    const cues = parseSrt(input);
    expect(cues.map((c) => c.startMs)).toEqual([1000, 4000]);
    expect(cues[1]!.text).toBe('Second line\nspans two rows.');
  });

  it('handles lone CR line endings', () => {
    expect(parseSrt(BASIC.replace(/\n/g, '\r'))).toHaveLength(2);
  });

  it('accepts "." as millisecond separator and short fractions', () => {
    const cues = parseSrt('1\n00:00:01.5 --> 00:00:02.25\nA\n');
    expect(cues[0]).toMatchObject({ startMs: 1500, endMs: 2250 });
  });

  it('tolerates extra blank lines, missing index and trailing whitespace', () => {
    const input = '\n\n\n00:00:01,000 --> 00:00:02,000   \nNo index\n\n\n\n2\n00:00:03,000 --> 00:00:04,000\nB   \n\n\n';
    const cues = parseSrt(input);
    expect(cues.map((c) => c.text)).toEqual(['No index', 'B']);
  });

  it('ignores SRT position coordinates after the timing', () => {
    const cues = parseSrt('1\n00:00:01,000 --> 00:00:02,000 X1:100 X2:200 Y1:10 Y2:20\nPositioned\n');
    expect(cues[0]).toMatchObject({ startMs: 1000, endMs: 2000, text: 'Positioned' });
  });

  it('strips formatting tags and ASS overrides, decodes entities', () => {
    const cues = parseSrt('1\n00:00:01,000 --> 00:00:02,000\n{\\an8}<i>Tom &amp; <b>Jerry</b></i> &lt;3\n');
    expect(cues[0]!.text).toBe('Tom & Jerry <3');
  });

  it('supports hours > 9 and long durations', () => {
    const cues = parseSrt('1\n10:00:00,000 --> 10:00:01,001\nLate\n');
    expect(cues[0]).toMatchObject({ startMs: 36_000_000, endMs: 36_001_001 });
  });

  it('sorts out-of-order cues', () => {
    const cues = parseSrt('2\n00:00:05,000 --> 00:00:06,000\nB\n\n1\n00:00:01,000 --> 00:00:02,000\nA\n');
    expect(cues.map((c) => c.text)).toEqual(['A', 'B']);
  });

  it('uses the given source name', () => {
    expect(parseSrt(BASIC, { source: 'my-file' })[0]!.source).toBe('my-file');
  });

  it('skips blocks without timing / empty text / zero duration with warnings', () => {
    const res = parseSrtDetailed(
      'orphan text\nmore\n\n1\n00:00:01,000 --> 00:00:02,000\n<i></i>\n\n2\n00:00:03,000 --> 00:00:03,000\nZero\n\n3\n00:00:04,000 --> 00:00:05,000\nKept\n',
    );
    expect(res.cues.map((c) => c.text)).toEqual(['Kept']);
    expect(res.warnings).toHaveLength(3);
    expect(res.warnings[0]).toMatch(/no timing line/);
    expect(res.warnings[1]).toMatch(/empty text/);
    expect(res.warnings[2]).toMatch(/zero duration/);
  });

  describe('errors', () => {
    it('rejects non-string input', () => {
      expect(() => parseSrt(undefined)).toThrow(CaptionParseError);
      expect(() => parseSrt(null)).toThrow(/input must be a string, got null/);
    });

    it('rejects empty input', () => {
      expect(() => parseSrt('  \n\n')).toThrow(/input is empty/);
    });

    it('reports invalid timestamps with the line number', () => {
      try {
        parseSrt('1\n00:00:01,000 --> 00:00:02,000\nA\n\n2\n00:00:0x,000 --> 00:00:04,000\nB\n');
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(CaptionParseError);
        expect((err as CaptionParseError).line).toBe(6);
        expect((err as Error).message).toBe('[SRT] line 6: invalid start timestamp "00:00:0x,000"');
      }
    });

    it('rejects minutes/seconds over 59', () => {
      expect(() => parseSrt('1\n00:61:00,000 --> 00:62:00,000\nA\n')).toThrow(/invalid start timestamp/);
    });

    it('rejects end before start', () => {
      expect(() => parseSrt('1\n00:00:05,000 --> 00:00:04,000\nA\n')).toThrow(/end time .* is before start time/);
    });

    it('rejects input with no valid cues', () => {
      expect(() => parseSrt('just some text\nwithout timing')).toThrow(/no valid cues found/);
    });

    it('parses a VTT body leniently, skipping the WEBVTT header block with a warning', () => {
      const res = parseSrtDetailed('WEBVTT\n\n00:01.000 --> 00:02.000\nHi\n');
      expect(res.cues[0]).toMatchObject({ startMs: 1000, endMs: 2000, text: 'Hi' });
      expect(res.warnings).toHaveLength(1);
    });
  });
});
