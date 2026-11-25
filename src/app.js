// The Express app (API only). Used by src/server.js (Render / local) and api/index.js (Vercel).
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');
const { seedBase } = require('./seed');
const { migrate } = require('./migrations');
const F = require('./fantasy');
const { RULES, POINTS } = require('./rules');

const PROD = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
const JWT_SECRET = process.env.JWT_SECRET || (PROD ? null : 'dev-only-secret-change-me');
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const LEVELS = ['Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Staff', 'Alumni', 'Guest'];

/**
 * One-time setup per server instance: connect, apply the schema, seed the programme if empty.
 * On Vercel this runs on each cold start; a database lock stops parallel cold starts seeding twice.
 */
let readyPromise;
function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await db.init();
      await db.locked(async (q) => {
        if (await seedBase(q)) console.log('Seeded the games programme.');
        await migrate(q);
      });
    })().catch((e) => { readyPromise = null; throw e; });
  }
  return readyPromise;
}

const app = express();
app.set('trust proxy', 1);
app.use((req, res, next) => {
  if (!JWT_SECRET) return res.status(500).json({ error: 'Server not configured: set the JWT_SECRET environment variable.' });
  ready().then(() => next(), next);
});
// JSON bodies: small everywhere, except spotlight uploads which carry a (resized) photo
const jsonSmall = express.json({ limit: '200kb' });
const jsonPhoto = express.json({ limit: '3mb' });
app.use((req, res, next) => (req.method === 'POST' && req.path === '/api/admin/spotlights' ? jsonPhoto : jsonSmall)(req, res, next));
app.use(cookieParser());

// ---------- helpers ----------
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const publicUser = (u) => u && { id: u.id, name: u.name, email: u.email, level: u.level, role: u.role };
const isStaff = (u) => u && (u.role === 'organiser' || u.role === 'admin');

function setSession(res, user) {
  const token = jwt.sign({ uid: user.id }, JWT_SECRET, { expiresIn: '60d' });
  res.cookie('session', token, { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 60 * 24 * 3600 * 1000 });
}

app.use(wrap(async (req, _res, next) => {
  const token = req.cookies.session;
  if (token) {
    try {
      const { uid } = jwt.verify(token, JWT_SECRET);
      const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [uid]);
      req.user = rows[0] || null;
    } catch { req.user = null; }
  }
  next();
}));

const needUser = (req, res, next) => (req.user ? next() : bad(res, 'Please log in.', 401));
const needStaff = (req, res, next) => (isStaff(req.user) ? next() : bad(res, 'Organisers only.', 403));
const needAdmin = (req, res, next) => (req.user?.role === 'admin' ? next() : bad(res, 'Admins only.', 403));

// Simple in-memory throttle for auth endpoints
const attempts = new Map();
function throttle(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < 15 * 60 * 1000);
  if (list.length >= 20) return bad(res, 'Too many attempts. Try again in a few minutes.', 429);
  list.push(now); attempts.set(key, list);
  next();
}

// ---------- auth ----------
app.post('/api/auth/signup', throttle, wrap(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 120);
  const password = String(req.body.password || '');
  const level = LEVELS.includes(req.body.level) ? req.body.level : null;
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) return bad(res, 'Enter your name and a valid email.');
  if (password.length < 8) return bad(res, 'Password must be at least 8 characters.');
  if (!level) return bad(res, 'Choose your level.');
  const exists = await db.query('SELECT 1 FROM users WHERE email = $1', [email]);
  if (exists.rows.length) return bad(res, 'An account with that email already exists.');
  const role = ADMIN_EMAILS.includes(email) ? 'admin' : 'user';
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await db.query(
    'INSERT INTO users (name, email, password_hash, level, role) VALUES ($1,$2,$3,$4,$5) RETURNING *', [name, email, hash, level, role]);
  setSession(res, rows[0]);
  res.json({ user: publicUser(rows[0]) });
}));

app.post('/api/auth/login', throttle, wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(String(req.body.password || ''), u.password_hash))) return bad(res, 'Wrong email or password.', 401);
  if (ADMIN_EMAILS.includes(email) && u.role !== 'admin') {
    await db.query("UPDATE users SET role = 'admin' WHERE id = $1", [u.id]); u.role = 'admin';
  }
  setSession(res, u);
  res.json({ user: publicUser(u) });
}));

