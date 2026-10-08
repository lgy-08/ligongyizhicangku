/**
 * Session-only list of the YouTube captions that have appeared ("best effort" mode).
 *
 * The UI shows sentences in order WITHOUT times. Internally each line keeps the media time at
 * which it was first seen, and the list is sorted by that time, so seeking back and forth does
 * not scramble the order. Nothing here is persisted.
 */

export interface TranscriptLine {
  id: number;
  text: string;
  /** Media time (ms) when this line was first seen. Sorting key only; never shown as "exact". */
  timeMs: number;
}

export type TranscriptItem = { kind: 'line'; line: TranscriptLine } | { kind: 'gap'; key: string };

/** Same text seen again within this window is the same line (replay after seeking back, ASR scroll). */
export const DEDUPE_WINDOW_MS = 8000;
export const MAX_LINES = 5000;

export class LiveTranscript {
  private readonly lines: TranscriptLine[] = [];
  private seq = 0;

  get size(): number {
    return this.lines.length;
  }

  get all(): readonly TranscriptLine[] {
    return this.lines;
  }

  /**
   * Records one visible caption line seen at media time t. Returns true if the list changed.
   * - identical text nearby in time: ignored (replay)
   * - longer version of a nearby line (auto-generated captions grow word by word): line updated
   * - shorter prefix of a nearby line (partially seen again): ignored
   */
  add(rawText: string, timeMs: number): boolean {
    const text = rawText.replace(/\s+/g, ' ').trim();
    if (!text || !Number.isFinite(timeMs)) return false;
    const lo = this.lowerBound(timeMs - DEDUPE_WINDOW_MS);
    for (let i = lo; i < this.lines.length && this.lines[i]!.timeMs <= timeMs + DEDUPE_WINDOW_MS; i++) {
      const l = this.lines[i]!;
      if (l.text === text) return false;
      if (text.startsWith(l.text)) {
        l.text = text; // grew: keep the original first-seen time
        return true;
      }
      if (l.text.startsWith(text)) return false;
    }
    if (this.lines.length >= MAX_LINES) return false;
    const line: TranscriptLine = { id: ++this.seq, text, timeMs };
    this.lines.splice(this.lowerBound(timeMs + 0.5), 0, line); // after lines with the same time
    return true;
  }

  clear(): void {
    this.lines.length = 0;
  }

  /** First index with timeMs >= t. */
  private lowerBound(t: number): number {
    let lo = 0;
    let hi = this.lines.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.lines[mid]!.timeMs < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

/**
 * Which parts of the video were actually played (with the overlay attached).
 * Used only to show "a part was skipped here" between two lines.
 */
export class Coverage {
  private readonly spans: [number, number][] = [];
  private current: [number, number] | null = null;
  /** Continuous playback advances by roughly one timeupdate (~250 ms x playback rate). */
  static readonly MAX_STEP_MS = 3000;
  static readonly TOLERANCE_MS = 1500;

  note(t: number): void {
    if (!Number.isFinite(t)) return;
    const c = this.current;
    if (c && t >= c[1] - 500 && t <= c[1] + Coverage.MAX_STEP_MS) {
      if (t > c[1]) c[1] = t;
      return;
    }
    this.current = [t, t];
    this.spans.push(this.current);
  }

  /** Call on seeking: the next note() starts a new span. */
  break(): void {
    this.current = null;
  }

  clear(): void {
    this.spans.length = 0;
    this.current = null;
  }

  /** Merged spans, sorted. */
  merged(): [number, number][] {
    const s = this.spans.map(([a, b]) => [a, b] as [number, number]).sort((x, y) => x[0] - y[0]);
    const out: [number, number][] = [];
    for (const span of s) {
      const last = out[out.length - 1];
      if (last && span[0] <= last[1] + Coverage.TOLERANCE_MS) last[1] = Math.max(last[1], span[1]);
      else out.push(span);
    }
    return out;
  }

  /** true if [a, b] lies inside one continuously played stretch. */
  covers(a: number, b: number): boolean {
    return spansCover(this.merged(), a, b);
  }
}

function spansCover(merged: readonly [number, number][], a: number, b: number): boolean {
  const tol = Coverage.TOLERANCE_MS;
  return merged.some(([s, e]) => s <= a + tol && e >= b - tol);
}

/** Lines in time order, with a gap marker wherever the stretch between two lines was not played. */
export function buildTranscriptView(lines: readonly TranscriptLine[], coverage: Coverage): TranscriptItem[] {
  const merged = coverage.merged();
  const out: TranscriptItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const prev = lines[i - 1];
    if (prev && !spansCover(merged, prev.timeMs, line.timeMs)) out.push({ kind: 'gap', key: `gap-${prev.id}-${line.id}` });
    out.push({ kind: 'line', line: { ...line } });
  }
  return out;
}
