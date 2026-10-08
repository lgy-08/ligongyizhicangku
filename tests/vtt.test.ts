import { describe, expect, it } from 'vitest';
import { CaptionParseError, detectCaptionFormat, parseCaptionFile, parseVtt, parseVttDetailed } from '../src/captions';

const BASIC = `WEBVTT - sample
Kind: captions
Language: en

NOTE this is a comment
spanning two lines

STYLE
::cue { color: yellow }

intro
00:00:01.000 --> 00:00:03.000 align:start position:10%
<v Roger>Hello <c.yellow>there</c></v>

00:04.500 --> 00:06.000
Short form
two lines
`;

describe('parseVtt', () => {
  it('parses cues, skipping header, NOTE and STYLE blocks', () => {
    const cues = parseVtt(BASIC);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({
      id: 'vtt-file#1',
      startMs: 1000,
      endMs: 3000,
      text: 'Hello there',
      source: 'vtt-file',
      timingConfidence: 'exact',
    });
    expect(cues[1]).toMatchObject({ startMs: 4500, endMs: 6000, text: 'Short form\ntwo lines' });
  });

  it('handles BOM + CRLF', () => {
    expect(parseVtt('﻿' + BASIC.replace(/\n/g, '\r\n'))).toHaveLength(2);
  });

  it('strips karaoke timestamps (YouTube-style auto captions)', () => {
    const cues = parseVtt('WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nhello<00:00:00.500><c> world</c><00:00:01.000><c> again</c>\n');
    expect(cues[0]!.text).toBe('hello world again');
  });

  it('accepts "," as millisecond separator leniently', () => {
    expect(parseVtt('WEBVTT\n\n00:00:01,250 --> 00:00:02,000\nA\n')[0]!.startMs).toBe(1250);
  });

  it('accepts a cue directly after the header line', () => {
    expect(parseVtt('WEBVTT\n00:00:01.000 --> 00:00:02.000\nA\n')).toHaveLength(1);
  });

  it('skips REGION blocks and warns about orphan blocks', () => {
    const res = parseVttDetailed('WEBVTT\n\nREGION\nid:fred\n\njust text\n\n00:00:01.000 --> 00:00:02.000\nA\n');
    expect(res.cues).toHaveLength(1);
    expect(res.warnings).toEqual(['block 2 (line 6): no timing line, skipped']);
  });

  it('does not treat "NOTE" inside cue text as a comment', () => {
    const cues = parseVtt('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nNOTE to self\n');
    expect(cues[0]!.text).toBe('NOTE to self');
  });

  describe('errors', () => {
    it('requires the WEBVTT header', () => {
      expect(() => parseVtt('00:00:01.000 --> 00:00:02.000\nA\n')).toThrow('[VTT] line 1: missing "WEBVTT" header');
      expect(() => parseVtt('WEBVTTX\n\n00:00:01.000 --> 00:00:02.000\nA\n')).toThrow(CaptionParseError);
    });

    it('rejects empty and non-string input', () => {
      expect(() => parseVtt('')).toThrow(/input is empty/);
      expect(() => parseVtt(42)).toThrow(/got number/);
    });

    it('reports malformed timing with line number', () => {
      expect(() => parseVtt('WEBVTT\n\n00:00:01.000 --> nope\nA\n')).toThrow('[VTT] line 3: invalid end timestamp "nope"');
    });

    it('rejects a header-only file', () => {
      expect(() => parseVtt('WEBVTT\n\n')).toThrow(/no valid cues/);
    });
  });
});

describe('format detection', () => {
  it('detects by header, then by file name', () => {
    expect(detectCaptionFormat('﻿WEBVTT\n')).toBe('vtt');
    expect(detectCaptionFormat('1\n00:00:01,000 --> 00:00:02,000\nA', 'a.srt')).toBe('srt');
    expect(detectCaptionFormat('garbage', 'x.VTT')).toBe('vtt');
  });

  it('parseCaptionFile dispatches to the right parser', () => {
    expect(parseCaptionFile('WEBVTT\n\n00:01.000 --> 00:02.000\nA').format).toBe('vtt');
    expect(parseCaptionFile('1\n00:00:01,000 --> 00:00:02,000\nA', 'x.srt').format).toBe('srt');
  });
});
