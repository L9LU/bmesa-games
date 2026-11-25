// One-time data migrations for databases that already exist (e.g. the live Neon one).
// Each runs once, in order, and is recorded in the `migrations` table. Runs inside the
// startup database lock (see ready() in app.js), so parallel cold starts can't run one twice.
// Add new ones to the END of the list; never edit or reorder ones that have shipped.

const MIGRATIONS = [
  {
    name: '2026-11-25-squad-of-9',
    // Fantasy moved from 6-a-side (6 start, 2 bench; slots 1-8) to 7-a-side (7 start, 2 bench; slots 1-9).
    // Keep everyone's saved players: bench GK 7 -> 8, bench outfield 8 -> 9. Slot 7 (a new outfield
    // starter place) is left empty, so managers add one more player before the next deadline.
    async up(q) {
      await q('ALTER TABLE gw_picks DROP CONSTRAINT IF EXISTS gw_picks_slot_check');
      await q('ALTER TABLE gw_picks ADD CONSTRAINT gw_picks_slot_check CHECK (slot BETWEEN 1 AND 9)');
      await q('UPDATE gw_picks SET slot = 9 WHERE slot = 8'); // two steps: (user, gameweek, slot) is unique
      await q('UPDATE gw_picks SET slot = 8 WHERE slot = 7');
    },
  },
  {
    name: '2026-11-25-male-football-7-a-side',
    async up(q) {
      await q("UPDATE events SET players_info = $1 WHERE slug = 'male-football'", ['7-a-side (1 keeper + 6 outfield), plus substitutes and 1 coach']);
    },
  },
];

/** q: query function (text, params) => result, already inside a transaction/lock. */
async function migrate(q) {
  await q('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, ran_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const { rows } = await q('SELECT name FROM migrations');
  const done = new Set(rows.map((r) => r.name));
  for (const m of MIGRATIONS) {
    if (done.has(m.name)) continue;
    await m.up(q);
    await q('INSERT INTO migrations (name) VALUES ($1)', [m.name]);
    console.log(`Migration applied: ${m.name}`);
  }
}

module.exports = { migrate, MIGRATIONS };
