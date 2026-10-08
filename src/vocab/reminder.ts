const DAY = 86_400_000;

export interface ReminderInput {
  now: number;
  reminderDays: number;
  vocabCount: number;
  /** Oldest vocab record time; used when the user has never exported. */
  oldestRecordAt: number | null;
  lastExportAt: number | null;
  lastRemindedAt: number | null;
}

/**
 * Remind at most once per period: only if there is data, the last export (or the first record,
 * if never exported) is older than reminderDays, and no reminder was shown in the last reminderDays.
 */
export function shouldRemind(i: ReminderInput): { remind: boolean; daysSinceExport: number | null } {
  const since = i.lastExportAt ?? i.oldestRecordAt;
  const daysSinceExport = since === null ? null : Math.floor((i.now - since) / DAY);
  if (i.reminderDays <= 0 || i.vocabCount === 0 || since === null) return { remind: false, daysSinceExport };
  const period = i.reminderDays * DAY;
  if (i.now - since < period) return { remind: false, daysSinceExport };
  if (i.lastRemindedAt !== null && i.now - i.lastRemindedAt < period) return { remind: false, daysSinceExport };
  return { remind: true, daysSinceExport };
}
