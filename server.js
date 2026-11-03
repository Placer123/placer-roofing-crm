import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Router } from './src/router.js';
import { sendHtml, sendJson, parseCookies, sendRedirect } from './src/http-helpers.js';
import { registerUiRoutes } from './src/ui-routes.js';
import { registerAuthRoutes } from './src/auth-routes.js';
import { registerApiV1 } from './src/api/v1.js';
import './src/db.js'; // ensures schema is created on boot
import { seedDefaults, ensureDefaultItem, ensureWeight2Default } from './src/models/picklists.js';
import { verifySessionToken, SESSION_COOKIE_NAME } from './src/auth.js';
import * as Users from './src/models/users.js';
import { als } from './src/request-context.js';

await seedDefaults(); // populates default dropdown values the first time this runs
// Added after Contract Type's initial defaults shipped -- ensureDefaultItem
// (unlike seedDefaults) still adds it even on a database that already has
// Reroof/New Construction seeded.
await ensureDefaultItem('contract_type', 'Service', 90);
// Backfills a starting follow-up cadence onto contract types created before
// that field existed -- never overwrites one already set.
await ensureWeight2Default('contract_type', 'Reroof', 3);
await ensureWeight2Default('contract_type', 'New Construction', 7);
await ensureWeight2Default('contract_type', 'Service', 7);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const STATIC_FILES = {
  '/styles.css': { file: 'public/styles.css', type: 'text/css; charset=utf-8' },
  '/app.js': { file: 'public/app.js', type: 'application/javascript; charset=utf-8' },
};

const router = new Router();
registerAuthRoutes(router);
registerUiRoutes(router);
registerApiV1(router);

// Paths reachable with no session at all -- the login/setup flow itself,
// plus the external JSON API, which already does its own X-API-Key auth in
// src/apiAuth.js and was never gated by a browser login.
function isPublicPath(pathname) {
  return pathname === '/login' || pathname === '/setup' || pathname === '/logout' || pathname.startsWith('/api/');
}

// Aggregate/"everyone's data" pages that only a manager (Chris/Josh) should
// see -- a rep is redirected to their own dashboard instead. Record-specific
// pages a rep reaches from their own dashboard (a customer, a bid, an ITB,
// their own follow-ups) are NOT in this list; those are guarded individually
// in ui-routes.js with an ownership check instead, since "manager-only" isn't
// right for them -- "yours only" is. Bid Calendar is also excluded -- it's a
// shared team scheduling view (every rep's ITBs, color-coded), and reps need
// it to see and manage their own bids-to-be; editing/deleting an ITB is still
// gated to its own assigned rep via the ownership checks in ui-routes.js.
function isManagerOnlyPath(method, pathname) {
  if (pathname.startsWith('/settings')) return true;
  if (method !== 'GET') return false;
  return pathname === '/' || pathname === '/sales' || pathname === '/pipeline'
    || pathname === '/projects' || pathname === '/customers'
    || pathname === '/documents';
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    // A repeated key (e.g. a <select multiple name="months"> submitted via
    // GET) comes back as an array; every other field stays a plain string,
    // same convention as readFormBody uses for POST bodies.
    const query = {};
    for (const key of new Set(url.searchParams.keys())) {
      const values = url.searchParams.getAll(key);
      query[key] = values.length > 1 ? values : values[0];
    }

    // CORS for the external API, so a browser-based app on another origin can call it.
    if (pathname.startsWith('/api/')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
      }
    }

    const staticEntry = STATIC_FILES[pathname];
    if (staticEntry && req.method === 'GET') {
      const filePath = path.join(__dirname, staticEntry.file);
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': staticEntry.type, 'Content-Length': content.length });
      return res.end(content);
    }

    const match = router.match(req.method, pathname);
    if (!match) {
      if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });
      return sendHtml(res, 404, '<h1>404 - Not found</h1><p><a href="/">Back to dashboard</a></p>');
    }

    if (isPublicPath(pathname)) {
      await match.handler(req, res, match.params, query);
      return;
    }

    // Every other UI page needs a logged-in user. A brand-new install (no
    // users yet, e.g. right after unzipping this update over an older
    // version) gets sent to /setup to create the first manager account
    // instead of being locked out with no way in.
    if ((await Users.countUsers()) === 0) {
      return sendRedirect(res, '/setup');
    }
    const cookies = parseCookies(req);
    const session = verifySessionToken(cookies[SESSION_COOKIE_NAME]);
    if (!session) {
      return sendRedirect(res, `/login?next=${encodeURIComponent(pathname)}`);
    }
    if (session.role === 'rep' && isManagerOnlyPath(req.method, pathname)) {
      return sendRedirect(res, '/my-dashboard');
    }

    const user = { id: session.uid, role: session.role, rep: session.rep, name: session.name, market: session.market || '' };
    await als.run({ user }, () => match.handler(req, res, match.params, query));
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      if (req.url.startsWith('/api/')) sendJson(res, 500, { error: 'Internal server error' });
      else sendHtml(res, 500, `<h1>500 - Internal server error</h1><pre>${err.stack || err.message}</pre>`);
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Placer Roofing CRM running at http://localhost:${PORT}`);
});
