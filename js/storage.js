// Local persistence. Everything is kept in localStorage so the app works
// with no internet connection; data only leaves the device via QR codes
// or exported files.

const PREFIX = 'ftcs.';

function read(name, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + name);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(name, value) {
  localStorage.setItem(PREFIX + name, JSON.stringify(value));
}

// ---- settings --------------------------------------------------------------

const DEFAULT_SETTINGS = {
  toaKey: '',
  scout: '',
  eventKey: '',
  station: 'R1',
  season: '2627',
};

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...read('settings', {}) };
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  write('settings', next);
  return next;
}

// ---- event data (teams / schedule / rankings from The Orange Alliance) -----

export function getEvents() {
  return read('events', {});
}

export function getEvent(key) {
  return getEvents()[key] || null;
}

export function saveEvent(event) {
  const all = getEvents();
  all[event.key] = event;
  write('events', all);
}

export function deleteEvent(key) {
  const all = getEvents();
  delete all[key];
  write('events', all);
}

export function getEventList() {
  return read('eventList', { season: '', fetchedAt: 0, events: [] });
}

export function saveEventList(list) {
  write('eventList', list);
}

// ---- scouting records -------------------------------------------------------

export function matchId(event, match, team) {
  return `${event}|${match}|${team}`;
}

export function pitId(event, team) {
  return `${event}|${team}`;
}

export function getMatchRecords(event) {
  const all = read('matches', {});
  const list = Object.values(all);
  return event ? list.filter((r) => r.event === event) : list;
}

export function getPitRecords(event) {
  const all = read('pits', {});
  const list = Object.values(all);
  return event ? list.filter((r) => r.event === event) : list;
}

export function getPit(event, team) {
  return read('pits', {})[pitId(event, team)] || null;
}

export function getMatchRecord(id) {
  return read('matches', {})[id] || null;
}

function upsert(store, records) {
  const all = read(store, {});
  let added = 0;
  let updated = 0;
  for (const r of records) {
    const existing = all[r.id];
    if (!existing) {
      all[r.id] = r;
      added++;
    } else if ((r.ts || 0) > (existing.ts || 0)) {
      // Newest entry wins when the same match/team was scouted twice.
      all[r.id] = r;
      updated++;
    }
  }
  write(store, all);
  return { added, updated };
}

export function saveMatchRecords(records) {
  return upsert('matches', records);
}

export function savePitRecords(records) {
  return upsert('pits', records);
}

export function deleteMatchRecord(id) {
  const all = read('matches', {});
  delete all[id];
  write('matches', all);
}

export function deletePitRecord(id) {
  const all = read('pits', {});
  delete all[id];
  write('pits', all);
}

// ---- pick list ---------------------------------------------------------------

export function getPickList(event) {
  return read('picklists', {})[event] || { order: [], dnp: [], picked: [] };
}

export function savePickList(event, list) {
  const all = read('picklists', {});
  all[event] = list;
  write('picklists', all);
}

// ---- backup ------------------------------------------------------------------

export function exportAll() {
  return {
    app: 'ftc-scouting',
    version: 1,
    exportedAt: Date.now(),
    matches: read('matches', {}),
    pits: read('pits', {}),
    picklists: read('picklists', {}),
    events: read('events', {}),
  };
}

export function importAll(data) {
  if (!data || data.app !== 'ftc-scouting') throw new Error('Not an FTC scouting backup file');
  const m = upsert('matches', Object.values(data.matches || {}));
  const p = upsert('pits', Object.values(data.pits || {}));
  const events = { ...getEvents() };
  for (const [k, v] of Object.entries(data.events || {})) {
    if (!events[k] || (v.fetchedAt || 0) > (events[k].fetchedAt || 0)) events[k] = v;
  }
  write('events', events);
  const picklists = read('picklists', {});
  for (const [k, v] of Object.entries(data.picklists || {})) {
    if (!picklists[k]) picklists[k] = v;
  }
  write('picklists', picklists);
  return { matches: m, pits: p };
}

export function clearScoutingData() {
  write('matches', {});
  write('pits', {});
  write('picklists', {});
}
