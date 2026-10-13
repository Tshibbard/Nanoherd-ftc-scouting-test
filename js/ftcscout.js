// FTCScout (https://ftcscout.org) API client — the primary data source.
// The REST API needs no key. Seasons are the starting year (BIOBUZZ = 2026).
// Team names aren't in the REST event-teams response, so they come from one
// small GraphQL query; if that fails the app still works without names.

import { compareMatches } from './schedule.js';

const REST = 'https://api.ftcscout.org/rest/v1';
const GRAPHQL = 'https://api.ftcscout.org/graphql';

async function get(path) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('You are offline. Using cached data.');
  const res = await fetch(REST + path);
  if (res.status === 404) throw Object.assign(new Error('FTCScout has no event with that code'), { notFound: true });
  if (!res.ok) throw new Error(`FTCScout returned ${res.status} for ${path}`);
  return res.json();
}

const place = (e) => [e.city, e.stateProv, e.country].filter(Boolean).join(', ');

// Keep just the numeric fields of a score/stats object (one level deep).
// Field names change every season, so the app shows whatever FTCScout sends.
const SKIP = new Set(['season', 'eventCode', 'matchId', 'teamNumber', 'id']);
export function numericFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (typeof v === 'number' && Number.isFinite(v) && !SKIP.has(k)) out[k] = v;
  }
  return out;
}

// App event keys for FTCScout events look like "2026:USCASDQ1".
export const eventKey = (seasonYear, code) => `${seasonYear}:${code}`;

export function parseEventKey(key) {
  const m = /^(\d{4}):(.+)$/.exec(String(key));
  return m ? { season: Number(m[1]), code: m[2] } : null;
}

export async function fetchSeasonEvents(seasonYear) {
  const events = await get(`/events/search/${seasonYear}`);
  return events
    .map((e) => ({
      key: eventKey(seasonYear, e.code),
      code: e.code,
      name: e.name,
      location: place(e),
      start: String(e.start || '').slice(0, 10),
      source: 'ftcscout',
    }))
    .sort((a, b) => (a.start || '').localeCompare(b.start || '') || a.name.localeCompare(b.name));
}

// FTCScout's REST matches have no matchNum field: it's derived from the id,
// which FTCScout builds as level * 10000 + series * 1000 + matchNum
// (remote events: teamNumber * 1000 + matchNum), so matchNum = id % 1000.
function matchNumOf(m) {
  if (Number.isFinite(m.matchNum)) return m.matchNum;
  return Number.isFinite(Number(m.id)) ? Number(m.id) % 1000 : null;
}

// Quals -> "Q12"; playoffs -> "SF1-2", "F1", "E3" (double elimination).
export function matchName(m) {
  const lvl = String(m.tournamentLevel || '');
  const num = matchNumOf(m);
  const series = Number(m.series) || 0;
  if (lvl.startsWith('Qual')) return `Q${num}`;
  if (lvl.startsWith('Semi')) return `SF${series}-${num}`;
  if (lvl.startsWith('Final')) return `F${num}`;
  if (lvl.startsWith('Double')) return `E${series}${num > 1 ? '-' + num : ''}`;
  if (lvl.startsWith('Practice')) return `P${num}`;
  return `${lvl.slice(0, 1) || 'M'}${num ?? m.id}`;
}

// Events saved before the fix above have names like "Qundefined". Their
// keys end in ":<id>", which is enough to rebuild the right name.
export function repairEvent(ev) {
  if (ev?.source !== 'ftcscout' || ev.via === 'toa') return false;
  let changed = false;
  for (const m of ev.matches || []) {
    if (!String(m.name).includes('undefined')) continue;
    const id = Number(String(m.key).split(':').pop());
    if (!Number.isFinite(id)) continue;
    m.name = matchName({ id, tournamentLevel: m.level, series: Math.floor(id / 1000) % 10 });
    if (String(m.label).includes('undefined')) m.label = m.name;
    changed = true;
  }
  if (changed) ev.matches.sort(compareMatches);
  return changed;
}

async function fetchTeamNames(seasonYear, code) {
  const query = `query($s:Int!,$c:String!){eventByCode(season:$s,code:$c){teams{teamNumber team{name city stateProv}}}}`;
  const res = await fetch(GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { s: seasonYear, c: code } }),
  });
  if (!res.ok) throw new Error(`FTCScout GraphQL ${res.status}`);
  const body = await res.json();
  const names = new Map();
  for (const t of body?.data?.eventByCode?.teams || []) {
    names.set(t.teamNumber, { name: t.team?.name || '', location: [t.team?.city, t.team?.stateProv].filter(Boolean).join(', ') });
  }
  return names;
}

