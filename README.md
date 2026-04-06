# EMA9 Screener — Free Deploy Guide
# Render (server) + Supabase (database) — DONO FREE, card nahi chahiye

═══════════════════════════════════════════
STEP 1 — Supabase (Free Database)
═══════════════════════════════════════════

1. supabase.com → "Start your project" → GitHub se signup karo
2. "New Project" dabao:
     Name     : ema9-screener
     Password : kuch bhi (yaad rakhna)
     Region   : Southeast Asia (Singapore)
3. Project banne mein ~2 min lagenge

4. Connection string lena:
   - Left sidebar → Settings (gear icon)
   - "Database" tab
   - "Connection string" section → "URI" tab
   - String copy karo — aisa dikhega:
     postgresql://postgres:[PASSWORD]@db.xxxx.supabase.co:5432/postgres
   - [PASSWORD] ki jagah apna password daalo

═══════════════════════════════════════════
STEP 2 — GitHub par upload karo
═══════════════════════════════════════════

1. github.com → New Repository
   Name: ema9-screener → Public → Create

2. "uploading an existing file" click karo
3. In files drag karo:
     server.js
     package.json
     render.yaml
     .gitignore
     public/index.html   (public folder ke saath)

4. "Commit changes"

═══════════════════════════════════════════
STEP 3 — Render (Free Server)
═══════════════════════════════════════════

1. render.com → "Get Started for Free"
   → GitHub se login karo

2. "New +" → "Web Service"

3. GitHub repo connect karo → ema9-screener select karo

4. Settings:
     Name     : ema9-screener
     Runtime  : Node
     Build    : npm install
     Start    : node server.js
     Plan     : FREE ✓

5. "Environment Variables" section mein:
     Key   : DATABASE_URL
     Value : (Step 1 ka connection string paste karo)

6. "Create Web Service" dabao

═══════════════════════════════════════════
STEP 4 — URL milega
═══════════════════════════════════════════

Deploy hone mein ~3-4 min lagenge.
Phir URL milega:
  https://ema9-screener.onrender.com

✅ Isko bookmark karo — kahi se bhi kholo!

═══════════════════════════════════════════
⚠️  EK IMPORTANT BAAT — Render Free Plan
═══════════════════════════════════════════

Render ka free server 15 min inactivity ke baad
"sleep" ho jaata hai. Jab aap page kholo toh
~30 sec mein wapas start ho jaata hai.

Scanner aur logs safe rehte hain — Supabase mein.

Isko fix karne ke liye (optional):
UptimeRobot (free) se har 10 min mein
ping karo — server kabhi sleep nahi karega.

  uptimerobot.com → "Add New Monitor"
  Type: HTTP(s)
  URL : https://ema9-screener.onrender.com/api/status
  Interval: 10 minutes

═══════════════════════════════════════════
FREE LIMITS
═══════════════════════════════════════════

Render   : Free forever (web service)
Supabase : 500MB database, free forever
UptimeRobot : 50 monitors free
