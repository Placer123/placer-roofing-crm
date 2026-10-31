import { esc } from '../http-helpers.js';
import { layout } from './layout.js';
import { monthOptions, marketFilterSelect, money, pct, projectLabel, bidCustomerName } from './form-helpers.js';

// Two-series comparison (Total Bid Value vs. Weighted Forecast) grouped by
// expected-close month -- one hue per series, gray for the raw total and the
// brand green for the risk-adjusted number, so "how much is really likely to
// land" reads apart from "how much is technically in the pipeline". A legend
// covers both series since there are 2+.
const SERIES_COLORS = { total: '#94a3b8', weighted: '#16a34a' };

function monthlyPipelineChartHtml(forecastBids) {
  const byMonth = {};
  for (const b of forecastBids) {
    const key = (b.expected_close_date || '').slice(0, 7);
    if (!key) continue;
    if (!byMonth[key]) byMonth[key] = { total: 0, weighted: 0 };
    byMonth[key].total += b.price || 0;
    byMonth[key].weighted += b.weighted_value || 0;
  }
  const months = Object.keys(byMonth).sort();
  if (!months.length) {
    return '<p class="empty">No open bids with an expected close date match these filters.</p>';
  }
  const max = Math.max(1, ...months.map((m) => byMonth[m].total));
  const monthLabel = (m) => {
    const [y, mo] = m.split('-').map(Number);
    return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  };
  const rows = months.map((m) => {
    const { total, weighted } = byMonth[m];
    const totalPct = Math.max(total > 0 ? 2 : 0, (total / max) * 100);
    const weightedPct = Math.max(weighted > 0 ? 2 : 0, (weighted / max) * 100);
    return `
      <div class="pipeline-chart-row">
        <div class="pipeline-chart-label">${esc(monthLabel(m))}</div>
        <div class="pipeline-chart-bars">
          <div class="pipeline-chart-track"><div class="pipeline-chart-bar" style="width:${totalPct}%;background:${SERIES_COLORS.total}"></div><span class="pipeline-chart-value">${money(total)}</span></div>
          <div class="pipeline-chart-track"><div class="pipeline-chart-bar" style="width:${weightedPct}%;background:${SERIES_COLORS.weighted}"></div><span class="pipeline-chart-value">${money(weighted)}</span></div>
        </div>
      </div>`;
  }).join('');
  return `
    <div class="pipeline-chart">
      <div class="pipeline-chart-legend">
        <span class="rep-legend-item"><span class="rep-legend-swatch" style="background:${SERIES_COLORS.total}"></span>Total Bid Value</span>
        <span class="rep-legend-item"><span class="rep-legend-swatch" style="background:${SERIES_COLORS.weighted}"></span>Weighted Forecast</span>
      </div>
      ${rows}
    </div>`;
}

export function renderPipeline({ forecastBids, reps, query, flash }) {
  const totalWeighted = forecastBids.reduce((sum, b) => sum + (b.weighted_value || 0), 0);
  const totalPrice = forecastBids.reduce((sum, b) => sum + (b.price || 0), 0);

  const forecastRows = forecastBids.map((b) => {
    const hasProjectName = Boolean(b.project_name && b.project_name.trim());
    return `
    <tr>
      <td>
        <a href="/bids/${b.id}/edit">${esc(projectLabel(b))}</a>
        ${hasProjectName ? `<div class="muted small">${esc(bidCustomerName(b))}</div>` : ''}
      </td>
      <td>${esc(b.rep) || '&mdash;'}</td>
      <td>${money(b.price)}</td>
      <td>${esc(b.sales_status)} ${b.probability !== null ? `(${pct(b.probability)})` : ''}</td>
      <td>${esc(b.contract_type) || '&mdash;'}</td>
      <td>${esc(b.delivered_date) || '&mdash;'}</td>
      <td>${esc(b.expected_close_date) || '&mdash;'}</td>
      <td><strong>${money(b.weighted_value)}</strong></td>
      <td><a class="btn btn-tiny" href="/bids/${b.id}/edit">Edit</a></td>
    </tr>`;
  }).join('') || '<tr><td colspan="9" class="empty">No open bids match these filters.</td></tr>';

  const repOptions = reps.map((r) => `<option value="${esc(r)}"${r === query.rep ? ' selected' : ''}>${esc(r)}</option>`).join('');

  const body = `
    <div class="page-header">
      <h1>Sales Pipeline</h1>
      <a class="btn btn-primary" href="/customers/new">+ New Lead</a>
    </div>

    <h3>Pipeline by Expected Close Month</h3>
    ${monthlyPipelineChartHtml(forecastBids)}

    <div class="section-heading">
      <h3>Weighted Bid Forecast</h3>
      <p class="muted">Open bids (Sales Status between 0% and 100%). Expected close = bid delivered date + forecast days for that contract type (Reroof: 60 days, New Construction: 120 days by default &mdash; adjust in <a href="/settings/dropdowns">Dropdown Lists</a>). Weighted $ = Price &times; Sales Status probability.</p>
    </div>

    <form class="filter-bar" method="get" action="/pipeline">
      <select name="month">
        <option value="">All months (by expected close)</option>
        ${monthOptions(query.month)}
      </select>
      <select name="rep">
        <option value="">All reps</option>
        ${repOptions}
      </select>
      ${marketFilterSelect({ current: query.market })}
      <button class="btn" type="submit">Filter</button>
      <a class="btn btn-ghost" href="/pipeline">Reset</a>
    </form>

    <div class="stat-strip">
      <div class="stat-card"><div class="stat-value">${forecastBids.length}</div><div class="stat-label">Open Bids</div></div>
      <div class="stat-card"><div class="stat-value">${money(totalPrice)}</div><div class="stat-label">Total Bid Value</div></div>
      <div class="stat-card"><div class="stat-value">${money(totalWeighted)}</div><div class="stat-label">Weighted Forecast</div></div>
    </div>

    <table class="data-table">
      <thead><tr><th>Project</th><th>Rep</th><th>Price</th><th>Status</th><th>Type</th><th>Delivered</th><th>Expected Close</th><th>Weighted $</th><th></th></tr></thead>
      <tbody>${forecastRows}</tbody>
    </table>
  `;
  return layout({ title: 'Pipeline', active: '/pipeline', body, flash });
}
