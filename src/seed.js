// Seeds the BMESA Games programme (teams, events, fixtures, gameweeks).
// Runs automatically on first start. `npm run seed:demo` also adds demo players and managers
// for local testing — don't run the demo seed on your live site.
const db = require('./db');
const { RULES, validateSquad } = require('./rules');

const TZ = '+01:00'; // West Africa Time
const at = (date, time) => `2026-12-${date}T${time}:00${TZ}`;

const TEAMS = [
  // Colours are taken from each class logo
  { name: 'Year 1', short: 'Y1', color: '#7c3aed', logo_url: '/kits/y1-logo.webp' }, // Bioneers crest (purple)
  { name: 'Year 2', short: 'Y2', color: '#1f2d5c', logo_url: '/kits/y2-logo.webp', jersey_url: '/kits/y2-jersey.png', gk_jersey_url: '/kits/y2-gk.png' }, // DNA & gear; navy kit, red GK
  { name: 'Year 3', short: 'Y3', color: '#7a1f2b', logo_url: '/kits/y3-logo.webp' }, // Biomedical FC heart (maroon)
  { name: 'Year 4', short: 'Y4', color: '#64748b', logo_url: '/kits/y4-logo.webp' }, // Owl shield (silver)
  { name: 'Year 5', short: 'Y5', color: '#c9a046', logo_url: '/kits/y5-logo.png', jersey_url: '/kits/y5-jersey.png', gk_jersey_url: '/kits/y5-gk.png' }, // Wolf; black kit, gold GK
  { name: 'Angels', short: 'ANG', color: '#ec4899', is_level: false },
  { name: 'Ravens', short: 'RAV', color: '#334155', is_level: false },
];

const IND = 'BME Year 5 Class';
const PITCH = 'Staff School';

