import { esc } from '../http-helpers.js';
import { layout } from './layout.js';

function customerName(t) {
  const name = [t.first_name, t.last_name].filter(Boolean).join(' ');
  return name || t.company_name || (t.customer_id ? `Customer #${t.customer_id}` : '');
}

export function renderTasks({ items, query, isRepView, flash }) {
  const rows = items.map((t) => {
    const hasProject = Boolean(t.bid_project_name && t.bid_project_name.trim());
    // Job name is the clickable thing here, not the customer -- see the
    // same change on My Dashboard (repDashboard.js) for why. Falls back to
    // the customer link when there's no bid to send them to.
    const jobLinked = hasProject && Boolean(t.bid_id);
    const jobCell = jobLinked
      ? `<a href="/bids/${t.bid_id}/edit">${esc(t.bid_project_name)}</a><div class="muted small">${esc(t.title)}</div>`
      : esc(t.title);
    const customerCell = !t.customer_id ? '&mdash;'
      : jobLinked ? esc(customerName(t))
      : `<a href="/customers/${t.customer_id}">${esc(customerName(t))}</a>`;
    return `
    <tr class="${t.status === 'done' ? 'row-done' : ''}">
      <td>
        ${jobCell}
        ${t.description ? `<div class="muted">${esc(t.description)}</div>` : ''}
        ${t.email_sent ? '<span class="badge-email-sent">Email sent</span>' : ''}
        <details class="task-notes">
          <summary>Notes${t.notes ? ' &middot; ' + esc(t.notes.slice(0, 40)) + (t.notes.length > 40 ? '&hellip;' : '') : ''}</summary>
          <form method="post" action="/tasks/${t.id}/notes" class="task-notes-form">
            <textarea name="notes" rows="2" placeholder="Follow-up notes...">${esc(t.notes)}</textarea>
            <label class="checkbox-label"><input type="checkbox" name="email_sent" value="1"${t.email_sent ? ' checked' : ''}> Email sent</label>
            <button class="btn btn-tiny" type="submit">Save notes</button>
          </form>
        </details>
      </td>
      <td>${customerCell}</td>
      <td>${esc(t.due_date) || '&mdash;'}</td>
      <td>${esc(t.assigned_to) || '&mdash;'}</td>
      <td>${t.status === 'done' ? 'Done' : 'Open'}</td>
      <td>
        <form method="post" action="/tasks/${t.id}/toggle" style="display:inline">
          <button class="btn btn-tiny" type="submit">${t.status === 'done' ? 'Reopen' : 'Mark done'}</button>
        </form>
        <form method="post" action="/tasks/${t.id}/delete" style="display:inline" onsubmit="return confirm('Delete this task?')">
          <button class="btn btn-tiny btn-danger" type="submit">Delete</button>
        </form>
        ${t.status === 'done' ? `
        <form method="post" action="/tasks/${t.id}/follow-up" class="next-followup-form">
          <input type="date" name="due_date" required>
          <button class="btn btn-tiny" type="submit">+ Next follow-up</button>
        </form>` : ''}
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" class="empty">No follow-up tasks match.</td></tr>';

  const body = `
    <div class="page-header">
      <h1>Follow-up Tasks</h1>
    </div>
    <p class="muted small">Follow-ups are mandatory: a task can't be marked done until it has a note, "Email sent" is checked, or the linked project has been marked Won/Lost. Completing one for a still-open project automatically schedules the next one at that contract type's follow-up cadence (set in Dropdown Lists).</p>
    <form class="filter-bar" method="get" action="/tasks">
      <select name="status">
        <option value="">All statuses</option>
        <option value="open"${query.status === 'open' ? ' selected' : ''}>Open</option>
        <option value="done"${query.status === 'done' ? ' selected' : ''}>Done</option>
      </select>
      ${isRepView ? '' : `<input type="text" name="assigned_to" placeholder="Assigned rep" value="${esc(query.assigned_to)}">`}
      <button class="btn" type="submit">Filter</button>
      <a class="btn btn-ghost" href="/tasks">Reset</a>
    </form>
    <table class="data-table">
      <thead><tr><th>Task</th><th>Customer</th><th>Due</th><th>Rep</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  return layout({ title: 'Follow-up Tasks', active: '/tasks', body, flash });
}
