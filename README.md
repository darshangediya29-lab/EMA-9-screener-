# EMA9 Screener — Deploy Guide
# Railway + Built-in PostgreSQL (no MongoDB needed)

Sirf Railway chahiye — database bhi wahi milega FREE mein.

═══════════════════════════════════════
STEP 1 — GitHub par upload karo
═══════════════════════════════════════

1. github.com → Sign up / Login
2. New Repository → Name: ema9-screener → Public → Create
3. "uploading an existing file" click karo
4. In files ko drag karo:
     server.js
     package.json
     railway.json
     .gitignore
     public/index.html   ← (public folder ke andar)
5. "Commit changes" dabao

═══════════════════════════════════════
STEP 2 — Railway par deploy karo
═══════════════════════════════════════

1. railway.app par jao → GitHub se Login karo
2. "New Project" → "Deploy from GitHub repo"
3. ema9-screener repo select karo
4. Deploy start ho jaayega ✓

═══════════════════════════════════════
STEP 3 — PostgreSQL database add karo
═══════════════════════════════════════

1. Railway project mein jao
2. "+ New" button dabao → "Database" → "PostgreSQL" select karo
3. PostgreSQL service ban jaayegi
4. Ab apni app service click karo → "Variables" tab
5. "+ New Variable" dabao:
     Name:  DATABASE_URL
     Value: (PostgreSQL service click karo → "Connect" tab → Connection URL copy karo)
6. App automatically redeploy ho jaayegi

═══════════════════════════════════════
STEP 4 — URL lo aur use karo
═══════════════════════════════════════

1. App service → "Settings" tab
2. "Domains" → "Generate Domain"
3. URL milega:  https://ema9-screener-xxxx.up.railway.app

✅ Bas! Is URL ko bookmark karo.
   24/7 chalta rahega. Logs hamesha safe rahenge.

═══════════════════════════════════════
FREE LIMITS
═══════════════════════════════════════

Railway   : $5 free credit/month (kafi hai 24/7 ke liye)
PostgreSQL: 1GB free storage (hazaaron trades)
