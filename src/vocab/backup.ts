import { isVocabStatus, sanitizeSettings, type CustomDefinition, type Settings, type VocabRecord } from './types';

export const BACKUP_FORMAT = 'lingualens-backup';
export const BACKUP_SCHEMA_VERSION = 1;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  vocab: VocabRecord[];
  customDefinitions: CustomDefinition[];
  settings: Settings;
}

export function buildBackup(input: {
  appVersion: string;
  now: number;
  vocab: VocabRecord[];
  customDefinitions: CustomDefinition[];
  settings: Settings;
}): BackupFile {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: input.appVersion,
    exportedAt: new Date(input.now).toISOString(),
    vocab: [...input.vocab].sort((a, b) => a.lemma.localeCompare(b.lemma)),
    customDefinitions: [...input.customDefinitions].sort((a, b) => a.lemma.localeCompare(b.lemma)),
    settings: input.settings,
  };
}

export type ParseBackupResult =
  | { ok: true; vocab: VocabRecord[]; customDefinitions: CustomDefinition[]; settings: Settings | null; skipped: string[] }
  | { ok: false; error: string };

const MAX_LEMMA = 100;
const MAX_DEF = 2000;
const validLemma = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_LEMMA;
const validTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * Validates a backup file. Whole-file problems (wrong format, newer schema) are errors;
 * individual malformed records are skipped and listed.
 */
export function parseBackup(data: unknown): ParseBackupResult {
  if (!data || typeof data !== 'object') return { ok: false, error: '文件内容不是 JSON 对象' };
  const d = data as Record<string, unknown>;
  if (d.format !== BACKUP_FORMAT) return { ok: false, error: `不是 LinguaLens 备份文件（format=${String(d.format)}）` };
  if (typeof d.schemaVersion !== 'number') return { ok: false, error: '缺少 schemaVersion' };
  if (d.schemaVersion > BACKUP_SCHEMA_VERSION) {
    return { ok: false, error: `备份文件版本 ${d.schemaVersion} 比当前支持的 ${BACKUP_SCHEMA_VERSION} 新，请先升级扩展` };
  }
  if (!Array.isArray(d.vocab)) return { ok: false, error: 'vocab 字段缺失或不是数组' };
  const skipped: string[] = [];
  const vocab: VocabRecord[] = [];
  d.vocab.forEach((r: unknown, i: number) => {
    const v = r as Partial<VocabRecord> | null;
    if (!v || !validLemma(v.lemma) || !isVocabStatus(v.status) || !validTime(v.updatedAt)) {
      skipped.push(`vocab[${i}]`);
      return;
    }
    vocab.push({
      lemma: v.lemma,
      status: v.status,
      createdAt: validTime(v.createdAt) ? v.createdAt : v.updatedAt,
      updatedAt: v.updatedAt,
      ...(typeof v.lastWord === 'string' ? { lastWord: v.lastWord.slice(0, MAX_LEMMA) } : {}),
    });
  });
  const customDefinitions: CustomDefinition[] = [];
  const defs = Array.isArray(d.customDefinitions) ? d.customDefinitions : [];
  defs.forEach((r: unknown, i: number) => {
    const c = r as Partial<CustomDefinition> | null;
    if (!c || !validLemma(c.lemma) || typeof c.text !== 'string' || !c.text.trim() || !validTime(c.updatedAt)) {
      skipped.push(`customDefinitions[${i}]`);
      return;
    }
    customDefinitions.push({ lemma: c.lemma, text: c.text.slice(0, MAX_DEF), updatedAt: c.updatedAt });
  });
  const settings = d.settings && typeof d.settings === 'object' ? sanitizeSettings(d.settings) : null;
  return { ok: true, vocab, customDefinitions, settings, skipped };
}

export interface MergePlan<T> {
  put: T[];
  added: number;
  updated: number;
  unchanged: number;
}

/** Last-writer-wins by updatedAt; existing newer records are kept. */
export function planMerge<T extends { lemma: string; updatedAt: number }>(
  existing: ReadonlyMap<string, T>,
  incoming: readonly T[],
): MergePlan<T> {
  const plan: MergePlan<T> = { put: [], added: 0, updated: 0, unchanged: 0 };
  const latest = new Map<string, T>();
  for (const r of incoming) {
    const prev = latest.get(r.lemma);
    if (!prev || r.updatedAt > prev.updatedAt) latest.set(r.lemma, r);
  }
  for (const r of latest.values()) {
    const cur = existing.get(r.lemma);
    if (!cur) {
      plan.put.push(r);
      plan.added++;
    } else if (r.updatedAt > cur.updatedAt) {
      plan.put.push(r);
      plan.updated++;
    } else plan.unchanged++;
  }
  return plan;
}
