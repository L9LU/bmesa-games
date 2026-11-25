// Usage: npm run make-admin -- someone@example.com [organiser|admin]
const db = require('./db');

(async () => {
  const [email, role = 'admin'] = process.argv.slice(2);
  if (!email || !['admin', 'organiser', 'user'].includes(role)) {
    console.log('Usage: npm run make-admin -- <email> [admin|organiser|user]');
    process.exit(1);
  }
  await db.init();
  const r = await db.query('UPDATE users SET role = $1 WHERE lower(email) = lower($2) RETURNING name', [role, email]);
  console.log(r.rows.length ? `${r.rows[0].name} is now ${role}.` : `No user with email ${email}. Sign up on the site first.`);
  await db.close();
})();
