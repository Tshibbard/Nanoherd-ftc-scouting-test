// Shared match-schedule helpers.

// Qualifications first, then playoffs, numerically within each.
export function compareMatches(a, b) {
  const order = (n) => {
    const c = String(n.name || n)[0];
    return { P: 0, Q: 1, S: 2, E: 2, F: 3 }[c] ?? 4;
  };
  const num = (n) => parseInt(String(n.name || n).replace(/^\D+/, ''), 10) || 0;
  return order(a) - order(b) || num(a) - num(b) || String(a.name || a).localeCompare(String(b.name || b));
}
