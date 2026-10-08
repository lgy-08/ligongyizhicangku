export type DictRow = [string, string, string, string, number];
export function parseCsv(text: string): string[][];
export function parseExchange(s: string): Record<string, string>;
export function compactTranslation(raw: string): string;
export function selectEntries(
  rows: string[][],
  options?: { maxRank?: number },
): { entries: DictRow[]; forms: Record<string, string>; stats: { rows: number } };
