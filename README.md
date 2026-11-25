# BMESA Games — Hub & Fantasy

A website for the BMESA H.O.D Games (4–11 December 2026) with two sides:

- **Games Hub**: schedule and live results for every event, a football bracket, the medals table by level, and an updates feed. Pages refresh themselves every 30 seconds.
- **Fantasy**: fantasy football on the men's football tournament. Pick 8 players, captain one, make transfers between gameweeks, and compete in overall, level and private leagues.
- **Admin** (organisers only): enter scores, player stats, medals, updates, players and deadlines.

Stack: React (Vite) frontend in `client/`, Node.js + Express API in `src/`, Postgres database.

## Run it on your computer

Needs Node.js 20 or newer.

```powershell
npm install
npm run build
npm start
```

Open http://localhost:3000. `npm run build` compiles the React app into `client/dist`, which Express serves.

**While editing the React code**, run the API and the Vite dev server side by side (two terminals) and open http://localhost:5173 — changes appear instantly:

```powershell
npm run dev
```

```powershell
npm run client
```

With no `DATABASE_URL`, data is saved in the `data/` folder using a built-in Postgres (PGlite), so you don't need to install a database.

To make yourself admin locally, either start with `ADMIN_EMAILS` set to your email before signing up:

```powershell
$env:ADMIN_EMAILS = "you@example.com"; npm start
```

or sign up first and then run `npm run make-admin -- you@example.com`.

Want sample data to click around? `npm run seed:demo` adds placeholder players ("Y1 Striker 1"…) and 6 demo managers. **Don't run it on the live site.**

Tests for the scoring rules: `npm test`.

## Put it online (free)

1. **Database**: create a free Postgres database at [neon.tech](https://neon.tech) and copy its connection string (`postgresql://…`).
2. **Code**: push this folder to a GitHub repository.
3. **Hosting**: on [render.com](https://render.com), choose *New → Blueprint* and select the repo (it reads `render.yaml`). When asked, set:
   - `DATABASE_URL` = the Neon connection string
   - `ADMIN_EMAILS` = your email (and other admins', comma-separated)
   `JWT_SECRET` is generated for you.
4. Open the site, sign up with your admin email, and you'll see the **Admin** tab.

The games programme (events, fixtures, gameweeks) is seeded automatically the first time the app starts. Render's free tier sleeps after 15 minutes idle, so the first visit after a quiet spell takes ~30 seconds. Upgrading to the $7/month plan during games week avoids that.

## Running the games (for organisers)

Admins can make other people organisers on **Admin → Users**.

**Before 4 December**
- **Team logos and jerseys**: save the images in `client/public/kits/` (e.g. `y1-logo.png`, `y1-jersey.png`, `y1-gk.png` — transparent PNGs look best), rebuild, then on **Admin → Teams & kits** enter each path (e.g. `/kits/y1-logo.png`). An https:// image link also works. Teams without a jersey image show a plain shirt in the team colour.
- **Admin → Players**: add every men's football player with team, position (GK/DEF/MID/FWD) and price. Bulk add takes one per line: `Tobi Ade, Year 3, FWD, 7.5`. Players need at least 2 GKs, 2 DEFs, 2 MIDs and 2 FWDs available in total; a good spread is 3.5–9.0m.
- **Admin → Gameweeks**: check the deadlines (default: 1 hour before each football match day).
- Share the link so people sign up and pick teams.

**During the games**
- **Admin → Results**: type scores, set status to *live* then *finished*.
- After each men's football match, click **Player stats**: tick who played, add goals, assists, saves, cards and the MVP. Clean sheets and goals conceded come from the score automatically.
- **When the playoff and semi-finals finish**, click **Edit** on the next fixture and pick the real team instead of "Winner Playoff" / "Winner SF1" etc. Fantasy uses this to show who plays next.
- **Admin → Medals**: record gold, silver and bronze for each event when it's decided.
- **Admin → Updates**: post news, time changes, walkovers.

## Fantasy rules (default)

| | |
|---|---|
| Budget | 50.0m |
| Squad | 8: 2 GK, 2 DEF, 2 MID, 2 FWD (6 start, 2 on the bench) |
| Max per level | 3 |
| Gameweeks | GW1 Fri 4 Dec · GW2 Mon 7 Dec · GW3 Tue 8 Dec · GW4 Fri 11 Dec |
| Transfers | Unlimited before your first deadline, then 2 free per gameweek, −4 pts each after |
| Captain | Double points; vice-captain doubles if the captain doesn't play |
| Auto-subs | Bench GK replaces starting GK, bench outfielder replaces the first outfield starter who didn't play |

Points: played +2 · goal GK/DEF +6, MID +5, FWD +4 · assist +3 · clean sheet GK/DEF +4, MID +1 · every 2 conceded GK/DEF −1 · every 3 saves +1 · penalty save +5 · penalty miss −2 · own goal −2 · yellow −1 · red −3 · MVP +3.

To change any of these, edit `src/rules.js` — the rules page updates itself.

## Files

```
src/app.js        API routes, login, organiser endpoints (Express app)
src/server.js     long-running server for local use and Render (API + React build)
api/index.js      Vercel serverless function (wraps src/app.js)
vercel.json       Vercel build, region and routing settings
render.yaml       Render Blueprint settings
src/rules.js      fantasy rules and scoring (pure functions, tested)
src/fantasy.js    gameweeks, squads, transfers, standings
src/seed.js       the games programme: events, fixtures, gameweeks
src/schema.sql    database tables
src/db.js         Postgres (production) or PGlite (local)
client/           React app (Vite)
  src/main.jsx          routes
  src/components.jsx    layout, header, team logos, jerseys, fixture rows
  src/pages/Hub.jsx     home, schedule, medals, events, teams
  src/pages/Fantasy.jsx pick team, points, leagues, stats, fixtures, rules
  src/pages/Admin.jsx   organiser tools
  src/styles.css        BMESA theme (royal blue, heart red, gear yellow)
  public/bmesa-logo.png department logo
  public/kits/          class logos and jersey images
test/             scoring tests
```
