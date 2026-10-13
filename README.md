# FTC Scouting — BIOBUZZ (2026-2027)

An offline-first, web-based scouting app for FIRST Tech Challenge. It's plain HTML/CSS/JavaScript with no build step and no server code, so it can be hosted anywhere that serves static files (GitHub Pages works well).

## Features

| Tab | What it does |
| --- | --- |
| **Event** | Enter a **team number** to list the events that team is registered for this season, then tap one to load it. You can also search all of the season's events. Loading an event downloads its teams, match schedule, scores and rankings. **FTCScout** is the primary source and **The Orange Alliance** is the backup. Everything is cached on the device. You can also enter teams and a schedule by hand when there's no signal or the event isn't online yet. |
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

## Data sources

1. **FTCScout** (primary). This uses `https://api.ftcscout.org/rest/v1` and needs no key. Season `2026` is BIOBUZZ. Search the event list, or type the FIRST event code (e.g. `USCASDQ1`). Team names come from one small GraphQL query.
2. **The Orange Alliance** (backup). It's used when FTCScout errors or doesn't have the event yet. The app matches the event by name, so load events from the list (not a typed code) when you want the backup to work. Scouting data stays attached to the same event whichever source supplied the schedule. You can also load a TOA key like `2627-CA-SDQ1` directly.

### Orange Alliance key as a GitHub secret

The TOA key is kept in the **`TOA_API_KEY` repository secret** and never shipped to browsers. Anything in a static site's JavaScript is public, so instead the **Orange Alliance snapshot** Action (`.github/workflows/toa-snapshot.yml`) uses the secret on GitHub's servers. It downloads TOA data into `data/toa/*.json`, which the app reads as its backup.

Setup:

1. Get a free API key from your account page on <https://theorangealliance.org>.
2. In GitHub, go to **Settings → Secrets and variables → Actions → New repository secret**. Name it `TOA_API_KEY` and paste the key as the value.
3. Add the TOA keys of your events to `data/toa-events.txt`, and your team numbers to `data/toa-teams.txt` (this is used by the team search when FTCScout is down), one per line. Pushing that file runs the Action. You can also run it by hand from **Actions → Orange Alliance snapshot → Run workflow**, optionally with extra event keys.
4. The Action also runs hourly to keep snapshots fresh. It only commits when the data actually changed. Scheduled runs only happen on the repository's default branch.

Optional: a key entered in the app's **Settings** tab enables live TOA requests from that device. It's stored only on that device.

### Testing with last season's data (DECODE 2025-2026)

On the **Event** page, set **Season** to **DECODE 2025-2026 (testing)** and confirm. The choice is saved on the device and stays until you change it there again, through reloads, app updates and offline use. Each season remembers its own current event. The team search, event list and event downloads then use DECODE (FTCScout season `2025`, TOA `2526`), so you can try the app with real teams, schedules and results. The header shows **(test)**. The scouting forms stay BIOBUZZ. Switch back to BIOBUZZ before competition. To snapshot DECODE data from Orange Alliance, run the script with `SEASON=2526`.

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

Whenever you change cached files, bump `VERSION` in `sw.js`. Open devices then show a **"A new version is ready — Reload"** bar. **Settings → Check for updates** forces a check and shows the current app version.

## Project layout

```
index.html            app shell
css/style.css         styles (light + dark)
js/app.js             UI: event, pit, match, analysis, settings pages
js/config.js          season definition (fields + points)
js/storage.js         localStorage persistence, backup/merge
js/datasource.js      picks FTCScout → TOA live → TOA snapshot
js/ftcscout.js        FTCScout API client (primary)
js/toa.js             The Orange Alliance API client (backup)
js/schedule.js        match ordering helper
js/qr.js              compact QR encoding, camera/photo scanning
js/analysis.js        per-team stats, pick score, CSV
sw.js                 offline cache
scripts/toa-snapshot.mjs  writes data/toa/ from the TOA_API_KEY secret
data/toa-events.txt   TOA event keys the snapshot Action downloads
.github/workflows/    toa-snapshot.yml
vendor/qrcode.js      qrcode-generator 1.4.4 (MIT, Kazuhiko Arase)
vendor/jsQR.js        jsQR 1.4.0 (Apache-2.0, Cosmo Wolfe)
```
