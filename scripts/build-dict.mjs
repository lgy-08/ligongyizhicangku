#!/usr/bin/env node
/**
 * Builds public/dict/ecdict-lite.json from ECDICT (https://github.com/skywind3000/ECDICT, MIT).
 *
 *   node scripts/build-dict.mjs              # uses data-src/ecdict.csv
 *   node scripts/build-dict.mjs --download   # downloads ecdict.csv first (≈66 MB) into data-src/
 *
 * The generated file is NOT committed (see .gitignore); only this script and the license are.
 * lemma.en.txt from the same repo is deliberately NOT used: its header restricts it to
 * "research and/or educational purposes", which is not the repo's MIT license.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, selectEntries } from './dict-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'data-src');
const CSV = join(SRC_DIR, 'ecdict.csv');
const OUT_DIR = join(ROOT, 'public', 'dict');
const OUT = join(OUT_DIR, 'ecdict-lite.json');
const RAW = 'https://raw.githubusercontent.com/skywind3000/ECDICT/master';
/** SHA-256 of the ecdict.csv this pipeline was validated against (downloaded 2026-10-08). */
const KNOWN_SHA256 = '1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf';

async function download(name, dest) {
  const res = await fetch(`${RAW}/${name}`);
  if (!res.ok) throw new Error(`download ${name} failed: HTTP ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  const args = new Set(process.argv.slice(2));
  mkdirSync(SRC_DIR, { recursive: true });
  if (args.has('--download') || !existsSync(CSV)) {
    if (!args.has('--download')) {
      console.error(`Missing ${CSV}. Run: npm run dict -- --download`);
      process.exit(1);
    }
    console.log('Downloading ecdict.csv and LICENSE ...');
    await download('ecdict.csv', CSV);
    await download('LICENSE', join(SRC_DIR, 'LICENSE'));
  }

  const buf = readFileSync(CSV);
  const sha = createHash('sha256').update(buf).digest('hex');
  if (sha !== KNOWN_SHA256) {
    console.warn(`WARNING: ecdict.csv SHA-256 ${sha} differs from the validated ${KNOWN_SHA256}.`);
    console.warn('Upstream data changed; review the output before shipping.');
  }

  const t0 = performance.now();
  const rows = parseCsv(buf.toString('utf8'));
  const { entries, forms, stats } = selectEntries(rows);
  const out = {
    format: 'lingualens-dict',
    version: 1,
    source: 'ECDICT (MIT) https://github.com/skywind3000/ECDICT',
    sourceSha256: sha,
    generatedAt: new Date().toISOString(),
    count: entries.length,
    // [word, phonetic, translation, tags, frqRank(0 = unknown)]
    entries,
    // inflected form -> lemma
    forms,
  };
  mkdirSync(OUT_DIR, { recursive: true });
  const json = JSON.stringify(out);
  writeFileSync(OUT, json);
  const lic = join(SRC_DIR, 'LICENSE');
  if (existsSync(lic)) copyFileSync(lic, join(OUT_DIR, 'LICENSE-ECDICT.txt'));
  console.log(
    `rows ${stats.rows}, kept ${entries.length} entries, ${Object.keys(forms).length} form->lemma mappings, ` +
      `${(json.length / 1024 / 1024).toFixed(2)} MB, ${Math.round(performance.now() - t0)} ms -> ${OUT}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
