// Fantasy rules and scoring. Pure functions only, so they are easy to test and tweak.

const RULES = {
  budget: 700,                 // tenths of a million: 700 = 70.0m
  // 7-a-side: 7 start (1 GK + 6 outfield), 2 on the bench (1 GK + 1 outfield) = squad of 9
  squadSize: 9,
  composition: { GK: 2, DEF: 2, MID: 2, FWD: 2 }, // minimum per position (exactly 2 GKs)
  extraOutfield: 1,                                // plus 1 outfield player of any position
  maxPerTeam: 3,
  freeTransfers: 2,            // per gameweek, after your first gameweek
  hitCost: 4,                  // points per extra transfer
  // Slots: 1 = starting GK, 2..7 = starting outfield, 8 = bench GK, 9 = bench outfield
  starterSlots: [1, 2, 3, 4, 5, 6, 7],
  gkSlots: [1, 8],
  benchGkSlot: 8,
  benchOutfieldSlot: 9,
  // Every position must be represented in the starting seven (no benching both defenders, etc.)
  minStarters: { GK: 1, DEF: 1, MID: 1, FWD: 1 },
};

const POINTS = {
  played: 2,
  goal: { GK: 6, DEF: 6, MID: 5, FWD: 4 },
  assist: 3,
  cleanSheet: { GK: 4, DEF: 4, MID: 1, FWD: 0 },
  concededPer2: { GK: -1, DEF: -1, MID: 0, FWD: 0 },
  savesPer3: 1,
  penSaved: 5,
  penMissed: -2,
  ownGoal: -2,
  yellow: -1,
  red: -3,
  mvp: 3,
};

/**
 * Points for one player in one fixture.
 * @param stat     player_stats row
 * @param position 'GK' | 'DEF' | 'MID' | 'FWD'
 * @param conceded goals the player's team conceded in that fixture (null if unknown)
 */
function playerPoints(stat, position, conceded) {
  const b = [];
  if (!stat || !stat.played) return { total: 0, breakdown: b };
  const add = (label, pts) => { if (pts) b.push({ label, pts }); };
  add('Played', POINTS.played);
  add(`Goals ×${stat.goals}`, stat.goals * POINTS.goal[position]);
  add(`Assists ×${stat.assists}`, stat.assists * POINTS.assist);
  if (conceded === 0) add('Clean sheet', POINTS.cleanSheet[position]);
  if (conceded > 0) add(`Conceded ${conceded}`, Math.floor(conceded / 2) * POINTS.concededPer2[position]);
  if (position === 'GK') add(`Saves ×${stat.saves}`, Math.floor(stat.saves / 3) * POINTS.savesPer3);
  add('Penalty saved', stat.pen_saved * POINTS.penSaved);
  add('Penalty missed', stat.pen_missed * POINTS.penMissed);
  add('Own goal', stat.own_goals * POINTS.ownGoal);
  add('Yellow card', stat.yellow * POINTS.yellow);
  add('Red card', stat.red * POINTS.red);
  if (stat.mvp) add('MVP', POINTS.mvp);
  return { total: b.reduce((s, x) => s + x.pts, 0), breakdown: b };
}

/**
 * Validate a squad. picks: [{ player_id, slot, is_captain, is_vice }]
 * players: Map(id -> { id, position, team_id, price, active })
 * Returns { ok, error, cost }.
 */
