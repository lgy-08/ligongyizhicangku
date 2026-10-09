import { describe, expect, it } from 'vitest';
import { buildBackup, parseBackup, planMerge } from '../src/vocab/backup';
import { shouldRemind } from '../src/vocab/reminder';
import { DEFAULT_SETTINGS, sanitizeSettings, type VocabRecord } from '../src/vocab/types';

const v = (lemma: string, updatedAt: number, status: VocabRecord['status'] = 'unknown'): VocabRecord => ({
  lemma,
  status,
  createdAt: 1,
  updatedAt,
});

describe('buildBackup / parseBackup', () => {
  it('round-trips', () => {
    const b = buildBackup({
      appVersion: '0.1.0',
      now: Date.UTC(2026, 9, 8),
      vocab: [v('zebra', 5), v('apple', 6, 'known')],
      customDefinitions: [{ lemma: 'apple', text: '苹果', updatedAt: 7 }],
      settings: DEFAULT_SETTINGS,
    });
    expect(b).toMatchObject({ format: 'lingualens-backup', schemaVersion: 1, appVersion: '0.1.0', exportedAt: '2026-10-08T00:00:00.000Z' });
    expect(b.vocab.map((x) => x.lemma)).toEqual(['apple', 'zebra']);
    const p = parseBackup(JSON.parse(JSON.stringify(b)));
    expect(p).toEqual({ ok: true, vocab: b.vocab, customDefinitions: b.customDefinitions, settings: DEFAULT_SETTINGS, skipped: [] });
  });

  it('rejects files that are not LinguaLens backups or are too new', () => {
    expect(parseBackup(null)).toEqual({ ok: false, error: '文件内容不是 JSON 对象' });
    expect(parseBackup({ format: 'other' })).toMatchObject({ ok: false, error: expect.stringContaining('不是 LinguaLens 备份文件') });
    expect(parseBackup({ format: 'lingualens-backup' })).toMatchObject({ ok: false, error: '缺少 schemaVersion' });
    expect(parseBackup({ format: 'lingualens-backup', schemaVersion: 99, vocab: [] })).toMatchObject({
      ok: false,
      error: expect.stringContaining('请先升级扩展'),
    });
    expect(parseBackup({ format: 'lingualens-backup', schemaVersion: 1 })).toMatchObject({ ok: false, error: expect.stringContaining('vocab') });
  });

  it('skips malformed records but keeps the rest', () => {
    const p = parseBackup({
      format: 'lingualens-backup',
      schemaVersion: 1,
      vocab: [v('ok', 2), { lemma: 'bad', status: 'maybe', updatedAt: 1 }, { lemma: '', status: 'known', updatedAt: 1 }, null],
      customDefinitions: [{ lemma: 'ok', text: '  ', updatedAt: 1 }],
    });
    expect(p.ok && p.vocab.map((x) => x.lemma)).toEqual(['ok']);
    expect(p.ok && p.skipped).toEqual(['vocab[1]', 'vocab[2]', 'vocab[3]', 'customDefinitions[0]']);
    expect(p.ok && p.settings).toBeNull();
  });
});

describe('planMerge', () => {
  it('last-writer-wins by updatedAt, never deletes', () => {
    const existing = new Map([
      ['a', v('a', 10)],
      ['b', v('b', 10)],
      ['keep', v('keep', 1)],
    ]);
    const plan = planMerge(existing, [v('a', 20, 'known'), v('b', 5), v('c', 1), v('c', 3, 'learning')]);
    expect(plan.put).toEqual([v('a', 20, 'known'), v('c', 3, 'learning')]);
    expect(plan).toMatchObject({ added: 1, updated: 1, unchanged: 1 });
  });
});

describe('shouldRemind', () => {
  const DAY = 86_400_000;
  const base = { now: 100 * DAY, reminderDays: 30, vocabCount: 5, oldestRecordAt: 10 * DAY, lastExportAt: null, lastRemindedAt: null };
  it('reminds when never exported and data is older than the period', () => {
    expect(shouldRemind(base)).toEqual({ remind: true, daysSinceExport: 90 });
  });
  it('does not remind without data, when disabled, or when recently exported', () => {
    expect(shouldRemind({ ...base, vocabCount: 0 }).remind).toBe(false);
    expect(shouldRemind({ ...base, reminderDays: 0 }).remind).toBe(false);
    expect(shouldRemind({ ...base, lastExportAt: 80 * DAY })).toEqual({ remind: false, daysSinceExport: 20 });
  });
  it('reminds at most once per period', () => {
    expect(shouldRemind({ ...base, lastRemindedAt: 95 * DAY }).remind).toBe(false);
    expect(shouldRemind({ ...base, lastRemindedAt: 60 * DAY }).remind).toBe(true);
  });
});

describe('sanitizeSettings', () => {
  it('keeps valid fields, ignores wrong types and unknown keys', () => {
    expect(sanitizeSettings({ pauseOnLookup: true, rareRankThreshold: 'x', backupReminderDays: -1, evil: 1 })).toEqual({
      ...DEFAULT_SETTINGS,
      pauseOnLookup: true,
    });
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ rareRankThreshold: 5000.4, backupReminderDays: 0 })).toMatchObject({ rareRankThreshold: 5000, backupReminderDays: 0 });
    // card opacity is clamped to 0.4 .. 1
    expect(sanitizeSettings({ cardOpacity: 0.1 }).cardOpacity).toBe(0.4);
    expect(sanitizeSettings({ cardOpacity: 3 }).cardOpacity).toBe(1);
    expect(sanitizeSettings({ cardOpacity: 0.666 }).cardOpacity).toBe(0.67);
    expect(sanitizeSettings({ cardOpacity: 'x' }).cardOpacity).toBe(DEFAULT_SETTINGS.cardOpacity);
    expect(DEFAULT_SETTINGS.webClickLookup).toBe(true);
    expect(sanitizeSettings({ webClickLookup: false }).webClickLookup).toBe(false);
    expect(sanitizeSettings({ webClickLookup: 'no' }).webClickLookup).toBe(true);
  });
});
