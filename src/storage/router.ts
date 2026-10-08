import type { DictLike } from '../dict/dictionary';
import { lemmatize } from '../dict/lemmatize';
import { buildBackup, parseBackup, planMerge } from '../vocab/backup';
import { shouldRemind } from '../vocab/reminder';
import { DEFAULT_SETTINGS, sanitizeSettings, type CustomDefinition, type Settings, type VocabRecord, type VocabStatus } from '../vocab/types';
import {
  validateRequest,
  type Annotation,
  type ImportResult,
  type KvRecord,
  type LlRequest,
  type LlResponse,
  type LookupResult,
  type ReminderResult,
  type SwStartEntry,
  type SwStatus,
} from './protocol';

/** Generic key-value + SW log storage (LL-001). */
export interface KvStore {
  get(key: string): Promise<KvRecord | undefined>;
  put(key: string, value: unknown): Promise<KvRecord>;
  delete(key: string): Promise<void>;
  /** Atomic read-modify-write inside one transaction. */
  increment(key: string): Promise<KvRecord>;
  appendSwStart(entry: SwStartEntry): Promise<void>;
  recentSwStarts(limit: number): Promise<SwStartEntry[]>;
}

/** Learning data (LL-002). Keys are lemmas. */
export interface VocabStore {
  getVocabMany(lemmas: readonly string[]): Promise<Map<string, VocabRecord>>;
  /** status null deletes the record. createdAt is preserved across updates. */
  setVocab(lemma: string, status: VocabStatus | null, word?: string): Promise<VocabRecord | null>;
  listVocab(): Promise<VocabRecord[]>;
  getCustomDef(lemma: string): Promise<CustomDefinition | undefined>;
  /** Empty / whitespace text deletes the definition. */
  setCustomDef(lemma: string, text: string): Promise<CustomDefinition | null>;
  listCustomDefs(): Promise<CustomDefinition[]>;
  /** Writes all records in one transaction (import). */
  putMany(vocab: readonly VocabRecord[], defs: readonly CustomDefinition[]): Promise<void>;
}

export type Store = KvStore & VocabStore;

export interface SwInfo {
  instanceId: string;
  startedAt: number;
}

export interface RouterDeps {
  store: Store;
  sw: SwInfo;
  /** Resolves to null when the bundled dictionary is missing or failed to load. */
  getDict: () => Promise<{ dict: DictLike | null; error: string | null }>;
  appVersion: string;
  now?: () => number;
  openOptions?: () => Promise<void>;
}

export const SETTINGS_KEY = 'settings';
export const LAST_EXPORT_KEY = 'meta:lastExportAt';
export const LAST_REMINDED_KEY = 'meta:lastRemindedAt';

const EMPTY_DICT: DictLike = { get: () => undefined, has: () => false, lemmaOf: () => undefined };

async function readSettings(store: Store): Promise<Settings> {
  return sanitizeSettings((await store.get(SETTINGS_KEY))?.value, DEFAULT_SETTINGS);
}

