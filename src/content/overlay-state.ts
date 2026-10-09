import type { CaptionCue } from '../captions/types';
import type { Annotation, LookupResult, PhraseLookupResult, ReminderResult } from '../storage/protocol';
import type { TranscriptItem } from './transcript';
import { DEFAULT_SETTINGS, type Settings, type VocabStatus } from '../vocab/types';

/** Card position relative to the overlay root, in px. */
export interface CardPosition {
  x: number;
  /** Exactly one of bottom / top is set: the card opens above or below the clicked words. */
  bottom: number | null;
  top: number | null;
  /** Keeps the card inside the space above the subtitle box (it must not cover the English line). */
  maxHeight: number | null;
}

/** Which words of which caption line the card is about (for highlighting and phrase lookup). */
export interface CardTarget {
  lineKey: string;
  text: string;
  from: number;
  to: number;
}

/** Machine translation shown in a card (web pages only). Always labelled; never stored. */
export interface MtState {
  status: 'loading' | 'downloading' | 'done' | 'error';
  /** Language-pack download progress 0..1 (first use only). */
  progress?: number;
  text?: string;
  error?: string;
  /** Translation of the sentence the selection is in, as context. */
  sentence?: { source: string; status: 'loading' | 'done' | 'error'; text?: string };
  /** Which translator channel answered ("direct" / "bridge"), for diagnostics. */
  channel?: string;
}

export interface CardState extends CardPosition {
  /** word / phrase: dictionary cards; text: machine translation of a longer selection. */
  kind: 'word' | 'phrase' | 'text';
  /** Clicked word, or the selected words for a phrase card. */
  word: string;
  target: CardTarget | null;
  loading: boolean;
  result: LookupResult | null;
  phrase: PhraseLookupResult | null;
  mt: MtState | null;
  error: string | null;
  editing: boolean;
  saving: boolean;
}

/** true if word `index` of line `lineKey` is part of the card's target. */
export function isTargeted(card: CardState | null, lineKey: string, index: number): boolean {
  const t = card?.target;
  return !!t && t.lineKey === lineKey && index >= t.from && index <= t.to;
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
  /** Text YouTube is currently rendering as CC ("best effort" source), null if none. */
  liveText: string | null;
  /** YouTube CC button state; null when unknown. */
  ccOn: boolean | null;
  /** Captions seen so far in this video (best effort), in video order, with gap markers. Session only. */
  transcript: TranscriptItem[];
}

export type CaptionMode = 'file' | 'youtube' | 'none';

/** File import wins; otherwise YouTube's on-screen captions if enabled. */
export function captionMode(s: Pick<OverlayState, 'cues' | 'settings'>): CaptionMode {
  if (s.cues) return 'file';
  return s.settings.youtubeCaptions ? 'youtube' : 'none';
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
  liveText: null,
  ccOn: null,
  transcript: [],
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
