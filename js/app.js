import { season, SEASONS } from './config.js';
import * as store from './storage.js';
import * as data from './datasource.js';
import { compareMatches } from './schedule.js';
import { encodeRecords, decodePayload, qrSvg, startScanner, scanFile } from './qr.js';
import { recordPoints, teamStats, pickScores, DEFAULT_WEIGHTS, toCsv } from './analysis.js';

let app = document.getElementById('app');
let settings = store.getSettings();
let cfg = season(settings.season);
let stopScan = null;

// ---- helpers -----------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = app) => root.querySelector(sel);
const $$ = (sel, root = app) => [...root.querySelectorAll(sel)];
const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '');
const pct = (n) => `${Math.round(n * 100)}%`;

function toast(msg, kind = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.className = 'toast'; }, kind === 'err' ? 7000 : 3000);
}

// Navigate, re-rendering even when the hash is unchanged.
function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

// The season is saved with the other settings, so it stays as chosen across
// reloads, app updates and going offline. Each season remembers its own
// current event, so switching back restores where you were.
function setSeason(key) {
  const seasonEvents = { ...(settings.seasonEvents || {}), [cfg.key]: settings.eventKey };
  settings = store.saveSettings({ season: key, seasonEvents, eventKey: seasonEvents[key] || '' });
  cfg = season(settings.season);
}

function currentEvent() {
  return settings.eventKey ? store.getEvent(settings.eventKey) : null;
}

function teamName(n) {
  const t = currentEvent()?.teams.find((x) => x.number === Number(n));
  return t?.name || '';
}

function download(name, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function updateHeader() {
  const ev = currentEvent();
  document.getElementById('event-label').textContent = ev
    ? `${cfg.name}${cfg.testOnly ? " (test)" : ""} · ${ev.name}`
    : `${cfg.name} ${cfg.years}${cfg.testOnly ? " (test)" : ""} · no event selected`;
  const net = document.getElementById('net-status');
  net.textContent = navigator.onLine ? 'Online' : 'Offline';
  net.className = `pill ${navigator.onLine ? 'ok' : 'warn'}`;
}

// ---- QR dialog ---------------------------------------------------------------

function showQr(title, payloads) {
  if (!payloads.length) { toast('Nothing to share yet'); return; }
  const dlg = document.getElementById('qr-dialog');
  let i = 0;
  const draw = () => {
    document.getElementById('qr-title').textContent = title;
    document.getElementById('qr-body').innerHTML = qrSvg(payloads[i]);
    document.getElementById('qr-count').textContent = `${i + 1} / ${payloads.length}`;
    document.getElementById('qr-prev').disabled = i === 0;
    document.getElementById('qr-next').disabled = i === payloads.length - 1;
  };
  document.getElementById('qr-prev').onclick = () => { i = Math.max(0, i - 1); draw(); };
  document.getElementById('qr-next').onclick = () => { i = Math.min(payloads.length - 1, i + 1); draw(); };
  document.getElementById('qr-close').onclick = () => dlg.close();
  draw();
  dlg.showModal();
}

// ---- generic field rendering -------------------------------------------------

function fieldHtml(f, value) {
  const id = `f-${f.id}`;
  switch (f.type) {
    case 'toggle':
      return `<label class="field toggle"><input type="checkbox" id="${id}" data-f="${f.id}" ${value ? 'checked' : ''}><span>${esc(f.label)}</span>${f.points ? `<small>+${f.points}</small>` : ''}</label>`;
    case 'counter':
      return `<div class="field counter"><span class="lbl">${esc(f.label)}${f.points ? ` <small>×${f.points}</small>` : ''}</span>
        <div class="stepper"><button type="button" class="btn minus" data-step="-1" data-for="${f.id}" aria-label="minus">−</button>
        <input type="number" inputmode="numeric" min="0" id="${id}" data-f="${f.id}" value="${Number(value) || 0}">
        <button type="button" class="btn plus" data-step="1" data-for="${f.id}" aria-label="plus">+</button></div></div>`;
    case 'rating':
      return `<div class="field rating"><span class="lbl">${esc(f.label)}</span><div class="stars" data-f="${f.id}" data-type="rating">
        ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="star ${Number(value) >= n ? 'on' : ''}" data-v="${n}" aria-label="${n}">★</button>`).join('')}
        </div><input type="hidden" id="${id}" data-f="${f.id}" value="${Number(value) || ''}"></div>`;
    case 'select':
      return `<label class="field"><span class="lbl">${esc(f.label)}</span><select id="${id}" data-f="${f.id}"><option value="">—</option>
        ${f.options.map((o) => `<option ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
    case 'number':
      return `<label class="field"><span class="lbl">${esc(f.label)}</span><input type="number" inputmode="decimal" id="${id}" data-f="${f.id}" value="${value ?? ''}"></label>`;
    case 'text':
    default:
      return `<label class="field wide"><span class="lbl">${esc(f.label)}</span><textarea id="${id}" data-f="${f.id}" rows="3">${esc(value || '')}</textarea></label>`;
  }
}

function wireFields(root, onChange) {
  root.addEventListener('click', (e) => {
    const step = e.target.closest('[data-step]');
    if (step) {
      const input = root.querySelector(`#f-${step.dataset.for}`);
      input.value = Math.max(0, (Number(input.value) || 0) + Number(step.dataset.step));
      onChange();
      return;
    }
    const star = e.target.closest('.star');
    if (star) {
      const box = star.parentElement;
      const input = root.querySelector(`#f-${box.dataset.f}`);
      const v = Number(star.dataset.v);
      input.value = Number(input.value) === v ? '' : v;
      $$('.star', box).forEach((s) => s.classList.toggle('on', Number(s.dataset.v) <= Number(input.value || 0)));
      onChange();
    }
  });
  root.addEventListener('input', onChange);
}

function readFields(root, fields) {
  const d = {};
  for (const f of fields) {
    const el = root.querySelector(`#f-${f.id}`);
    if (!el) continue;
    if (f.type === 'toggle') d[f.id] = el.checked ? 1 : 0;
    else if (f.type === 'counter') d[f.id] = Math.max(0, Number(el.value) || 0);
    else if (f.type === 'rating' || f.type === 'number') { if (el.value !== '') d[f.id] = Number(el.value); }
    else if (el.value !== '') d[f.id] = el.value;
  }
  return d;
}

// ---- Event page --------------------------------------------------------------

