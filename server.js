/**
 * EMA9 Screener — Cloud Backend
 * Database: Railway PostgreSQL (or any Postgres)
 * Env vars:
 *   DATABASE_URL  — auto-set by Railway Postgres plugin
 *   PORT          — auto-set by Railway
 */

const express = require('express');
const https   = require('https');
const http    = require('http');
const path    = require('path');
const { Pool } = require('pg');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Postgres ──────────────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌  DATABASE_URL not set. Add Railway Postgres plugin.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ── init tables ───────────────────────────────────────────────────
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trade_log (
      id          SERIAL PRIMARY KEY,
      sym         TEXT,
      base        TEXT,
      sig         TEXT,
      tf          TEXT,
      conf_close  DOUBLE PRECISION,
      cross_close DOUBLE PRECISION,
      body_pct    DOUBLE PRECISION,
      conf_body   DOUBLE PRECISION,
      conf_volx   DOUBLE PRECISION,
      e9          DOUBLE PRECISION,
      scanned_at  TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scanner_state (
      id          TEXT PRIMARY KEY DEFAULT 'singleton',
      tf          TEXT    DEFAULT '1m',
      tf_iv       INTEGER DEFAULT 60,
      auto_on     BOOLEAN DEFAULT false,
      last_scan   BIGINT  DEFAULT 0
    );
  `);
  // ensure singleton row exists
  await pool.query(`
    INSERT INTO scanner_state (id) VALUES ('singleton')
    ON CONFLICT (id) DO NOTHING;
  `);
  console.log('✅  DB ready');
}

// ── state ─────────────────────────────────────────────────────────
let state = { tf: '1m', tfIv: 60, autoOn: false, lastScanTs: 0 };

async function loadState() {
  const r = await pool.query(`SELECT * FROM scanner_state WHERE id='singleton'`);
  if (r.rows.length) {
    const row    = r.rows[0];
    state.tf         = row.tf;
    state.tfIv       = row.tf_iv;
    state.autoOn     = row.auto_on;
    state.lastScanTs = Number(row.last_scan);
  }
}
async function saveState() {
  await pool.query(`
    UPDATE scanner_state SET tf=$1, tf_iv=$2, auto_on=$3, last_scan=$4 WHERE id='singleton'
  `, [state.tf, state.tfIv, state.autoOn, state.lastScanTs]);
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
  out[period-1] = closes.slice(0,period).reduce((a,b)=>a+b,0)/period;
  for (let i = period; i < closes.length; i++)
    out[i] = closes[i] * k + out[i-1] * (1-k);
  return out;
}

// ── screen ────────────────────────────────────────────────────────
async function screenSymbol(sym) {
  const kl = await fetchJSON(
    `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${state.tf}&limit=60`
  );
  if (!Array.isArray(kl) || kl.length < 5) return null;

  const ci=kl.length-3, cnf=kl.length-2, prv=kl.length-4;
  const closes=kl.map(k=>+k[4]), opens=kl.map(k=>+k[1]);
  const highs=kl.map(k=>+k[2]),  lows=kl.map(k=>+k[3]),  vols=kl.map(k=>+k[5]);
  const e9=calcEMA(closes,9), e21=calcEMA(closes,21);
  if (!e9[ci]||!e9[prv]) return null;

  const crossUp   = closes[prv]<e9[prv] && closes[ci]>e9[ci];
  const crossDown = closes[prv]>e9[prv] && closes[ci]<e9[ci];
  if (!crossUp&&!crossDown) return null;
  if (crossUp   && closes[ci]<=e9[ci]) return null;
  if (crossDown && closes[ci]>=e9[ci]) return null;

  const body=Math.abs(closes[ci]-opens[ci]), range=highs[ci]-lows[ci];
  if (!range||body/range<0.75) return null;

  if (crossUp  && highs[cnf]<=highs[ci])  return null;
  if (!crossUp && lows[cnf]>=lows[ci])    return null;
  if (crossUp  && closes[cnf]<=closes[ci]) return null;
  if (!crossUp && closes[cnf]>=closes[ci]) return null;

  const confBody=Math.abs(closes[cnf]-opens[cnf]), confRange=highs[cnf]-lows[cnf];
  if (!confRange||confBody/confRange<0.75) return null;
  if (vols[cnf]<=vols[ci]) return null;

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

// ── scan ──────────────────────────────────────────────────────────
async function runScan() {
  if (scanning) return;
  scanning = true;
  const found=[], now=new Date();
  console.log(`[${now.toLocaleTimeString()}] Scanning ${state.tf}…`);

  for (const sym of PAIRS) {
    try {
      const s = await screenSymbol(sym);
      if (s) { found.push(s); console.log(`  ✓ ${s.sig} ${sym}`); }
    } catch {}
    await new Promise(r=>setTimeout(r,80));
  }

  lastSignals      = found;
  state.lastScanTs = Date.now();
  await saveState();

  if (found.length) {
    const cutoff = new Date(Date.now() - state.tfIv*2*1000);
    for (const s of found) {
      const dup = await pool.query(
        `SELECT 1 FROM trade_log WHERE sym=$1 AND sig=$2 AND tf=$3 AND scanned_at>=$4 LIMIT 1`,
        [s.sym, s.sig, state.tf, cutoff]
      );
      if (!dup.rows.length) {
        await pool.query(`
          INSERT INTO trade_log
            (sym,base,sig,tf,conf_close,cross_close,body_pct,conf_body,conf_volx,e9,scanned_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        `, [s.sym,s.base,s.sig,state.tf,s.confClose,s.crossClose,
            s.bodyPct,s.confBodyPct,s.confVolX,s.e9,now]);
      }
    }
  }

  scanning=false;
  console.log(`[${new Date().toLocaleTimeString()}] Done — ${found.length} signal(s)`);
}

// ── scheduler ────────────────────────────────────────────────────
function stopAutoScan() { if(scanTimer){clearInterval(scanTimer);scanTimer=null;} }
function startAutoScan() {
  stopAutoScan();
  if (!state.autoOn) return;
  scanTimer = setInterval(()=>runScan(), state.tfIv*1000);
  console.log(`⏱  Auto every ${state.tfIv}s on ${state.tf}`);
}

// ── middleware ────────────────────────────────────────────────────
app.use((req,res,next)=>{
  res.header('Access-Control-Allow-Origin','*');
  res.header('Access-Control-Allow-Methods','GET,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json());
app.use(express.static(path.join(__dirname,'public')));

// ── API ───────────────────────────────────────────────────────────
app.get('/api/status',(req,res)=>{
  const elapsed=Math.floor((Date.now()-(state.lastScanTs||0))/1000);
  res.json({
    tf:state.tf, tfIv:state.tfIv, autoOn:state.autoOn, scanning,
    lastScanTs:state.lastScanTs,
    nextScanIn: state.autoOn ? Math.max(0,state.tfIv-elapsed) : null,
    signals:lastSignals
  });
});

app.post('/api/scan',(req,res)=>{
  if(scanning) return res.json({ok:false,msg:'Already scanning'});
  runScan();
  res.json({ok:true});
});

app.post('/api/settings',async(req,res)=>{
  const {tf,tfIv,autoOn}=req.body;
  if(tf)    state.tf    = tf;
  if(tfIv)  state.tfIv  = Number(tfIv);
  if(typeof autoOn==='boolean') state.autoOn=autoOn;
  await saveState();
  stopAutoScan();
  if(state.autoOn){runScan();startAutoScan();}
  res.json({ok:true,state});
});

app.get('/api/logs',async(req,res)=>{
  const r=await pool.query(
    `SELECT * FROM trade_log ORDER BY scanned_at DESC LIMIT 1000`
  );
  res.json(r.rows.map(e=>({
    sym:e.sym, base:e.base, sig:e.sig, tf:e.tf,
    confClose:e.conf_close, crossClose:e.cross_close,
    bodyPct:e.body_pct, confBodyPct:e.conf_body,
    confVolX:e.conf_volx, e9:e.e9,
    scannedAt:e.scanned_at
  })));
});

app.delete('/api/logs',async(req,res)=>{
  await pool.query('DELETE FROM trade_log');
  res.json({ok:true});
});

app.get('/api/logs/export',async(req,res)=>{
  const r=await pool.query(`SELECT * FROM trade_log ORDER BY scanned_at DESC`);
  const hdr='#,Scanned At,TF,Symbol,Signal,Conf Close,Cross Close,Body%,Vol×\n';
  const rows=r.rows.map((e,i)=>
    `${i+1},"${new Date(e.scanned_at).toLocaleString('en-IN')}",${e.tf},${e.base},${e.sig},${e.conf_close},${e.cross_close},${e.body_pct},${e.conf_volx}`
  ).join('\n');
  res.setHeader('Content-Type','text/csv');
  res.setHeader('Content-Disposition','attachment; filename="ema9_trade_log.csv"');
  res.send(hdr+rows);
});

// ── start ─────────────────────────────────────────────────────────
async function main() {
  await initDB();
  await loadState();
  app.listen(PORT,()=>{
    console.log('─────────────────────────────────');
    console.log(`  EMA9 Screener → :${PORT}`);
    console.log(`  TF: ${state.tf}  Auto: ${state.autoOn}`);
    console.log('─────────────────────────────────');
  });
  if(state.autoOn){
    const delay=Math.max(0,state.tfIv-Math.floor((Date.now()-(state.lastScanTs||0))/1000));
    console.log(`▶  Auto-scan resumes in ${delay}s`);
    setTimeout(()=>{runScan();startAutoScan();},delay*1000);
  }
}
main();