const EVENTS = [
  { slug: 'male-football', name: 'Male Football', category: 'Football', format: 'Knockout, 2 × 25-minute halves. Semi-finals are home and away.', awards: '1 Trophy, 11 Gold, 11 Silver, 11 Bronze, MVP, Golden Boot, Golden Gloves', players_info: '6-a-side (1 keeper), 3 substitutes, 1 coach', venue: PITCH },
  { slug: 'female-football', name: 'Female Football', category: 'Football', format: 'Final, 2 × 10-minute halves', awards: '1 Trophy, 10 Gold, 10 Silver, MVP', players_info: '6-a-side (1 keeper), 2 substitutes, 1 coach', venue: PITCH },
  { slug: 'male-basketball', name: 'Male Basketball', category: 'Basketball', format: 'Final', awards: '8 Gold, 8 Silver, MVP', players_info: '8 per team: 5 starters, 3 subs' },
  { slug: 'female-basketball', name: 'Female Basketball', category: 'Basketball', format: 'Final', awards: '4 Gold, 4 Silver, MVP', players_info: 'TBC' },
  { slug: 'mixed-volleyball', name: 'Mixed Volleyball', category: 'Volleyball', format: 'Final', awards: '9 Gold, 9 Silver, MVP', players_info: '9 per team: 6 starters (at least 1 girl), 3 subs' },
  { slug: 'badminton-male', name: 'Badminton — Male', category: 'Badminton', format: 'TBC', awards: '1 Gold, 1 Silver, 1 Bronze', players_info: '1 rep per level' },
  { slug: 'badminton-female', name: 'Badminton — Female', category: 'Badminton', format: 'TBC', awards: '1 Gold, 1 Silver, 1 Bronze', players_info: '1 rep per level' },
  { slug: 'badminton-mixed', name: 'Badminton — Mixed', category: 'Badminton', format: 'TBC', awards: '2 Gold, 2 Silver, 2 Bronze', players_info: '2 reps per level' },
  { slug: '100m-male', name: '100m Male', category: 'Track', format: 'Sprint race', awards: '1 Gold, 1 Silver, 1 Bronze', players_info: '1 rep per level' },
  { slug: '100m-female', name: '100m Female', category: 'Track', format: 'Sprint race', awards: '1 Gold, 1 Silver, 1 Bronze', players_info: '1 rep per level' },
  { slug: '200m-male', name: '200m Male', category: 'Track', format: 'Sprint race', awards: '1 Gold, 1 Silver, 1 Bronze', players_info: '1 rep per level' },
  { slug: '200m-female', name: '200m Female', category: 'Track', format: 'Sprint race', awards: '1 Gold, 1 Silver, 1 Bronze', players_info: '1 rep per level' },
  { slug: '400m-male', name: '400m Male', category: 'Track', format: 'One-lap race', awards: '1 Gold, 1 Silver, 1 Bronze', players_info: '1 rep per level' },
  { slug: '400m-female', name: '400m Female', category: 'Track', format: 'One-lap race', awards: '1 Gold, 1 Silver, 1 Bronze', players_info: '1 rep per level' },
  { slug: '4x100m-mixed', name: '4 × 100m Mixed Relay', category: 'Track', format: 'Relay', awards: '4 Gold, 4 Silver, 4 Bronze', players_info: '4 athletes per level: 2 male, 2 female' },
  { slug: 'scrabble', name: 'Scrabble', category: 'Indoor', format: 'League', awards: '2 Gold, 2 Silver, 2 Bronze', players_info: '2 reps per level', venue: IND },
  { slug: 'ludo', name: 'Ludo', category: 'Indoor', format: 'League', awards: '1 Gold, 1 Silver, 1 Bronze', players_info: '1 rep per level', venue: IND },
  { slug: 'chess', name: 'Chess', category: 'Indoor', format: 'League', awards: '1 Gold, 1 Silver, 1 Bronze', players_info: '1 rep per level', venue: IND },
  { slug: 'connect-4', name: 'Connect 4', category: 'Indoor', format: 'League', awards: '1 Gold, 1 Silver, 1 Bronze', players_info: '1 rep per level', venue: IND },
  { slug: 'fifa', name: 'FIFA', category: 'Esports', format: 'Knockout', awards: '1 Gold, 1 Silver, 1 Bronze', players_info: '2 reps per level', venue: IND },
  { slug: 'efootball', name: 'eFootball Mobile', category: 'Esports', format: 'Knockout', awards: '1 Gold, 1 Silver, 1 Bronze', players_info: '2 reps per level', venue: IND, notes: 'MTN SIM advised. Latecomers risk forfeit.' },
  { slug: 'codm', name: 'CODM', category: 'Esports', format: 'One for all', awards: '1 Gold, 1 Silver, 1 Bronze', players_info: '1 rep per level', venue: IND },
  { slug: 'mortal-kombat', name: 'Mortal Kombat (Female)', category: 'Esports', format: 'Knockout', awards: '1 Gold, 1 Silver, 1 Bronze', players_info: '1 female rep per level', venue: IND },
];

const GAMEWEEKS = [
  { name: 'Gameweek 1', deadline: at('04', '13:00') },
  { name: 'Gameweek 2', deadline: at('07', '15:00') },
  { name: 'Gameweek 3', deadline: at('08', '15:00') },
  { name: 'Gameweek 4', deadline: at('11', '13:00') },
];