function renderEvent() {
  const ev = currentEvent();
  const cached = Object.values(store.getEvents());
  const list = store.getEventList();
  const seasonList = list.season === cfg.key ? list.events : [];
  const tl = store.getTeamEvents();
  const teamList = tl && tl.season === cfg.key ? tl : null;
  const eventRow = (e) => `<button class="list-item btn-like" data-pick="${esc(e.key)}">
      <div><b>${esc(e.name)}</b><br><small>${esc(e.start)}${e.location ? ' · ' + esc(e.location) : ''} · <code>${esc(e.key)}</code></small></div>
      ${e.key === settings.eventKey ? '<span class="pill ok">Current</span>' : store.getEvent(e.key) ? '<span class="pill">Saved</span>' : ''}</button>`;

  app.innerHTML = `
  <section class="card">
    <div class="season-row">
      <h2>${esc(cfg.name)} <small>${esc(cfg.years)} season</small></h2>
      <label class="field"><span class="lbl">Season</span><select id="ev-season">
        ${Object.values(SEASONS).sort((a, b) => b.key.localeCompare(a.key)).map((x) => `<option value="${x.key}" ${x.key === cfg.key ? 'selected' : ''}>${esc(x.name)} ${esc(x.years)}${x.testOnly ? ' (testing)' : ''}</option>`).join('')}
      </select></label>
    </div>
    ${cfg.testOnly ? `<p class="warn-text"><small><b>Testing mode:</b> events, teams and schedules come from ${esc(cfg.name)} ${esc(cfg.years)}, but the scouting forms are still BIOBUZZ. Switch back before competition.</small></p>` : ''}
    ${ev ? `<p><b>Current event:</b> ${esc(ev.name)} <code>${esc(ev.key)}</code><br>
      ${ev.teams.length} teams · ${ev.matches.length} matches · ${ev.location ? esc(ev.location) + ' · ' : ''}updated ${new Date(ev.fetchedAt).toLocaleString()}</p>`
    : '<p>Pick an event below. Event data is saved on this device, so load it while you have internet and it keeps working offline.</p>'}
  </section>

  <section class="card">
    <h3>Find events by team</h3>
    <form class="row" id="team-form">
      <input id="team-num" type="number" inputmode="numeric" min="1" placeholder="Team number" value="${esc(teamList?.team.number ?? settings.myTeam)}">
      <button class="btn primary" type="submit">Show events</button>
    </form>
    ${teamList ? `<p><b>${teamList.team.number}${teamList.team.name ? ' ' + esc(teamList.team.name) : ''}</b>
      <small>· ${teamList.events.length} ${esc(cfg.years)} event${teamList.events.length === 1 ? '' : 's'} · from ${teamList.source === 'toa' ? 'Orange Alliance' : 'FTCScout'}, ${new Date(teamList.fetchedAt).toLocaleString()}</small></p>
      ${teamList.events.length
        ? `<div class="list">${[...teamList.events].sort((a, b) => (a.start || '').localeCompare(b.start || '')).map(eventRow).join('')}</div><p><small>Tap an event to download its teams and schedule.</small></p>`
        : '<p>No events found for this team yet this season. Registrations can take a while to appear; try again later or search all events below.</p>'}` : ''}
  </section>

  <section class="card">
    <h3>Search all events</h3>
    <p><small>From <b>FTCScout</b>, with <b>The Orange Alliance</b> as a backup when FTCScout is down or doesn't have the event yet.</small></p>
    <div class="row">
      <button class="btn" id="load-events">${seasonList.length ? 'Refresh' : 'Load'} all ${esc(cfg.years)} events</button>
      ${list.fetchedAt && seasonList.length ? `<small>${seasonList.length} events from ${list.source === 'toa' ? 'Orange Alliance' : 'FTCScout'}, fetched ${new Date(list.fetchedAt).toLocaleDateString()}</small>` : ''}
    </div>
    ${seasonList.length ? `
      <label class="field wide"><span class="lbl">Search events</span><input id="ev-search" placeholder="Name, city, or key"></label>
      <div id="ev-results" class="list scroll"></div>` : ''}
    <div class="row">
      <input id="ev-key" placeholder="Event code (USCASDQ1) or TOA key (2627-CA-SDQ1)" value="">
      <button class="btn primary" id="load-key">Load event</button>
    </div>
  </section>

  <section class="card">
    <h3>Saved events</h3>
    ${cached.length ? `<div class="list">${cached.map((e) => `
      <div class="list-item ${e.key === settings.eventKey ? 'active' : ''}">
        <div><b>${esc(e.name)}</b><br><small><code>${esc(e.key)}</code> · ${e.teams.length} teams · ${e.matches.length} matches${e.source === 'manual' ? ' · manual' : e.source === 'toa' ? ' · Orange Alliance' : e.via === 'toa' ? ' · Orange Alliance backup' : ' · FTCScout'}</small></div>
        <div class="row">
          ${e.key === settings.eventKey ? '<span class="pill ok">Current</span>' : `<button class="btn" data-use="${esc(e.key)}">Use</button>`}
          ${e.source !== 'manual' ? `<button class="btn" data-refresh="${esc(e.key)}">Refresh</button>` : ''}
          <button class="btn danger ghost" data-del="${esc(e.key)}">Remove</button>
        </div>
      </div>`).join('')}</div>` : '<p>No events saved yet.</p>'}
  </section>

  <section class="card">
    <h3>Manual setup (no internet / event not online yet)</h3>
    <label class="field wide"><span class="lbl">Event name</span><input id="m-name" value="${esc(ev?.source === 'manual' ? ev.name : '')}" placeholder="Scrimmage"></label>
    <label class="field wide"><span class="lbl">Team numbers (comma or space separated, optional "number:name")</span>
      <textarea id="m-teams" rows="3" placeholder="12345:Nanoherd, 23456, 34567">${esc(ev?.source === 'manual' ? ev.teams.map((t) => t.name ? `${t.number}:${t.name}` : t.number).join(', ') : '')}</textarea></label>
    <label class="field wide"><span class="lbl">Schedule (one match per line: match,red1,red2,blue1,blue2)</span>
      <textarea id="m-sched" rows="4" placeholder="Q1,12345,23456,34567,45678">${esc(ev?.source === 'manual' ? ev.matches.map((m) => [m.name, ...m.red, ...m.blue].join(',')).join('\n') : '')}</textarea></label>
    <button class="btn" id="m-save">Save manual event</button>
  </section>`;

  const showResults = (q) => {
    const box = $('#ev-results');
    if (!box) return;
    const ql = q.toLowerCase();
    const hits = seasonList.filter((e) => !ql || `${e.name} ${e.location} ${e.key}`.toLowerCase().includes(ql)).slice(0, 60);
    box.innerHTML = hits.map(eventRow).join('') || '<p>No matches.</p>';
  };
  showResults('');
  $('#ev-search')?.addEventListener('input', (e) => showResults(e.target.value));

  $('#ev-season').onchange = (e) => {
    const next = season(e.target.value);
    if (next.key === cfg.key) return;
    if (!confirm(`Switch event data to ${next.name} ${next.years}${next.testOnly ? ' (testing)' : ''}?\n\nThe app stays on this season until you change it here again. Scouting data is kept.`)) {
      e.target.value = cfg.key;
      return;
    }
    setSeason(next.key);
    toast(`Season set to ${cfg.name} ${cfg.years}`, next.testOnly ? 'warn' : 'ok');
    route();
  };

  $('#team-form').onsubmit = async (e) => {
    e.preventDefault();
    const number = parseInt($('#team-num').value, 10);
    if (!number) { toast('Enter a team number', 'err'); return; }
    try {
      toast(`Finding events for ${number}…`);
      const res = await data.fetchTeamEvents(cfg, settings, number);
      store.saveTeamEvents({ ...res, season: cfg.key, fetchedAt: Date.now() });
      settings = store.saveSettings({ myTeam: number });
      toast(`${res.events.length} event${res.events.length === 1 ? '' : 's'} for ${number}${res.source === 'toa' ? ' (Orange Alliance backup)' : ''}`, res.source === 'toa' ? 'warn' : 'ok');
      route();
    } catch (err) { toast(err.message, 'err'); }
  };

  $('#load-events').onclick = async () => {
    try {
      toast('Loading events…');
      const { source, events } = await data.fetchSeasonEvents(cfg, settings);
      store.saveEventList({ season: cfg.key, source, fetchedAt: Date.now(), events });
      toast(`Loaded ${events.length} events${source === 'toa' ? ' from Orange Alliance (FTCScout unavailable)' : ''}`, source === 'toa' ? 'warn' : 'ok');
      route();
    } catch (err) { toast(err.message, 'err'); }
  };

  const loadEvent = async (key) => {
    if (!key) return;
    const name = [...seasonList, ...(teamList?.events || [])].find((e) => e.key === key)?.name || store.getEvent(key)?.name || '';
    try {
      toast('Downloading event data…');
      const ev2 = await data.fetchEvent(key, cfg, settings, name);
      const src = ev2.via === 'toa' ? 'Orange Alliance' : 'FTCScout';
      if (!ev2.teams.length && !ev2.matches.length) toast(`Event loaded, but ${src} has no teams or matches for it yet`, 'warn');
      else toast(`Loaded ${ev2.name}${ev2.via === 'toa' && ev2.source !== 'toa' ? ' from Orange Alliance backup' : ''}`, ev2.via === 'toa' && ev2.source !== 'toa' ? 'warn' : 'ok');
      store.saveEvent(ev2);
      settings = store.saveSettings({ eventKey: key });
      route();
    } catch (err) { toast(err.message, 'err'); }
  };

  $('#load-key').onclick = () => { const k = $('#ev-key').value.trim(); if (k) loadEvent(data.normalizeKey(k, cfg)); };
  app.addEventListener('click', (e) => {
    const t = e.target.closest('[data-pick],[data-use],[data-refresh],[data-del]');
    if (!t) return;
    if (t.dataset.pick) loadEvent(t.dataset.pick);
    if (t.dataset.refresh) loadEvent(t.dataset.refresh);
    if (t.dataset.use) { settings = store.saveSettings({ eventKey: t.dataset.use }); route(); }
    if (t.dataset.del && confirm('Remove this event\'s schedule from this device? Scouting data is kept.')) {
      store.deleteEvent(t.dataset.del);
      if (settings.eventKey === t.dataset.del) settings = store.saveSettings({ eventKey: '' });
      route();
    }
  });

  $('#m-save').onclick = () => {
    const name = $('#m-name').value.trim() || 'Manual event';
    const teams = $('#m-teams').value.split(/[,\s]+/).filter(Boolean).map((tok) => {
      const [n, ...rest] = tok.split(':');
      return { number: parseInt(n, 10), name: rest.join(':'), location: '' };
    }).filter((t) => t.number);
    const teamMap = new Map(teams.map((t) => [t.number, t]));
    const matches = $('#m-sched').value.split('\n').map((l) => l.split(/[,\t]/).map((s) => s.trim())).filter((p) => p.length >= 3 && p[0])
      .map(([n, ...ts]) => {
        const nums = ts.map((x) => parseInt(x, 10)).filter(Boolean);
        nums.forEach((x) => { if (!teamMap.has(x)) teamMap.set(x, { number: x, name: '', location: '' }); });
        const half = Math.ceil(nums.length / 2);
        return { key: n, name: n.toUpperCase(), label: n, red: nums.slice(0, half), blue: nums.slice(half), redScore: null, blueScore: null };
      });
    matches.sort(compareMatches);
    const key = ev?.source === 'manual' ? ev.key : `manual-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    store.saveEvent({ key, name, location: '', start: '', teams: [...teamMap.values()].sort((a, b) => a.number - b.number), matches, rankings: [], fetchedAt: Date.now(), source: 'manual' });
    settings = store.saveSettings({ eventKey: key });
    toast('Manual event saved', 'ok');
    route();
  };
}

// ---- Pit page ----------------------------------------------------------------

function renderPit(teamArg) {
  const ev = currentEvent();
  if (!ev) { app.innerHTML = noEvent(); return; }
  const pits = store.getPitRecords(ev.key);
  const done = new Set(pits.map((p) => p.team));
  const team = Number(teamArg) || null;
  const rec = team ? store.getPit(ev.key, team) : null;

  app.innerHTML = `
  <section class="card">
    <h2>Pit scouting</h2>
    <p>${done.size} of ${ev.teams.length} teams scouted. Tap a team to scout or edit.</p>
    <div class="team-grid">${ev.teams.map((t) => `<button class="team-chip ${done.has(t.number) ? 'done' : ''} ${t.number === team ? 'active' : ''}" data-team="${t.number}" title="${esc(t.name)}">${t.number}</button>`).join('')}</div>
    <div class="row"><input id="pit-team" type="number" inputmode="numeric" placeholder="Other team #"><button class="btn" id="pit-go">Open</button></div>
  </section>
  ${team ? `
  <section class="card" id="pit-form">
    <h3>Team ${team} ${esc(teamName(team))}</h3>
    ${rec ? `<p><small>Last saved ${new Date(rec.ts).toLocaleString()} by ${esc(rec.scout || 'unknown')}</small></p>` : ''}
    <div class="fields">${cfg.pitFields.map((f) => fieldHtml(f, rec?.d?.[f.id])).join('')}</div>
    <div class="row sticky-actions">
      <button class="btn primary" id="pit-save">Save</button>
      <button class="btn" id="pit-qr" ${rec ? '' : 'disabled'}>Show QR</button>
    </div>
  </section>` : ''}
  <section class="card">
    <div class="row"><button class="btn" id="pit-qr-all" ${pits.length ? '' : 'disabled'}>QR for all pit data on this device (${pits.length})</button></div>
  </section>`;

  $$('[data-team]').forEach((b) => { b.onclick = () => { location.hash = `#pit/${b.dataset.team}`; }; });
  $('#pit-go').onclick = () => { const n = parseInt($('#pit-team').value, 10); if (n) location.hash = `#pit/${n}`; };
  $('#pit-qr-all').onclick = () => showQr('Pit data', encodeRecords(store.getPitRecords(ev.key), 'p', cfg));
  if (!team) return;
  wireFields($('#pit-form'), () => {});
  $('#pit-save').onclick = () => {
    const r = { id: store.pitId(ev.key, team), event: ev.key, team, scout: settings.scout, ts: Date.now(), d: readFields($('#pit-form'), cfg.pitFields) };
    store.savePitRecords([r]);
    toast(`Saved pit data for ${team}`, 'ok');
    route();
  };
  $('#pit-qr').onclick = () => showQr(`Pit · ${team}`, encodeRecords([store.getPit(ev.key, team)], 'p', cfg));
}

// ---- Match page --------------------------------------------------------------

const STATIONS = { R1: ['red', 0], R2: ['red', 1], B1: ['blue', 0], B2: ['blue', 1] };

function renderMatch(matchArg, teamArg) {
  const ev = currentEvent();
  if (!ev) { app.innerHTML = noEvent(); return; }
  const records = store.getMatchRecords(ev.key);
  const scouted = new Set(records.map((r) => r.match + '|' + r.team));

  let matchName = matchArg ? decodeURIComponent(matchArg) : '';
  if (!matchName) {
    // First scheduled match this station hasn't scouted yet.
    const [al, idx] = STATIONS[settings.station] || STATIONS.R1;
    const next = ev.matches.find((m) => m[al][idx] && !scouted.has(m.name + '|' + m[al][idx]));
    matchName = next?.name || ev.matches[0]?.name || 'Q1';
  }
  const sched = ev.matches.find((m) => m.name === matchName);
  const [stAlliance, idx] = STATIONS[settings.station] || STATIONS.R1;
  const editing = teamArg ? store.getMatchRecord(store.matchId(ev.key, matchName, Number(teamArg))) : null;
  const alliance = editing?.alliance || (teamArg && sched ? (sched.blue.includes(Number(teamArg)) ? 'blue' : 'red') : stAlliance);
  const schedTeam = teamArg || sched?.[stAlliance]?.[idx] || '';

  const phases = [['auto', 'Autonomous (30 s)'], ['teleop', 'TeleOp (2:00)'], ['endgame', 'Endgame (last 60 s)'], ['other', 'Robot & notes']];

  app.innerHTML = `
  <section class="card">
    <h2>Match scouting</h2>
    <div class="grid3">
      <label class="field"><span class="lbl">Scout</span><input id="m-scout" value="${esc(settings.scout)}" placeholder="Your name"></label>
      <label class="field"><span class="lbl">Station</span><select id="m-station">${Object.keys(STATIONS).map((s) => `<option ${s === settings.station ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label class="field"><span class="lbl">Match</span>
        ${ev.matches.length ? `<select id="m-match">${ev.matches.map((m) => `<option value="${esc(m.name)}" ${m.name === matchName ? 'selected' : ''}>${esc(m.name)}${scouted.has(m.name + '|' + (m[stAlliance]?.[idx] || '')) ? ' ✓' : ''}</option>`).join('')}
          ${sched ? '' : `<option selected value="${esc(matchName)}">${esc(matchName)}</option>`}</select>`
        : `<input id="m-match" value="${esc(matchName)}">`}
      </label>
    </div>
    <div class="grid3">
      <label class="field"><span class="lbl">Team</span><input id="m-team" type="number" inputmode="numeric" value="${schedTeam}"></label>
      <label class="field"><span class="lbl">Alliance</span><select id="m-alliance"><option value="red" ${alliance === 'red' ? 'selected' : ''}>Red</option><option value="blue" ${alliance === 'blue' ? 'selected' : ''}>Blue</option></select></label>
      <div class="field"><span class="lbl">&nbsp;</span><div id="m-teamname" class="muted"></div></div>
    </div>
    ${sched ? `<p class="alliances"><span class="red">${sched.red.join(' · ')}</span> vs <span class="blue">${sched.blue.join(' · ')}</span></p>` : ''}
  </section>
  <form id="match-form" onsubmit="return false">
    ${phases.map(([ph, title]) => `<section class="card phase phase-${ph}"><h3>${title}</h3>
      <div class="fields">${cfg.matchFields.filter((f) => f.phase === ph).map((f) => fieldHtml(f, undefined)).join('')}</div></section>`).join('')}
  </form>
  <div class="card sticky-actions">
    <div class="score" id="m-score"></div>
    <div class="row">
      <button class="btn primary" id="m-save">Save &amp; show QR</button>
      <button class="btn" id="m-reset">Clear</button>
    </div>
  </div>
  <section class="card">
    <h3>Saved on this device (${records.length})</h3>
    <div class="row">
      <button class="btn" id="m-qr-all" ${records.length ? '' : 'disabled'}>QR for all match data</button>
      <button class="btn" id="m-qr-mine" ${records.some((r) => r.scout === settings.scout) ? '' : 'disabled'}>QR for my entries</button>
    </div>
    <div class="list">${records.sort((a, b) => b.ts - a.ts).slice(0, 12).map((r) => `<div class="list-item"><div><b>${esc(r.match)}</b> · ${r.team} <span class="${r.alliance}">${r.alliance}</span><br><small>${esc(r.scout || '')} · ${recordPoints(r, cfg).total} est. pts</small></div>
      <div class="row"><button class="btn" data-edit="${esc(r.id)}">Edit</button><button class="btn" data-qr="${esc(r.id)}">QR</button></div></div>`).join('')}</div>
  </section>`;

  const form = $('#match-form');
  const loadExisting = () => {
    const team = parseInt($('#m-team').value, 10);
    const existing = team ? store.getMatchRecord(store.matchId(ev.key, $('#m-match').value, team)) : null;
    $$('[data-f]', form).forEach((el) => {
      const f = cfg.matchFields.find((x) => x.id === el.dataset.f);
      if (!f || el.classList.contains('stars')) return;
      const v = existing?.d?.[f.id];
      if (f.type === 'toggle') el.checked = !!v;
      else if (f.type === 'counter') el.value = Number(v) || 0;
      else el.value = v ?? '';
    });
    $$('.stars', form).forEach((box) => {
      const v = Number($(`#f-${box.dataset.f}`, form).value) || 0;
      $$('.star', box).forEach((s) => s.classList.toggle('on', Number(s.dataset.v) <= v));
    });
    $('#m-teamname').textContent = (teamName(team) || '') + (existing ? ' (editing saved entry)' : '');
    updateScore();
  };
  const updateScore = () => {
    const p = recordPoints({ d: readFields(form, cfg.matchFields) }, cfg);
    $('#m-score').innerHTML = `Est. <b>${p.total}</b> pts <small>auto ${p.auto} · teleop ${p.teleop} · endgame ${p.endgame}</small>`;
  };
  wireFields(form, updateScore);
  loadExisting();

  $('#m-scout').onchange = (e) => { settings = store.saveSettings({ scout: e.target.value.trim() }); };
  $('#m-station').onchange = (e) => { settings = store.saveSettings({ station: e.target.value }); go(`#match/${encodeURIComponent(matchName)}`); };
  $('#m-match').onchange = (e) => { location.hash = `#match/${encodeURIComponent(e.target.value.trim())}`; };
  $('#m-team').onchange = loadExisting;
  $('#m-reset').onclick = () => { form.reset(); $$('input[type=hidden]', form).forEach((i) => { i.value = ''; }); $$('.star', form).forEach((s) => s.classList.remove('on')); $$('input[type=number]', form).forEach((i) => { i.value = 0; }); updateScore(); };

  $('#m-save').onclick = () => {
    const team = parseInt($('#m-team').value, 10);
    const match = String($('#m-match').value).trim();
    if (!team || !match) { toast('Enter a match and team number', 'err'); return; }
    if (!settings.scout) { settings = store.saveSettings({ scout: $('#m-scout').value.trim() }); }
    const rec = { id: store.matchId(ev.key, match, team), event: ev.key, match, team, alliance: $('#m-alliance').value, scout: settings.scout, ts: Date.now(), d: readFields(form, cfg.matchFields) };
    store.saveMatchRecords([rec]);
    toast(`Saved ${match} · ${team}`, 'ok');
    showQr(`${match} · Team ${team}`, encodeRecords([rec], 'm', cfg));
    // Advance to the next match in the schedule.
    const i = ev.matches.findIndex((m) => m.name === match);
    const nextName = i >= 0 && ev.matches[i + 1] ? ev.matches[i + 1].name : match;
    document.getElementById('qr-dialog').addEventListener('close', () => go(`#match/${encodeURIComponent(nextName)}`), { once: true });
  };
  $('#m-qr-all').onclick = () => showQr('All match data', encodeRecords(store.getMatchRecords(ev.key), 'm', cfg));
  $('#m-qr-mine').onclick = () => showQr(`Match data · ${settings.scout}`, encodeRecords(store.getMatchRecords(ev.key).filter((r) => r.scout === settings.scout), 'm', cfg));
  $$('[data-qr]').forEach((b) => { b.onclick = () => { const r = store.getMatchRecord(b.dataset.qr); showQr(`${r.match} · Team ${r.team}`, encodeRecords([r], 'm', cfg)); }; });
  $$('[data-edit]').forEach((b) => {
    b.onclick = () => { const r = store.getMatchRecord(b.dataset.edit); go(`#match/${encodeURIComponent(r.match)}/${r.team}`); };
  });
}