app.post('/api/auth/logout', (req, res) => { res.clearCookie('session'); res.json({ ok: true }); });
app.get('/api/me', (req, res) => res.json({ user: publicUser(req.user), levels: LEVELS }));

// ---------- sports hub ----------
async function hubData() {
  const [teams, events, fixtures, placements, news, spots] = await Promise.all([
    db.query('SELECT * FROM teams ORDER BY id'),
    db.query('SELECT * FROM events ORDER BY sort'),
    db.query('SELECT * FROM fixtures ORDER BY starts_at, id'),
    db.query('SELECT * FROM placements ORDER BY event_id, position'),
    db.query('SELECT a.id, a.title, a.body, a.created_at, u.name AS author FROM announcements a LEFT JOIN users u ON u.id = a.author_id ORDER BY a.created_at DESC LIMIT 30'),
    // Photo bytes are served separately (/api/spotlights/:id/image) so this stays light
    db.query('SELECT id, athlete, team_id, event_id, headline, body, created_at, image IS NOT NULL AS has_image FROM spotlights ORDER BY created_at DESC, id DESC LIMIT 6'),
  ]);
  const medals = teams.rows.filter((t) => t.is_level).map((t) => {
    const mine = placements.rows.filter((p) => p.team_id === t.id);
    const n = (pos) => mine.filter((p) => p.position === pos).length;
    return { team_id: t.id, name: t.name, short: t.short, color: t.color, gold: n(1), silver: n(2), bronze: n(3), total: mine.length };
  }).sort((a, b) => b.gold - a.gold || b.silver - a.silver || b.bronze - a.bronze || a.name.localeCompare(b.name));
  medals.forEach((m, i) => {
    const p = medals[i - 1];
    m.rank = p && p.gold === m.gold && p.silver === m.silver && p.bronze === m.bronze ? p.rank : i + 1;
  });
  const spotlights = spots.rows.map((s) => ({ ...s, image_url: s.has_image ? `/api/spotlights/${s.id}/image` : null }));
  return { teams: teams.rows, events: events.rows, fixtures: fixtures.rows, placements: placements.rows, announcements: news.rows, spotlights, medals };
}
app.get('/api/hub', wrap(async (req, res) => res.json(await hubData())));

// Spotlight photos never change once posted (edit = delete + repost), so they can be cached hard
app.get('/api/spotlights/:id/image', wrap(async (req, res) => {
  const { rows } = await db.query('SELECT image, image_type FROM spotlights WHERE id = $1', [+req.params.id]);
  if (!rows[0]?.image) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.type(rows[0].image_type || 'image/jpeg').send(Buffer.from(rows[0].image));
}));

// ---------- fantasy ----------
app.get('/api/fantasy/bootstrap', wrap(async (req, res) => {
  const [gws, players, totals, fx] = await Promise.all([
    F.gameweeks(), F.allPlayers(), F.playerTotals(),
    db.query('SELECT f.* FROM fixtures f WHERE f.gameweek_id IS NOT NULL ORDER BY f.starts_at'),
  ]);
  for (const p of players) { p.total_points = totals.totals.get(p.id) || 0; p.selected_by = totals.selected.get(p.id) || 0; }
  let me = null;
  if (req.user) {
    const { rows } = await db.query('SELECT name FROM fantasy_teams WHERE user_id = $1', [req.user.id]);
    const editSort = gws.next ? gws.next.sort : Infinity;
    const picks = await F.picksAt(req.user.id, editSort);
    const prev = gws.next ? await F.picksAt(req.user.id, gws.next.sort - 1) : [];
    const entry = gws.next ? (await db.query('SELECT transfers, hit FROM gw_entries WHERE user_id = $1 AND gameweek_id = $2', [req.user.id, gws.next.id])).rows[0] : null;
    me = {
      team_name: rows[0]?.name || null,
      picks,
      previous_ids: prev.map((p) => p.player_id), // squad before the next deadline (for counting transfers)
      transfers: entry?.transfers || 0,
      hit: entry?.hit || 0,
    };
  }
  res.json({ rules: RULES, points: POINTS, gameweeks: gws.list, players, fixtures: fx.rows, me });
}));

app.post('/api/fantasy/team', needUser, wrap(async (req, res) => {
  const name = String(req.body.team_name || '').trim().slice(0, 30);
  if (!name) return bad(res, 'Give your team a name.');
  const r = await F.saveSquad(req.user.id, name, Array.isArray(req.body.picks) ? req.body.picks : []);
  if (r.error) return bad(res, r.error);
  res.json(r);
}));

