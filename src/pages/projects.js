import { esc } from '../http-helpers.js';
import { layout } from './layout.js';
import { pickSelect, marketSelect, marketFilterSelect, money, pct, projectLabel, bidCustomerName, customerDisplayName } from './form-helpers.js';

export function renderProjectsList({ items, reps, picklists, query, flash }) {
  const rows = items.map((b) => {
    const extra = b.additionalCount > 0 ? ` <span class="muted small">+${b.additionalCount} more</span>` : '';
    const hasProjectName = Boolean(b.project_name && b.project_name.trim());
    return `
    <tr>
      <td>
        <a href="/bids/${b.id}/edit">${esc(projectLabel(b))}</a>${extra}
        ${hasProjectName ? `<div class="muted small">${esc(bidCustomerName(b))}</div>` : ''}
        ${b.location ? `<div class="muted small">${esc(b.location)}</div>` : ''}
      </td>
      <td>${b.customer_id ? `<a href="/customers/${b.customer_id}">${esc(bidCustomerName(b))}</a>` : `<span class="muted">${esc(bidCustomerName(b))}</span>`}</td>
      <td>${esc(b.rep) || '&mdash;'}</td>
      <td>${money(b.price)}</td>
      <td>${esc(b.sales_status) || '&mdash;'}</td>
      <td>${esc(b.contract_type) || '&mdash;'}</td>
      <td>${esc(b.vertical_market) || '&mdash;'}</td>
      <td>${esc(b.delivered_date) || '&mdash;'}</td>
      <td>${esc(b.next_follow_up_date) || '&mdash;'}</td>
      <td>${b.weighted_value !== null ? money(b.weighted_value) : '&mdash;'}</td>
      <td><a class="btn btn-tiny" href="/bids/${b.id}/edit">Edit</a></td>
    </tr>`;
  }).join('') || '<tr><td colspan="11" class="empty">No projects match these filters.</td></tr>';

  const repOptions = reps.map((r) => `<option value="${esc(r)}"${r === query.rep ? ' selected' : ''}>${esc(r)}</option>`).join('');
  const statusOptions = picklists.sales_status.map((s) => `<option value="${esc(s.label)}"${s.label === query.status ? ' selected' : ''}>${esc(s.label)}</option>`).join('');
  const typeOptions = picklists.contract_type.map((t) => `<option value="${esc(t.label)}"${t.label === query.contract_type ? ' selected' : ''}>${esc(t.label)}</option>`).join('');

  const body = `
    <div class="page-header">
      <h1>Projects</h1>
      <a class="btn btn-primary" href="/projects/new">+ New Project</a>
    </div>
    <p class="muted">Every bid/project across all customers. This is the fastest place to start a new one &mdash; pick or add a customer as you go.</p>

    <form class="filter-bar" method="get" action="/projects">
      <input type="text" name="q" placeholder="Search project, location, or customer..." value="${esc(query.q)}">
      <select name="status">
        <option value="">All statuses</option>
        ${statusOptions}
      </select>
      <select name="contract_type">
        <option value="">All contract types</option>
        ${typeOptions}
      </select>
      <select name="rep">
        <option value="">All reps</option>
        ${repOptions}
      </select>
      ${marketFilterSelect({ current: query.market })}
      <button class="btn" type="submit">Filter</button>
      <a class="btn btn-ghost" href="/projects">Reset</a>
    </form>

    <table class="data-table">
      <thead><tr><th>Project</th><th>Customer</th><th>Rep</th><th>Price</th><th>Status</th><th>Type</th><th>Market</th><th>Delivered</th><th>Next Follow-up</th><th>Weighted $</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  return layout({ title: 'Projects', active: '/projects', body, flash });
}

function extraCustomerRowHtml(additionalOptions) {
  return `
    <div class="repeat-row">
      <select name="extra_existing_id">
        <option value="">-- pick an existing customer --</option>
        ${additionalOptions}
      </select>
      <span class="muted small">or new:</span>
      <input type="text" name="extra_first_name" placeholder="First name">
      <input type="text" name="extra_last_name" placeholder="Last name">
      <input type="text" name="extra_company_name" placeholder="Company name">
      <button type="button" class="btn btn-tiny remove-row" title="Remove this row">&times;</button>
    </div>`;
}

export function renderProjectForm({ customers, picklists, flash }) {
  // A project is almost always being entered the same day it's delivered
  // (bid handed off, quoted, whatever "delivered" means for this contract
  // type) -- defaulting to today saves re-typing it on nearly every project,
  // and it's a plain date input, so it's one click to change if this one's
  // being entered late.
  const todayStr = new Date().toISOString().slice(0, 10);

  const customerOptions = customers.map((c) => {
    const loc = [c.city, c.state].filter(Boolean).join(', ');
    return `<option value="${c.id}">${esc(customerDisplayName(c))}${loc ? ` — ${esc(loc)}` : ''}</option>`;
  }).join('');

  const additionalOptions = customers.map((c) => `<option value="${c.id}">${esc(customerDisplayName(c))}</option>`).join('');

  const body = `
    <div class="page-header">
      <h1>New Project</h1>
      <a class="btn btn-ghost" href="/projects">Back to Projects</a>
    </div>

    <form class="card form-grid" method="post" action="/projects">
      <div class="full-width">
        <h3>Project</h3>
        <p class="muted small">Projects are identified by name first, everywhere in the app &mdash; the customer/GC is linked underneath.</p>
      </div>
      <label class="full-width">Project name<input type="text" name="project_name" placeholder="e.g. Riverbend Office Roof" required></label>
      <label class="full-width">Location<input type="text" name="location" placeholder="Job site address or description"></label>

      <div class="full-width section-heading" style="margin-top:0.5rem;padding-top:1rem">
        <h3>Customer</h3>
        <p class="muted small">Pick an existing customer, fill in the fields below to create a new one, or leave everything in this section blank if the customer isn't known yet &mdash; you can link one later from the project's edit page.</p>
      </div>
      <label class="full-width">Existing customer
        <select name="existing_customer_id" class="js-searchable" data-placeholder="Search existing customers...">
          <option value="">&mdash; none yet / create new below &mdash;</option>
          ${customerOptions}
        </select>
      </label>

      <label>First name<input type="text" name="first_name"></label>
      <label>Last name<input type="text" name="last_name"></label>
      <label>Company name<input type="text" name="company_name"></label>
      <label>Email<input type="email" name="email"></label>
      <label>Phone<input type="text" name="phone"></label>
      <label>City<input type="text" name="city"></label>
      <label>State<input type="text" name="state" maxlength="2" placeholder="CA"></label>
      <label>Branch<input type="text" name="branch"></label>

      <div class="full-width section-heading" style="margin-top:0.5rem;padding-top:1rem">
        <h3>Bid / Project Details</h3>
      </div>
      <label>Region ${marketSelect({ current: '' })}</label>
      <label>Price ($)<input type="number" step="any" name="price"></label>
      <label>GM %<input type="number" step="any" name="gm_percent"></label>
      <label>Sales Status ${pickSelect({ name: 'sales_status', items: picklists.sales_status, current: '', placeholder: '-- select status --' })}</label>
      <label>Estimator ${pickSelect({ name: 'estimator', items: picklists.estimator, current: '', placeholder: '-- select estimator --' })}</label>
      <label>Contract Type ${pickSelect({ name: 'contract_type', items: picklists.contract_type, current: '', placeholder: '-- select type --' })}</label>
      <label>Vertical Market ${pickSelect({ name: 'vertical_market', items: picklists.vertical_market, current: '', placeholder: '-- select market --' })}</label>
      <label>Roof Type ${pickSelect({ name: 'roof_type', items: picklists.roof_type, current: '', placeholder: '-- select roof type --' })}</label>
      <label>Squares<input type="number" step="any" name="squares"></label>
      <label>Delivered Date<input type="date" name="delivered_date" value="${todayStr}"></label>
      <label>Next Follow-up Date<input type="date" name="next_follow_up_date"></label>
      <label class="full-width">Notes<textarea name="notes" rows="3"></textarea></label>

      <div class="full-width">
        <label>Additional customers <span class="muted small">(optional — for New Construction projects with more than one owner/GC/stakeholder; pick an existing customer per row, or fill in a name/company to create a new one on the spot)</span></label>
        <div class="repeat-rows" id="extra-customers">
          ${extraCustomerRowHtml(additionalOptions)}
        </div>
        <button type="button" class="btn btn-tiny" id="add-extra-customer">+ Add another customer</button>
      </div>

      <div class="full-width form-actions">
        <button class="btn btn-primary" type="submit">Create project</button>
      </div>
    </form>
  `;
  return layout({ title: 'New Project', active: '/projects', body, flash });
}
