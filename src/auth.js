// Login/session handling -- zero-dependency, using only node:crypto.
//
// Passwords: scrypt with a random per-user salt (both stored as hex).
// Sessions: a signed cookie, not a server-side session table -- the cookie
// carries { uid, role, rep, market, exp } as base64url JSON plus an HMAC-SHA256
// signature, keyed by a secret.
//
// This used to be generated once and persisted to a file next to the SQLite
// database file, so it survived restarts. That doesn't work on Replit (or
// any host without a persistent local filesystem): a redeploy wipes the
// filesystem, so a file-based secret would be regenerated on every push,
// silently logging every user out. The secret now comes from the
// SESSION_SECRET environment variable instead -- set it once as a Replit
// "Secret" and it stays the same across every redeploy.
import crypto from 'node:crypto';

const SESSION_COOKIE = 'session';
const SESSION_DAYS = 30;

function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  // No env var set -- fall back to a secret that's random per process start,
  // so local development still works without any setup. This means every
  // logged-in session is invalidated whenever the process restarts, which
  // is fine for local testing but must NOT happen in production: set
  // SESSION_SECRET (e.g. `openssl rand -hex 32`) as a real environment
  // variable / Replit Secret before going live.
  console.warn(
    'WARNING: SESSION_SECRET is not set. Using a temporary secret for this ' +
    'process only -- all logged-in sessions will be invalidated on the next ' +
    'restart/redeploy. Set SESSION_SECRET as an environment variable before deploying.'
  );
  return crypto.randomBytes(32).toString('hex');
}
const SESSION_SECRET = loadSecret();

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, hash, salt) {
  if (!hash || !salt) return false;
  const candidate = crypto.scryptSync(String(password), salt, 64);
  const stored = Buffer.from(hash, 'hex');
  if (candidate.length !== stored.length) return false;
  return crypto.timingSafeEqual(candidate, stored);
}

function sign(payload) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
}

/** Builds the signed cookie value for a logged-in user. */
export function createSessionToken(user) {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({
    uid: user.id, role: user.role, rep: user.rep_label || '', name: user.display_name || user.username, market: user.market || '', exp,
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** Verifies a cookie value and returns the decoded session, or null if missing/invalid/expired/tampered. */
export function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  let session;
  try {
    session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!session.exp || Date.now() > session.exp) return null;
  return session;
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
