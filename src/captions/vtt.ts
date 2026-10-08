import { sortCues } from './match';
import { cleanCueText, ensureString, normalizeNewlines, parseTimingLine, stripBom } from './text';
import { CaptionParseError, type CaptionCue, type ParseOptions, type ParseResult } from './types';

const HEADER_RE = /^WEBVTT(?:[ \t].*)?$/;
const SKIP_BLOCK_RE = /^(NOTE|STYLE|REGION)(?:[ \t]|$)/;

/**
 * Minimal WebVTT parser.
 * - Requires the "WEBVTT" header (after optional BOM).
 * - Skips NOTE / STYLE / REGION blocks, accepts optional cue identifiers, ignores cue settings.
 * - Strips inline tags (<c>, <v>, <b>, karaoke timestamps). Accepts "," as ms separator leniently.
 */
export function parseVttDetailed(input: unknown, options: ParseOptions = {}): ParseResult {
  const source = options.source ?? 'vtt-file';
  const raw = ensureString(input, 'vtt');
  const lines = normalizeNewlines(stripBom(raw)).split('\n');
  if (lines.every((l) => l.trim() === '')) throw new CaptionParseError('input is empty', 'vtt');
  if (!HEADER_RE.test(lines[0]!.trim())) {
    throw new CaptionParseError(`missing "WEBVTT" header (first line is "${lines[0]!.trim().slice(0, 40)}")`, 'vtt', 1);
  }

  // Skip the header block (header line + optional metadata lines until the first blank line).
  let i = 1;
  while (i < lines.length && lines[i]!.trim() !== '') {
    if (lines[i]!.includes('-->')) break; // tolerate a cue directly after the header
    i++;
  }

  const cues: CaptionCue[] = [];
  const warnings: string[] = [];
  let block = 0;

  while (i < lines.length) {
    while (i < lines.length && lines[i]!.trim() === '') i++;
    if (i >= lines.length) break;
    block++;
    const blockStart = i;
    const first = lines[i]!.trim();

    if (SKIP_BLOCK_RE.test(first) && !first.includes('-->')) {
      while (i < lines.length && lines[i]!.trim() !== '') i++;
      continue;
    }

    let timingIdx = -1;
    if (lines[i]!.includes('-->')) timingIdx = i;
    else if (i + 1 < lines.length && lines[i + 1]!.includes('-->')) timingIdx = i + 1;

    if (timingIdx === -1) {
      while (i < lines.length && lines[i]!.trim() !== '') i++;
      warnings.push(`block ${block} (line ${blockStart + 1}): no timing line, skipped`);
      continue;
    }

    const timing = parseTimingLine(lines[timingIdx]!, timingIdx + 1, 'vtt');
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

  if (cues.length === 0) throw new CaptionParseError('no valid cues found', 'vtt');
  return { cues: sortCues(cues), warnings };
}

export function parseVtt(input: unknown, options: ParseOptions = {}): CaptionCue[] {
  return parseVttDetailed(input, options).cues;
}
