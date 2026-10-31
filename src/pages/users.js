import { esc } from '../http-helpers.js';
import { layout } from './layout.js';
import { pickSelect, marketSelect } from './form-helpers.js';

export function renderUsers({ users, reps, flash }) {
  const repItems = reps.map((r) => ({ label: r }));

  const rows = users.map((u) => `
    <tr>
      <td>${esc(u.display_name)}</td>
      <td>${esc(u.username)}</td>
      <td>${u.role === 'manager' ? 'Manager' : 'Rep'}</td>
      <td>${u.role === 'rep' ? (esc(u.rep_label) || '<span class="muted">not linked</span>') : '&mdash;'}</td>
      <td>
        <form method="post" action="/settings/users/${u.id}/market" class="inline-form market-form" style="margin:0">
          ${marketSelect({ current: u.market })}
          <noscript><button class="btn btn-tiny" type="submit">Save</button></noscript>
        </form>
      </td>
      <td>
        <details>
          <summary class="btn btn-tiny">Reset password</summary>
          <form method="post" action="/settings/users/${u.id}/password" class="inline-form" style="margin-top:0.4rem">
            <input type="password" name="password" placeholder="New password" required minlength="6">
            <button class="btn btn-tiny" type="submit">Save</button>
          </form>
        </details>
      </td>
      <td>
        <form method="post" action="/settings/users/${u.id}/delete" onsubmit="return confirm('Delete this login? They will no longer be able to log in.')">
          <button class="btn btn-tiny btn-danger" type="submit">Delete</button>
        </form>
      </td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty">No logins yet.</td></tr>';

  const body = `
    <div class="page-header">
      <h1>Users</h1>
    </div>
    <p class="muted">Manager logins see everything (same as before this page existed). A Rep login is scoped to one person&rsquo;s own book of business, matched by the Sales Rep name linked below &mdash; their bids, ITBs, and follow-ups need to use that same name for this to work.</p>
    <p class="muted small">Region is which territory (AZ/CA) that login's dashboard defaults to &mdash; they can still switch to the other region or "combined" from the filter any time, this just sets the starting view. A change here takes effect the next time that person logs in.</p>

    <table class="data-table">
      <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Linked Rep</th><th>Region</th><th></th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="card" style="margin-top:1.5rem;max-width:480px">
      <h3>Add a login</h3>
      <form method="post" action="/settings/users" class="form-grid">
        <label class="full-width">Name<input type="text" name="display_name" required></label>
        <label class="full-width">Username<input type="text" name="username" required></label>
        <label class="full-width">Password<input type="password" name="password" required minlength="6"></label>
        <label class="full-width">Role
          <select name="role" id="new-user-role">
            <option value="rep">Rep</option>
            <option value="manager">Manager</option>
          </select>
        </label>
        <label class="full-width" id="new-user-rep-label-wrap">Linked Sales Rep ${pickSelect({ name: 'rep_label', items: repItems, current: '', placeholder: '-- select rep --' })}</label>
        <label class="full-width">Region ${marketSelect({ current: 'CA' })}</label>
        <div class="full-width form-actions">
          <button class="btn btn-primary" type="submit">Create login</button>
        </div>
      </form>
    </div>
    <script>
      (function() {
        var roleSelect = document.getElementById('new-user-role');
        var repWrap = document.getElementById('new-user-rep-label-wrap');
        function sync() { repWrap.style.display = roleSelect.value === 'manager' ? 'none' : ''; }
        roleSelect.addEventListener('change', sync);
        sync();
      })();
      // Auto-save the Region select the moment it's changed -- no separate
      // Save button needed when JS is available (the <noscript> button
      // above covers the rare case it's disabled).
      document.querySelectorAll('.market-form select[name="market"]').forEach(function(sel) {
        sel.addEventListener('change', function() { sel.form.submit(); });
      });
    </script>
  `;
  return layout({ title: 'Users', active: '/settings/users', body, flash });
}
