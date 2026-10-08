import type { CaptionCue } from './types';

/** Stable sort by start, then end. Returns a new array. */
export function sortCues(cues: readonly CaptionCue[]): CaptionCue[] {
  return cues
    .map((cue, idx) => ({ cue, idx }))
    .sort((a, b) => a.cue.startMs - b.cue.startMs || a.cue.endMs - b.cue.endMs || a.idx - b.idx)
    .map((x) => x.cue);
}

/**
 * Time lookup over cues, correct for overlapping cues.
 * A cue is active at t when startMs <= t < endMs (half-open interval).
 */
export class CueIndex {
  readonly cues: readonly CaptionCue[];
  /** prefixMaxEnd[i] = max(endMs of cues[0..i]); lets the backwards scan stop early. */
  private readonly prefixMaxEnd: number[];

  constructor(cues: readonly CaptionCue[]) {
    this.cues = sortCues(cues);
    this.prefixMaxEnd = [];
    let max = -Infinity;
    for (const c of this.cues) {
      max = Math.max(max, c.endMs);
      this.prefixMaxEnd.push(max);
    }
  }

  get size(): number {
    return this.cues.length;
  }

  /** Index of the last cue with startMs <= t, or -1. */
  private lastStartingAtOrBefore(t: number): number {
    let lo = 0;
    let hi = this.cues.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.cues[mid]!.startMs <= t) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }

  /** All cues active at t, in start order. */
  activeAt(t: number): CaptionCue[] {
    if (!Number.isFinite(t)) return [];
    const out: CaptionCue[] = [];
    for (let i = this.lastStartingAtOrBefore(t); i >= 0 && this.prefixMaxEnd[i]! > t; i--) {
      const c = this.cues[i]!;
      if (c.endMs > t) out.push(c);
    }
    return out.reverse();
  }

  /** The first cue starting at or after t (useful for "next line"), or null. */
  nextAfter(t: number): CaptionCue | null {
    let lo = 0;
    let hi = this.cues.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cues[mid]!.startMs < t) lo = mid + 1;
      else hi = mid;
    }
    return this.cues[lo] ?? null;
  }
}