// ---- Analysis page -----------------------------------------------------------

const COLS = [
  ['team', 'Team'], ['n', 'Scouted'], ['total', 'Avg pts'], ['auto', 'Auto'], ['teleop', 'Tele'], ['endgame', 'End'],
  ['tips', 'Tips'], ['cells', 'Cells'], ['flower', 'Flower'], ['park', 'Park%'], ['driver', 'Driver'], ['died', 'Died%'], ['max', 'Max'], ['sd', 'SD'], ['rank', 'Rank'],
];
let sortKey = 'total';
let sortDir = -1;
let anaTab = 'teams';

function renderAnalysis(arg) {
  const ev = currentEvent();
  const evKey = ev?.key || settings.eventKey;
  if (arg && /^\d+$/.test(arg)) { anaTab = 'team'; } else if (arg) { anaTab = arg; }
  if (stopScan) { stopScan(); stopScan = null; }

  const tabs = [['teams', 'Teams'], ['picklist', 'Pick list'], ['scan', 'Scan QR'], ['data', 'Data']];
  app.innerHTML = `
  <nav class="subtabs">${tabs.map(([k, l]) => `<a href="#analysis/${k}" class="${anaTab === k ? 'active' : ''}">${l}</a>`).join('')}</nav>
  <div id="ana"></div>`;
  const box = $('#ana');
  if (anaTab === 'scan') return renderScan(box);
  if (anaTab === 'data') return renderData(box, evKey);
  if (!ev && !store.getMatchRecords(evKey).length) { box.innerHTML = noEvent(); return; }
  const stats = teamStats(ev, store.getMatchRecords(evKey), store.getPitRecords(evKey), cfg);
  if (anaTab === 'team') return renderTeam(box, stats.find((s) => s.team === Number(arg)), evKey);
  if (anaTab === 'picklist') return renderPickList(box, stats, evKey);
  return renderTeams(box, stats);
}

