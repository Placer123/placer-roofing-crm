import { sendHtml, sendRedirect, readFormBody, setCookie } from './http-helpers.js';
import { renderLogin, renderSetup } from './pages/auth.js';
import { createSessionToken, SESSION_COOKIE_NAME } from './auth.js';
import * as Users from './models/users.js';

function clearSessionCookie(res) {
  setCookie(res, SESSION_COOKIE_NAME, '', { maxAgeDays: 0 });
}

function setSessionCookie(res, user) {
  setCookie(res, SESSION_COOKIE_NAME, createSessionToken(user), { maxAgeDays: 30 });
}

/** Where a freshly-logged-in user lands, based on role. */
function homeFor(user) {
  return user.role === 'manager' ? '/' : '/my-dashboard';
}

export function registerAuthRoutes(router) {
  router.get('/setup', async (req, res, params, query) => {
    if ((await Users.countUsers()) > 0) return sendRedirect(res, '/login');
    sendHtml(res, 200, renderSetup({ error: query.error }));
  });

  router.post('/setup', async (req, res) => {
    if ((await Users.countUsers()) > 0) return sendRedirect(res, '/login');
    const body = await readFormBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!username || password.length < 6 || !body.display_name) {
      return sendHtml(res, 200, renderSetup({ error: 'Fill in your name, a username, and a password (6+ characters).' }));
    }
    const user = await Users.createUser({ username, password, displayName: body.display_name, role: 'manager' });
    setSessionCookie(res, user);
    sendRedirect(res, '/');
  });

  router.get('/login', async (req, res, params, query) => {
    if ((await Users.countUsers()) === 0) return sendRedirect(res, '/setup');
    sendHtml(res, 200, renderLogin({ error: query.error, next: query.next }));
  });

  router.post('/login', async (req, res) => {
    const body = await readFormBody(req);
    const user = await Users.verifyLogin(body.username, body.password);
    if (!user) {
      return sendHtml(res, 200, renderLogin({ error: 'Incorrect username or password.', next: body.next }));
    }
    setSessionCookie(res, user);
    const next = body.next && body.next.startsWith('/') ? body.next : homeFor(user);
    sendRedirect(res, next);
  });

  router.post('/logout', async (req, res) => {
    clearSessionCookie(res);
    sendRedirect(res, '/login');
  });
}
