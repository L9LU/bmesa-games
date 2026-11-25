// Long-running server: used locally (`npm start`) and on Render.
// Serves the API from src/app.js plus the built React app from client/dist.
const path = require('path');
const express = require('express');
const { app, ready } = require('./app');

const PORT = process.env.PORT || 3000;
const DIST = path.join(__dirname, '..', 'client', 'dist');

const server = express();
server.use(app); // /api/* — unmatched non-API requests fall through to the frontend below
server.use(express.static(DIST, { index: false, redirect: false, maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
server.get('*', (req, res) => res.sendFile(path.join(DIST, 'index.html'), (err) => {
  if (err) res.status(500).send('Frontend not built yet. Run: npm run build');
}));

ready()
  .then(() => server.listen(PORT, () => console.log(`BMESA Games running on http://localhost:${PORT}`)))
  .catch((e) => { console.error(e); process.exit(1); });
