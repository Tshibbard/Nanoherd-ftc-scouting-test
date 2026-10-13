// The Orange Alliance (https://theorangealliance.org) API client, used as
// the backup data source when FTCScout is unavailable.
// Requests need an API key (free, from your TOA account page) sent as
// X-TOA-Key, plus an X-Application-Origin name. Responses are normalized
// into the app's own shapes and cached in storage for offline use.

import { compareMatches } from './schedule.js';

const BASE = 'https://theorangealliance.org/api';
const ORIGIN = 'FTC Scouting App';

async function get(path, key) {
  if (!key) throw new Error('No Orange Alliance API key.');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('You are offline. Using cached data.');
  const res = await fetch(BASE + path, {
    headers: {
      'Content-Type': 'application/json',
      'X-TOA-Key': key,
      'X-Application-Origin': ORIGIN,
    },
  });
  if (!res.ok) {
    throw new Error(`Orange Alliance returned ${res.status} for ${path}`);
  }
  return res.json();
}

// "2627-CA-ABC-Q012-1" -> "Q12"; "...-Q012-2" -> "Q12-2" (replay)
export function shortMatchName(matchKey, fallback) {
  const parts = String(matchKey || '').split('-');
  if (parts.length >= 3) {
    const seg = parts[parts.length - 2];
    const m = /^([A-Z]+)(\d+)$/i.exec(seg);
    if (m) {
      const replay = parts[parts.length - 1];
      return `${m[1].toUpperCase()}${parseInt(m[2], 10)}${replay && replay !== '1' ? '-' + replay : ''}`;
    }
  }
  return fallback || String(matchKey);
}

export async function fetchSeasonEvents(seasonKey, key) {
  const events = await get(`/event?season_key=${encodeURIComponent(seasonKey)}`, key);
  return events
    .map((e) => ({
      key: e.event_key,
      name: e.event_name,
      location: [e.city, e.state_prov, e.country].filter(Boolean).join(', '),
      start: (e.start_date || '').slice(0, 10),
      source: 'toa',
    }))
    .sort((a, b) => (a.start || '').localeCompare(b.start || '') || a.name.localeCompare(b.name));
}

export async function fetchEvent(eventKey, key) {
  const k = encodeURIComponent(eventKey);
  const [info, teams, matches, rankings] = await Promise.all([
    get(`/event/${k}`, key).catch(() => []),
    get(`/event/${k}/teams`, key).catch(() => []),
    get(`/event/${k}/matches`, key).catch(() => []),
    get(`/event/${k}/rankings`, key).catch(() => []),
  ]);
  const e = Array.isArray(info) ? info[0] : info;

  const teamMap = new Map();
  for (const t of teams || []) {
    const num = parseInt(t.team_key || t.team?.team_key, 10);
    if (!num) continue;
    teamMap.set(num, {
      number: num,
      name: t.team?.team_name_short || t.team?.team_name_long || '',
      location: [t.team?.city, t.team?.state_prov].filter(Boolean).join(', '),
    });
  }

  const normMatches = (matches || []).map((m) => {
    const red = [];
    const blue = [];
    for (const p of (m.participants || []).sort((a, b) => a.station - b.station)) {
      const num = parseInt(p.team_key || p.team?.team_key, 10);
      if (!num) continue;
      if (!teamMap.has(num)) {
        teamMap.set(num, { number: num, name: p.team?.team_name_short || '', location: '' });
      }
      (String(p.station).startsWith('1') ? red : blue).push(num);
    }
    const played = m.red_score != null && m.blue_score != null && (m.red_score > 0 || m.blue_score > 0 || m.match_start_time);
    return {
      key: m.match_key,
      name: shortMatchName(m.match_key, m.match_name),
      label: m.match_name || shortMatchName(m.match_key),
      level: m.tournament_level,
      red,
      blue,
      redScore: played ? m.red_score : null,
      blueScore: played ? m.blue_score : null,
    };
  });
  normMatches.sort(compareMatches);

  const normRankings = (rankings || []).map((r) => ({
    team: parseInt(r.team_key || r.team?.team_key, 10),
    rank: r.rank,
    wins: r.wins,
    losses: r.losses,
    ties: r.ties,
    rp: r.ranking_points,
    tbp: r.tie_breaker_points,
    played: r.played,
  }));

  return {
    key: eventKey,
    name: e?.event_name || eventKey,
    location: e ? [e.city, e.state_prov, e.country].filter(Boolean).join(', ') : '',
    start: (e?.start_date || '').slice(0, 10),
    teams: [...teamMap.values()].sort((a, b) => a.number - b.number),
    matches: normMatches,
    rankings: normRankings,
    fetchedAt: Date.now(),
    source: 'toa',
  };
}
