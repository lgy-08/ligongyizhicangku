import { parseSrtDetailed } from './srt';
import { normalizeNewlines, stripBom } from './text';
import type { CaptionFormat, ParseResult } from './types';
import { parseVttDetailed } from './vtt';

export * from './types';
export { CueIndex, sortCues } from './match';
export { parseSrt, parseSrtDetailed } from './srt';
export { parseVtt, parseVttDetailed } from './vtt';
export { formatTimestamp, parseTimestamp } from './text';

/** Detects format from content first (WEBVTT header), then from the file name. */
export function detectCaptionFormat(text: string, fileName = ''): CaptionFormat {
  const firstLine = normalizeNewlines(stripBom(text)).split('\n', 1)[0]?.trim() ?? '';
  if (/^WEBVTT(?:[ \t]|$)/.test(firstLine)) return 'vtt';
  if (/\.vtt$/i.test(fileName)) return 'vtt';
  return 'srt';
}

export function parseCaptionFile(text: string, fileName = ''): ParseResult & { format: CaptionFormat } {
  const format = detectCaptionFormat(text, fileName);
  const result = format === 'vtt' ? parseVttDetailed(text) : parseSrtDetailed(text);
  return { ...result, format };
}
