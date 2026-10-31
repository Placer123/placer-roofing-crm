// Small hand-rolled helpers so the app has zero external dependencies.

export function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
  });
  res.end(html);
}

export function sendRedirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

export async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error('Invalid JSON body');
    err.statusCode = 400;
    throw err;
  }
}

/**
 * Parses application/x-www-form-urlencoded bodies (used by plain HTML forms).
 * A field that appears more than once (e.g. a <select multiple>) comes back
 * as an array; every other field stays a plain string, same as before.
 */
export async function readFormBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  const params = new URLSearchParams(raw);
  const body = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    body[key] = values.length > 1 ? values : values[0];
  }
  return body;
}

/**
 * Reads a raw request body into a single Buffer -- used for uploaded files,
 * which are sent as the bare request body (no multipart parsing needed since
 * the browser only ever sends one file per request here). Rejects once the
 * body exceeds maxBytes so a huge drop can't exhaust memory.
 */
export async function readRawBody(req, maxBytes = 25 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const err = new Error(`File is too large (limit ${Math.floor(maxBytes / (1024 * 1024))}MB)`);
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Parses the Cookie request header into a plain object. */
export function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) {
      try { out[key] = decodeURIComponent(value); } catch { out[key] = value; }
    }
  });
  return out;
}

/**
 * Sets a simple, long-lived cookie -- used to remember the Dashboard's filter
 * selections across page navigations (so flipping between tabs doesn't reset
 * them back to defaults). Stacks onto any Set-Cookie header already queued
 * on the response instead of clobbering it.
 */
export function setCookie(res, name, value, { maxAgeDays = 365 } = {}) {
  const existing = res.getHeader('Set-Cookie');
  const cookieStr = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${Math.max(0, Math.floor(maxAgeDays * 24 * 60 * 60))}; SameSite=Lax`;
  const next = existing ? [...(Array.isArray(existing) ? existing : [existing]), cookieStr] : [cookieStr];
  res.setHeader('Set-Cookie', next);
}

/** Escapes text for safe interpolation into HTML. */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
