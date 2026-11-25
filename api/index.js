// Vercel serverless function: every /api/* request is routed here (see vercel.json).
// The React app itself is served as static files from client/dist by Vercel's CDN.
const { app } = require('../src/app');

module.exports = app;
