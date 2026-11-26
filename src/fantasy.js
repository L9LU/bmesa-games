// Fantasy queries: gameweek state, player points, squads and standings.
const db = require('./db');
const { RULES, playerPoints, validateSquad, scoreSquad, countTransfers } = require('./rules');

async function gameweeks() {
  const { rows } = await db.query('SELECT id, name, deadline, finished, sort FROM gameweeks ORDER BY sort');
  const now = Date.now();
  let current = null, next = null;
  for (const g of rows) {
    g.started = new Date(g.deadline).getTime() <= now;
    if (g.started) current = g;
    else if (!next) next = g;
  }
  for (const g of rows) {
    g.state = g.id === current?.id ? 'current' : g.started ? 'past' : g.id === next?.id ? 'next' : 'upcoming';
  }
  return { list: rows, current, next };
}

/** Per-player info for one gameweek: Map(player_id -> { points, played, done, breakdown, fixtures }) */
async function gwPlayerInfo(gwId) {
  const { rows: fx } = await db.query('SELECT id, home_team_id, away_team_id, home_score, away_score, status FROM fixtures WHERE gameweek_id = $1', [gwId]);
  const { rows: players } = await db.query('SELECT id, team_id, position FROM players');
  const { rows: stats } = await db.query(
    'SELECT s.* FROM player_stats s JOIN fixtures f ON f.id = s.fixture_id WHERE f.gameweek_id = $1', [gwId]);
  const statsBy = new Map();
  for (const s of stats) {
    if (!statsBy.has(s.player_id)) statsBy.set(s.player_id, []);
    statsBy.get(s.player_id).push(s);
  }
  const info = new Map();
  for (const p of players) {
    const teamFx = fx.filter((f) => f.home_team_id === p.team_id || f.away_team_id === p.team_id);
    let points = 0, played = false;
    const breakdown = [];
    for (const s of statsBy.get(p.id) || []) {
      const f = fx.find((x) => x.id === s.fixture_id);
      const isHome = f.home_team_id === p.team_id;
      const conceded = isHome ? f.away_score : f.home_score;
      const r = playerPoints(s, p.position, conceded == null ? null : conceded);
      points += r.total;
      played = played || s.played;
      breakdown.push({ fixture_id: f.id, total: r.total, items: r.breakdown });
    }
    info.set(p.id, {
      points, played, breakdown,
      done: teamFx.every((f) => f.status === 'finished'),
      fixtures: teamFx.map((f) => f.id),
    });
  }
  return info;
}

/** Squad effective for a gameweek sort order: latest saved picks with sort <= maxSort. */
async function picksAt(userId, maxSort) {
  const { rows } = await db.query(
    `SELECT p.player_id, p.slot, p.is_captain, p.is_vice, g.id AS gameweek_id, g.sort
       FROM gw_picks p JOIN gameweeks g ON g.id = p.gameweek_id
      WHERE p.user_id = $1 AND g.sort = (
        SELECT max(g2.sort) FROM gw_picks p2 JOIN gameweeks g2 ON g2.id = p2.gameweek_id
         WHERE p2.user_id = $1 AND g2.sort <= $2)
      ORDER BY p.slot`, [userId, maxSort]);
  return rows;
}

async function allPlayers() {
  const { rows } = await db.query(
    `SELECT p.id, p.name, p.position, p.price, p.active, p.team_id, t.name AS team, t.short AS team_short, t.color AS team_color,
            t.logo_url AS team_logo, t.jersey_url AS team_jersey, t.gk_jersey_url AS team_gk_jersey, p.photo_updated
       FROM players p JOIN teams t ON t.id = p.team_id ORDER BY p.position, p.price DESC, p.name`);
  // Photo bytes are served separately; the ?v= stamp busts caches when a photo is replaced
  return rows.map(({ photo_updated, ...p }) => ({
    ...p, photo_url: photo_updated ? `/api/players/${p.id}/photo?v=${new Date(photo_updated).getTime()}` : null,
  }));
}

