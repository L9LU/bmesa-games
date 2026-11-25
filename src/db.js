// Database adapter.
// - With DATABASE_URL set (production, e.g. Neon / Render / Supabase Postgres) it uses `pg`.
// - Without it (local development) it uses PGlite, an embedded Postgres stored in ./data,
//   so you can run the app with no database install. Both speak the same SQL.
const fs = require('fs');
const path = require('path');

let impl;
let initPromise;
const LOCK_ID = 727274; // arbitrary number for pg_advisory_xact_lock

function init() {
  if (!initPromise) initPromise = connect().catch((e) => { initPromise = null; impl = null; throw e; });
  return initPromise;
}

async function connect() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const serverless = !!process.env.VERCEL;
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false },
      // Serverless: many short-lived instances, so keep each one's pool tiny (use Neon's pooled URL)
      max: serverless ? 3 : 10,
      idleTimeoutMillis: serverless ? 5000 : 30000,
    });
    impl = {
      query: (text, params) => pool.query(text, params),
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn({ query: (t, p) => client.query(t, p) });
          await client.query('COMMIT');
          return result;
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      },
      exec: (sql) => pool.query(sql),
      close: () => pool.end(),
      // Run fn while holding a database-wide lock, so parallel instances take turns
      locked: (fn) => impl.tx(async (t) => { await t.query(`SELECT pg_advisory_xact_lock(${LOCK_ID})`); return fn(t.query); }),
    };
    await impl.locked((q) => q(schema));
    return impl;
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = process.env.PGLITE_DIR || path.join(__dirname, '..', 'data');
    fs.mkdirSync(dir, { recursive: true });
    const db = new PGlite(dir);
    await db.waitReady;
    impl = {
      query: (text, params) => db.query(text, params),
      tx: (fn) => db.transaction((tx) => fn({ query: (t, p) => tx.query(t, p) })),
      exec: (sql) => db.exec(sql),
      close: () => db.close(),
      locked: (fn) => fn((t, p) => db.query(t, p)), // single local process: no lock needed
    };
    await impl.exec(schema);
    return impl;
  }
}

module.exports = {
  init,
  query: (t, p) => impl.query(t, p),
  tx: (fn) => impl.tx(fn),
  locked: (fn) => impl.locked(fn),
  close: () => impl && impl.close(),
};
