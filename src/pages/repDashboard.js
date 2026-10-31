import { esc } from '../http-helpers.js';
import { layout } from './layout.js';
import { money, pct, projectLabel, bidCustomerName, dashFilterOptions, marketFilterSelect } from './form-helpers.js';

function taskRowHtml(t, todayStr) {
  const isPastDue = Boolean(t.due_date) && t.due_date < todayStr;
  const hasProject = Boolean(t.bid_project_name && t.bid_project_name.trim());
  const customerName = [t.first_name, t.last_name].filter(Boolean).join(' ') || t.company_name || '';
  // The job/project name is the clickable thing here, not the customer --
  // it's what a rep actually recognizes a follow-up by, and it's what takes
  // them to the bid (where they'd go to work the follow-up anyway). Only
  // links when there's an actual bid to go to; a task with no linked
  // project (rare -- an old or manually-added one) falls back to the plain
  // title text, same as before.
  const jobLinked = hasProject && Boolean(t.bid_id);
  const jobCell = jobLinked
    ? `<a href="/bids/${t.bid_id}/edit">${esc(t.bid_project_name)}</a><div class="muted small">${esc(t.title)}</div>`
    : esc(t.title);
  // Only one link per row: the job name when there's a bid to send them to,
  // otherwise the customer (same as before this change) so a task with no
  // linked project still has somewhere to click through to.
  const customerCell = !t.customer_id ? '&mdash;'
    : jobLinked ? esc(customerName || `#${t.customer_id}`)
    : `<a href="/customers/${t.customer_id}">${esc(customerName || '#' + t.customer_id)}</a>`;
  return `
    <tr class="${isPastDue ? 'row-past-due' : ''}">
      <td>
        ${jobCell}
        ${t.email_sent ? '<span class="badge-email-sent">Email sent</span>' : ''}
        <details class="task-notes">
          <summary>Notes${t.notes ? ' &middot; ' + esc(t.notes.slice(0, 40)) + (t.notes.length > 40 ? '&hellip;' : '') : ''}</summary>
          <form method="post" action="/tasks/${t.id}/notes" class="task-notes-form">
            <textarea name="notes" rows="2" placeholder="What happened -- phone call, voicemail, email sent...">${esc(t.notes)}</textarea>
            <label class="checkbox-label"><input type="checkbox" name="email_sent" value="1"${t.email_sent ? ' checked' : ''}> Email sent</label>
            <button class="btn btn-tiny" type="submit">Save notes</button>
          </form>
        </details>
      </td>
      <td>${customerCell}</td>
      <td>${isPastDue ? `<strong class="text-danger">${esc(t.due_date)}</strong>` : (esc(t.due_date) || '&mdash;')}</td>
      <td>
        <form method="post" action="/tasks/${t.id}/toggle" style="display:inline">
          <button class="btn btn-tiny" type="submit">Mark done</button>
        </form>
      </td>
    </tr>`;
}

