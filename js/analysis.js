// Turns raw match/pit records into per-team statistics.

export function recordPoints(rec, seasonCfg) {
  const out = { auto: 0, teleop: 0, endgame: 0 };
  for (const f of seasonCfg.matchFields) {
    if (!f.points || !(f.phase in out)) continue;
    const v = rec.d?.[f.id];
    const units = f.type === 'toggle' ? (v ? 1 : 0) : Number(v) || 0;
    out[f.phase] += units * f.points;
  }
  out.total = out.auto + out.teleop + out.endgame;
  return out;
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const stdev = (xs) => {
  if (xs.length < 2) return 0;
  const m = avg(xs);
  return Math.sqrt(avg(xs.map((x) => (x - m) ** 2)));
};
const rate = (recs, id) => (recs.length ? recs.filter((r) => r.d?.[id]).length / recs.length : 0);
const num = (r, id) => Number(r.d?.[id]) || 0;

export function teamStats(event, matchRecs, pitRecs, seasonCfg) {
  const teams = new Map();
  const ensure = (n, name = '') => {
    if (!teams.has(n)) teams.set(n, { team: n, name, records: [], pit: null });
    return teams.get(n);
  };
  for (const t of event?.teams || []) ensure(t.number, t.name);
  for (const r of matchRecs) ensure(r.team).records.push(r);
  for (const p of pitRecs) ensure(p.team).pit = p;

  const rankings = new Map((event?.rankings || []).map((r) => [r.team, r]));

  return [...teams.values()].map((t) => {
    const played = t.records.filter((r) => !r.d?.oNoShow);
    const pts = played.map((r) => recordPoints(r, seasonCfg));
    const totals = pts.map((p) => p.total);
    const rk = rankings.get(t.team);
    const drivers = played.map((r) => num(r, 'oDriver')).filter(Boolean);
    return {
      team: t.team,
      name: t.name,
      pit: t.pit,
      records: t.records,
      n: t.records.length,
      auto: avg(pts.map((p) => p.auto)),
      teleop: avg(pts.map((p) => p.teleop)),
      endgame: avg(pts.map((p) => p.endgame)),
      total: avg(totals),
      max: totals.length ? Math.max(...totals) : 0,
      sd: stdev(totals),
      tips: avg(played.map((r) => num(r, 'aTip') + num(r, 'tTip'))),
      cells: avg(played.map((r) => num(r, 'aCell') + num(r, 'tCell'))),
      flower: avg(played.map((r) => num(r, 'tFlower') + num(r, 'eNectar'))),
      leave: rate(played, 'aLeave'),
      park: rate(played, 'ePark'),
      defense: rate(played, 'tDef'),
      driver: avg(drivers),
      fouls: avg(played.map((r) => num(r, 'oMinor') + 3 * num(r, 'oMajor'))),
      died: t.records.length ? t.records.filter((r) => r.d?.oDead || r.d?.oNoShow).length / t.records.length : 0,
      rank: rk?.rank ?? null,
      rp: rk?.rp ?? null,
      wlt: rk ? `${rk.wins ?? 0}-${rk.losses ?? 0}-${rk.ties ?? 0}` : '',
      opr: rk?.opr ?? null,
      avgScore: rk?.avg ?? null,
      official: rk || null,
    };
  });
}

export const DEFAULT_WEIGHTS = { total: 5, auto: 2, endgame: 2, tips: 2, driver: 1, reliability: 3, consistency: 1, opr: 3 };

// Weighted pick score. Each metric is scaled 0..1 across the event so the
// weights are comparable; reliability and consistency reward fewer
// breakdowns and lower spread.
export function pickScores(stats, weights) {
  const scouted = stats.filter((s) => s.n > 0);
  const maxOf = (k) => Math.max(1e-9, ...scouted.map((s) => s[k]));
  const maxSd = maxOf('sd');
  const maxOpr = Math.max(1e-9, ...stats.map((s) => s.opr || 0));
  const m = { opr: maxOpr, total: maxOf('total'), auto: maxOf('auto'), endgame: maxOf('endgame'), tips: maxOf('tips'), driver: 5 };
  const scores = new Map();
  for (const s of stats) {
    const oprPart = (weights.opr ?? 0) * (s.opr > 0 ? s.opr / m.opr : 0);
    // Teams nobody scouted still rank by their official OPR.
    if (!s.n) { scores.set(s.team, Math.round(oprPart * 100) / 100); continue; }
    const score =
      weights.total * (s.total / m.total) +
      weights.auto * (s.auto / m.auto) +
      weights.endgame * (s.endgame / m.endgame) +
      weights.tips * (s.tips / m.tips) +
      weights.driver * (s.driver / m.driver) +
      weights.reliability * (1 - s.died) +
      weights.consistency * (1 - s.sd / maxSd) +
      oprPart;
    scores.set(s.team, Math.round(score * 100) / 100);
  }
  return scores;
}

export function toCsv(rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(',')).join('\n');
}