function renderTeams(box, stats) {
  const cell = (s, k) => {
    if (k === 'team') return `<a href="#analysis/${s.team}"><b>${s.team}</b></a><br><small>${esc(s.name)}</small>`;
    if (['park', 'died'].includes(k)) return s.n ? pct(s[k]) : '';
    if (k === 'n') return `${s.n}${s.pit ? ' <span title="pit scouted">🔧</span>' : ''}`;
    if (k === 'rank') return s.rank ?? '';
    return s.n ? fmt(s[k]) : '';
  };
  const sorted = [...stats].sort((a, b) => {
    const va = a[sortKey] ?? (sortDir < 0 ? -Infinity : Infinity);
    const vb = b[sortKey] ?? (sortDir < 0 ? -Infinity : Infinity);
    return (va > vb ? 1 : va < vb ? -1 : 0) * sortDir;
  });
  const scouted = stats.filter((s) => s.n);
  box.innerHTML = `
  <section class="card">
    <p>${scouted.length} teams with match data · ${stats.reduce((a, s) => a + s.n, 0)} match entries · ${stats.filter((s) => s.pit).length} pit entries.
    Points are estimated from scouted actions. Tap a column to sort, a team for details.</p>
    <div class="table-wrap"><table class="data">
      <thead><tr>${COLS.map(([k, l]) => `<th data-sort="${k}" class="${k === sortKey ? 'sorted' : ''}">${l}${k === sortKey ? (sortDir < 0 ? ' ▼' : ' ▲') : ''}</th>`).join('')}</tr></thead>
      <tbody>${sorted.map((s) => `<tr class="${s.n ? '' : 'dim'}">${COLS.map(([k]) => `<td>${cell(s, k)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>
    <div class="chart" id="chart"></div>
  </section>`;
  $$('[data-sort]', box).forEach((th) => {
    th.onclick = () => {
      if (sortKey === th.dataset.sort) sortDir *= -1; else { sortKey = th.dataset.sort; sortDir = th.dataset.sort === 'team' || th.dataset.sort === 'rank' ? 1 : -1; }
      renderTeams(box, stats);
    };
  });
  // Stacked bar chart of average points by phase.
  const top = [...scouted].sort((a, b) => b.total - a.total).slice(0, 24);
  const max = Math.max(1, ...top.map((s) => s.total));
  $('#chart', box).innerHTML = top.length ? `<h3>Average estimated points</h3>
    <div class="legend"><span class="sw auto"></span>Auto <span class="sw teleop"></span>TeleOp <span class="sw endgame"></span>Endgame</div>
    ${top.map((s) => `<div class="bar-row"><a href="#analysis/${s.team}">${s.team}</a><div class="bar">
      <span class="auto" style="width:${(s.auto / max) * 100}%" title="Auto ${fmt(s.auto)}"></span>
      <span class="teleop" style="width:${(s.teleop / max) * 100}%" title="TeleOp ${fmt(s.teleop)}"></span>
      <span class="endgame" style="width:${(s.endgame / max) * 100}%" title="Endgame ${fmt(s.endgame)}"></span>
      </div><span class="val">${fmt(s.total)}</span></div>`).join('')}` : '';
}

function renderTeam(box, s, evKey) {
  if (!s) { box.innerHTML = '<section class="card"><p>No data for that team.</p></section>'; return; }
  const ev = currentEvent();
  const sched = (ev?.matches || []).filter((m) => m.red.includes(s.team) || m.blue.includes(s.team));
  const recs = [...s.records].sort((a, b) => compareMatches({ name: a.match }, { name: b.match }));
  const pitVal = (f) => {
    const v = s.pit?.d?.[f.id];
    if (v == null || v === '') return '—';
    if (f.type === 'toggle') return v ? 'Yes' : 'No';
    if (f.type === 'rating') return '★'.repeat(v);
    return esc(v);
  };
  box.innerHTML = `
  <section class="card">
    <h2>Team ${s.team} <small>${esc(s.name)}</small></h2>
    <div class="stats">
      <div><b>${fmt(s.total)}</b><small>avg est. pts</small></div>
      <div><b>${fmt(s.auto)}</b><small>auto</small></div>
      <div><b>${fmt(s.teleop)}</b><small>teleop</small></div>
      <div><b>${fmt(s.endgame)}</b><small>endgame</small></div>
      <div><b>${fmt(s.tips)}</b><small>HIVE TIPs</small></div>
      <div><b>${s.n ? pct(s.park) : '—'}</b><small>park</small></div>
      <div><b>${s.n ? pct(s.died) : '—'}</b><small>died / no-show</small></div>
      <div><b>${s.rank ?? '—'}</b><small>rank ${s.wlt}</small></div>
    </div>
  </section>
  <section class="card">
    <h3>Pit scouting</h3>
    ${s.pit ? `<dl class="pit">${cfg.pitFields.map((f) => `<dt>${esc(f.label)}</dt><dd>${pitVal(f)}</dd>`).join('')}</dl>
      <small>By ${esc(s.pit.scout || 'unknown')}, ${new Date(s.pit.ts).toLocaleString()}</small>` : `<p>Not pit scouted yet. <a href="#pit/${s.team}">Scout now</a></p>`}
  </section>
  <section class="card">
    <h3>Match entries (${recs.length})</h3>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Match</th><th>Pts</th><th>Auto</th><th>Tele</th><th>End</th><th>Tips</th><th>Park</th><th>Notes</th><th></th></tr></thead>
      <tbody>${recs.map((r) => {
        const p = recordPoints(r, cfg);
        const flags = [r.d.oNoShow && 'NO SHOW', r.d.oDead && 'died', r.d.tDef && 'defense'].filter(Boolean).join(', ');
        return `<tr><td><span class="${r.alliance}">${esc(r.match)}</span><br><small>${esc(r.scout || '')}</small></td><td><b>${p.total}</b></td><td>${p.auto}</td><td>${p.teleop}</td><td>${p.endgame}</td>
          <td>${(Number(r.d.aTip) || 0) + (Number(r.d.tTip) || 0)}</td><td>${r.d.ePark ? '✓' : ''}</td>
          <td class="notes">${esc([flags, r.d.oNotes].filter(Boolean).join(' — '))}</td>
          <td><button class="btn ghost danger" data-delrec="${esc(r.id)}" aria-label="Delete">✕</button></td></tr>`;
      }).join('')}</tbody>
    </table></div>
  </section>
  ${sched.length ? `<section class="card"><h3>Schedule</h3><div class="list">${sched.map((m) => `<div class="list-item"><div><b>${esc(m.name)}</b>
    <span class="red">${m.red.join(' · ')}</span> vs <span class="blue">${m.blue.join(' · ')}</span></div>
    <div>${m.redScore != null ? `<span class="red">${m.redScore}</span>-<span class="blue">${m.blueScore}</span>` : ''}</div></div>`).join('')}</div></section>` : ''}`;
  $$('[data-delrec]', box).forEach((b) => {
    b.onclick = () => { if (confirm('Delete this match entry from this device?')) { store.deleteMatchRecord(b.dataset.delrec); renderAnalysis(String(s.team)); } };
  });
}

function renderPickList(box, stats, evKey) {
  const weights = { ...DEFAULT_WEIGHTS, ...store.getPickList(evKey).weights };
  const scores = pickScores(stats, weights);
  let pl = store.getPickList(evKey);
  const known = new Set(stats.map((s) => s.team));
  // Keep stored order, then append any new teams by score.
  const order = pl.order.filter((t) => known.has(t));
  const rest = stats.map((s) => s.team).filter((t) => !order.includes(t)).sort((a, b) => scores.get(b) - scores.get(a));
  pl = { ...pl, order: [...order, ...rest] };
  const byTeam = new Map(stats.map((s) => [s.team, s]));
  const save = () => store.savePickList(evKey, pl);

  const draw = () => {
    box.innerHTML = `
    <section class="card">
      <h2>Pick list</h2>
      <p>Drag teams (or use the arrows) to reorder. Mark teams as picked by another alliance or "do not pick". The order is saved on this device.</p>
      <details><summary>Auto-sort weights</summary>
        <div class="weights">${Object.keys(DEFAULT_WEIGHTS).map((k) => `<label class="field"><span class="lbl">${k}</span><input type="range" min="0" max="10" value="${weights[k]}" data-w="${k}"><small>${weights[k]}</small></label>`).join('')}</div>
      </details>
      <div class="row">
        <button class="btn primary" id="pl-auto">Auto-sort by score</button>
        <button class="btn" id="pl-csv">Export CSV</button>
        <button class="btn" id="pl-reset-picked">Clear picked marks</button>
      </div>
      <ol class="picklist" id="pl">${pl.order.map((t, i) => {
        const s = byTeam.get(t);
        const cls = pl.dnp.includes(t) ? 'dnp' : pl.picked.includes(t) ? 'picked' : '';
        return `<li draggable="true" data-t="${t}" class="${cls}">
          <span class="handle" aria-hidden="true">⋮⋮</span>
          <span class="num">${i + 1}</span>
          <div class="who"><a href="#analysis/${t}"><b>${t}</b></a> <small>${esc(s?.name || '')}</small><br>
            <small>${s?.n ? `${fmt(s.total)} pts · auto ${fmt(s.auto)} · end ${fmt(s.endgame)} · tips ${fmt(s.tips)} · ${s.n} m` : 'no match data'}${s?.rank ? ` · rank ${s.rank}` : ''}</small></div>
          <span class="score-badge" title="pick score">${scores.get(t) ?? 0}</span>
          <div class="pl-actions">
            <button class="btn ghost" data-mv="-1" aria-label="Move up">▲</button>
            <button class="btn ghost" data-mv="1" aria-label="Move down">▼</button>
            <button class="btn ghost" data-mark="picked" title="Picked by another alliance">✓</button>
            <button class="btn ghost" data-mark="dnp" title="Do not pick">⛔</button>
          </div></li>`;
      }).join('')}</ol>
    </section>`;

    $$('[data-w]', box).forEach((r) => {
      r.onchange = () => { weights[r.dataset.w] = Number(r.value); pl.weights = { ...weights }; save(); renderPickList(box, stats, evKey); };
    });
    $('#pl-auto', box).onclick = () => {
      pl.order = [...pl.order].sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0));
      // DNP teams go to the bottom.
      pl.order = [...pl.order.filter((t) => !pl.dnp.includes(t)), ...pl.order.filter((t) => pl.dnp.includes(t))];
      save(); draw();
    };
    $('#pl-reset-picked', box).onclick = () => { pl.picked = []; save(); draw(); };
    $('#pl-csv', box).onclick = () => {
      const rows = [['Pick', 'Team', 'Name', 'Status', 'Score', 'Avg pts', 'Auto', 'TeleOp', 'Endgame', 'Tips', 'Park %', 'Matches', 'Rank']];
      pl.order.forEach((t, i) => {
        const s = byTeam.get(t);
        rows.push([i + 1, t, s?.name || '', pl.dnp.includes(t) ? 'DNP' : pl.picked.includes(t) ? 'Picked' : '', scores.get(t),
          fmt(s?.total), fmt(s?.auto), fmt(s?.teleop), fmt(s?.endgame), fmt(s?.tips), s?.n ? Math.round(s.park * 100) : '', s?.n ?? 0, s?.rank ?? '']);
      });
      download(`picklist-${evKey}.csv`, toCsv(rows), 'text/csv');
    };
    const list = $('#pl', box);
    list.onclick = (e) => {
      const li = e.target.closest('li');
      if (!li) return;
      const t = Number(li.dataset.t);
      const mv = e.target.closest('[data-mv]');
      const mark = e.target.closest('[data-mark]');
      if (mv) {
        const i = pl.order.indexOf(t);
        const j = i + Number(mv.dataset.mv);
        if (j < 0 || j >= pl.order.length) return;
        [pl.order[i], pl.order[j]] = [pl.order[j], pl.order[i]];
      } else if (mark) {
        const k = mark.dataset.mark;
        pl[k] = pl[k].includes(t) ? pl[k].filter((x) => x !== t) : [...pl[k], t];
      } else return;
      save(); draw();
    };
    let dragT = null;
    list.addEventListener('dragstart', (e) => { const li = e.target.closest('li'); dragT = Number(li?.dataset.t); li?.classList.add('dragging'); });
    list.addEventListener('dragend', () => { dragT = null; draw(); });
    list.addEventListener('dragover', (e) => {
      e.preventDefault();
      const over = e.target.closest('li');
      if (!over || dragT == null || Number(over.dataset.t) === dragT) return;
      const from = pl.order.indexOf(dragT);
      const to = pl.order.indexOf(Number(over.dataset.t));
      pl.order.splice(from, 1);
      pl.order.splice(to, 0, dragT);
      const dragged = list.querySelector(`li[data-t="${dragT}"]`);
      list.insertBefore(dragged, from < to ? over.nextSibling : over);
      save();
    });
  };
  draw();
}

