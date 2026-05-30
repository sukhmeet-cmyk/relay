/**
 * RELAY — Dispatch Tracking server
 * One file. One dependency (express). Persists to a JSON file.
 *
 * Roles:
 *   Dispatcher  → protected by ADMIN_KEY, creates loads, watches the map.
 *   Driver      → opens a public link /t/:token, shares phone GPS.
 *
 * Env vars (all optional except you SHOULD set ADMIN_KEY):
 *   PORT          default 3000 (most hosts set this for you)
 *   ADMIN_KEY     dispatcher password. CHANGE IT. default "changeme"
 *   PUBLIC_URL    e.g. https://relay.onrender.com  (used in tracking links/SMS)
 *   DATA_FILE     path to persistence file. default ./data.json
 *   TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM   enable SMS link sending (optional)
 */
const express = require('express');
const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');

const app  = express();
app.use(express.json({ limit: '64kb' }));

const PORT       = process.env.PORT || 3000;
const ADMIN_KEY  = process.env.ADMIN_KEY || 'changeme';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const DATA_FILE  = process.env.DATA_FILE || path.join(__dirname, 'data.json');

const SMS_ON = !!(process.env.TWILIO_SID && process.env.TWILIO_TOKEN && process.env.TWILIO_FROM);

/* ---------- persistence ---------- */
let db = { loads: {}, positions: {} };
try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { /* fresh start */ }
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DATA_FILE, JSON.stringify(db), err => { if (err) console.error('save error', err); });
  }, 250);
}

/* ---------- helpers ---------- */
const token = () => crypto.randomBytes(5).toString('hex');                       // 10 chars
const ref   = () => 'TRK-' + crypto.randomBytes(2).toString('hex').toUpperCase(); // TRK-ABCD
const clean = s => (typeof s === 'string' ? s : '').trim().slice(0, 200);

function baseUrl(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  return proto + '://' + req.get('host');
}
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const key = h.startsWith('Bearer ') ? h.slice(7) : (req.query.key || '');
  if (key !== ADMIN_KEY) return res.status(401).json({ error: 'unauthorized' });
  next();
}
const withExtras = (req, L) => ({ ...L, position: db.positions[L.token] || null, trackUrl: baseUrl(req) + '/t/' + L.token });

/* ============================================================
   DISPATCHER API (protected)
   ============================================================ */
app.get('/api/config', auth, (req, res) => res.json({ sms: SMS_ON }));

app.post('/api/loads', auth, (req, res) => {
  const b = req.body || {};
  const t = token();
  const load = {
    token: t, ref: ref(),
    loadNo:  clean(b.loadNo),
    driver:  clean(b.driver),
    phone:   clean(b.phone),
    origin:  clean(b.origin),
    dest:    clean(b.dest),
    carrier: clean(b.carrier),
    status: 'open', created: Date.now()
  };
  db.loads[t] = load; save();
  res.json(withExtras(req, load));
});

app.get('/api/loads', auth, (req, res) => {
  const out = Object.values(db.loads)
    .sort((a, b) => b.created - a.created)
    .map(L => withExtras(req, L));
  res.json(out);
});

app.get('/api/loads/:t', auth, (req, res) => {
  const L = db.loads[req.params.t];
  if (!L) return res.status(404).json({ error: 'not_found' });
  res.json(withExtras(req, L));
});

app.patch('/api/loads/:t', auth, (req, res) => {
  const L = db.loads[req.params.t];
  if (!L) return res.status(404).json({ error: 'not_found' });
  if (req.body && typeof req.body.status === 'string') L.status = req.body.status;
  save();
  res.json(withExtras(req, L));
});

app.delete('/api/loads/:t', auth, (req, res) => {
  delete db.loads[req.params.t];
  delete db.positions[req.params.t];
  save();
  res.json({ ok: true });
});

app.post('/api/loads/:t/sms', auth, async (req, res) => {
  const L = db.loads[req.params.t];
  if (!L) return res.status(404).json({ error: 'not_found' });
  if (!SMS_ON) return res.status(400).json({ error: 'sms_not_configured' });
  if (!L.phone) return res.status(400).json({ error: 'no_phone' });
  const link = baseUrl(req) + '/t/' + L.token;
  const body = `Load ${L.loadNo || L.ref}: please share your location for tracking. Open: ${link}`;
  const sid = process.env.TWILIO_SID, tk = process.env.TWILIO_TOKEN, from = process.env.TWILIO_FROM;
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(sid + ':' + tk).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ To: L.phone, From: from, Body: body })
    });
    const j = await r.json();
    if (!r.ok) return res.status(400).json({ error: 'twilio_error', detail: j.message || j });
    res.json({ ok: true, sid: j.sid });
  } catch (e) {
    res.status(500).json({ error: 'send_failed', detail: String(e) });
  }
});

/* ============================================================
   PUBLIC DRIVER API (no auth — driver only knows their token)
   ============================================================ */
app.get('/api/track/:t', (req, res) => {
  const L = db.loads[req.params.t];
  if (!L) return res.status(404).json({ error: 'not_found' });
  res.json({ ref: L.ref, loadNo: L.loadNo, driver: L.driver, origin: L.origin, dest: L.dest, carrier: L.carrier, status: L.status });
});

app.post('/api/track/:t/ping', (req, res) => {
  const L = db.loads[req.params.t];
  if (!L) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  const lat = Number(b.lat), lng = Number(b.lng);
  if (!isFinite(lat) || !isFinite(lng)) return res.status(400).json({ error: 'bad_coords' });
  const prev = db.positions[L.token];
  const trail = prev && Array.isArray(prev.trail) ? prev.trail.slice(-119) : [];
  trail.push([+lat.toFixed(5), +lng.toFixed(5)]);
  db.positions[L.token] = {
    lat, lng,
    acc: b.acc != null ? Number(b.acc) : null,
    spd: b.spd != null ? Number(b.spd) : null,
    hdg: b.hdg != null ? Number(b.hdg) : null,
    t: Date.now(), trail
  };
  save();
  res.json({ ok: true });
});

/* ============================================================
   PAGES + STATIC
   ============================================================ */
app.get('/healthz', (req, res) => res.send('ok'));
app.get('/t/:t', (req, res) => res.sendFile(path.join(__dirname, 'public', 'track.html')));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`RELAY running on :${PORT}  |  SMS ${SMS_ON ? 'enabled' : 'disabled'}  |  admin key ${ADMIN_KEY === 'changeme' ? '⚠ DEFAULT — change ADMIN_KEY!' : 'set'}`);
});