export async function fetchEvent(key) {
  const parsed = parseEventKey(key);
  if (!parsed) throw new Error(`Not an FTCScout event key: ${key}`);
  const { season: yr, code } = parsed;
  const c = encodeURIComponent(code);
  // The event itself must exist; the rest may legitimately be empty early on.
  const info = await get(`/events/${yr}/${c}`);
  const [teams, matches, names] = await Promise.all([
    get(`/events/${yr}/${c}/teams`).catch(() => []),
    get(`/events/${yr}/${c}/matches`).catch(() => []),
    fetchTeamNames(yr, code).catch(() => new Map()),
  ]);

  const teamMap = new Map();
  const addTeam = (num) => {
    if (num && !teamMap.has(num)) teamMap.set(num, { number: num, name: names.get(num)?.name || '', location: names.get(num)?.location || '' });
  };
  for (const t of teams || []) addTeam(Number(t.teamNumber));

  const normMatches = (matches || []).map((m) => {
    const red = [];
    const blue = [];
    const sorted = [...(m.teams || [])].sort((a, b) => String(a.station).localeCompare(String(b.station)));
    for (const p of sorted) {
      const num = Number(p.teamNumber);
      // Playoff alliances list a third team that sits out (onField false).
      if (!num || p.onField === false || p.station === 'NotOnField') continue;
      addTeam(num);
      (String(p.alliance).toLowerCase() === 'blue' ? blue : red).push(num);
    }
    const played = m.hasBeenPlayed && m.scores;
    const score = (al) => {
      const s = m.scores?.[al];
      return s?.totalPoints ?? s?.totalPointsNp ?? null;
    };
    const name = matchName(m);
    return {
      key: `${key}:${m.id}`,
      name,
      label: m.description || name,
      level: m.tournamentLevel,
      red,
      blue,
      redScore: played ? score('red') : null,
      blueScore: played ? score('blue') : null,
      breakdown: played ? { red: numericFields(m.scores.red), blue: numericFields(m.scores.blue) } : null,
    };
  });
  normMatches.sort(compareMatches);

  const rankings = (teams || [])
    .filter((t) => t.stats && t.stats.rank != null)
    .map((t) => ({
      team: Number(t.teamNumber),
      rank: t.stats.rank,
      wins: t.stats.wins,
      losses: t.stats.losses,
      ties: t.stats.ties,
      rp: t.stats.rp,
      tbp: t.stats.tb1,
      played: t.stats.qualMatchesPlayed,
      // OPR = estimated points this team adds to its alliance per match.
      opr: t.stats.opr?.totalPointsNp ?? t.stats.opr?.totalPoints ?? null,
      avg: t.stats.avg?.totalPointsNp ?? t.stats.avg?.totalPoints ?? null,
      oprBreakdown: numericFields(t.stats.opr),
      avgBreakdown: numericFields(t.stats.avg),
    }));

  return {
    key,
    name: info?.name || code,
    location: info ? place(info) : '',
    start: String(info?.start || '').slice(0, 10),
    teams: [...teamMap.values()].sort((a, b) => a.number - b.number),
    matches: normMatches,
    rankings,
    fetchedAt: Date.now(),
    source: 'ftcscout',
  };
}

const toListItem = (seasonYear, code, e) => ({
  key: eventKey(seasonYear, code),
  code,
  name: e?.name || code,
  location: e ? place(e) : '',
  start: String(e?.start || '').slice(0, 10),
  source: 'ftcscout',
});

// Events a team is registered for this season, plus the team's name.
// GraphQL returns everything in one request; REST is the fallback.
export async function fetchTeamEvents(seasonYear, number) {
  try {
    const query = `query($n:Int!,$s:Int!){teamByNumber(number:$n){number name events(season:$s){eventCode event{name start city stateProv country}}}}`;
    const res = await fetch(GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { n: number, s: seasonYear } }),
    });
    if (!res.ok) throw new Error(`FTCScout GraphQL ${res.status}`);
    const body = await res.json();
    if (body.errors?.length) throw new Error(body.errors[0].message);
    const t = body.data?.teamByNumber;
    if (!t) throw Object.assign(new Error(`FTCScout has no team ${number}`), { notFound: true });
    return {
      team: { number, name: t.name || '' },
      events: (t.events || []).map((p) => toListItem(seasonYear, p.eventCode, p.event)),
    };
  } catch (err) {
    if (err.notFound) throw err;
  }
  const team = await get(`/teams/${number}`).catch((e) => {
    throw e.notFound ? Object.assign(new Error(`FTCScout has no team ${number}`), { notFound: true }) : e;
  });
  const parts = await get(`/teams/${number}/events/${seasonYear}`).catch(() => []);
  const events = await Promise.all(parts.map(async (p) => {
    const info = await get(`/events/${seasonYear}/${encodeURIComponent(p.eventCode)}`).catch(() => null);
    return toListItem(seasonYear, p.eventCode, info);
  }));
  return { team: { number, name: team?.name || '' }, events };
}