function importPayload(text, log) {
  try {
    const { kind, records } = decodePayload(text.trim());
    const res = kind === 'match' ? store.saveMatchRecords(records) : store.savePitRecords(records);
    const desc = kind === 'match' ? records.map((r) => `${r.match}·${r.team}`).join(', ') : records.map((r) => `pit ${r.team}`).join(', ');
    log(`✓ ${records.length} ${kind} record(s): ${res.added} new, ${res.updated} updated — ${desc}`, 'ok');
    if (records[0]?.event && !settings.eventKey) settings = store.saveSettings({ eventKey: records[0].event });
    return true;
  } catch (err) {
    log(`✗ ${err.message}`, 'err');
    return false;
  }
}

function renderScan(box) {
  box.innerHTML = `
  <section class="card">
    <h2>Scan match &amp; pit QR codes</h2>
    <p>Point the camera at a QR code shown on a scout's device. Each code is merged into this device's data; scanning the same code twice is safe.</p>
    <div class="row">
      <button class="btn primary" id="scan-start">Start camera</button>
      <button class="btn" id="scan-stop" disabled>Stop</button>
      <label class="btn">From photo<input type="file" accept="image/*" id="scan-file" multiple hidden></label>
    </div>
    <div class="scanner"><video id="scan-video" muted playsinline></video><canvas id="scan-canvas" hidden></canvas></div>
    <details><summary>Paste QR text instead</summary>
      <textarea id="scan-text" rows="3" placeholder="FTCS1{...}"></textarea>
      <button class="btn" id="scan-paste">Import text</button>
    </details>
    <ul class="scan-log" id="scan-log"></ul>
  </section>`;
  const logEl = $('#scan-log', box);
  const log = (msg, kind) => { logEl.insertAdjacentHTML('afterbegin', `<li class="${kind}">${esc(msg)}</li>`); if (kind === 'ok' && navigator.vibrate) navigator.vibrate(60); };
  $('#scan-start', box).onclick = async () => {
    try {
      stopScan = await startScanner($('#scan-video', box), $('#scan-canvas', box), (t) => importPayload(t, log));
      $('#scan-start', box).disabled = true;
      $('#scan-stop', box).disabled = false;
    } catch (err) { log(`✗ Camera unavailable: ${err.message}. Use "From photo" instead.`, 'err'); }
  };
  $('#scan-stop', box).onclick = () => { stopScan?.(); stopScan = null; $('#scan-start', box).disabled = false; $('#scan-stop', box).disabled = true; };
  $('#scan-file', box).onchange = async (e) => {
    for (const f of e.target.files) {
      try { importPayload(await scanFile(f), log); } catch (err) { log(`✗ ${f.name}: ${err.message}`, 'err'); }
    }
    e.target.value = '';
  };
  $('#scan-paste', box).onclick = () => { importPayload($('#scan-text', box).value, log); };
}