// [event slug, round, day, start, home, away, gameweek index (male football only), venue override]
const FIXTURES = [
  ['male-football', 'Playoff', 1, at('04', '14:00'), 'Year 1', 'Year 2', 0],
  ['male-football', 'Semi-final 1 · Leg 1', 1, at('04', '15:00'), 'Year 3', 'Year 4', 0],
  ['scrabble', 'League', 2, at('07', '12:00'), '*', null],
  ['chess', 'League', 2, at('07', '12:00'), '*', null],
  ['male-football', 'Semi-final 2 · Leg 1', 2, at('07', '16:00'), 'Year 5', '~Winner Playoff', 1],
  ['male-football', 'Semi-final 1 · Leg 2', 2, at('07', '17:00'), 'Year 4', 'Year 3', 1],
  ['ludo', 'League', 3, at('08', '12:00'), '*', null],
  ['connect-4', 'League', 3, at('08', '12:00'), '*', null],
  ['male-football', 'Semi-final 2 · Leg 2', 3, at('08', '16:00'), '~Winner Playoff', 'Year 5', 2],
  ['female-football', 'Final', 3, at('08', '17:00'), 'Angels', 'Ravens'],
  ['badminton-male', 'Competition', 4, at('09', '12:00'), '*', null],
  ['badminton-female', 'Competition', 4, at('09', '12:00'), '*', null],
  ['badminton-mixed', 'Competition', 4, at('09', '12:00'), '*', null],
  ['mixed-volleyball', 'Final', 4, at('09', '12:00'), '~TBD', '~TBD'],
  ['male-basketball', 'Final', 4, at('09', '12:00'), '~TBD', '~TBD'],
  ['female-basketball', 'Final', 4, at('09', '12:00'), '~TBD', '~TBD'],
  ['100m-male', 'Race', 5, at('10', '12:00'), '*', null],
  ['100m-female', 'Race', 5, at('10', '12:00'), '*', null],
  ['200m-male', 'Race', 5, at('10', '12:00'), '*', null],
  ['200m-female', 'Race', 5, at('10', '12:00'), '*', null],
  ['400m-male', 'Race', 5, at('10', '12:00'), '*', null],
  ['400m-female', 'Race', 5, at('10', '12:00'), '*', null],
  ['4x100m-mixed', 'Relay', 5, at('10', '12:00'), '*', null],
  ['fifa', 'Knockout', 5, at('10', '14:30'), '*', null],
  ['mortal-kombat', 'Knockout', 5, at('10', '14:30'), '*', null],
  ['efootball', 'Knockout', 5, at('10', '15:00'), '*', null],
  ['codm', 'One for all', 5, at('10', '15:00'), '*', null],
  ['male-football', '3rd place', 6, at('11', '14:00'), '~Loser SF1', '~Loser SF2', 3],
  ['male-football', 'Final', 6, at('11', '15:00'), '~Winner SF1', '~Winner SF2', 3],
];

