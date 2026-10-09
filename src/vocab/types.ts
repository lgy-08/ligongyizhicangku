/** 认识 / 半熟 / 不认识 */
export type VocabStatus = 'known' | 'learning' | 'unknown';
export const VOCAB_STATUSES: readonly VocabStatus[] = ['known', 'learning', 'unknown'];

export const STATUS_LABEL: Record<VocabStatus, string> = {
  known: '认识',
  learning: '半熟',
  unknown: '不认识',
};

/** One record per lemma (running / ran are stored under "run"). */
export interface VocabRecord {
  lemma: string;
  status: VocabStatus;
  createdAt: number;
  updatedAt: number;
  /** Surface form the user last marked, e.g. "ran". Informational only. */
  lastWord?: string;
}

/** User-written definition for words the dictionary lacks (or to supplement it). */
export interface CustomDefinition {
  lemma: string;
  text: string;
  updatedAt: number;
}

export interface Settings {
  /** Pause the video while the word card is open. Off by default (no forced pauses). */
  pauseOnLookup: boolean;
  /** Show the LL-001 diagnostics panel. */
  showDiagnostics: boolean;
  /** Underline unmarked words whose public frequency rank is above the threshold (rough "maybe new" hint). */
  highlightRare: boolean;
  rareRankThreshold: number;
  /** Days without export before ONE gentle reminder. 0 disables reminders. */
  backupReminderDays: number;
  /**
   * When no subtitle file is imported, show YouTube's on-screen CC text as clickable words
   * ("best effort": current text only, no timeline). Hides YouTube's own caption box meanwhile.
   */
  youtubeCaptions: boolean;
  /** Background opacity of the word card, 0.4 (very see-through) .. 1 (solid). */
  cardOpacity: number;
  /** Web lookup: a single click on a word opens its card (double-click and selection always work). */
  webClickLookup: boolean;
  /** Web lookup: machine translation with Chrome's on-device translator (phrases, long selections). */
  webTranslate: boolean;
}

export const CARD_OPACITY_MIN = 0.4;
export const CARD_OPACITY_MAX = 1;

export const DEFAULT_SETTINGS: Settings = {
  youtubeCaptions: true,
  cardOpacity: 0.78,
  webClickLookup: true,
  webTranslate: true,
  pauseOnLookup: false,
  showDiagnostics: false,
  highlightRare: false,
  rareRankThreshold: 8000,
  backupReminderDays: 30,
};

export function isVocabStatus(v: unknown): v is VocabStatus {
  return typeof v === 'string' && (VOCAB_STATUSES as readonly string[]).includes(v);
}

/** Merges a partial settings object, ignoring unknown keys and wrong types. */
export function sanitizeSettings(input: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const out: Settings = { ...base };
  if (!input || typeof input !== 'object') return out;
  const s = input as Record<string, unknown>;
  if (typeof s.pauseOnLookup === 'boolean') out.pauseOnLookup = s.pauseOnLookup;
  if (typeof s.youtubeCaptions === 'boolean') out.youtubeCaptions = s.youtubeCaptions;
  if (typeof s.webClickLookup === 'boolean') out.webClickLookup = s.webClickLookup;
  if (typeof s.webTranslate === 'boolean') out.webTranslate = s.webTranslate;
  if (typeof s.cardOpacity === 'number' && Number.isFinite(s.cardOpacity)) {
    out.cardOpacity = Math.round(Math.min(CARD_OPACITY_MAX, Math.max(CARD_OPACITY_MIN, s.cardOpacity)) * 100) / 100;
  }
  if (typeof s.showDiagnostics === 'boolean') out.showDiagnostics = s.showDiagnostics;
  if (typeof s.highlightRare === 'boolean') out.highlightRare = s.highlightRare;
  if (typeof s.rareRankThreshold === 'number' && Number.isFinite(s.rareRankThreshold) && s.rareRankThreshold >= 100) {
    out.rareRankThreshold = Math.round(s.rareRankThreshold);
  }
  if (typeof s.backupReminderDays === 'number' && Number.isFinite(s.backupReminderDays) && s.backupReminderDays >= 0) {
    out.backupReminderDays = Math.round(s.backupReminderDays);
  }
  return out;
}
