import postgres from './vendor/postgres-js/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// Postgres now, not a local SQLite file -- this app used to be zero-npm-
// dependency, file-based SQLite (node:sqlite) specifically so it could run
// anywhere with nothing to install and nothing to stand up. That stopped
// being compatible with the goal of hosting this somewhere multiple people
// can reach it and pushing updates to it frequently: every hosting platform
// that fits that (Replit included) wipes whatever's on local disk on every
// redeploy, which would mean wiping the entire database on every single
// code push. A real database server survives that. The driver is still
// vendored plain JS with zero npm dependencies of its own (see
// src/vendor/postgres-js/VENDORED.md) -- there's still no node_modules to
// manage, just one more folder of plain .js files alongside everything else
// in src/.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Point it at a Postgres database, e.g. ' +
    'postgres://user:password@host:5432/dbname (Replit\'s managed Postgres ' +
    'database provides this automatically once you add one to your app).'
  );
}

export const sql = postgres(connectionString, {
  max: 10,
  // Works against both a local/dev Postgres with no SSL and a hosted one
  // that requires it, without needing separate config for each.
  ssl: 'prefer',
  // Every boot re-runs schema.sql and every ensureColumn -- harmless (all
  // of it is IF NOT EXISTS / ADD COLUMN IF NOT EXISTS), but Postgres logs a
  // NOTICE for each "already exists, skipping", which would otherwise spam
  // the logs on every single restart once the schema already exists.
  onnotice: () => {},
  // Postgres returns COUNT(*) and similar bigint columns (type oid 20) as
  // plain strings by default, to avoid silent precision loss on counts
  // bigger than Number.MAX_SAFE_INTEGER. SQLite never did this -- a count
  // was always a plain JS number -- and several call sites rely on that:
  // Users.countUsers() === 0 (the brand-new-install check that sends a
  // fresh deploy to /setup) is a strict-equality comparison that silently
  // and permanently fails against the string "0". This app's counts will
  // never get anywhere near the precision ceiling, so parsing bigint as a
  // normal number here matches the old behavior and avoids that entire
  // class of string-vs-number bug.
  types: {
    bigint: {
      to: 20,
      from: [20],
      parse: (x) => parseInt(x, 10),
      serialize: (x) => String(x),
    },
  },
});

/**
 * Every model file was written against SQLite and still reads that way on
 * purpose -- '?' placeholders, datetime('now'), strftime(), date(), LIKE --
 * rather than being hand-converted query by query (150+ call sites across
 * 10 files) when this moved to Postgres. Instead, every query text passes
 * through here first, which mechanically rewrites just the handful of
 * SQLite-specific bits Postgres doesn't understand into their Postgres
 * equivalent. None of these are judgment calls -- each one means exactly
 * the same thing in every query it appears in, in this codebase:
 *
 * - '?' positional placeholders -> '$1, $2, ...' (Postgres's placeholder
 *   syntax). Safe as a blind count-and-replace because this codebase never
 *   puts a literal '?' character in a query string itself -- every value is
 *   always passed as a bind parameter, never inlined.
 * - datetime('now') -> an inline Postgres expression producing the exact
 *   same 'YYYY-MM-DD HH:MM:SS' UTC text SQLite's datetime('now') produced,
 *   so every created_at/updated_at value, and every string comparison or
 *   sort against one, keeps working unchanged.
 * - strftime('%Y-%m', x) -> substring(x, 1, 7) -- every date/datetime value
 *   in this app is already stored as that exact text shape, so pulling the
 *   first 7 characters ('YYYY-MM') does the same job as asking SQLite to
 *   format it, without needing Postgres to parse the text as a real date
 *   (which would error on an empty string -- substring doesn't).
 * - date(x) -> substring(x, 1, 10) -- same reasoning, for 'YYYY-MM-DD'.
 *   Deliberately only matches the single-argument form (a bare column
 *   name/reference with no comma inside the parens) -- the one place this
 *   codebase calls the two-argument SQLite form, date(x, '+N days') doing
 *   date arithmetic, is hand-converted directly in models/bids.js instead,
 *   since that one has no single generic Postgres equivalent worth
 *   pattern-matching for.
 * - LIKE -> ILIKE -- SQLite's LIKE is case-insensitive for plain ASCII by
 *   default; Postgres's isn't. Every LIKE in this app is a search box, where
 *   case-insensitive is the only behavior that's ever made sense here.
 * - An INSERT with no RETURNING clause gets ' RETURNING id' appended, so
 *   run() can report back the new row's id the same way SQLite's
 *   lastInsertRowid did automatically -- Postgres has no equivalent
 *   auto-tracking, so this is the only way to get it without adding
 *   RETURNING id by hand to every INSERT in every model file.
 */