function validateSquad(picks, players) {
  const fail = (error) => ({ ok: false, error });
  if (!Array.isArray(picks) || picks.length !== RULES.squadSize) return fail(`Pick exactly ${RULES.squadSize} players.`);
  const slots = new Set(picks.map((p) => p.slot));
  const ids = new Set(picks.map((p) => p.player_id));
  if (slots.size !== RULES.squadSize || [...slots].some((s) => s < 1 || s > RULES.squadSize)) return fail(`Each slot 1–${RULES.squadSize} must be filled once.`);
  if (ids.size !== RULES.squadSize) return fail('A player can only be picked once.');

  const count = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  const perTeam = {};
  let cost = 0;
  for (const pick of picks) {
    const pl = players.get(pick.player_id);
    if (!pl) return fail('Unknown player in squad.');
    if (!pl.active) return fail(`${pl.name} is no longer available.`);
    const isGkSlot = RULES.gkSlots.includes(pick.slot);
    if (isGkSlot && pl.position !== 'GK') return fail('Goalkeeper slots must hold goalkeepers.');
    if (!isGkSlot && pl.position === 'GK') return fail('Goalkeepers can only go in goalkeeper slots.');
    count[pl.position]++;
    perTeam[pl.team_id] = (perTeam[pl.team_id] || 0) + 1;
    cost += pl.price;
  }
  if (count.GK !== RULES.composition.GK) return fail(`You need exactly ${RULES.composition.GK} goalkeepers.`);
  for (const pos of ['DEF', 'MID', 'FWD']) {
    if (count[pos] < RULES.composition[pos]) return fail(`You need at least ${RULES.composition[pos]} ${pos}s.`);
  }
  if (Object.values(perTeam).some((n) => n > RULES.maxPerTeam)) return fail(`Max ${RULES.maxPerTeam} players from one team.`);

  const started = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const pick of picks) if (RULES.starterSlots.includes(pick.slot)) started[players.get(pick.player_id).position]++;
  const WORD = { GK: 'goalkeeper', DEF: 'defender', MID: 'midfielder', FWD: 'forward' };
  for (const [pos, n] of Object.entries(RULES.minStarters)) {
    if (started[pos] < n) return fail(`Your starting seven needs at least ${n} ${WORD[pos]}${n > 1 ? 's' : ''}.`);
  }
  if (cost > RULES.budget) return fail(`Squad costs ${(cost / 10).toFixed(1)}m, over the ${(RULES.budget / 10).toFixed(1)}m budget.`);

  const caps = picks.filter((p) => p.is_captain);
  const vices = picks.filter((p) => p.is_vice);
  if (caps.length !== 1 || vices.length !== 1) return fail('Choose one captain and one vice-captain.');
  if (caps[0].player_id === vices[0].player_id) return fail('Captain and vice-captain must be different.');
  if (!RULES.starterSlots.includes(caps[0].slot) || !RULES.starterSlots.includes(vices[0].slot)) return fail('Captain and vice-captain must be starters.');
  return { ok: true, cost };
}

/**
 * Score a squad for one gameweek with auto-subs and captaincy.
 * picks: [{ player_id, slot, is_captain, is_vice }]
 * info:  Map(player_id -> { points, played, done }) where `done` = all of the player's
 *        team fixtures in that gameweek are finished (or the team has none).
 */
function scoreSquad(picks, info, hit = 0) {
  const get = (id) => info.get(id) || { points: 0, played: false, done: true };
  const lineup = picks.map((p) => ({ ...p, points: get(p.player_id).points, multiplier: 0, subIn: false, subOut: false }));
  const bySlot = Object.fromEntries(lineup.map((p) => [p.slot, p]));
  const missed = (p) => !get(p.player_id).played && get(p.player_id).done;

  // Starters count by default
  for (const s of RULES.starterSlots) if (bySlot[s]) bySlot[s].multiplier = 1;

  // Auto-subs: bench GK for the starting GK, bench outfielder for the first outfield starter who missed out.
  // (With at least 2 per position and one outfield sub, this can never leave a position with no starter.)
  const benchGk = bySlot[RULES.benchGkSlot], benchOut = bySlot[RULES.benchOutfieldSlot];
  if (bySlot[1] && benchGk && missed(bySlot[1]) && get(benchGk.player_id).played) {
    bySlot[1].multiplier = 0; bySlot[1].subOut = true;
    benchGk.multiplier = 1; benchGk.subIn = true;
  }
  if (benchOut && get(benchOut.player_id).played) {
    const out = RULES.starterSlots.filter((s) => s !== 1).map((s) => bySlot[s]).find((p) => p && missed(p));
    if (out) {
      out.multiplier = 0; out.subOut = true;
      benchOut.multiplier = 1; benchOut.subIn = true;
    }
  }

  // Captaincy: captain doubles; if the captain missed out, the vice doubles instead
  const cap = lineup.find((p) => p.is_captain);
  const vice = lineup.find((p) => p.is_vice);
  const capped = cap && missed(cap) && vice && vice.multiplier > 0 ? vice : cap;
  if (capped && capped.multiplier > 0) capped.multiplier = 2;
  if (capped) capped.activeCaptain = true;

  const total = lineup.reduce((s, p) => s + p.points * p.multiplier, 0) - hit;
  return { total, hit, lineup };
}

/** Number of transfers between two squads (players in new not in old). */
function countTransfers(oldIds, newIds) {
  const old = new Set(oldIds);
  return newIds.filter((id) => !old.has(id)).length;
}

module.exports = { RULES, POINTS, playerPoints, validateSquad, scoreSquad, countTransfers };
