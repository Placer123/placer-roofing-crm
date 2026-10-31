import { esc } from '../http-helpers.js';
import { getCurrentUser } from '../request-context.js';

// Bumped by hand each time an update is packaged and shipped, and shown
// small in the footer of every page. Lets us confirm at a glance whether a
// given install is actually running the build we think it is -- useful when
// troubleshooting something that "should" be fixed but isn't showing up.
export const BUILD_STAMP = '2026-10-29 v12';

// Manager nav -- unchanged from before logins existed. A rep gets a much
// shorter one (see below): their own dashboard and their own follow-ups,
// nothing that shows every rep's data.
const MANAGER_NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/sales', label: 'Sales' },
  { href: '/projects', label: 'Projects' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/bid-calendar', label: 'Bid Calendar' },
  { href: '/customers', label: 'Customers' },
  { href: '/tasks', label: 'Follow-ups' },
  { href: '/settings/dropdowns', label: 'Dropdown Lists' },
  { href: '/settings/users', label: 'Users' },
  { href: '/settings/api-keys', label: 'API Keys' },
];

const REP_NAV = [
  { href: '/my-dashboard', label: 'My Dashboard' },
  { href: '/bid-calendar', label: 'Bid Calendar' },
  { href: '/tasks', label: 'Follow-ups' },
];

export function layout({ title, active, body, flash }) {
  const user = getCurrentUser();
  const nav = user && user.role === 'rep' ? REP_NAV : MANAGER_NAV;
  const navHtml = nav.map((item) => {
    const isActive = item.href === active;
    return `<a class="nav-link${isActive ? ' active' : ''}" href="${item.href}">${esc(item.label)}</a>`;
  }).join('');

  const flashHtml = flash ? `<div class="flash">${esc(flash)}</div>` : '';

  const userBarHtml = user ? `
    <div class="user-bar">
      <span class="muted small">${esc(user.name)}${user.role === 'rep' ? '' : ' &middot; Manager'}</span>
      <form method="post" action="/logout" style="display:inline"><button class="btn btn-tiny btn-ghost" type="submit">Log out</button></form>
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Placer Roofing CRM</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<div class="app-shell">
  <header class="topbar">
    <div class="brand">Placer Roofing <span>CRM</span></div>
    <nav class="nav">${navHtml}</nav>
    ${userBarHtml}
  </header>
  <main class="content">
    ${flashHtml}
    ${body}
  </main>
  <footer class="app-footer muted small">Build ${esc(BUILD_STAMP)}</footer>
</div>
<script src="/app.js"></script>
</body>
</html>`;
}