function translate(sqlText) {
  let out = sqlText;
  out = out.replaceAll("datetime('now')", "to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')");
  out = out.replace(/strftime\('%Y-%m',\s*([a-zA-Z0-9_.]+)\)/g, 'substring($1, 1, 7)');
  out = out.replace(/\bdate\(([a-zA-Z0-9_.]+)\)/g, 'substring($1, 1, 10)');
  out = out.replace(/\bLIKE\b/g, 'ILIKE');
  if (/^\s*INSERT\b/i.test(out) && !/\bRETURNING\b/i.test(out)) out += ' RETURNING id';
  let i = 0;
  out = out.replace(/\?/g, () => `$${++i}`);
  return out;
}

/** Run a query and return all rows as plain objects. */
export async function all(sqlText, params = []) {
  return sql.unsafe(translate(sqlText), params);
}

/** Run a query and return the first row (or undefined). */
export async function get(sqlText, params = []) {
  const rows = await sql.unsafe(translate(sqlText), params);
  return rows[0];
}

/** Run an insert/update/delete statement. Returns { changes, lastInsertRowid }. */
export async function run(sqlText, params = []) {
  const rows = await sql.unsafe(translate(sqlText), params);
  return { changes: rows.count, lastInsertRowid: rows[0]?.id };
}

/**
 * Adds a column to an existing table if it's not already there. Postgres
 * (unlike SQLite) supports ADD COLUMN IF NOT EXISTS directly, so unlike the
 * old SQLite version of this helper, there's no need to check first --
 * this is just always safe to run on every boot.
 */
async function ensureColumn(table, column, definition) {
  await sql.unsafe(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
}

const schemaPath = path.join(__dirname, 'schema.sql');

async function init() {
  await sql.unsafe(fs.readFileSync(schemaPath, 'utf8'));

  // Which state's book of business a record belongs to (see MARKETS in
  // constants.js) -- added once the company started bidding Arizona work
  // alongside its existing California book. Backfilled to 'CA' rather than
  // left blank so nothing already in the database silently vanishes from
  // both the "CA" and "AZ" filtered views the moment this ships.
  await ensureColumn('bids', 'market', "TEXT DEFAULT ''");
  await ensureColumn('itbs', 'market', "TEXT DEFAULT ''");
  await ensureColumn('customers', 'market', "TEXT DEFAULT ''");
  await sql.unsafe("UPDATE bids SET market = 'CA' WHERE market IS NULL OR market = '';");
  await sql.unsafe("UPDATE itbs SET market = 'CA' WHERE market IS NULL OR market = '';");
  await sql.unsafe("UPDATE customers SET market = 'CA' WHERE market IS NULL OR market = '';");

  // Same idea, but for which territory a *user* (login) belongs to, so their
  // dashboard can default to showing just their own region instead of
  // everything combined.
  await ensureColumn('users', 'market', "TEXT DEFAULT ''");
  await sql.unsafe("UPDATE users SET market = 'CA' WHERE market IS NULL OR market = '';");

  /**
   * One-time cleanup for a bug where a bid could end up with more than one
   * open follow-up task at once (e.g. completing one auto-scheduled the
   * next, but a manual "+ Next follow-up" or "Reopen" could still add a
   * second) -- from the dashboard this looked like a just-completed
   * follow-up "never went away", when really a different, older open task
   * for the same bid was still sitting there. For every bid with more than
   * one open task, keeps only the one due soonest (if overdue, that's the
   * one that most needs attention) and marks the rest done. Safe to run on
   * every boot: once every task-creating path enforces one-open-per-bid
   * itself (see closeOtherOpenTasksForBid in models/tasks.js), there's
   * nothing left here for it to find.
   */
  const dupeBidIds = await sql.unsafe(`
    SELECT bid_id FROM tasks
    WHERE status = 'open' AND bid_id IS NOT NULL
    GROUP BY bid_id HAVING COUNT(*) > 1
  `);
  for (const { bid_id } of dupeBidIds) {
    const openForBid = await sql.unsafe(
      `SELECT id FROM tasks WHERE bid_id = $1 AND status = 'open' ORDER BY (due_date = '') ASC, due_date ASC, id ASC`,
      [bid_id]
    );
    for (const { id } of openForBid.slice(1)) {
      await sql.unsafe("UPDATE tasks SET status = 'done', updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') WHERE id = $1", [id]);
    }
  }
}

// Node 22 ESM supports top-level await -- anything that imports this module
// (directly or indirectly, e.g. server.js importing ui-routes.js importing
// a model importing this) automatically waits for init() to finish before
// it can run, the same guarantee the old synchronous SQLite setup gave for
// free. No caller needs to know or do anything differently.
await init();

export default sql;
