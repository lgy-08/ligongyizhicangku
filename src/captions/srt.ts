import { sortCues } from './match';
import { cleanCueText, ensureString, normalizeNewlines, parseTimingLine, stripBom } from './text';
import { CaptionParseError, type CaptionCue, type ParseOptions, type ParseResult } from './types';

/**
 * Minimal SRT parser.
 * - Handles BOM, CRLF/CR, "," or "." millisecond separators, multi-line text, extra blank lines.
 * - Fatal (throws CaptionParseError): non-string / empty input, malformed timing line, end < start, no cues.
 * - Non-fatal (warning, block skipped): block without a timing line, empty text, zero duration.
 */
export function parseSrtDetailed(input: unknown, options: ParseOptions = {}): ParseResult {
  const source = options.source ?? 'srt-file';
  const raw = ensureString(input, 'srt');
  const lines = normalizeNewlines(stripBom(raw)).split('\n');
  if (lines.every((l) => l.trim() === '')) throw new CaptionParseError('input is empty', 'srt');

  const cues: CaptionCue[] = [];
  const warnings: string[] = [];
  let i = 0;
  let block = 0;

  while (i < lines.length) {
    while (i < lines.length && lines[i]!.trim() === '') i++;
    if (i >= lines.length) break;
    block++;
    const blockStart = i;

    // Optional numeric (or arbitrary) index line before the timing line.
    let timingIdx = -1;
    if (lines[i]!.includes('-->')) timingIdx = i;
    else if (i + 1 < lines.length && lines[i + 1]!.includes('-->')) timingIdx = i + 1;

    if (timingIdx === -1) {
      while (i < lines.length && lines[i]!.trim() !== '') i++;
      warnings.push(`block ${block} (line ${blockStart + 1}): no timing line, skipped`);
      continue;
    }

    const timing = parseTimingLine(lines[timingIdx]!, timingIdx + 1, 'srt');
    i = timingIdx + 1;
    const textLines: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== '') textLines.push(lines[i++]!);

    const text = cleanCueText(textLines.join('\n'));
    if (!text) {
      warnings.push(`block ${block} (line ${blockStart + 1}): empty text, skipped`);
      continue;
    }
    if (timing.endMs === timing.startMs) {
      warnings.push(`block ${block} (line ${blockStart + 1}): zero duration, skipped`);
      continue;
    }
    cues.push({
      id: `${source}#${cues.length + 1}`,
      startMs: timing.startMs,
      endMs: timing.endMs,
      text,
      source,
      timingConfidence: 'exact',
    });
  }

  if (cues.length === 0) throw new CaptionParseError('no valid cues found', 'srt');
  return { cues: sortCues(cues), warnings };
}

export function parseSrt(input: unknown, options: ParseOptions = {}): CaptionCue[] {
  return parseSrtDetailed(input, options).cues;
}
