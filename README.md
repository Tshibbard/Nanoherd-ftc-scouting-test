# FTC Scouting — BIOBUZZ (2026-2027)

An offline-first, web-based scouting app for FIRST Tech Challenge. It's plain HTML/CSS/JavaScript with no build step and no server code, so it can be hosted anywhere that serves static files (GitHub Pages works well).

## Features

| Tab | What it does |
| --- | --- |
| **Event** | Downloads the season's events, then a single event's teams, match schedule, scores and rankings from **The Orange Alliance**. Everything is cached on the device. You can also enter teams and a schedule by hand when there's no signal or the event isn't on TOA yet. |
| **Pit** | One-tap team grid (green = done) and a BIOBUZZ pit form: drivetrain, size, POLLEN/NECTAR handling, HIVE/FLOWER/GARDEN scoring, auto routine, claimed HIVE TIPs, endgame, and notes. |
| **Match** | Pick your station (R1/R2/B1/B2) and the team fills in from the schedule. Big +/− counters and toggles cover Auto, TeleOp and Endgame, plus a live estimated score. **Save** shows the entry as a QR code and moves on to the next match. Saved entries can be edited. |
| **Analysis** | Shows match and pit data from this device and from scanned QR codes. It has a sortable team table, a points-by-phase chart and team detail pages that combine pit info with each match entry. The **pick list** can be dragged or nudged with arrows, marked picked or do-not-pick, auto-sorted with adjustable weights and exported to CSV. The **Scan QR** tab reads codes through the camera or from photos. The **Data** tab has CSV export and JSON backup and restore. |

### Offline use

* A service worker (`sw.js`) caches the whole app after the first visit. Use "Add to Home Screen" / "Install app" to get a full-screen app icon.
* All scouting data is stored in the browser's `localStorage`, so nothing is lost when the connection drops.
* **Load each event on the Event tab while you still have internet.** The schedule then stays available offline.
* Service workers need **HTTPS** (or `localhost`). Opening `index.html` straight from disk won't give you offline caching.

### Moving data between devices (no internet needed)

1. A match scout taps **Save & show QR** (or *QR for all / my entries*). Pit data has a **Show QR** button too.
2. The analyst opens **Analysis → Scan QR → Start camera** and points it at the scout's screen.
3. The records merge into the analyst's device. Scanning a code twice is harmless, and if a team or match was scouted more than once, the newest entry wins.

Large batches are split across several codes. Use ◀ / ▶ in the QR window to page through them. For bulk sync, the **Data → Export backup / Import backup** JSON files work too.

## The Orange Alliance setup

1. Create an account at <https://theorangealliance.org> and generate an API key on your account page.
2. Paste the key into **Settings** in the app. It's stored only on that device.
3. On **Event**, tap **Load 2026-2027 events**, search for your event, and tap it. You can also type an event key such as `2627-CA-XXXX`.

The app calls `GET /api/event?season_key=2627`, `/api/event/{key}`, `/api/event/{key}/teams`, `/matches` and `/rankings` with the `X-TOA-Key` and `X-Application-Origin` headers (see `js/toa.js`).

## Running it

```bash
# any static server works
python3 -m http.server 8000
# open http://localhost:8000
```

To deploy on GitHub Pages, go to *Settings → Pages → Deploy from branch*, pick this branch and `/ (root)`. The `.nojekyll` file is already included.

## Changing the game / point values

Everything specific to the game is in [`js/config.js`](js/config.js):

* `matchFields`: every match-scouting input, its phase (`auto`/`teleop`/`endgame`/`other`) and `points` per unit. These drive the form, the score estimate and all the analysis.
* `pitFields`: the pit form.

The BIOBUZZ point values come from Competition Manual Table 10-2: LEAVE 3, PARK 5, HIVE TIP 20, piece in a CELL 2, Bottom NECTAR Bonus 5, piece in an owned FLOWER 2, piece in a GARDEN 1. **Check them against the latest manual and team updates.** The estimate credits each robot with the actions the scout saw it do. Things that are scored per alliance, like FLOWER ownership, are only approximated.

Field `id`s are written into QR codes. You can add or reorder fields freely, but don't reuse an old `id` for a different meaning. When a new season starts, add a new entry to `SEASONS` and set `DEFAULT_SEASON`.

Whenever you change cached files, bump `VERSION` in `sw.js` so installed devices pick up the update.

## Project layout

```
index.html            app shell
css/style.css         styles (light + dark)
js/app.js             UI: event, pit, match, analysis, settings pages
js/config.js          season definition (fields + points)
js/storage.js         localStorage persistence, backup/merge
js/toa.js             The Orange Alliance API client
js/qr.js              compact QR encoding, camera/photo scanning
js/analysis.js        per-team stats, pick score, CSV
sw.js                 offline cache
vendor/qrcode.js      qrcode-generator 1.4.4 (MIT, Kazuhiko Arase)
vendor/jsQR.js        jsQR 1.4.0 (Apache-2.0, Cosmo Wolfe)
```
