import { esc } from '../http-helpers.js';
import { layout } from './layout.js';
import { monthOptions, marketFilterSelect, money, pct, projectLabel, bidCustomerName } from './form-helpers.js';

export function renderSales({ items, killRatio, reps, query, flash }) {
  const totalPrice = items.reduce((sum, b) => sum + (b.price || 0), 0);
  const totalGm = items.reduce((sum, b) => sum + (b.gm_dollars || 0), 0);
  // Dollar-weighted, not a simple average of each bid's GM% -- a $500k job at
  // 20% GM should count for more than a $5k job at 40% GM.
  const avgGmPct = totalPrice ? (totalGm / totalPrice) * 100 : 0;

  const rows = items.map((b) => {
    const hasProjectName = Boolean(b.project_name && b.project_name.trim());
    return `
    <tr>
      <td>
        <a href="/bids/${b.id}/edit">${esc(projectLabel(b))}</a>
        ${hasProjectName ? `<div class="muted small">${esc(bidCustomerName(b))}</div>` : ''}
      </td>
      <td>${esc(b.rep) || '&mdash;'}</td>
      <td>${money(b.price)}</td>
      <td>${pct(b.gm_percent)} <span class="muted small">(${money(b.gm_dollars)})</span></td>
      <td>${esc(b.contract_type) || '&mdash;'}</td>
      <td>${esc(b.vertical_market) || '&mdash;'}</td>
      <td>${esc(b.delivered_date) || '&mdash;'}</td>
      <td><a class="btn btn-tiny" href="/bids/${b.id}/edit">Edit</a></td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" class="empty">No won bids match these filters.</td></tr>';

  const repOptions = reps.map((r) => `<option value="${esc(r)}"${r === query.rep ? ' selected' : ''}>${esc(r)}</option>`).join('');

  const body = `
    <div class="page-header">
      <h1>Sales</h1>
    </div>
    <p class="muted">Bids marked "Won" (100% sales status), based on the bid's delivered date.</p>

    <form class="filter-bar" method="get" action="/sales">
      <select name="month">
        <option value="">All months</option>
        ${monthOptions(query.month)}
      </select>
      <select name="rep">
        <option value="">All reps</option>
        ${repOptions}
      </select>
      ${marketFilterSelect({ current: query.market })}
      <button class="btn" type="submit">Filter</button>
      <a class="btn btn-ghost" href="/sales">Reset</a>
    </form>

    <div class="stat-strip">
      <div class="stat-card"><div class="stat-value">${items.length}</div><div class="stat-label">Won Bids</div></div>
      <div class="stat-card"><div class="stat-value">${money(totalPrice)}</div><div class="stat-label">Total Sales</div></div>
      <div class="stat-card"><div class="stat-value">${money(totalGm)}</div><div class="stat-label">Total GM $</div></div>
      <div class="stat-card"><div class="stat-value">${avgGmPct.toFixed(1)}%</div><div class="stat-label">Avg GM %</div></div>
      <div class="stat-card"><div class="stat-value">${killRatio.ratio === null ? '&mdash;' : `${killRatio.ratio.toFixed(0)}%`}</div><div class="stat-label">Kill Ratio</div><div class="stat-sub">${killRatio.won} won / ${killRatio.total} total bids</div></div>
    </div>

    <table class="data-table">
      <thead><tr><th>Project</th><th>Rep</th><th>Price</th><th>GM</th><th>Type</th><th>Market</th><th>Delivered</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  return layout({ title: 'Sales', active: '/sales', body, flash });
}
