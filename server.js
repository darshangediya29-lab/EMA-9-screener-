/**
 * EMA9 Screener — Cloud-Ready Backend
 * Binance Perpetual Futures
 *
 * Required env vars:
 *   MONGODB_URI   — MongoDB Atlas connection string
 *   PORT          — set automatically by Railway/Render
 */

const express  = require('express');
const https    = require('https');
const http     = require('http');
const path     = require('path');
const mongoose = require('mongoose');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── MongoDB ───────────────────────────────────────────────────────
const MONGO_URI = process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error('❌  MONGODB_URI not set. Add it in Railway → Variables.');
  process.exit(1);
}

mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 })
  .then(() => console.log('✅  MongoDB connected'))
  .catch(err => { console.error('❌  MongoDB:', err.message); process.exit(1); });

// ── Schemas ───────────────────────────────────────────────────────
const TradeSchema = new mongoose.Schema({
  sym: String, base: String, sig: String, tf: String,
  confClose: Number, crossClose: Number,
  bodyPct: Number, confBodyPct: Number, confVolX: Number, e9: Number,
  scannedAt: { type: Date, default: Date.now }
});

const StateSchema = new mongoose.Schema({
  _id:        { type: String, default: 'singleton' },
  tf:         { type: String,  default: '1m'   },
  tfIv:       { type: Number,  default: 60      },
  autoOn:     { type: Boolean, default: false   },
  lastScanTs: { type: Number,  default: 0       }
});

const Trade = mongoose.model('Trade', TradeSchema);
const State = mongoose.model('State', StateSchema);

// ── state ─────────────────────────────────────────────────────────
let state = { tf: '1m', tfIv: 60, autoOn: false, lastScanTs: 0 };

async function loadState() {
  const doc = await State.findById('singleton').lean();
  if (doc) { state.tf = doc.tf; state.tfIv = doc.tfIv; state.autoOn = doc.autoOn; state.lastScanTs = doc.lastScanTs; }
  else      { await State.create({ _id: 'singleton', ...state }); }
}
async function saveState() {
  await State.findByIdAndUpdate('singleton', state, { upsert: true });
}

let scanning = false, lastSignals = [], scanTimer = null;

// ── pairs ─────────────────────────────────────────────────────────
const PAIRS = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT',
  'DOGEUSDT','ADAUSDT','AVAXUSDT','DOTUSDT','LINKUSDT',
  'MATICUSDT','LTCUSDT','UNIUSDT','ATOMUSDT','ETCUSDT',
  'XLMUSDT','VETUSDT','TRXUSDT','NEARUSDT','APTUSDT',
  'ARBUSDT','OPUSDT','INJUSDT','SUIUSDT','SEIUSDT',
  'TIAUSDT','STXUSDT','RUNEUSDT','WLDUSDT','TONUSDT'
];

// ── HTTP helper ───────────────────────────────────────────────────
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: 8000 }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── EMA ───────────────────────────────────────────────────────────
function calcEMA(closes, period) {
  if (closes.length < period) return [];
  const k = 2 / (period + 1);
  const out = new Array(closes.length).fill(null);
  out[period - 1] = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) out[i] = closes[i] * k + out[i-1] * (1 - k);
  return out;
}

