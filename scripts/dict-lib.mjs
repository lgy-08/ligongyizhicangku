/**
 * Pure helpers for scripts/build-dict.mjs (unit-tested in tests/dict-build.test.ts).
 */

/** RFC 4180 CSV parser: quoted fields, "" escapes, CRLF/LF, newlines inside quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
    } else if (ch === ',') {
      row.push(field);
      field = '';
      i++;
    } else if (ch === '\n' || ch === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
    } else {
      field += ch;
      i++;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** "0:run/1:i/i:running" -> { '0': 'run', '1': 'i', i: 'running' } */
export function parseExchange(s) {
  const out = {};
  if (!s) return out;
  for (const part of s.split('/')) {
    const idx = part.indexOf(':');
    if (idx > 0) out[part.slice(0, idx)] = part.slice(idx + 1);
  }
  return out;
}

const WORD_RE = /^[a-z]+(?:[-'][a-z]+)*$/;
const FORM_KEYS = ['p', 'd', 'i', '3', 's', 'r', 't'];

/** ECDICT translations use literal "\n"; keep at most 4 lines / 240 chars. */
export function compactTranslation(raw) {
  const lines = raw
    .split('\\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('[网络]'));
  let out = '';
  for (const l of lines.slice(0, 4)) {
    const next = out ? `${out}\n${l}` : l;
    if (next.length > 240) break;
    out = next;
  }
  return out || lines[0]?.slice(0, 240) || '';
}

const num = (s) => {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export const PHRASE_RE = /^[a-z]+(?:[-'][a-z]+)*(?: [a-z]+(?:[-'][a-z]+)*)+$/;
/** Lines like "[计] 自动分级" mark technical terms (computing, economics, ...): not useful for subtitles. */
const DOMAIN_LINE_RE = /^\[[^\]]{1,4}\]/;

/** Keeps only general-language lines of a phrase translation; '' if every line is a technical term. */
export function generalTranslation(translation) {
  return translation
    .split('\n')
    .filter((l) => !DOMAIN_LINE_RE.test(l))
    .join('\n');
}

/**
 * Selection:
 * - single words: lowercase headword, non-empty Chinese translation, and at least one of
 *   frq/bnc rank <= maxRank, an exam tag, a Collins star, or Oxford-3000 flag;
 * - phrases: 2..phraseMaxWords words, every word (hyphen parts included) a kept word with
 *   rank <= phraseWordMaxRank, and at least one general-language (non-technical) translation line.
 */
export function selectEntries(rows, { maxRank = 40000, phraseMaxWords = 5, phraseWordMaxRank = 10000 } = {}) {
  const header = rows[0];
  const col = (name) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`CSV column "${name}" not found`);
    return i;
  };
  const C = {
    word: col('word'),
    phonetic: col('phonetic'),
    translation: col('translation'),
    collins: col('collins'),
    oxford: col('oxford'),
    tag: col('tag'),
    bnc: col('bnc'),
    frq: col('frq'),
    exchange: col('exchange'),
  };

  const kept = new Map();
  const exchanges = [];
  const phraseRows = [];
  let total = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length < header.length - 2) continue;
    total++;
    const word = row[C.word];
    if (PHRASE_RE.test(word)) {
      phraseRows.push(row);
      continue;
    }
    if (!WORD_RE.test(word)) continue;
    const ex = parseExchange(row[C.exchange]);
    exchanges.push([word, ex]);
    const translation = compactTranslation(row[C.translation] ?? '');
    if (!translation) continue;
    const frq = num(row[C.frq]);
    const bnc = num(row[C.bnc]);
    const tag = (row[C.tag] ?? '').trim();
    const rank = frq || bnc;
    const keep = (rank > 0 && rank <= maxRank) || tag !== '' || num(row[C.collins]) > 0 || row[C.oxford] === '1';
    if (!keep) continue;
    kept.set(word, [word, row[C.phonetic] ?? '', translation, tag, rank]);
  }

  const forms = {};
  // 1) Lemma rows list their inflections (p/d/i/3/s/r/t).
  for (const [word, ex] of exchanges) {
    if (!kept.has(word)) continue;
    for (const k of FORM_KEYS) {
      const f = ex[k];
      if (f && WORD_RE.test(f) && f !== word && !(f in forms)) forms[f] = word;
    }
  }
  // 2) A form's own row ("0:lemma") is more specific and overrides.
  for (const [word, ex] of exchanges) {
    const lemma = ex['0'];
    if (lemma && lemma !== word && WORD_RE.test(lemma) && kept.has(lemma)) forms[word] = lemma;
  }

  // 3) Phrases, made only of common words.
  const commonWord = (w) => {
    const e = kept.get(w);
    return !!e && e[4] > 0 && e[4] <= phraseWordMaxRank;
  };
  const phrases = [];
  for (const row of phraseRows) {
    const phrase = row[C.word];
    const words = phrase.split(' ');
    if (words.length > phraseMaxWords) continue;
    if (!words.flatMap((w) => w.split('-')).every(commonWord)) continue;
    const translation = generalTranslation(compactTranslation(row[C.translation] ?? ''));
    if (!translation) continue;
    phrases.push([phrase, row[C.phonetic] ?? '', translation, (row[C.tag] ?? '').trim(), num(row[C.frq]) || num(row[C.bnc])]);
  }

  const entries = [...kept.values(), ...phrases].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { entries, forms, stats: { rows: total, words: kept.size, phrases: phrases.length } };
}