app.get('/api/fantasy/points/:userId', wrap(async (req, res) => {
  const userId = +req.params.userId;
  const { rows: u } = await db.query('SELECT u.id, u.name, u.level, f.name AS team_name FROM users u JOIN fantasy_teams f ON f.user_id = u.id WHERE u.id = $1', [userId]);
  if (!u.length) return bad(res, 'Manager not found.', 404);
  const gws = (await F.gameweeks()).list.filter((g) => g.started);
  const gwId = req.query.gw ? +req.query.gw : gws[gws.length - 1]?.id;
  const gw = gws.find((g) => g.id === gwId);
  if (!gw) return res.json({ manager: u[0], gameweeks: gws, gw: null, score: null });
  const info = await F.gwPlayerInfo(gw.id);
  const score = await F.userGwScore(userId, gw, info);
  if (score) for (const p of score.lineup) { const i = info.get(p.player_id); p.breakdown = i?.breakdown || []; p.played = i?.played; p.done = i?.done; }
  res.json({ manager: u[0], gameweeks: gws, gw, score });
}));

app.get('/api/fantasy/player/:id', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT s.*, f.round, f.starts_at, f.home_team_id, f.away_team_id, f.home_score, f.away_score, f.home_label, f.away_label, f.gameweek_id,
            p.position, p.team_id
       FROM player_stats s JOIN fixtures f ON f.id = s.fixture_id JOIN players p ON p.id = s.player_id
      WHERE s.player_id = $1 ORDER BY f.starts_at`, [+req.params.id]);
  const { playerPoints } = require('./rules');
  for (const r of rows) {
    const conceded = r.home_team_id === r.team_id ? r.away_score : r.home_score;
    Object.assign(r, playerPoints(r, r.position, conceded));
  }
  res.json({ matches: rows });
}));

app.get('/api/fantasy/standings', wrap(async (req, res) => {
  const league = String(req.query.league || 'overall');
  let rows, title = 'Overall';
  if (league === 'overall') rows = await F.standings();
  else if (league.startsWith('level:')) {
    title = league.slice(6);
    rows = await F.standings('WHERE u.level = $1', [title]);
  } else {
    const { rows: l } = await db.query('SELECT * FROM leagues WHERE id = $1', [+league]);
    if (!l.length) return bad(res, 'League not found.', 404);
    title = l[0].name;
    rows = await F.standings('WHERE u.id IN (SELECT user_id FROM league_members WHERE league_id = $1)', [l[0].id]);
    return res.json({ title, code: l[0].code, league_id: l[0].id, is_owner: !!req.user && req.user.id === l[0].owner_id, rows });
  }
  res.json({ title, rows });
}));

app.get('/api/fantasy/leagues', needUser, wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT l.id, l.name, l.code, (SELECT count(*)::int FROM league_members m2 WHERE m2.league_id = l.id) AS members
       FROM leagues l JOIN league_members m ON m.league_id = l.id WHERE m.user_id = $1 ORDER BY l.name`, [req.user.id]);
  res.json({ leagues: rows });
}));

// League invite codes: 6 characters from an alphabet without look-alikes (no 0/O, 1/I/L),
// so they're easy to read out or type from a WhatsApp message. ~1 billion combinations.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.randomBytes(6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
const cleanCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);

/** Run `fn(code)` with a fresh code, retrying if it collides with an existing one (unique index). */
async function withUniqueCode(fn) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try { return await fn(newCode()); }
    catch (e) { if (e.code !== '23505') throw e; } // 23505 = unique_violation
  }
  throw new Error('Could not generate a unique league code.');
}

app.post('/api/fantasy/leagues', needUser, wrap(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 40);
  if (!name) return bad(res, 'Name your league.');
  const league = await withUniqueCode(async (code) =>
    (await db.query('INSERT INTO leagues (name, code, owner_id) VALUES ($1,$2,$3) RETURNING *', [name, code, req.user.id])).rows[0]);
  await db.query('INSERT INTO league_members (league_id, user_id) VALUES ($1,$2)', [league.id, req.user.id]);
  res.json({ league });
}));

