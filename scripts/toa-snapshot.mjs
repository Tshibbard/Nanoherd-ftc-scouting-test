// Downloads Orange Alliance data into data/toa/ so the web app can use it as
// a backup without ever seeing the API key. Run by
// .github/workflows/toa-snapshot.yml with the TOA_API_KEY repository secret.
//
//   TOA_API_KEY=... node scripts/toa-snapshot.mjs [EVENT_KEY ...]
//
// Event keys come from the arguments, the EVENT_KEYS env var (space
// separated) and data/toa-events.txt (one per line, # for comments).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as toa from '../js/toa.js';
import { season, DEFAULT_SEASON } from '../js/config.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'data', 'toa');
const key = process.env.TOA_API_KEY;
if (!key) {
  console.error('TOA_API_KEY is not set. Add it under Settings → Secrets and variables → Actions.');
  process.exit(1);
}

const safeName = (k) => String(k).replace(/[^A-Za-z0-9_-]/g, '_');

// Only rewrite a file when the data changed, so scheduled runs don't
// create a commit every time just because fetchedAt moved.
async function writeIfChanged(file, data) {
  const strip = ({ fetchedAt, ...rest }) => JSON.stringify(rest);
  try {
    const old = JSON.parse(await readFile(file, 'utf8'));
    if (strip(old) === strip(data)) return false;
  } catch { /* new file */ }
  await writeFile(file, JSON.stringify(data, null, 1) + '\n');
  return true;
}

async function listedEvents() {
  let text = '';
  try { text = await readFile(path.join(root, 'data', 'toa-events.txt'), 'utf8'); } catch { /* optional */ }
  const fromFile = text.split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);
  const fromEnv = (process.env.EVENT_KEYS || '').split(/[\s,]+/).filter(Boolean);
  return [...new Set([...process.argv.slice(2), ...fromEnv, ...fromFile])];
}

const cfg = season(DEFAULT_SEASON);
await mkdir(outDir, { recursive: true });
let failed = 0;

try {
  const events = await toa.fetchSeasonEvents(cfg.key, key);
  const changed = await writeIfChanged(path.join(outDir, `season-${cfg.key}.json`), { season: cfg.key, fetchedAt: Date.now(), events });
  console.log(`season ${cfg.key}: ${events.length} events${changed ? '' : ' (unchanged)'}`);
} catch (err) {
  failed++;
  console.error(`season ${cfg.key}: ${err.message}`);
}

for (const ek of await listedEvents()) {
  try {
    const ev = await toa.fetchEvent(ek, key);
    const changed = await writeIfChanged(path.join(outDir, `event-${safeName(ek)}.json`), ev);
    console.log(`${ek}: ${ev.teams.length} teams, ${ev.matches.length} matches${changed ? '' : ' (unchanged)'}`);
  } catch (err) {
    failed++;
    console.error(`${ek}: ${err.message}`);
  }
}

process.exit(failed ? 1 : 0);