export function renderRepDashboard({ user, salesStats, killRatio, openTasks, upcomingItbs, pipelineBids, query, flash }) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const pastDue = openTasks.filter((t) => t.due_date && t.due_date < todayStr);
  const selectedFilters = Array.isArray(query.dash_filter) ? query.dash_filter : (query.dash_filter ? [query.dash_filter] : []);

  const taskRows = openTasks.map((t) => taskRowHtml(t, todayStr)).join('')
    || '<tr><td colspan="4" class="empty">No open follow-ups. Nice work.</td></tr>';

  const upcomingHtml = upcomingItbs.map((itb) => `
    <div class="upcoming-item">
      <div><strong>${esc(itb.project_name)}</strong></div>
      <div class="muted small">${esc(itb.due_date)} &middot; ${esc(itb.customer_names) || 'No GC yet'}</div>
      <div class="muted small">${esc(itb.status || 'New')}</div>
      <a class="btn btn-tiny" href="/bid-calendar/itbs/${itb.id}/edit">Open</a>
    </div>
  `).join('') || '<p class="muted small">Nothing upcoming.</p>';

  const totalWeighted = pipelineBids.reduce((sum, b) => sum + (b.weighted_value || 0), 0);
  const totalPrice = pipelineBids.reduce((sum, b) => sum + (b.price || 0), 0);
  const pipelineRows = pipelineBids.map((b) => `
    <tr>
      <td>
        <a href="/bids/${b.id}/edit">${esc(projectLabel(b))}</a>
        <div class="muted small">${esc(bidCustomerName(b))}</div>
      </td>
      <td>${money(b.price)}</td>
      <td>${esc(b.sales_status)} ${b.probability !== null ? `(${pct(b.probability)})` : ''}</td>
      <td>${esc(b.expected_close_date) || '&mdash;'}</td>
      <td><strong>${money(b.weighted_value)}</strong></td>
    </tr>`).join('') || '<tr><td colspan="5" class="empty">No open bids right now.</td></tr>';

  const killRatioDisplay = killRatio.ratio === null ? '&mdash;' : `${killRatio.ratio.toFixed(0)}%`;
  const killRatioDollarDisplay = killRatio.dollarRatio === null ? '&mdash;' : `${killRatio.dollarRatio.toFixed(0)}%`;

  const body = `
    <div class="page-header">
      <h1>My Dashboard</h1>
    </div>
    <p class="muted">Hi ${esc(user.name)} &mdash; this is your own book of business: your open bids, your pipeline, and your follow-ups.</p>

    <div class="stat-grid">
      <div class="stat-card"><div class="stat-value">${pastDue.length}</div><div class="stat-label">Past Due Follow-ups</div></div>
      <div class="stat-card"><div class="stat-value">${pipelineBids.length}</div><div class="stat-label">Open Pipeline Bids</div></div>
      <div class="stat-card"><div class="stat-value">${money(totalWeighted)}</div><div class="stat-label">Weighted Forecast</div></div>
      <div class="stat-card"><div class="stat-value">${killRatioDisplay}</div><div class="stat-label">Kill Ratio</div><div class="stat-sub">${killRatio.won} won / ${killRatio.total} total</div></div>
    </div>

    <div class="section-heading">
      <h3>Sales Info</h3>
    </div>
    <form class="filter-bar" method="get" action="/my-dashboard">
      <input type="hidden" name="dash_submit" value="1">
      <select name="dash_filter" multiple size="1" class="months-multi" title="Pick a quick range, or Cmd/Ctrl-click one or more months">
        ${dashFilterOptions(selectedFilters)}
      </select>
      ${marketFilterSelect({ current: query.market })}
      <button class="btn" type="submit">Apply</button>
      <a class="btn btn-ghost" href="/my-dashboard?reset=1">Reset</a>
    </form>
    <div class="stat-grid" style="margin-top:0.75rem">
      <div class="stat-card"><div class="stat-value">${money(salesStats.bidsOut.total)}</div><div class="stat-label">Bid $ Out</div><div class="stat-sub">${salesStats.bidsOut.count} bid${salesStats.bidsOut.count === 1 ? '' : 's'}</div></div>
      <div class="stat-card"><div class="stat-value">${money(salesStats.sales.total)}</div><div class="stat-label">Sales $</div><div class="stat-sub">${salesStats.sales.count} bid${salesStats.sales.count === 1 ? '' : 's'}</div></div>
      <div class="stat-card"><div class="stat-value">${killRatioDollarDisplay}</div><div class="stat-label">Kill Ratio ($)</div><div class="stat-sub">${money(killRatio.wonDollars)} won / ${money(killRatio.totalDollars)} total</div></div>
    </div>

    <div class="detail-grid">
      <div class="card">
        <h3>Current Pipeline</h3>
        <div class="table-scroll compact-scroll">
          <table class="data-table compact">
            <thead><tr><th>Project</th><th>Price</th><th>Status</th><th>Expected Close</th><th>Weighted $</th></tr></thead>
            <tbody>${pipelineRows}</tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <h3>Upcoming Bids (ITBs)</h3>
        <div class="upcoming-list">${upcomingHtml}</div>
      </div>
    </div>

    <div class="section-heading">
      <h3>Follow-ups</h3>
      <p class="muted small">Can't mark one done without a note, "Email sent" checked, or the project marked Won/Lost. Completing one on a still-open project automatically schedules the next one at that contract type's cadence.</p>
    </div>
    <div class="table-scroll regular-scroll">
      <table class="data-table">
        <thead><tr><th>Task</th><th>Customer</th><th>Due</th><th></th></tr></thead>
        <tbody>${taskRows}</tbody>
      </table>
    </div>
  `;
  return layout({ title: 'My Dashboard', active: '/my-dashboard', body, flash });
}
