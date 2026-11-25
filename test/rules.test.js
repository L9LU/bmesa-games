const test = require('node:test');
const assert = require('node:assert');
const { RULES, playerPoints, validateSquad, scoreSquad, countTransfers } = require('../src/rules');

const stat = (o = {}) => ({ played: true, goals: 0, assists: 0, saves: 0, pen_saved: 0, pen_missed: 0, own_goals: 0, yellow: 0, red: 0, mvp: false, ...o });

test('forward goal + assist + MVP', () => {
  assert.strictEqual(playerPoints(stat({ goals: 2, assists: 1, mvp: true }), 'FWD', 3).total, 2 + 8 + 3 + 3);
});

test('keeper clean sheet and saves', () => {
  assert.strictEqual(playerPoints(stat({ saves: 7 }), 'GK', 0).total, 2 + 4 + 2);
});

test('defender concedes 5', () => {
  assert.strictEqual(playerPoints(stat(), 'DEF', 5).total, 2 - 2);
});

test('did not play scores 0', () => {
  assert.strictEqual(playerPoints(null, 'MID', 0).total, 0);
});

/**
 * 7-a-side squad of 9: slot 1 GK, slots 2-7 outfield starters (2-2-2), slot 8 bench GK, slot 9 bench outfield.
 * Player 9 is the extra outfield player (a DEF here), on the bench.
 */
function squad() {
  const players = new Map();
  const add = (id, position, team_id, price = 60) => players.set(id, { id, name: `P${id}`, position, team_id, price, active: true });
  add(1, 'GK', 1, 45); add(2, 'GK', 2, 45);
  add(3, 'DEF', 1); add(4, 'DEF', 2); add(5, 'MID', 3); add(6, 'MID', 4); add(7, 'FWD', 5); add(8, 'FWD', 3); add(9, 'DEF', 4);
  const picks = [
    { player_id: 1, slot: 1 }, { player_id: 3, slot: 2 }, { player_id: 4, slot: 3 }, { player_id: 5, slot: 4 },
    { player_id: 6, slot: 5 }, { player_id: 7, slot: 6 }, { player_id: 8, slot: 7 }, { player_id: 2, slot: 8 }, { player_id: 9, slot: 9 },
  ].map((p) => ({ ...p, is_captain: p.slot === 6, is_vice: p.slot === 4 }));
  return { players, picks };
}

test('rules are 7-a-side: 7 starters, squad of 9', () => {
  assert.strictEqual(RULES.squadSize, 9);
  assert.strictEqual(RULES.starterSlots.length, 7);
});

test('valid squad passes', () => {
  const { players, picks } = squad();
  assert.deepStrictEqual(validateSquad(picks, players), { ok: true, cost: 2 * 45 + 7 * 60 });
});

test('the extra outfield player can be any position', () => {
  for (const pos of ['DEF', 'MID', 'FWD']) {
    const { players, picks } = squad();
    players.get(9).position = pos;
    assert.ok(validateSquad(picks, players).ok, `extra ${pos} should be allowed`);
  }
});

test('squad shape is enforced', () => {
  let s = squad();
  s.players.get(9).position = 'GK'; // a third goalkeeper in an outfield slot
  assert.match(validateSquad(s.picks, s.players).error, /Goalkeepers can only go/);
  s = squad();
  s.players.get(4).position = 'MID'; // DEFs drop to 2 (3 and extra 9)... make the extra a MID too -> only 1 DEF
  s.players.get(9).position = 'MID';
  assert.match(validateSquad(s.picks, s.players).error, /at least 2 DEFs/);
  s = squad();
  assert.match(validateSquad(s.picks.slice(0, 8), s.players).error, /exactly 9/);
});

test('over budget and team limit fail', () => {
  const { players, picks } = squad();
  for (const id of [3, 4, 5, 6]) players.get(id).price = 150; // 870 > 700
  assert.match(validateSquad(picks, players).error, /budget/);
  const s2 = squad();
  for (const id of [3, 5, 6, 7]) s2.players.get(id).team_id = 9;
  assert.match(validateSquad(s2.picks, s2.players).error, /Max 3/);
});

