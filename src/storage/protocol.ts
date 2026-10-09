import type { DictEntry } from '../dict/dictionary';
import type { LemmaMethod } from '../dict/lemmatize';
import { MAX_SELECTION_WORDS } from '../dict/phrases';
import type { CustomDefinition, Settings, VocabRecord, VocabStatus } from '../vocab/types';

/** Messages from content script / options page -> background (service worker). */
export type LlRequest =
  // diagnostics (LL-001)
  | { type: 'll/kv-get'; key: string }
  | { type: 'll/kv-put'; key: string; value: unknown }
  | { type: 'll/kv-delete'; key: string }
  | { type: 'll/counter-increment'; key: string }
  | { type: 'll/sw-status' }
  // dictionary + vocabulary (LL-002)
  | {
      type: 'll/lookup';
      word: string;
      /** The caption line and the clicked word's index among its words, to find phrases containing it. */
      context?: { text: string; wordIndex: number };
    }
  | { type: 'll/phrase-lookup'; text: string; from: number; to: number }
  | { type: 'll/annotate'; words: string[] }
  /** Dictionary entries for many words at once (vocabulary book). */
  | { type: 'll/define'; words: string[] }
  | { type: 'll/vocab-set'; lemma: string; status: VocabStatus | null; word?: string }
  | { type: 'll/vocab-list' }
  | { type: 'll/custom-def-set'; lemma: string; text: string }
  | { type: 'll/custom-def-list' }
  | { type: 'll/settings-get' }
  | { type: 'll/settings-set'; settings: Partial<Settings> }
  | { type: 'll/export' }
  | { type: 'll/import'; data: unknown }
  | { type: 'll/reminder-check' }
  | { type: 'll/reminder-dismiss'; disable: boolean }
  | { type: 'll/open-options' };

export type LlResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

export interface KvRecord {
  key: string;
  value: unknown;
  updatedAt: number;
}

export interface SwStartEntry {
  instanceId: string;
  startedAt: number;
}

export interface SwStatus {
  instanceId: string;
  startedAt: number;
  uptimeMs: number;
  recentStarts: SwStartEntry[];
}

export interface LookupResult {
  query: string;
  word: string;
  lemma: string;
  method: LemmaMethod;
  dictAvailable: boolean;
  dictError: string | null;
  lemmaEntry: DictEntry | null;
  /** Entry for the surface form when it differs from the lemma and is itself a headword (e.g. "left"). */
  wordEntry: DictEntry | null;
  custom: CustomDefinition | null;
  vocab: VocabRecord | null;
  /** Dictionary phrases in the caption line that contain the clicked word (longest first, at most 3). */
  phrases: PhraseEntry[];
}

export interface PhraseEntry {
  phrase: string;
  entry: DictEntry;
}

export interface PhraseLookupResult {
  /** The selected words as shown. */
  selection: string;
  /** The selection itself as a dictionary phrase (possibly via lemmas: "gave up" -> "give up"). */
  match: PhraseEntry | null;
  /** Shorter dictionary phrases found inside the selection, when the selection itself is not one. */
  inner: PhraseEntry[];
  dictAvailable: boolean;
  dictError: string | null;
}

export interface DefineResult {
  /** Present only for words the dictionary has. */
  entries: Record<string, { phonetic: string; translation: string }>;
  dictAvailable: boolean;
  dictError: string | null;
}

export interface Annotation {
  lemma: string;
  status: VocabStatus | null;
  rank: number | null;
  inDict: boolean;
}

export interface ImportResult {
  vocab: { added: number; updated: number; unchanged: number };
  customDefinitions: { added: number; updated: number; unchanged: number };
  skipped: string[];
  settingsImported: boolean;
}

export interface ReminderResult {
  remind: boolean;
  daysSinceExport: number | null;
}

