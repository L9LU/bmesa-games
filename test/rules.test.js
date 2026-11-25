const test = require('node:test');
const assert = require('node:assert');
const { playerPoints, validateSquad, scoreSquad, countTransfers } = require('../src/rules');

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

function squad() {
  const players = new Map();
  const add = (id, position, team_id, price = 60) => players.set(id, { id, name: `P${id}`, position, team_id, price, active: true });
  add(1, 'GK', 1, 45); add(2, 'GK', 2, 45);
  add(3, 'DEF', 1); add(4, 'DEF', 2); add(5, 'MID', 3); add(6, 'MID', 4); add(7, 'FWD', 5); add(8, 'FWD', 3);
  const picks = [
    { player_id: 1, slot: 1 }, { player_id: 3, slot: 2 }, { player_id: 4, slot: 3 }, { player_id: 5, slot: 4 },
    { player_id: 6, slot: 5 }, { player_id: 7, slot: 6 }, { player_id: 2, slot: 7 }, { player_id: 8, slot: 8 },
  ].map((p) => ({ ...p, is_captain: p.slot === 6, is_vice: p.slot === 4 }));
  return { players, picks };
}

test('valid squad passes', () => {
  const { players, picks } = squad();
  assert.deepStrictEqual(validateSquad(picks, players), { ok: true, cost: 450 });
});

test('over budget and team limit fail', () => {
  const { players, picks } = squad();
  for (const id of [3, 4, 5, 6]) players.get(id).price = 150; // 810 > 700
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
    [4, { points: 0, played: false, done: true }],   // missed → bench outfield (8) comes on
    [5, { points: 5, played: true, done: true }],
    [6, { points: 2, played: true, done: true }],
    [7, { points: 0, played: false, done: true }],   // captain missed → vice (5) doubles
    [2, { points: 9, played: true, done: true }],
    [8, { points: 4, played: true, done: true }],
  ]);
  const r = scoreSquad(picks, info, 4);
  // 6 + 2 + 5*2 + 2 + 4 (sub) - 4 hit
  assert.strictEqual(r.total, 20);
});

test('no auto-sub while matches pending', () => {
  const { picks } = squad();
  const info = new Map([1, 2, 3, 5, 6, 7, 8].map((id) => [id, { points: 2, played: true, done: true }]));
  info.set(4, { points: 0, played: false, done: false });
  assert.ok(!scoreSquad(picks, info).lineup.find((l) => l.slot === 8).subIn);
});

test('countTransfers', () => {
  assert.strictEqual(countTransfers([1, 2, 3], [1, 4, 5]), 2);
});

test('starting six must include every position', () => {
  const { RULES } = require('../src/rules');
  const saved = RULES.composition;
  // A squad shape where benching a whole position is possible: 3 DEF, 1 MID
  RULES.composition = { GK: 2, DEF: 3, MID: 1, FWD: 2 };
  try {
    const players = new Map();
    const add = (id, position, team_id) => players.set(id, { id, name: `P${id}`, position, team_id, price: 50, active: true });
    add(1, 'GK', 1); add(2, 'GK', 2); add(3, 'DEF', 1); add(4, 'DEF', 2); add(5, 'DEF', 3); add(6, 'MID', 4); add(7, 'FWD', 5); add(8, 'FWD', 3);
    const lineup = (starters, benchOut) => [
      { player_id: 1, slot: 1 }, ...starters.map((id, i) => ({ player_id: id, slot: i + 2 })),
      { player_id: 2, slot: 7 }, { player_id: benchOut, slot: 8 },
    ].map((p) => ({ ...p, is_captain: p.slot === 6, is_vice: p.slot === 5 }));
    // Only midfielder on the bench -> rejected
    assert.match(validateSquad(lineup([3, 4, 5, 7, 8], 6), players).error, /at least 1 midfielder/);
    // Midfielder starts, a defender on the bench -> fine
    assert.ok(validateSquad(lineup([3, 4, 6, 7, 8], 5), players).ok);
  } finally {
    RULES.composition = saved;
  }
});
