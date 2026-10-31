import { esc } from '../http-helpers.js';
import { layout } from './layout.js';
import { money, dashFilterOptions, marketFilterSelect } from './form-helpers.js';

export function renderDashboard({ periodStats, killRatio, counts, upcomingTasks, recentLeads, reps, contractTypes, query, flash }) {
  const selectedFilters = Array.isArray(query.dash_filter) ? query.dash_filter : (query.dash_filter ? [query.dash_filter] : []);
  const repOptions = reps.map((r) => `<option value="${esc(r)}"${r === query.rep ? ' selected' : ''}>${esc(r)}</option>`).join('');
  const contractTypeOptions = (contractTypes || []).map((t) => `<option value="${esc(t.label)}"${t.label === query.contract_type ? ' selected' : ''}>${esc(t.label)}</option>`).join('');

  const taskRows = upcomingTasks.map((t) => {
    const customerName = [t.first_name, t.last_name].filter(Boolean).join(' ') || t.company_name || '';
    const hasProject = Boolean(t.bid_project_name && t.bid_project_name.trim());
    return `
    <tr>
      <td>
        ${hasProject ? `<div>${esc(t.bid_project_name)}</div><div class="muted small">${esc(t.title)}</div>` : esc(t.title)}
      </td>
      <td>${t.customer_id ? `<a href="/customers/${t.customer_id}">${esc(customerName)}</a>` : '&mdash;'}</td>
      <td>${esc(t.assigned_to) || '&mdash;'}</td>
      <td>${esc(t.due_date) || '&mdash;'}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="4" class="empty">No open follow-ups. Nice work.</td></tr>';

  const leadRows = recentLeads.map((c) => {
    const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company_name || `#${c.id}`;
    const hasProject = Boolean(c.project_name && c.project_name.trim());
    return `
    <tr>
      <td>
        ${hasProject ? `<div><a href="/customers/${c.id}">${esc(c.project_name)}</a></div><div class="muted small">${esc(name)}</div>` : `<a href="/customers/${c.id}">${esc(name)}</a>`}
      </td>
      <td>${esc(c.stage)}</td>
      <td>${esc(c.created_at)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="3" class="empty">No leads yet.</td></tr>';

  const killRatioDisplay = killRatio.ratio === null ? '&mdash;' : `${killRatio.ratio.toFixed(0)}%`;
  const killRatioDollarDisplay = killRatio.dollarRatio === null ? '&mdash;' : `${killRatio.dollarRatio.toFixed(0)}%`;

  const body = `
    <div class="page-header">
      <h1>Dashboard</h1>
    </div>

    <form class="filter-bar" method="get" action="/">
      <input type="hidden" name="dash_submit" value="1">
      <select name="dash_filter" multiple size="1" class="months-multi" title="Pick a quick range, or Cmd/Ctrl-click one or more months of ${new Date().getUTCFullYear()} -- picking any month overrides the quick range">
        ${dashFilterOptions(selectedFilters)}
      </select>
      <select name="rep">
        <option value="">All reps</option>
        ${repOptions}
      </select>
      <select name="contract_type">
        <option value="">All contract types</option>
        ${contractTypeOptions}
      </select>
      ${marketFilterSelect({ current: query.market })}
      <button class="btn" type="submit">Apply</button>
      <a class="btn btn-ghost" href="/?reset=1">Reset</a>
    </form>
    <p class="muted small" style="margin-top:-0.5rem;margin-bottom:1rem">Your filter choices are remembered as you move between tabs &mdash; use Reset to clear them. Cmd/Ctrl-click to pick more than one month.</p>

    <div class="stat-grid">
      <div class="stat-card"><div class="stat-value">${money(periodStats.bidsOut.total)}</div><div class="stat-label">Bid $ Out</div><div class="stat-sub">${periodStats.bidsOut.count} bid${periodStats.bidsOut.count === 1 ? '' : 's'}</div></div>
      <div class="stat-card"><div class="stat-value">${money(periodStats.sales.total)}</div><div class="stat-label">Sales $</div><div class="stat-sub">${periodStats.sales.count} bid${periodStats.sales.count === 1 ? '' : 's'}</div></div>
      <div class="stat-card"><div class="stat-value">${periodStats.newCustomers}</div><div class="stat-label">New Customers Added</div></div>
      <div class="stat-card"><div class="stat-value">${periodStats.newLeads}</div><div class="stat-label">New Opportunities Posted</div></div>
      <div class="stat-card"><div class="stat-value">${killRatioDisplay}</div><div class="stat-label">Kill Ratio</div><div class="stat-sub">${killRatio.won} won / ${killRatio.total} total bids</div></div>
      <div class="stat-card"><div class="stat-value">${killRatioDollarDisplay}</div><div class="stat-label">Kill Ratio ($)</div><div class="stat-sub">${money(killRatio.wonDollars)} won / ${money(killRatio.totalDollars)} total</div></div>
    </div>
    <p class="muted small" style="margin-top:-0.75rem;margin-bottom:1.5rem">
      Bid $ Out = total price of bids delivered in this period, any status. Sales $ = bids Won and delivered in this period.
      New Customers Added = every new customer/lead record created in this period. New Opportunities Posted = every new project/bid created in this period.
      Kill Ratio = Won bids / total bids delivered in this period. Kill Ratio ($) = the same idea but dollar-weighted (won bid $ / total delivered bid $), so a big job dying pulls it down more than a small one. All follow the Rep, Contract Type, and Region filters above.
    </p>

    <div class="section-heading">
      <h3>All-Time Snapshot</h3>
    </div>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-value">${counts.leads}</div><div class="stat-label">Active Leads</div></div>
      <div class="stat-card"><div class="stat-value">${counts.customers}</div><div class="stat-label">Customers</div></div>
      <div class="stat-card"><div class="stat-value">${counts.openTasks}</div><div class="stat-label">Open Follow-ups</div></div>
      <div class="stat-card"><div class="stat-value">${counts.pastDueTasks}</div><div class="stat-label">Past Due Follow-ups</div><div class="stat-sub">Across all reps</div></div>
      <div class="stat-card"><div class="stat-value">${counts.documents}</div><div class="stat-label">Documents Linked</div></div>
    </div>

    <div class="detail-grid">
      <div class="card">
        <h3>Upcoming follow-ups</h3>
        <table class="data-table compact">
          <thead><tr><th>Task</th><th>Customer</th><th>Rep</th><th>Due</th></tr></thead>
          <tbody>${taskRows}</tbody>
        </table>
        <a class="btn btn-small" href="/tasks">View all tasks</a>
      </div>
      <div class="card">
        <h3>Recent leads</h3>
        <table class="data-table compact">
          <thead><tr><th>Name</th><th>Stage</th><th>Added</th></tr></thead>
          <tbody>${leadRows}</tbody>
        </table>
        <a class="btn btn-small" href="/pipeline">View pipeline</a>
      </div>
    </div>
  `;
  return layout({ title: 'Dashboard', active: '/', body, flash });
}