// Public preview for an invite link: lets the join page show which league you're joining
app.get('/api/fantasy/leagues/code/:code', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT l.id, l.name, l.code, u.name AS owner,
            (SELECT count(*)::int FROM league_members m WHERE m.league_id = l.id) AS members,
            EXISTS (SELECT 1 FROM league_members m WHERE m.league_id = l.id AND m.user_id = $2) AS joined
       FROM leagues l LEFT JOIN users u ON u.id = l.owner_id WHERE l.code = $1`, [cleanCode(req.params.code), req.user?.id || 0]);
  if (!rows.length) return bad(res, 'This invite link isn’t valid any more. Ask for a new one.', 404);
  res.json({ league: rows[0] });
}));

app.post('/api/fantasy/leagues/join', needUser, wrap(async (req, res) => {
  const code = cleanCode(req.body.code);
  const { rows } = await db.query('SELECT * FROM leagues WHERE code = $1', [code]);
  if (!rows.length) return bad(res, 'No league with that code.');
  await db.query('INSERT INTO league_members (league_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [rows[0].id, req.user.id]);
  res.json({ league: rows[0] });
}));

// League owner: issue a new code (old code and links stop working; members stay)
app.post('/api/fantasy/leagues/:id/code', needUser, wrap(async (req, res) => {
  const { rows } = await db.query('SELECT owner_id FROM leagues WHERE id = $1', [+req.params.id]);
  if (!rows.length) return bad(res, 'League not found.', 404);
  if (rows[0].owner_id !== req.user.id) return bad(res, 'Only the league creator can change the code.', 403);
  const league = await withUniqueCode(async (code) =>
    (await db.query('UPDATE leagues SET code = $2 WHERE id = $1 RETURNING *', [+req.params.id, code])).rows[0]);
  res.json({ league });
}));

// ---------- organiser tools ----------
const admin = express.Router();
admin.use(needStaff);
const intOrNull = (v) => (v === '' || v == null ? null : Number.isFinite(+v) ? Math.trunc(+v) : null);
const strOrNull = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, 200));

admin.put('/fixtures/:id', wrap(async (req, res) => {
  const b = req.body;
  if (b.status && !['scheduled', 'live', 'finished'].includes(b.status)) return bad(res, 'Bad status.');
  const { rows } = await db.query(
    `UPDATE fixtures SET round = $2, starts_at = $3, venue = $4, home_team_id = $5, away_team_id = $6, home_label = $7, away_label = $8,
            home_score = $9, away_score = $10, status = $11, notes = $12 WHERE id = $1 RETURNING *`,
    [+req.params.id, strOrNull(b.round), b.starts_at || null, strOrNull(b.venue), intOrNull(b.home_team_id), intOrNull(b.away_team_id),
      strOrNull(b.home_label), strOrNull(b.away_label), intOrNull(b.home_score), intOrNull(b.away_score), b.status || 'scheduled', strOrNull(b.notes)]);
  if (!rows.length) return bad(res, 'Fixture not found.', 404);
  res.json({ fixture: rows[0] });
}));

admin.post('/fixtures', wrap(async (req, res) => {
  const b = req.body;
  const { rows } = await db.query(
    `INSERT INTO fixtures (event_id, round, day, starts_at, venue, home_team_id, away_team_id, home_label, away_label, gameweek_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [+b.event_id, strOrNull(b.round), intOrNull(b.day), b.starts_at || null, strOrNull(b.venue), intOrNull(b.home_team_id), intOrNull(b.away_team_id),
      strOrNull(b.home_label), strOrNull(b.away_label), intOrNull(b.gameweek_id)]);
  res.json({ fixture: rows[0] });
}));

admin.delete('/fixtures/:id', wrap(async (req, res) => {
  await db.query('DELETE FROM fixtures WHERE id = $1', [+req.params.id]);
  res.json({ ok: true });
}));

admin.get('/fixtures/:id/stats', wrap(async (req, res) => {
  const { rows: f } = await db.query('SELECT * FROM fixtures WHERE id = $1', [+req.params.id]);
  if (!f.length) return bad(res, 'Fixture not found.', 404);
  const teamIds = [f[0].home_team_id, f[0].away_team_id].filter(Boolean);
  const { rows: players } = await db.query(
    `SELECT p.id, p.name, p.position, p.team_id, s.played, s.goals, s.assists, s.saves, s.pen_saved, s.pen_missed, s.own_goals, s.yellow, s.red, s.mvp
       FROM players p LEFT JOIN player_stats s ON s.player_id = p.id AND s.fixture_id = $1
      WHERE p.team_id = ANY($2::int[]) ORDER BY p.team_id, CASE p.position WHEN 'GK' THEN 0 WHEN 'DEF' THEN 1 WHEN 'MID' THEN 2 ELSE 3 END, p.name`,
    [f[0].id, teamIds]);
  res.json({ fixture: f[0], players });
}));

