// QR code transfer of scouting records between devices (no internet needed).
//
// Payload: "FTCS1" + JSON { s: season, t: 'm'|'p', f: [fieldIds], r: [rows] }
// Each row is [event, match, team, alliance, scout, ts36, ...values] for
// match records or [event, team, scout, ts36, ...values] for pit records,
// with values in the same order as `f`. Carrying the field list makes old
// codes still decode correctly if the field config changes later.

/* global qrcode, jsQR */

const MAGIC = 'FTCS1';
const MAX_CHARS = 1100; // keeps codes scannable from a phone screen

qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

function packValue(field, v) {
  if (field.type === 'toggle') return v ? 1 : 0;
  if (field.type === 'text') return v || '';
  if (v === '' || v == null) return null;
  return typeof v === 'number' ? v : (field.type === 'select' ? v : Number(v));
}

function packMatch(rec, fields) {
  return [rec.event, rec.match, rec.team, rec.alliance === 'blue' ? 'b' : 'r', rec.scout || '', (rec.ts || 0).toString(36),
    ...fields.map((f) => packValue(f, rec.d?.[f.id]))];
}

function packPit(rec, fields) {
  return [rec.event, rec.team, rec.scout || '', (rec.ts || 0).toString(36), ...fields.map((f) => packValue(f, rec.d?.[f.id]))];
}

// Split records into as many payload strings as needed.
export function encodeRecords(records, kind, seasonCfg) {
  const fields = kind === 'm' ? seasonCfg.matchFields : seasonCfg.pitFields;
  const pack = kind === 'm' ? packMatch : packPit;
  const head = { s: seasonCfg.key, t: kind, f: fields.map((f) => f.id), r: [] };
  const payloads = [];
  let cur = { ...head, r: [] };
  for (const rec of records) {
    const row = pack(rec, fields);
    const trial = { ...cur, r: [...cur.r, row] };
    if (cur.r.length && MAGIC.length + JSON.stringify(trial).length > MAX_CHARS) {
      payloads.push(MAGIC + JSON.stringify(cur));
      cur = { ...head, r: [row] };
    } else {
      cur = trial;
    }
  }
  if (cur.r.length) payloads.push(MAGIC + JSON.stringify(cur));
  return payloads;
}

// Returns { kind: 'match'|'pit', records: [...] } or throws.
export function decodePayload(text) {
  if (!text || !text.startsWith(MAGIC)) throw new Error('Not a scouting QR code');
  const obj = JSON.parse(text.slice(MAGIC.length));
  const ids = obj.f || [];
  const rows = obj.r || [];
  if (obj.t === 'm') {
    return {
      kind: 'match',
      records: rows.map((row) => {
        const [event, match, team, al, scout, ts36, ...vals] = row;
        const d = {};
        ids.forEach((id, i) => { if (vals[i] !== null && vals[i] !== undefined) d[id] = vals[i]; });
        return {
          id: `${event}|${match}|${team}`,
          event, match, team: Number(team), alliance: al === 'b' ? 'blue' : 'red',
          scout, ts: parseInt(ts36, 36) || 0, d,
        };
      }),
    };
  }
  if (obj.t === 'p') {
    return {
      kind: 'pit',
      records: rows.map((row) => {
        const [event, team, scout, ts36, ...vals] = row;
        const d = {};
        ids.forEach((id, i) => { if (vals[i] !== null && vals[i] !== undefined) d[id] = vals[i]; });
        return { id: `${event}|${team}`, event, team: Number(team), scout, ts: parseInt(ts36, 36) || 0, d };
      }),
    };
  }
  throw new Error('Unknown QR record type');
}

// Render a payload to an SVG string.
export function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}

// ---- scanning ----------------------------------------------------------------

function decodeImageData(img) {
  const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
  if (!code) return null;
  if (code.binaryData && code.binaryData.length) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(code.binaryData));
    } catch { /* fall through */ }
  }
  return code.data;
}

// Live camera scanner. Calls onText(text) for every distinct code seen.
// Returns a stop() function.
export async function startScanner(video, canvas, onText) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  await video.play();
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let running = true;
  let last = '';
  const tick = () => {
    if (!running) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      const scale = Math.min(1, 800 / video.videoWidth);
      canvas.width = Math.floor(video.videoWidth * scale);
      canvas.height = Math.floor(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const text = decodeImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
      if (text && text !== last) {
        last = text;
        onText(text);
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => {
    running = false;
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
}

// Decode a QR code from a photo/screenshot file.
export function scanFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.floor(img.width * scale);
      c.height = Math.floor(img.height * scale);
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const text = decodeImageData(ctx.getImageData(0, 0, c.width, c.height));
      text ? resolve(text) : reject(new Error('No QR code found in that image'));
    };
    img.onerror = () => reject(new Error('Could not read image'));
    img.src = url;
  });
}
