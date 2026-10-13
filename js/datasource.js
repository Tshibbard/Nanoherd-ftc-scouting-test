// Chooses where event data comes from:
//   1. FTCScout (primary, no key needed)
//   2. The Orange Alliance live API, if a key was entered in Settings
//   3. Orange Alliance snapshots in data/toa/, written by the
//      toa-snapshot GitHub Action using the TOA_API_KEY repository secret.
//      The key stays on GitHub; the browser only reads the JSON files.

import * as ftcscout from './ftcscout.js';
import * as toa from './toa.js';

const SNAPSHOT_DIR = 'data/toa/';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const safeName = (key) => String(key).replace(/[^A-Za-z0-9_-]/g, '_');

async function snapshot(file) {
  const res = await fetch(SNAPSHOT_DIR + file, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`no snapshot ${file}`);
  return res.json();
}

// Try TOA live (when the user has a key), then the published snapshot.
async function toaSeasonEvents(cfg, settings) {
  if (settings.toaKey) {
    try { return await toa.fetchSeasonEvents(cfg.key, settings.toaKey); } catch { /* fall through */ }
  }
  const snap = await snapshot(`season-${cfg.key}.json`);
  return snap.events || [];
}

async function toaEvent(toaKey, settings) {
  if (settings.toaKey) {
    try { return await toa.fetchEvent(toaKey, settings.toaKey); } catch { /* fall through */ }
  }
  return snapshot(`event-${safeName(toaKey)}.json`);
}

function backupError(primary, reason) {
  return new Error(`FTCScout failed (${primary.message}) and the Orange Alliance backup ${reason}`);
}

export async function fetchSeasonEvents(cfg, settings) {
  try {
    return { source: 'ftcscout', events: await ftcscout.fetchSeasonEvents(cfg.ftcscoutSeason) };
  } catch (err) {
    if (!navigator.onLine) throw err;
    try {
      return { source: 'toa', events: await toaSeasonEvents(cfg, settings) };
    } catch {
      throw backupError(err, 'is unavailable too');
    }
  }
}

// Decide which service a typed-in key belongs to.
export function normalizeKey(input, cfg) {
  const k = input.trim();
  if (/^\d{4}-/.test(k)) return k; // TOA: 2627-CA-XXX
  if (ftcscout.parseEventKey(k)) return k; // 2026:USCAQ1
  return ftcscout.eventKey(cfg.ftcscoutSeason, k.toUpperCase()); // bare FIRST code
}

// Returns the normalized event plus `via` ('ftcscout' | 'toa').
// For FTCScout events the app key stays the same even when the data came
// from TOA, so scouting records stay attached to one event.
export async function fetchEvent(key, cfg, settings, knownName = '') {
  if (!ftcscout.parseEventKey(key)) {
    return { ...(await toaEvent(key, settings)), source: 'toa', via: 'toa' };
  }
  try {
    return { ...(await ftcscout.fetchEvent(key)), via: 'ftcscout' };
  } catch (err) {
    if (!navigator.onLine) throw err;
    if (!knownName) throw backupError(err, "can't be matched without the event name (load it from the event list instead)");
    let list;
    try {
      list = await toaSeasonEvents(cfg, settings);
    } catch {
      throw backupError(err, 'is unavailable too');
    }
    const hit = list.find((e) => norm(e.name) === norm(knownName));
    if (!hit) throw backupError(err, `has no event named "${knownName}"`);
    let ev;
    try {
      ev = await toaEvent(hit.key, settings);
    } catch {
      throw backupError(err, `has no data for ${hit.key} yet`);
    }
    return { ...ev, key, name: ev.name || knownName, source: 'ftcscout', toaKey: hit.key, via: 'toa' };
  }
}
