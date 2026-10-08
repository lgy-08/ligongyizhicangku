export interface DictEntry {
  word: string;
  phonetic: string;
  /** Chinese translation, lines separated by "\n". */
  translation: string;
  tags: string[];
  /** Corpus frequency rank (smaller = more common); null when unknown. */
  frqRank: number | null;
}

/** Shape of public/dict/ecdict-lite.json (produced by scripts/build-dict.mjs). */
export interface DictFile {
  format: 'lingualens-dict';
  version: number;
  source: string;
  count: number;
  entries: [string, string, string, string, number][];
  forms: Record<string, string>;
}

export interface DictLike {
  get(word: string): DictEntry | undefined;
  has(word: string): boolean;
  /** Lemma recorded in the dictionary for an inflected form, if any. */
  lemmaOf(form: string): string | undefined;
}

export class Dictionary implements DictLike {
  private readonly entries = new Map<string, DictFile['entries'][number]>();
  private readonly forms: Map<string, string>;
  readonly source: string;

  constructor(file: DictFile) {
    for (const e of file.entries) this.entries.set(e[0], e);
    this.forms = new Map(Object.entries(file.forms));
    this.source = file.source;
  }

  static fromJson(data: unknown): Dictionary {
    const d = data as Partial<DictFile> | null;
    if (!d || d.format !== 'lingualens-dict' || d.version !== 1 || !Array.isArray(d.entries) || typeof d.forms !== 'object' || d.forms === null) {
      throw new Error('invalid dictionary file (expected lingualens-dict v1)');
    }
    return new Dictionary(d as DictFile);
  }

  get size(): number {
    return this.entries.size;
  }

  get(word: string): DictEntry | undefined {
    const e = this.entries.get(word);
    if (!e) return undefined;
    return {
      word: e[0],
      phonetic: e[1],
      translation: e[2].replace(/\\n/g, '\n'),
      tags: e[3] ? e[3].split(/\s+/) : [],
      frqRank: e[4] > 0 ? e[4] : null,
    };
  }

  has(word: string): boolean {
    return this.entries.has(word);
  }

  lemmaOf(form: string): string | undefined {
    return this.forms.get(form);
  }
}
