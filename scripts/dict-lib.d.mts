export type DictRow = [string, string, string, string, number];
export function parseCsv(text: string): string[][];
export function parseExchange(s: string): Record<string, string>;
export function compactTranslation(raw: string): string;
export function generalTranslation(translation: string): string;
export const PHRASE_RE: RegExp;
export function selectEntries(
  rows: string[][],
  options?: { maxRank?: number; phraseMaxWords?: number; phraseWordMaxRank?: number },
): { entries: DictRow[]; forms: Record<string, string>; stats: { rows: number; words: number; phrases: number } };