/** Total points and selection % for each player. */
async function playerTotals() {
  const gws = await gameweeks();
  const totals = new Map();
  for (const g of gws.list.filter((x) => x.started)) {
    for (const [pid, i] of await gwPlayerInfo(g.id)) totals.set(pid, (totals.get(pid) || 0) + i.points);
  }
  // Selected by: share of managers whose squad for the relevant gameweek includes the player
  const sort = (gws.next || gws.current || { sort: 0 }).sort;
  const { rows } = await db.query(
    `WITH latest AS (
       SELECT p.user_id, max(g.sort) AS s FROM gw_picks p JOIN gameweeks g ON g.id = p.gameweek_id
        WHERE g.sort <= $1 GROUP BY p.user_id)
     SELECT p.player_id, count(*)::int AS n FROM gw_picks p JOIN gameweeks g ON g.id = p.gameweek_id
       JOIN latest l ON l.user_id = p.user_id AND l.s = g.sort GROUP BY p.player_id`, [sort]);
  const { rows: m } = await db.query('SELECT count(*)::int AS n FROM fantasy_teams');
  const selected = new Map(rows.map((r) => [r.player_id, m[0].n ? Math.round((r.n / m[0].n) * 1000) / 10 : 0]));
  return { totals, selected };
}

async function userGwScore(userId, gw, info) {
  const picks = await picksAt(userId, gw.sort);
  if (!picks.length) return null;
  const { rows } = await db.query('SELECT hit FROM gw_entries WHERE user_id = $1 AND gameweek_id = $2', [userId, gw.id]);
  return scoreSquad(picks, info, rows[0]?.hit || 0);
}

/** Standings for a set of user ids (or everyone with a fantasy team). */
async function standings(filterSql = '', params = []) {
  const { rows: managers } = await db.query(
    `SELECT u.id AS user_id, u.name AS manager, u.level, f.name AS team_name
       FROM fantasy_teams f JOIN users u ON u.id = f.user_id ${filterSql}`, params);
  const gws = (await gameweeks()).list.filter((g) => g.started);
  const infos = new Map();
  for (const g of gws) infos.set(g.id, await gwPlayerInfo(g.id));
  const out = [];
  for (const m of managers) {
    let total = 0, last = null;
    const byGw = {};
    for (const g of gws) {
      const s = await userGwScore(m.user_id, g, infos.get(g.id));
      const pts = s ? s.total : 0;
      byGw[g.id] = pts; total += pts; last = pts;
    }
    out.push({ ...m, total, gw_points: last, by_gw: byGw });
  }
  out.sort((a, b) => b.total - a.total || (b.gw_points || 0) - (a.gw_points || 0) || a.manager.localeCompare(b.manager));
  out.forEach((r, i) => { r.rank = i > 0 && out[i - 1].total === r.total ? out[i - 1].rank : i + 1; });
  return out;
}

/** Save the squad for the next gameweek, counting transfers against the previous squad. */
async function saveSquad(userId, teamName, picks) {
  const gws = await gameweeks();
  if (!gws.next) return { error: 'There are no more gameweeks to pick a team for.' };
  const players = new Map((await allPlayers()).map((p) => [p.id, p]));
  picks = picks.map((p) => ({ player_id: +p.player_id, slot: +p.slot, is_captain: !!p.is_captain, is_vice: !!p.is_vice }));
  const v = validateSquad(picks, players);
  if (!v.ok) return { error: v.error };

  const prev = await picksAt(userId, gws.next.sort - 1);
  const transfers = prev.length ? countTransfers(prev.map((p) => p.player_id), picks.map((p) => p.player_id)) : 0;
  const hit = Math.max(0, transfers - RULES.freeTransfers) * RULES.hitCost;

  await db.tx(async (t) => {
    await t.query(
      `INSERT INTO fantasy_teams (user_id, name) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name`,
      [userId, teamName]);
    await t.query('DELETE FROM gw_picks WHERE user_id = $1 AND gameweek_id = $2', [userId, gws.next.id]);
    for (const p of picks) {
      await t.query('INSERT INTO gw_picks (user_id, gameweek_id, player_id, slot, is_captain, is_vice) VALUES ($1,$2,$3,$4,$5,$6)',
        [userId, gws.next.id, p.player_id, p.slot, p.is_captain, p.is_vice]);
    }
    await t.query(
      `INSERT INTO gw_entries (user_id, gameweek_id, transfers, hit) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, gameweek_id) DO UPDATE SET transfers = EXCLUDED.transfers, hit = EXCLUDED.hit`,
      [userId, gws.next.id, transfers, hit]);
  });
  return { ok: true, transfers, hit, cost: v.cost };
}

module.exports = { gameweeks, gwPlayerInfo, picksAt, allPlayers, playerTotals, userGwScore, standings, saveSquad };
