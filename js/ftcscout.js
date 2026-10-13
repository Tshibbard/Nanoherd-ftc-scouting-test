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

// Quals -> "Q12"; playoffs -> "SF1-2", "F1", "E3" (double elimination).
export function matchName(m) {
  const lvl = String(m.tournamentLevel || '');
  if (lvl.startsWith('Qual')) return `Q${m.matchNum}`;
  if (lvl.startsWith('Semi')) return `SF${m.series}-${m.matchNum}`;
  if (lvl.startsWith('Final')) return `F${m.matchNum}`;
  if (lvl.startsWith('Double')) return `E${m.series}${m.matchNum > 1 ? '-' + m.matchNum : ''}`;
  return `${lvl.slice(0, 1) || 'M'}${m.matchNum ?? m.id}`;
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
      if (!num) continue;
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