admin.put('/fixtures/:id/stats', wrap(async (req, res) => {
  const fixtureId = +req.params.id;
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const n = (v) => Math.max(0, Math.min(20, Math.trunc(+v || 0)));
  await db.tx(async (t) => {
    await t.query('DELETE FROM player_stats WHERE fixture_id = $1', [fixtureId]);
    for (const r of rows) {
      if (!r.played) continue;
      await t.query(
        `INSERT INTO player_stats (player_id, fixture_id, played, goals, assists, saves, pen_saved, pen_missed, own_goals, yellow, red, mvp)
         VALUES ($1,$2,true,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [+r.player_id, fixtureId, n(r.goals), n(r.assists), n(r.saves), n(r.pen_saved), n(r.pen_missed), n(r.own_goals), Math.min(1, n(r.yellow)), Math.min(1, n(r.red)), !!r.mvp]);
    }
  });
  res.json({ ok: true });
}));

admin.put('/events/:id/placements', wrap(async (req, res) => {
  const eventId = +req.params.id;
  const list = (Array.isArray(req.body.placements) ? req.body.placements : []).filter((p) => p.team_id);
  await db.tx(async (t) => {
    await t.query('DELETE FROM placements WHERE event_id = $1', [eventId]);
    for (const p of list) {
      const pos = +p.position;
      if (![1, 2, 3].includes(pos)) continue;
      await t.query('INSERT INTO placements (event_id, position, team_id, note) VALUES ($1,$2,$3,$4)', [eventId, pos, +p.team_id, strOrNull(p.note)]);
    }
  });
  res.json({ ok: true });
}));

admin.post('/announcements', wrap(async (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 120);
  if (!title) return bad(res, 'Add a title.');
  const { rows } = await db.query('INSERT INTO announcements (title, body, author_id) VALUES ($1,$2,$3) RETURNING *',
    [title, String(req.body.body || '').slice(0, 2000), req.user.id]);
  res.json({ announcement: rows[0] });
}));

admin.delete('/announcements/:id', wrap(async (req, res) => {
  await db.query('DELETE FROM announcements WHERE id = $1', [+req.params.id]);
  res.json({ ok: true });
}));

// Athlete spotlight. `photo` is a data URL (JPEG/PNG/WebP), already resized in the browser.
admin.post('/spotlights', wrap(async (req, res) => {
  const b = req.body;
  const athlete = String(b.athlete || '').trim().slice(0, 80);
  if (!athlete) return bad(res, 'Add the athlete’s name.');
  let image = null, imageType = null;
  if (b.photo) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.photo));
    if (!m) return bad(res, 'Photo must be a JPEG, PNG or WebP image.');
    image = Buffer.from(m[2], 'base64');
    imageType = m[1];
    if (image.length > 1.5 * 1024 * 1024) return bad(res, 'Photo is too large (max 1.5 MB after resizing).');
  }
  const { rows } = await db.query(
    `INSERT INTO spotlights (athlete, team_id, event_id, headline, body, image, image_type, author_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, athlete, created_at`,
    [athlete, intOrNull(b.team_id), intOrNull(b.event_id), strOrNull(b.headline), String(b.body || '').trim().slice(0, 1500) || null, image, imageType, req.user.id]);
  res.json({ spotlight: rows[0] });
}));

admin.delete('/spotlights/:id', wrap(async (req, res) => {
  await db.query('DELETE FROM spotlights WHERE id = $1', [+req.params.id]);
  res.json({ ok: true });
}));

function parsePlayer(b) {
  const position = String(b.position || '').toUpperCase();
  const price = Math.round(parseFloat(b.price) * 10);
  if (!String(b.name || '').trim()) return { error: 'Player needs a name.' };
  if (!['GK', 'DEF', 'MID', 'FWD'].includes(position)) return { error: `Position must be GK, DEF, MID or FWD (got "${b.position}").` };
  if (!(price >= 30 && price <= 200)) return { error: `Price must be between 3.0 and 20.0 (got "${b.price}").` };
  return { name: String(b.name).trim().slice(0, 60), position, price, team_id: +b.team_id, active: b.active !== false };
}

admin.post('/players', wrap(async (req, res) => {
  const p = parsePlayer(req.body);
  if (p.error) return bad(res, p.error);
  const { rows } = await db.query('INSERT INTO players (name, team_id, position, price, active) VALUES ($1,$2,$3,$4,$5) RETURNING *', [p.name, p.team_id, p.position, p.price, p.active]);
  res.json({ player: rows[0] });
}));

admin.put('/players/:id', wrap(async (req, res) => {
  const p = parsePlayer(req.body);
  if (p.error) return bad(res, p.error);
  const { rows } = await db.query('UPDATE players SET name=$2, team_id=$3, position=$4, price=$5, active=$6 WHERE id=$1 RETURNING *', [+req.params.id, p.name, p.team_id, p.position, p.price, p.active]);
  res.json({ player: rows[0] });
}));

// Bulk import: one player per line — "Name, Team, Position, Price" e.g. "Tobi Ade, Year 3, FWD, 7.5"
admin.post('/players/bulk', wrap(async (req, res) => {
  const { rows: teams } = await db.query('SELECT id, name, short FROM teams');
  const findTeam = (s) => teams.find((t) => [t.name, t.short].map((x) => x.toLowerCase()).includes(s.trim().toLowerCase()));
  const lines = String(req.body.text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const parsed = [];
  for (const [i, line] of lines.entries()) {
    const [name, team, position, price] = line.split(',').map((s) => (s || '').trim());
    const t = findTeam(team || '');
    if (!t) return bad(res, `Line ${i + 1}: unknown team "${team}".`);
    const p = parsePlayer({ name, position, price, team_id: t.id });
    if (p.error) return bad(res, `Line ${i + 1}: ${p.error}`);
    parsed.push(p);
  }
  await db.tx(async (tx) => {
    for (const p of parsed) await tx.query('INSERT INTO players (name, team_id, position, price) VALUES ($1,$2,$3,$4)', [p.name, p.team_id, p.position, p.price]);
  });
  res.json({ added: parsed.length });
}));

admin.put('/gameweeks/:id', wrap(async (req, res) => {
  const { rows } = await db.query('UPDATE gameweeks SET deadline = $2, finished = $3 WHERE id = $1 RETURNING *', [+req.params.id, req.body.deadline, !!req.body.finished]);
  res.json({ gameweek: rows[0] });
}));

admin.post('/teams', wrap(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 40);
  const short = String(req.body.short || name.slice(0, 3)).trim().toUpperCase().slice(0, 4);
  if (!name) return bad(res, 'Team needs a name.');
  const { rows } = await db.query('INSERT INTO teams (name, short, is_level, color) VALUES ($1,$2,$3,$4) RETURNING *', [name, short, !!req.body.is_level, req.body.color || '#64748b']);
  res.json({ team: rows[0] });
}));

admin.put('/teams/:id', wrap(async (req, res) => {
  const b = req.body;
  const name = String(b.name || '').trim().slice(0, 40);
  if (!name) return bad(res, 'Team needs a name.');
  const url = (v) => { const s = strOrNull(v); return s && (s.startsWith('/') || /^https:\/\//.test(s)) ? s : null; };
  const { rows } = await db.query(
    `UPDATE teams SET name=$2, short=$3, color=$4, is_level=$5, logo_url=$6, jersey_url=$7, gk_jersey_url=$8 WHERE id=$1 RETURNING *`,
    [+req.params.id, name, String(b.short || name.slice(0, 3)).toUpperCase().slice(0, 4), /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#64748b',
      !!b.is_level, url(b.logo_url), url(b.jersey_url), url(b.gk_jersey_url)]);
  res.json({ team: rows[0] });
}));

admin.get('/users', needAdmin, wrap(async (req, res) => {
  const { rows } = await db.query('SELECT id, name, email, level, role, created_at FROM users ORDER BY role, name');
  res.json({ users: rows });
}));

admin.put('/users/:id/role', needAdmin, wrap(async (req, res) => {
  const role = req.body.role;
  if (!['user', 'organiser', 'admin'].includes(role)) return bad(res, 'Bad role.');
  if (+req.params.id === req.user.id && role !== 'admin') return bad(res, "You can't remove your own admin role.");
  await db.query('UPDATE users SET role = $2 WHERE id = $1', [+req.params.id, role]);
  res.json({ ok: true });
}));

app.use('/api/admin', admin);
app.use('/api', (req, res) => bad(res, 'Not found.', 404));

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

module.exports = { app, ready };
