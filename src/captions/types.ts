/** Unified caption cue. Times are milliseconds from media start. */
export interface CaptionCue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  /** Where the cue came from, e.g. "srt-file", "vtt-file", "youtube-dom". */
  source: string;
  /**
   * "exact"     - timing comes from a structured source (SRT/VTT file, full timeline).
   * "estimated" - timing was inferred by observing when text appeared/disappeared.
   * Estimated timing must never be labelled "exact".
   */
  timingConfidence: 'exact' | 'estimated';
}

export type CaptionFormat = 'srt' | 'vtt';

export class CaptionParseError extends Error {
  readonly format: CaptionFormat;
  /** 1-based line number where the problem was detected, when known. */
  readonly line: number | undefined;

  constructor(message: string, format: CaptionFormat, line?: number) {
    super(line !== undefined ? `[${format.toUpperCase()}] line ${line}: ${message}` : `[${format.toUpperCase()}] ${message}`);
    this.name = 'CaptionParseError';
    this.format = format;
    this.line = line;
  }
}

export interface ParseOptions {
  /** Value for CaptionCue.source. Defaults to "srt-file" / "vtt-file". */
  source?: string;
}

export interface ParseResult {
  cues: CaptionCue[];
  /** Non-fatal problems (skipped blocks etc.), human readable. */
  warnings: string[];
}