// ── screen one symbol ─────────────────────────────────────────────
async function screenSymbol(sym) {
  const kl = await fetchJSON(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${state.tf}&limit=60`);
  if (!Array.isArray(kl) || kl.length < 5) return null;

  const ci = kl.length-3, cnf = kl.length-2, prv = kl.length-4;
  const closes = kl.map(k=>+k[4]), opens = kl.map(k=>+k[1]);
  const highs  = kl.map(k=>+k[2]), lows  = kl.map(k=>+k[3]), vols = kl.map(k=>+k[5]);
  const e9 = calcEMA(closes,9), e21 = calcEMA(closes,21);
  if (!e9[ci] || !e9[prv]) return null;

  const crossUp   = closes[prv] < e9[prv] && closes[ci] > e9[ci];
  const crossDown = closes[prv] > e9[prv] && closes[ci] < e9[ci];
  if (!crossUp && !crossDown) return null;
  if (crossUp   && closes[ci] <= e9[ci])  return null;
  if (crossDown && closes[ci] >= e9[ci])  return null;

  const body = Math.abs(closes[ci]-opens[ci]), range = highs[ci]-lows[ci];
  if (!range || body/range < 0.75) return null;

  if (crossUp  && highs[cnf] <= highs[ci]) return null;
  if (!crossUp && lows[cnf]  >= lows[ci])  return null;
  if (crossUp  && closes[cnf] <= closes[ci]) return null;
  if (!crossUp && closes[cnf] >= closes[ci]) return null;

  const confBody = Math.abs(closes[cnf]-opens[cnf]), confRange = highs[cnf]-lows[cnf];
  if (!confRange || confBody/confRange < 0.75) return null;
  if (vols[cnf] <= vols[ci]) return null;

  return {
    sym, base: sym.replace('USDT',''), sig: crossUp?'BUY':'SELL',
    crossClose: closes[ci], confClose: closes[cnf],
    e9: e9[ci], e21: e21[ci]||null,
    bodyPct:    +(body/range*100).toFixed(2),
    confBodyPct:+(confBody/confRange*100).toFixed(2),
    volX:       +(vols[ci]/vols[prv]).toFixed(3),
    confVolX:   +(vols[cnf]/vols[ci]).toFixed(3),
    candleTime: new Date(kl[cnf][6]).toISOString()
  };
}

// ── run full scan ─────────────────────────────────────────────────
async function runScan() {
  if (scanning) return;
  scanning = true;
  const found = [], now = new Date();
  console.log(`[${now.toLocaleTimeString()}] Scanning ${state.tf}…`);

  for (const sym of PAIRS) {
    try { const s = await screenSymbol(sym); if (s) { found.push(s); console.log(`  ✓ ${s.sig} ${sym}`); } }
    catch {}
    await new Promise(r => setTimeout(r, 80));
  }

  lastSignals = found;
  state.lastScanTs = Date.now();
  await saveState();

  if (found.length) {
    const cutoff = new Date(Date.now() - state.tfIv * 2 * 1000);
    for (const s of found) {
      const dup = await Trade.exists({ sym: s.sym, sig: s.sig, tf: state.tf, scannedAt: { $gte: cutoff } });
      if (!dup) await Trade.create({ ...s, tf: state.tf, scannedAt: now });
    }
  }

  scanning = false;
  console.log(`[${new Date().toLocaleTimeString()}] Done — ${found.length} signal(s)`);
}

// ── scheduler ────────────────────────────────────────────────────
function stopAutoScan() { if (scanTimer) { clearInterval(scanTimer); scanTimer = null; } }
function startAutoScan() {
  stopAutoScan();
  if (!state.autoOn) return;
  scanTimer = setInterval(() => runScan(), state.tfIv * 1000);
  console.log(`⏱  Auto every ${state.tfIv}s on ${state.tf}`);
}

// ── CORS + middleware ─────────────────────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── API ───────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  const elapsed = Math.floor((Date.now() - (state.lastScanTs||0)) / 1000);
  res.json({
    tf: state.tf, tfIv: state.tfIv, autoOn: state.autoOn, scanning,
    lastScanTs: state.lastScanTs,
    nextScanIn: state.autoOn ? Math.max(0, state.tfIv - elapsed) : null,
    signals: lastSignals
  });
});

app.post('/api/scan', (req, res) => {
  if (scanning) return res.json({ ok: false, msg: 'Already scanning' });
  runScan();
  res.json({ ok: true });
});

app.post('/api/settings', async (req, res) => {
  const { tf, tfIv, autoOn } = req.body;
  if (tf)    state.tf    = tf;
  if (tfIv)  state.tfIv  = Number(tfIv);
  if (typeof autoOn === 'boolean') state.autoOn = autoOn;
  await saveState();
  stopAutoScan();
  if (state.autoOn) { runScan(); startAutoScan(); }
  res.json({ ok: true, state });
});

app.get('/api/logs', async (req, res) => {
  const logs = await Trade.find().sort({ scannedAt: -1 }).limit(1000).lean();
  res.json(logs);
});

app.delete('/api/logs', async (req, res) => {
  await Trade.deleteMany({});
  res.json({ ok: true });
});

app.get('/api/logs/export', async (req, res) => {
  const logs = await Trade.find().sort({ scannedAt: -1 }).lean();
  const hdr  = '#,Scanned At,TF,Symbol,Signal,Conf Close,Cross Close,Body%,Vol×\n';
  const rows = logs.map((e,i) =>
    `${i+1},"${new Date(e.scannedAt).toLocaleString('en-IN')}",${e.tf},${e.base},${e.sig},${e.confClose},${e.crossClose},${e.bodyPct},${e.confVolX}`
  ).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="ema9_trade_log.csv"');
  res.send(hdr + rows);
});

// ── start ─────────────────────────────────────────────────────────
async function main() {
  await loadState();
  app.listen(PORT, () => {
    console.log('─────────────────────────────────');
    console.log(`  EMA9 Screener → :${PORT}`);
    console.log(`  TF: ${state.tf}  Auto: ${state.autoOn}`);
    console.log('─────────────────────────────────');
  });
  if (state.autoOn) {
    const delay = Math.max(0, state.tfIv - Math.floor((Date.now()-(state.lastScanTs||0))/1000));
    console.log(`▶  Auto-scan resumes in ${delay}s`);
    setTimeout(() => { runScan(); startAutoScan(); }, delay * 1000);
  }
}
main();
