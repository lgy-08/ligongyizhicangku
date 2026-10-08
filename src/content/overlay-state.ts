import type { CaptionCue } from '../captions/types';
import type { Annotation, LookupResult, ReminderResult } from '../storage/protocol';
import { DEFAULT_SETTINGS, type Settings, type VocabStatus } from '../vocab/types';

export interface CardState {
  /** Surface word as clicked. */
  word: string;
  /** Position relative to the overlay root, in px. */
  x: number;
  bottom: number;
  loading: boolean;
  result: LookupResult | null;
  error: string | null;
  editing: boolean;
  saving: boolean;
}

export interface OverlayState {
  videoId: string | null;
  fileName: string | null;
  cues: CaptionCue[] | null;
  activeCues: CaptionCue[];
  annotations: Record<string, Annotation>;
  settings: Settings;
  card: CardState | null;
  menuOpen: boolean;
  listOpen: boolean;
  message: { text: string; kind: 'info' | 'error' } | null;
  reminder: ReminderResult | null;
}

export const initialOverlayState = (): OverlayState => ({
  videoId: null,
  fileName: null,
  cues: null,
  activeCues: [],
  annotations: {},
  settings: DEFAULT_SETTINGS,
  card: null,
  menuOpen: false,
  listOpen: false,
  message: null,
  reminder: null,
});

/** CSS class for a word given its annotation and the settings. Pure, unit-tested. */
export function wordClass(a: Annotation | undefined, s: Settings): string {
  if (!a) return 'w';
  if (a.status === 'unknown') return 'w s-unknown';
  if (a.status === 'learning') return 'w s-learning';
  if (a.status === 'known') return 'w s-known';
  if (s.highlightRare && a.rank !== null && a.rank > s.rareRankThreshold) return 'w rare';
  return 'w';
}

/** After a status change, update every surface word that shares the lemma. */
export function applyStatus(
  annotations: Record<string, Annotation>,
  lemma: string,
  status: VocabStatus | null,
): Record<string, Annotation> {
  let changed = false;
  const next: Record<string, Annotation> = {};
  for (const [w, a] of Object.entries(annotations)) {
    if (a.lemma === lemma && a.status !== status) {
      next[w] = { ...a, status };
      changed = true;
    } else next[w] = a;
  }
  return changed ? next : annotations;
}