async function readNumber(store: Store, key: string): Promise<number | null> {
  const v = (await store.get(key))?.value;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export async function handleRequest(msg: unknown, deps: RouterDeps): Promise<LlResponse> {
  const invalid = validateRequest(msg);
  if (invalid) return { ok: false, error: invalid };
  const req = msg as LlRequest;
  const { store, sw } = deps;
  const now = deps.now ?? Date.now;
  try {
    switch (req.type) {
      case 'll/kv-get':
        return { ok: true, data: (await store.get(req.key)) ?? null };
      case 'll/kv-put':
        return { ok: true, data: await store.put(req.key, req.value) };
      case 'll/kv-delete':
        await store.delete(req.key);
        return { ok: true, data: null };
      case 'll/counter-increment':
        return { ok: true, data: await store.increment(req.key) };
      case 'll/sw-status': {
        const status: SwStatus = {
          instanceId: sw.instanceId,
          startedAt: sw.startedAt,
          uptimeMs: now() - sw.startedAt,
          recentStarts: await store.recentSwStarts(10),
        };
        return { ok: true, data: status };
      }

      case 'll/lookup': {
        const { dict, error } = await deps.getDict();
        const d = dict ?? EMPTY_DICT;
        const lr = lemmatize(req.word, d);
        if (!lr.word) return { ok: false, error: 'not a word' };
        const [vocabMap, custom] = await Promise.all([store.getVocabMany([lr.lemma]), store.getCustomDef(lr.lemma)]);
        const result: LookupResult = {
          query: req.word,
          word: lr.word,
          lemma: lr.lemma,
          method: lr.method,
          dictAvailable: dict !== null,
          dictError: error,
          lemmaEntry: d.get(lr.lemma) ?? null,
          wordEntry: lr.word !== lr.lemma ? (d.get(lr.word) ?? null) : null,
          custom: custom ?? null,
          vocab: vocabMap.get(lr.lemma) ?? null,
        };
        return { ok: true, data: result };
      }
      case 'll/annotate': {
        const { dict } = await deps.getDict();
        const d = dict ?? EMPTY_DICT;
        const lemmas = new Map<string, string>();
        for (const w of req.words) lemmas.set(w, lemmatize(w, d).lemma);
        const vocab = await store.getVocabMany([...new Set(lemmas.values())].filter(Boolean));
        const out: Record<string, Annotation> = {};
        for (const [w, lemma] of lemmas) {
          if (!lemma) continue;
          const entry = d.get(lemma);
          out[w] = { lemma, status: vocab.get(lemma)?.status ?? null, rank: entry?.frqRank ?? null, inDict: !!entry };
        }
        return { ok: true, data: out };
      }
      case 'll/vocab-set':
        return { ok: true, data: await store.setVocab(req.lemma, req.status, req.word) };
      case 'll/vocab-list':
        return { ok: true, data: await store.listVocab() };
      case 'll/custom-def-set':
        return { ok: true, data: await store.setCustomDef(req.lemma, req.text) };
      case 'll/custom-def-list':
        return { ok: true, data: await store.listCustomDefs() };
      case 'll/settings-get':
        return { ok: true, data: await readSettings(store) };
      case 'll/settings-set': {
        const next = sanitizeSettings(req.settings, await readSettings(store));
        await store.put(SETTINGS_KEY, next);
        return { ok: true, data: next };
      }
      case 'll/export': {
        const [vocab, customDefinitions, settings] = await Promise.all([store.listVocab(), store.listCustomDefs(), readSettings(store)]);
        const t = now();
        const backup = buildBackup({ appVersion: deps.appVersion, now: t, vocab, customDefinitions, settings });
        await store.put(LAST_EXPORT_KEY, t);
        return { ok: true, data: backup };
      }
      case 'll/import': {
        const parsed = parseBackup(req.data);
        if (!parsed.ok) return { ok: false, error: parsed.error };
        const [vocabNow, defsNow] = await Promise.all([store.listVocab(), store.listCustomDefs()]);
        const vPlan = planMerge(new Map(vocabNow.map((r) => [r.lemma, r])), parsed.vocab);
        const dPlan = planMerge(new Map(defsNow.map((r) => [r.lemma, r])), parsed.customDefinitions);
        await store.putMany(vPlan.put, dPlan.put);
        if (parsed.settings) await store.put(SETTINGS_KEY, parsed.settings);
        const result: ImportResult = {
          vocab: { added: vPlan.added, updated: vPlan.updated, unchanged: vPlan.unchanged },
          customDefinitions: { added: dPlan.added, updated: dPlan.updated, unchanged: dPlan.unchanged },
          skipped: parsed.skipped,
          settingsImported: !!parsed.settings,
        };
        return { ok: true, data: result };
      }
      case 'll/reminder-check': {
        const [settings, vocab, lastExportAt, lastRemindedAt] = await Promise.all([
          readSettings(store),
          store.listVocab(),
          readNumber(store, LAST_EXPORT_KEY),
          readNumber(store, LAST_REMINDED_KEY),
        ]);
        const t = now();
        const r: ReminderResult = shouldRemind({
          now: t,
          reminderDays: settings.backupReminderDays,
          vocabCount: vocab.length,
          oldestRecordAt: vocab.length ? Math.min(...vocab.map((v) => v.createdAt)) : null,
          lastExportAt,
          lastRemindedAt,
        });
        if (r.remind) await store.put(LAST_REMINDED_KEY, t); // shown once per period
        return { ok: true, data: r };
      }
      case 'll/reminder-dismiss': {
        if (req.disable) {
          const next = sanitizeSettings({ backupReminderDays: 0 }, await readSettings(store));
          await store.put(SETTINGS_KEY, next);
        }
        return { ok: true, data: null };
      }
      case 'll/open-options':
        if (!deps.openOptions) return { ok: false, error: 'openOptions not available' };
        await deps.openOptions();
        return { ok: true, data: null };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  }
}