async function seedBase(q = db.query) {
  const { rows } = await q('SELECT count(*)::int AS n FROM events');
  if (rows[0].n > 0) return false;

  const teamId = {};
  for (const t of TEAMS) {
    const r = await q('INSERT INTO teams (name, short, color, is_level, logo_url, jersey_url, gk_jersey_url) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [t.name, t.short, t.color, t.is_level !== false, t.logo_url || null, t.jersey_url || null, t.gk_jersey_url || null]);
    teamId[t.name] = r.rows[0].id;
  }
  const eventId = {};
  for (const [i, e] of EVENTS.entries()) {
    const r = await q(
      'INSERT INTO events (slug, name, category, format, awards, players_info, venue, notes, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
      [e.slug, e.name, e.category, e.format, e.awards, e.players_info, e.venue || null, e.notes || null, i]
    );
    eventId[e.slug] = r.rows[0].id;
  }
  const gwIds = [];
  for (const [i, g] of GAMEWEEKS.entries()) {
    const r = await q('INSERT INTO gameweeks (name, deadline, sort) VALUES ($1,$2,$3) RETURNING id', [g.name, g.deadline, i + 1]);
    gwIds.push(r.rows[0].id);
  }
  const side = (v) => {
    if (v === '*') return [null, 'All levels'];
    if (!v) return [null, null];
    if (v.startsWith('~')) return [null, v.slice(1)];
    return [teamId[v], null];
  };
  for (const [slug, round, day, startsAt, home, away, gw] of FIXTURES) {
    const ev = EVENTS.find((e) => e.slug === slug);
    const [hId, hLabel] = side(home);
    const [aId, aLabel] = side(away);
    const venue = ev.venue || (ev.category === 'Football' ? PITCH : 'TBC');
    await q(
      `INSERT INTO fixtures (event_id, round, day, starts_at, venue, home_team_id, away_team_id, home_label, away_label, gameweek_id, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [eventId[slug], round, day, startsAt, venue, hId, aId, hLabel, aLabel, gw === undefined ? null : gwIds[gw], day === 4 ? 'Exact time TBC' : null]
    );
  }
  await q('INSERT INTO announcements (title, body) VALUES ($1,$2)', [
    'Welcome to the BMESA Games hub',
    'Follow fixtures, results and the medals table here, and build your fantasy football squad before the Gameweek 1 deadline on Friday 4 December, 1 pm.',
  ]);
  return true;
}

// ---------- Demo data (local testing only) ----------
const POS_PLAN = [['GK', 2, 40, 50], ['DEF', 2, 45, 55], ['MID', 3, 55, 75], ['FWD', 2, 60, 85]];
const POS_WORD = { GK: 'Keeper', DEF: 'Defender', MID: 'Midfielder', FWD: 'Striker' };

function rand(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function randomSquad(players) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const need = { ...RULES.composition };
    const perTeam = {};
    const chosen = [];
    for (const p of shuffle([...players])) {
      if (need[p.position] > 0 && (perTeam[p.team_id] || 0) < RULES.maxPerTeam) {
        chosen.push(p); need[p.position]--; perTeam[p.team_id] = (perTeam[p.team_id] || 0) + 1;
      }
    }
    if (chosen.length !== RULES.squadSize) continue;
    const gks = chosen.filter((p) => p.position === 'GK');
    const out = shuffle(chosen.filter((p) => p.position !== 'GK'));
    const picks = [
      { player_id: gks[0].id, slot: 1 }, ...out.slice(0, 5).map((p, i) => ({ player_id: p.id, slot: i + 2 })),
      { player_id: gks[1].id, slot: 7 }, { player_id: out[5].id, slot: 8 },
    ].map((p) => ({ ...p, is_captain: p.slot === 2, is_vice: p.slot === 3 }));
    const map = new Map(players.map((p) => [p.id, p]));
    if (validateSquad(picks, map).ok) return picks;
  }
  return null;
}

async function seedDemo() {
  const { rows: existing } = await db.query('SELECT count(*)::int AS n FROM players');
  if (existing[0].n === 0) {
    const { rows: teams } = await db.query('SELECT * FROM teams WHERE is_level ORDER BY id');
    for (const t of teams) {
      for (const [pos, n, lo, hi] of POS_PLAN) {
        for (let i = 1; i <= n; i++) {
          await db.query('INSERT INTO players (name, team_id, position, price) VALUES ($1,$2,$3,$4)', [`${t.short} ${POS_WORD[pos]} ${i}`, t.id, pos, Math.round(rand(lo, hi) / 5) * 5]);
        }
      }
    }
    console.log('Added demo players.');
  }
  const { rows: players } = await db.query('SELECT * FROM players');
  const { rows: gw } = await db.query('SELECT id FROM gameweeks ORDER BY sort LIMIT 1');
  const bcrypt = require('bcryptjs');
  const managers = ['Demo Manager A', 'Demo Manager B', 'Demo Manager C', 'Demo Manager D', 'Demo Manager E', 'Demo Manager F'];
  for (const [i, name] of managers.entries()) {
    const email = `demo${i + 1}@example.invalid`;
    const hash = await bcrypt.hash(require('crypto').randomBytes(16).toString('hex'), 8);
    const r = await db.query(
      `INSERT INTO users (name, email, password_hash, level) VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING RETURNING id`,
      [name, email, hash, `Year ${(i % 5) + 1}`]
    );
    if (!r.rows.length) continue;
    const uid = r.rows[0].id;
    await db.query('INSERT INTO fantasy_teams (user_id, name) VALUES ($1,$2)', [uid, `${name.split(' ').pop()} FC`]);
    const picks = randomSquad(players);
    for (const p of picks) {
      await db.query('INSERT INTO gw_picks (user_id, gameweek_id, player_id, slot, is_captain, is_vice) VALUES ($1,$2,$3,$4,$5,$6)', [uid, gw[0].id, p.player_id, p.slot, p.is_captain, p.is_vice]);
    }
  }
  console.log('Added demo managers.');
}

module.exports = { seedBase };

if (require.main === module) {
  (async () => {
    await db.init();
    const did = await seedBase();
    console.log(did ? 'Seeded the games programme.' : 'Programme already seeded.');
    if (process.argv.includes('--demo')) await seedDemo();
    await db.close();
  })().catch((e) => { console.error(e); process.exit(1); });
}
