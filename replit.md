# Running the imported CRM

- Keep the existing plain Node.js server, server-rendered pages, and vendored
  PostgreSQL driver. No npm dependencies or frontend build are required.
- Runtime: Node.js 22.5+ (the project is configured with Node.js 22).
- Click **Run** to start the `Start application` workflow:
  `PORT=5000 npm run dev`.
- The HTTP server listens on `0.0.0.0`; the Replit preview uses port 5000.
- `DATABASE_URL` is provided by the Replit PostgreSQL database. `SESSION_SECRET`
  is configured in Secrets. Do not copy values into files or logs.
- The existing server initializes schema and default dropdowns at startup.
  Do not run `seed-demo` unless sample customer data is explicitly requested.
- On an empty database, visit the preview to create the first manager account
  at `/setup`. Once an account exists, users sign in at `/login`.
- The README's original SQLite instructions are historical: the current code
  requires PostgreSQL, not a local SQLite file.

## Verification

- Check JavaScript syntax with `node --check server.js`.
- Start the workflow and confirm `/` redirects to the setup/login flow.
- Confirm `/setup` or `/login` renders in preview, `/styles.css` and `/app.js`
  load, and unauthenticated `/api/v1/customers` requests are rejected.
- Do not bypass authentication or create a permanent account for verification.
  Signed-in CRM screens need separate authenticated testing.

## After task merges

- `scripts/post-merge.sh` checks the Node.js version and JavaScript syntax.
  No dependency installation or build is needed for the current stack.
- The platform then reconciles workflows and restarts the running app.
- The setup script does not seed data or run database-changing tests.