export const MAX_KEY_LENGTH = 200;
export const MAX_WORD_LENGTH = 100;
export const MAX_ANNOTATE_WORDS = 20_000;
export const MAX_CUSTOM_DEF_LENGTH = 2000;
export const LEMMA_RE = /^[a-z]+(?:['-][a-z]+)*$/;

const NO_ARG = new Set([
  'll/sw-status',
  'll/vocab-list',
  'll/custom-def-list',
  'll/settings-get',
  'll/export',
  'll/reminder-check',
  'll/open-options',
]);
const KEYED = new Set(['ll/kv-get', 'll/kv-put', 'll/kv-delete', 'll/counter-increment']);
const ALL = new Set([
  ...NO_ARG,
  ...KEYED,
  'll/lookup',
  'll/phrase-lookup',
  'll/annotate',
  'll/define',
  'll/vocab-set',
  'll/custom-def-set',
  'll/settings-set',
  'll/import',
  'll/reminder-dismiss',
]);

const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isLemma = (v: unknown): v is string => isStr(v, MAX_WORD_LENGTH) && LEMMA_RE.test(v);
const isIndex = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1000;
export const MAX_LINE_LENGTH = 500;

/** Returns null when valid, otherwise a human-readable reason. */
export function validateRequest(msg: unknown): string | null {
  if (msg === null || typeof msg !== 'object') return 'message must be an object';
  const m = msg as Record<string, unknown>;
  if (typeof m.type !== 'string' || !ALL.has(m.type)) return `unknown message type: ${String(m.type)}`;
  if (NO_ARG.has(m.type)) return null;
  if (KEYED.has(m.type)) {
    if (typeof m.key !== 'string' || m.key.length === 0) return 'key must be a non-empty string';
    if (m.key.length > MAX_KEY_LENGTH) return `key longer than ${MAX_KEY_LENGTH} characters`;
    if (m.type === 'll/kv-put' && !('value' in m)) return 'kv-put requires a value';
    return null;
  }
  switch (m.type) {
    case 'll/lookup': {
      if (!isStr(m.word, MAX_WORD_LENGTH)) return `word must be a string of 1-${MAX_WORD_LENGTH} characters`;
      if (m.context === undefined) return null;
      const c = m.context as { text?: unknown; wordIndex?: unknown } | null;
      if (!c || !isStr(c.text, MAX_LINE_LENGTH) || !isIndex(c.wordIndex)) return 'context must be { text, wordIndex }';
      return null;
    }
    case 'll/phrase-lookup':
      if (!isStr(m.text, MAX_LINE_LENGTH)) return `text must be a string of 1-${MAX_LINE_LENGTH} characters`;
      if (!isIndex(m.from) || !isIndex(m.to) || (m.to as number) < (m.from as number)) return 'from/to must be word indexes with from <= to';
      if ((m.to as number) - (m.from as number) + 1 > MAX_SELECTION_WORDS) return `select at most ${MAX_SELECTION_WORDS} words`;
      return null;
    case 'll/annotate':
    case 'll/define':
      if (!Array.isArray(m.words)) return 'words must be an array';
      if (m.words.length > MAX_ANNOTATE_WORDS) return `too many words (max ${MAX_ANNOTATE_WORDS})`;
      return m.words.every((w) => isStr(w, MAX_WORD_LENGTH)) ? null : 'every word must be a non-empty string';
    case 'll/vocab-set':
      if (!isLemma(m.lemma)) return 'lemma must be a lowercase word';
      if (m.status !== null && m.status !== 'known' && m.status !== 'learning' && m.status !== 'unknown') {
        return 'status must be known | learning | unknown | null';
      }
      if (m.word !== undefined && !isStr(m.word, MAX_WORD_LENGTH)) return 'word must be a string';
      return null;
    case 'll/custom-def-set':
      if (!isLemma(m.lemma)) return 'lemma must be a lowercase word';
      if (typeof m.text !== 'string' || m.text.length > MAX_CUSTOM_DEF_LENGTH) {
        return `text must be a string of at most ${MAX_CUSTOM_DEF_LENGTH} characters`;
      }
      return null;
    case 'll/settings-set':
      return m.settings && typeof m.settings === 'object' ? null : 'settings must be an object';
    case 'll/import':
      return 'data' in m ? null : 'import requires data';
    case 'll/reminder-dismiss':
      return typeof m.disable === 'boolean' ? null : 'disable must be a boolean';
  }
  return null;
}

export function isLlMessage(msg: unknown): boolean {
  return (
    msg !== null &&
    typeof msg === 'object' &&
    typeof (msg as { type?: unknown }).type === 'string' &&
    (msg as { type: string }).type.startsWith('ll/')
  );
}