test('captain doubles, auto-sub and vice fallback', () => {
  const { picks } = squad();
  const info = new Map([
    [1, { points: 6, played: true, done: true }],
    [3, { points: 2, played: true, done: true }],
    [4, { points: 0, played: false, done: true }],   // missed → bench outfield (9) comes on
    [5, { points: 5, played: true, done: true }],
    [6, { points: 2, played: true, done: true }],
    [7, { points: 0, played: false, done: true }],   // captain missed → vice (5) doubles
    [8, { points: 3, played: true, done: true }],
    [2, { points: 9, played: true, done: true }],    // bench GK not needed
    [9, { points: 4, played: true, done: true }],
  ]);
  const r = scoreSquad(picks, info, 4);
  // 6 + 2 + 5*2 + 2 + 3 + 4 (sub) - 4 hit
  assert.strictEqual(r.total, 23);
  assert.ok(r.lineup.find((l) => l.slot === 9).subIn);
  assert.ok(!r.lineup.find((l) => l.slot === 8).subIn);
});

test('bench goalkeeper comes on when the starter misses out', () => {
  const { picks } = squad();
  const info = new Map([...Array(9)].map((_, i) => [i + 1, { points: 2, played: true, done: true }]));
  info.set(1, { points: 0, played: false, done: true });
  const r = scoreSquad(picks, info);
  assert.ok(r.lineup.find((l) => l.slot === 8).subIn);
  assert.strictEqual(r.total, 2 * 7 + 2); // 6 outfield starters + bench GK, captain (slot 6) doubled
});

test('no auto-sub while matches pending', () => {
  const { picks } = squad();
  const info = new Map([1, 2, 3, 5, 6, 7, 8, 9].map((id) => [id, { points: 2, played: true, done: true }]));
  info.set(4, { points: 0, played: false, done: false });
  assert.ok(!scoreSquad(picks, info).lineup.find((l) => l.slot === 9).subIn);
});

test('countTransfers', () => {
  assert.strictEqual(countTransfers([1, 2, 3], [1, 4, 5]), 2);
});

test('starting seven must include every position', () => {
  const saved = RULES.composition;
  // A squad shape where benching a whole position is possible: min 3 DEF, 1 MID (+1 extra outfield)
  RULES.composition = { GK: 2, DEF: 3, MID: 1, FWD: 2 };
  try {
    const players = new Map();
    const add = (id, position, team_id) => players.set(id, { id, name: `P${id}`, position, team_id, price: 50, active: true });
    add(1, 'GK', 1); add(2, 'GK', 2); add(3, 'DEF', 1); add(4, 'DEF', 2); add(5, 'DEF', 3); add(6, 'MID', 4); add(7, 'FWD', 5); add(8, 'FWD', 3); add(9, 'FWD', 4);
    const lineup = (starters, benchOut) => [
      { player_id: 1, slot: 1 }, ...starters.map((id, i) => ({ player_id: id, slot: i + 2 })),
      { player_id: 2, slot: 8 }, { player_id: benchOut, slot: 9 },
    ].map((p) => ({ ...p, is_captain: p.slot === 6, is_vice: p.slot === 5 }));
    // Only midfielder on the bench -> rejected
    assert.match(validateSquad(lineup([3, 4, 5, 7, 8, 9], 6), players).error, /at least 1 midfielder/);
    // Midfielder starts, a defender on the bench -> fine
    assert.ok(validateSquad(lineup([3, 4, 6, 7, 8, 9], 5), players).ok);
  } finally {
    RULES.composition = saved;
  }
});

test('migration moves saved 8-player squads to the 9-slot layout once', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { migrate } = require('../src/migrations');
  const db = new PGlite(); // in-memory
  // Old schema: slots 1-8 (7 = bench GK, 8 = bench outfield)
  await db.exec(`CREATE TABLE events (slug TEXT, players_info TEXT);
    INSERT INTO events VALUES ('male-football', '6-a-side');
    CREATE TABLE gw_picks (user_id INT, gameweek_id INT, player_id INT, slot INT NOT NULL CHECK (slot BETWEEN 1 AND 8), PRIMARY KEY (user_id, gameweek_id, slot));
    INSERT INTO gw_picks SELECT 1, 1, s * 10, s FROM generate_series(1, 8) s;`);
  const q = (t, p) => db.query(t, p);
  await migrate(q);
  await migrate(q); // second run must do nothing
  const { rows } = await db.query('SELECT player_id, slot FROM gw_picks ORDER BY slot');
  assert.deepStrictEqual(rows.map((r) => [r.slot, r.player_id]), [[1, 10], [2, 20], [3, 30], [4, 40], [5, 50], [6, 60], [8, 70], [9, 80]]);
  const ev = await db.query("SELECT players_info FROM events WHERE slug = 'male-football'");
  assert.match(ev.rows[0].players_info, /7-a-side/);
  await db.close();
});
