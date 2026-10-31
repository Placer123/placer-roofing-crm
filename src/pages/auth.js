import { esc } from '../http-helpers.js';

// Login/setup pages intentionally don't use layout() -- there's no nav to
// show someone who isn't logged in yet (or, for /setup, before any account
// even exists), so these are small standalone pages instead.
function authShell(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Placer Roofing CRM</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<div class="auth-shell">
  <div class="auth-card card">
    <div class="brand">Placer Roofing <span>CRM</span></div>
    ${body}
  </div>
</div>
</body>
</html>`;
}

export function renderLogin({ error, next }) {
  const body = `
    <h1>Log in</h1>
    ${error ? `<div class="flash flash-error">${esc(error)}</div>` : ''}
    <form method="post" action="/login" class="form-grid">
      <input type="hidden" name="next" value="${esc(next || '')}">
      <label class="full-width">Username
        <input type="text" name="username" autofocus required>
      </label>
      <label class="full-width">Password
        <input type="password" name="password" required>
      </label>
      <div class="full-width form-actions">
        <button class="btn btn-primary" type="submit">Log in</button>
      </div>
    </form>
  `;
  return authShell('Log in', body);
}

export function renderSetup({ error }) {
  const body = `
    <h1>Create the first manager account</h1>
    <p class="muted">This install has no logins yet. Create the manager account you'll use going forward &mdash; you can add rep logins afterward from Dropdown Lists &rarr; Users.</p>
    ${error ? `<div class="flash flash-error">${esc(error)}</div>` : ''}
    <form method="post" action="/setup" class="form-grid">
      <label class="full-width">Your name
        <input type="text" name="display_name" placeholder="Josh Watson" required>
      </label>
      <label class="full-width">Username
        <input type="text" name="username" autofocus required>
      </label>
      <label class="full-width">Password
        <input type="password" name="password" required minlength="6">
      </label>
      <div class="full-width form-actions">
        <button class="btn btn-primary" type="submit">Create account &amp; log in</button>
      </div>
    </form>
  `;
  return authShell('Set up', body);
}
