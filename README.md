# EMA9 Screener — Cloud Deployment Guide

Browser band ho, server band ho — koi baat nahi.
Railway (free) + MongoDB Atlas (free) par 24/7 chalta rahega.

---

## Step 1 — MongoDB Atlas (Free Database)

1. https://mongodb.com/cloud/atlas → "Try Free" → account banao
2. "Build a Database" → M0 Free → AWS Mumbai → Create
3. Username/password set karo (yaad rakho)
4. Security → Network Access → "Add IP Address" → "Allow from Anywhere"
5. Connect → Drivers → Node.js → connection string copy karo:
   ```
   mongodb+srv://USER:PASSWORD@cluster.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```

---

## Step 2 — GitHub

1. https://github.com → New repository → `ema9-screener` → Public → Create
2. "uploading an existing file" → in files ko drag karo:
   - server.js
   - package.json
   - railway.json
   - .gitignore
   - public/index.html
3. Commit changes

---

## Step 3 — Railway

1. https://railway.app → GitHub se login karo
2. New Project → Deploy from GitHub → `ema9-screener` select karo
3. Variables tab → New Variable:
   - `MONGODB_URI` = (Step 1 ka connection string)
4. Railway auto-deploy karega
5. Settings → Domains → Generate Domain → URL milega:
   `https://ema9-screener-xxxx.up.railway.app`

✅ Bas itna! Is URL ko bookmark karo.

---

## Local chalana

.env file banao:
```
MONGODB_URI=mongodb+srv://...
PORT=3000
```
```bash
npm install
node server.js
```

---

## Strategy

Cross Candle: EMA9 cross · close above/below · body ≥ 75%
Conf Candle:  high > cross high · close > cross close · body ≥ 75% · vol > cross vol
