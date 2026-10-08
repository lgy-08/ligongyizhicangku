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

/**
 * Selection: lowercase headword, non-empty Chinese translation, and at least one of
 * frq/bnc rank <= maxRank, an exam tag, a Collins star, or Oxford-3000 flag.
 */
export function selectEntries(rows, { maxRank = 40000 } = {}) {
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
  let total = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length < header.length - 2) continue;
    total++;
    const word = row[C.word];
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

  const entries = [...kept.values()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { entries, forms, stats: { rows: total } };
}
