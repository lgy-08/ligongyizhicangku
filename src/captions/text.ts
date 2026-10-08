import { CaptionParseError, type CaptionFormat } from './types';

export function stripBom(input: string): string {
  return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
}

/** CRLF and lone CR -> LF. */
export function normalizeNewlines(input: string): string {
  return input.replace(/\r\n?/g, '\n');
}

const TIMESTAMP_RE = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/;

/**
 * Parses "HH:MM:SS,mmm", "HH:MM:SS.mmm", "MM:SS.mmm" (hours optional, as in WebVTT).
 * Accepts both "," and "." as the millisecond separator. Returns null when invalid.
 */
export function parseTimestamp(raw: string): number | null {
  const m = TIMESTAMP_RE.exec(raw.trim());
  if (!m) return null;
  const hours = m[1] !== undefined ? Number(m[1]) : 0;
  const minutes = Number(m[2]);
  const seconds = Number(m[3]);
  if (minutes > 59 || seconds > 59) return null;
  // "1,5" means 500ms: the fraction is right-padded to 3 digits.
  const millis = m[4] !== undefined ? Number(m[4].padEnd(3, '0')) : 0;
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
}

export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const mmm = total % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${h > 0 ? `${h}:` : ''}${pad(m)}:${pad(s)}.${pad(mmm, 3)}`;
}

export interface TimingLine {
  startMs: number;
  endMs: number;
  /** Anything after the end timestamp (VTT cue settings, SRT coordinates). */
  rest: string;
}

const TIMING_LINE_RE = /^\s*(\S+)\s*-->\s*(\S+)(.*)$/;

/** Throws CaptionParseError with the line number for malformed timing lines. */
export function parseTimingLine(raw: string, lineNo: number, format: CaptionFormat): TimingLine {
  const m = TIMING_LINE_RE.exec(raw);
  if (!m) {
    throw new CaptionParseError(`invalid timing line "${raw.trim()}" (expected "start --> end")`, format, lineNo);
  }
  const startMs = parseTimestamp(m[1]!);
  if (startMs === null) throw new CaptionParseError(`invalid start timestamp "${m[1]}"`, format, lineNo);
  const endMs = parseTimestamp(m[2]!);
  if (endMs === null) throw new CaptionParseError(`invalid end timestamp "${m[2]}"`, format, lineNo);
  if (endMs < startMs) {
    throw new CaptionParseError(`end time ${m[2]} is before start time ${m[1]}`, format, lineNo);
  }
  return { startMs, endMs, rest: m[3]!.trim() };
}

const ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&lrm;': '',
  '&rlm;': '',
};

/**
 * Plain-text cleanup shared by SRT and VTT:
 * strips markup tags (<i>, <c.color>, <v Speaker>, <00:00:01.000>), ASS overrides ({\an8}),
 * decodes common entities, trims lines and drops empty lines. Line breaks are kept as "\n".
 */
export function cleanCueText(text: string): string {
  const stripped = text
    .replace(/<[^>\n]*>/g, '')
    .replace(/\{\\[^}\n]*\}/g, '')
    .replace(/&(lt|gt|quot|#39|apos|nbsp|lrm|rlm);/g, (e) => ENTITIES[e] ?? e)
    .replace(/&amp;/g, '&');
  return stripped
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => l.length > 0)
    .join('\n');
}

export function ensureString(input: unknown, format: CaptionFormat): string {
  if (typeof input !== 'string') {
    throw new CaptionParseError(`input must be a string, got ${input === null ? 'null' : typeof input}`, format);
  }
  return input;
}
