-- All statements are idempotent so the schema can be applied on every start.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  level TEXT,                                   -- 'Year 1' .. 'Year 5', 'Staff', 'Alumni'
  role TEXT NOT NULL DEFAULT 'user',            -- 'user' | 'organiser' | 'admin'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Sports hub ----------
CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  short TEXT NOT NULL,
  is_level BOOLEAN NOT NULL DEFAULT true,       -- only level teams count on the medals table
  color TEXT NOT NULL DEFAULT '#64748b'
);
-- Images for each team (paths under /teams/... or full URLs)
ALTER TABLE teams ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS jersey_url TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS gk_jersey_url TEXT;

CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,                       -- Football, Basketball, Volleyball, Badminton, Track, Indoor, Esports
  format TEXT,
  awards TEXT,
  players_info TEXT,
  venue TEXT,
  notes TEXT,
  sort INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS gameweeks (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  deadline TIMESTAMPTZ NOT NULL,
  finished BOOLEAN NOT NULL DEFAULT false,
  sort INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS fixtures (
  id SERIAL PRIMARY KEY,
  event_id INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  round TEXT,                                   -- 'Playoff', 'Semi-final 1 · Leg 1', 'Final' ...
  day INT,                                      -- 1..6
  starts_at TIMESTAMPTZ,
  venue TEXT,
  home_team_id INT REFERENCES teams(id),
  away_team_id INT REFERENCES teams(id),
  home_label TEXT,                              -- shown when team not known yet, e.g. 'Winner Playoff'
  away_label TEXT,
  home_score INT,
  away_score INT,
  status TEXT NOT NULL DEFAULT 'scheduled',     -- 'scheduled' | 'live' | 'finished'
  notes TEXT,
  gameweek_id INT REFERENCES gameweeks(id)
);

CREATE TABLE IF NOT EXISTS placements (
  event_id INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  position INT NOT NULL CHECK (position BETWEEN 1 AND 3),
  team_id INT NOT NULL REFERENCES teams(id),
  note TEXT,                                    -- e.g. winner's name
  PRIMARY KEY (event_id, position)
);

CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT,
  author_id INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Fantasy ----------
CREATE TABLE IF NOT EXISTS players (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  team_id INT NOT NULL REFERENCES teams(id),
  position TEXT NOT NULL CHECK (position IN ('GK','DEF','MID','FWD')),
  price INT NOT NULL,                           -- in tenths of a million: 65 = 6.5m
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS player_stats (
  player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  fixture_id INT NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE,
  played BOOLEAN NOT NULL DEFAULT true,
  goals INT NOT NULL DEFAULT 0,
  assists INT NOT NULL DEFAULT 0,
  saves INT NOT NULL DEFAULT 0,
  pen_saved INT NOT NULL DEFAULT 0,
  pen_missed INT NOT NULL DEFAULT 0,
  own_goals INT NOT NULL DEFAULT 0,
  yellow INT NOT NULL DEFAULT 0,
  red INT NOT NULL DEFAULT 0,
  mvp BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (player_id, fixture_id)
);

CREATE TABLE IF NOT EXISTS fantasy_teams (
  user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The squad a user has set for a gameweek. Picks carry forward: a user's squad for
-- gameweek N is the latest saved one with sort <= N.
CREATE TABLE IF NOT EXISTS gw_picks (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gameweek_id INT NOT NULL REFERENCES gameweeks(id) ON DELETE CASCADE,
  player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  slot INT NOT NULL CHECK (slot BETWEEN 1 AND 9),   -- 1 = GK, 2..7 = outfield starters, 8 = bench GK, 9 = bench outfield
  is_captain BOOLEAN NOT NULL DEFAULT false,
  is_vice BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, gameweek_id, slot)
);

CREATE TABLE IF NOT EXISTS gw_entries (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gameweek_id INT NOT NULL REFERENCES gameweeks(id) ON DELETE CASCADE,
  transfers INT NOT NULL DEFAULT 0,
  hit INT NOT NULL DEFAULT 0,                       -- points deducted
  PRIMARY KEY (user_id, gameweek_id)
);

CREATE TABLE IF NOT EXISTS leagues (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  owner_id INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS league_members (
  league_id INT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (league_id, user_id)
);

-- Athlete of the day: photo + short write-up, featured on the home page.
-- Photos live in the database (Vercel has no persistent disk); they're resized in the browser first.
CREATE TABLE IF NOT EXISTS spotlights (
  id SERIAL PRIMARY KEY,
  athlete TEXT NOT NULL,
  team_id INT REFERENCES teams(id) ON DELETE SET NULL,
  event_id INT REFERENCES events(id) ON DELETE SET NULL,
  headline TEXT,
  body TEXT,
  image BYTEA,
  image_type TEXT,
  author_id INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Player photos (media day): stored in the database because Vercel has no persistent disk
ALTER TABLE players ADD COLUMN IF NOT EXISTS photo BYTEA;
ALTER TABLE players ADD COLUMN IF NOT EXISTS photo_type TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS photo_updated TIMESTAMPTZ;