function renderData(box, evKey) {
  const m = store.getMatchRecords(evKey);
  const p = store.getPitRecords(evKey);
  box.innerHTML = `
  <section class="card">
    <h2>Data</h2>
    <p>${m.length} match entries and ${p.length} pit entries for this event on this device.</p>
    <div class="row">
      <button class="btn" id="d-csv-m" ${m.length ? '' : 'disabled'}>Match data CSV</button>
      <button class="btn" id="d-csv-p" ${p.length ? '' : 'disabled'}>Pit data CSV</button>
      <button class="btn" id="d-qr-m" ${m.length ? '' : 'disabled'}>Match QR codes</button>
      <button class="btn" id="d-qr-p" ${p.length ? '' : 'disabled'}>Pit QR codes</button>
    </div>
    <h3>Backup / sync by file</h3>
    <p>A backup holds every event, entry and pick list on this device. Importing merges (newest entry wins).</p>
    <div class="row">
      <button class="btn" id="d-export">Export backup</button>
      <label class="btn">Import backup<input type="file" accept=".json,application/json" id="d-import" hidden></label>
    </div>
  </section>`;
  const csv = (recs, fields, head) => toCsv([[...head, ...fields.map((f) => f.label), ...(fields === cfg.matchFields ? ['Est auto', 'Est teleop', 'Est endgame', 'Est total'] : [])],
    ...recs.map((r) => {
      const base = head.length === 4 ? [r.match, r.team, r.alliance, r.scout] : [r.team, r.scout];
      const vals = fields.map((f) => r.d?.[f.id] ?? '');
      if (fields !== cfg.matchFields) return [...base, ...vals];
      const pts = recordPoints(r, cfg);
      return [...base, ...vals, pts.auto, pts.teleop, pts.endgame, pts.total];
    })]);
  $('#d-csv-m', box).onclick = () => download(`match-${evKey}.csv`, csv(m, cfg.matchFields, ['Match', 'Team', 'Alliance', 'Scout']), 'text/csv');
  $('#d-csv-p', box).onclick = () => download(`pit-${evKey}.csv`, csv(p, cfg.pitFields, ['Team', 'Scout']), 'text/csv');
  $('#d-qr-m', box).onclick = () => showQr('All match data', encodeRecords(m, 'm', cfg));
  $('#d-qr-p', box).onclick = () => showQr('All pit data', encodeRecords(p, 'p', cfg));
  $('#d-export', box).onclick = () => download(`ftc-scouting-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store.exportAll()));
  $('#d-import', box).onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const r = store.importAll(JSON.parse(await f.text()));
      toast(`Imported: ${r.matches.added} new match, ${r.pits.added} new pit entries`, 'ok');
      renderData(box, evKey);
    } catch (err) { toast(err.message, 'err'); }
  };
}

// ---- Settings page -------------------------------------------------------------

function renderSettings() {
  app.innerHTML = `
  <section class="card">
    <h2>Settings</h2>
    <label class="field wide"><span class="lbl">Scout name</span><input id="s-scout" value="${esc(settings.scout)}"></label>
    <label class="field wide"><span class="lbl">The Orange Alliance API key (optional)</span><input id="s-key" value="${esc(settings.toaKey)}" autocomplete="off" spellcheck="false"></label>
    <p><small>Get a free key from your account page on <a href="https://theorangealliance.org" target="_blank" rel="noopener">theorangealliance.org</a>. It is stored only on this device.
      You usually don't need one: event data comes from FTCScout, and the Orange Alliance backup is published by the team's GitHub Action from the <code>TOA_API_KEY</code> repository secret. A key here just enables live Orange Alliance requests from this device.</small></p>
    <button class="btn primary" id="s-save">Save</button>
  </section>
  <section class="card">
    <h3>Install for offline use</h3>
    <p>Open this site once while online, then use your browser's "Add to Home Screen" / "Install app". After that the app opens and records data with no internet. Load each event's schedule before you lose signal.</p>
    <p id="sw-status"><small>Offline cache: checking…</small></p>
  </section>
  <section class="card">
    <h3>Danger zone</h3>
    <button class="btn danger" id="s-clear">Delete all scouting data on this device</button>
  </section>`;
  $('#s-save').onclick = () => {
    // Only these two fields; the season is chosen on the Event page.
    settings = store.saveSettings({ scout: $('#s-scout').value.trim(), toaKey: $('#s-key').value.trim() });
    toast('Settings saved', 'ok');
  };
  $('#s-clear').onclick = () => {
    if (confirm('Delete ALL match, pit and pick list data on this device? Export a backup first if unsure.')) {
      store.clearScoutingData();
      toast('Scouting data deleted');
    }
  };
  const swEl = $('#sw-status');
  if ('serviceWorker' in navigator) {
    Promise.all([navigator.serviceWorker.getRegistration(), caches.keys().catch(() => [])]).then(([r, keys]) => {
      const ver = keys.find((k) => k.startsWith('ftcs-'));
      swEl.innerHTML = `<small>Offline cache: ${r?.active ? `ready ✓${ver ? ` · app version ${esc(ver.replace('ftcs-', ''))}` : ''}` : 'not installed yet (needs https or localhost)'}</small>
        <br><button class="btn" id="sw-update">Check for updates</button>`;
      $('#sw-update').onclick = async () => {
        toast('Checking for updates…');
        await r?.update().catch(() => {});
        location.reload();
      };
    });
  } else swEl.innerHTML = '<small>Offline cache: not supported by this browser</small>';
}

function noEvent() {
  return `<section class="card"><h2>No event selected</h2><p>Choose or set up an event on the <a href="#event">Event</a> tab first.</p></section>`;
}

// ---- router ------------------------------------------------------------------

function route() {
  if (stopScan) { stopScan(); stopScan = null; }
  const [page = 'event', ...args] = location.hash.replace(/^#/, '').split('/');
  $$('#tabs a', document).forEach((a) => a.classList.toggle('active', a.dataset.page === (page || 'event')));
  // Swap in a fresh <main> so listeners from the previous render are dropped.
  const fresh = app.cloneNode(false);
  app.replaceWith(fresh);
  app = fresh;
  updateHeader();
  ({ event: renderEvent, pit: renderPit, match: renderMatch, analysis: renderAnalysis, settings: renderSettings }[page] || renderEvent)(...args);
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
window.addEventListener('online', updateHeader);
window.addEventListener('offline', updateHeader);
// Another tab changed settings: pick up its season too, not just the values.
window.addEventListener('storage', (e) => {
  if (e.key && e.key !== 'ftcs.settings') return;
  const prev = cfg.key;
  settings = store.getSettings();
  cfg = season(settings.season);
  if (cfg.key !== prev) route();
});

if ('serviceWorker' in navigator) {
  // Only a page that was already controlled is running old code when a new
  // service worker takes over; offer a reload rather than forcing one so
  // nobody loses a half-filled form.
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || document.getElementById('update-bar')) return;
    document.body.insertAdjacentHTML('beforeend',
      '<div id="update-bar" class="update-bar">A new version is ready. <button class="btn primary" id="update-reload">Reload</button></div>');
    document.getElementById('update-reload').onclick = () => location.reload();
  });
  navigator.serviceWorker.register('sw.js').then((r) => r.update()).catch(() => {});
}

route();
