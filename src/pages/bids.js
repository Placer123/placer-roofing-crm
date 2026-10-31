import { esc } from '../http-helpers.js';
import { layout } from './layout.js';
import { pickSelect, marketSelect, money, pct, projectLabel, customerDisplayName, toDateInputValue } from './form-helpers.js';
import { DOC_TYPES } from '../constants.js';

function customerName(c) {
  if (!c) return 'No customer yet';
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
  return name || c.company_name || `#${c.id}`;
}

function bidDocumentsHtml(bidId, documents) {
  const rows = (documents || []).map((d) => `
    <tr>
      <td><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.title)}</a></td>
      <td>${esc(d.doc_type)}</td>
      <td>${esc(d.created_at)}</td>
      <td>
        <form method="post" action="/documents/${d.id}/delete" onsubmit="return confirm('Remove this document link?')">
          <button class="btn btn-tiny btn-danger" type="submit">Remove</button>
        </form>
      </td>
    </tr>`).join('') || '<tr><td colspan="4" class="empty">No documents linked yet.</td></tr>';

  return `
    <h3>Documents</h3>
    <p class="muted small">Plans, specs, proposals — paste a SharePoint/OneDrive link.</p>
    <table class="data-table compact">
      <thead><tr><th>Title</th><th>Type</th><th>Added</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <form class="inline-form" method="post" action="/documents">
      <input type="hidden" name="bid_id" value="${bidId}">
      <input type="text" name="title" placeholder="Document title..." required>
      <input type="url" name="url" placeholder="SharePoint / OneDrive link..." required>
      <select name="doc_type">
        ${DOC_TYPES.map((t) => `<option value="${t}">${t}</option>`).join('')}
      </select>
      <button class="btn btn-small" type="submit">Add document</button>
    </form>
  `;
}

export function renderBidForm({ bid, customer, customers, documents, picklists, flash, additionalCustomerIds }) {
  const isEdit = Boolean(bid && bid.id);
  const b = bid || {};
  const hasCustomer = Boolean(customer && customer.id);
  const action = isEdit ? `/bids/${b.id}` : `/customers/${customer.id}/bids`;
  const heading = isEdit && b.project_name ? b.project_name : customerName(customer);
  const extraIds = additionalCustomerIds || [];
  // Same default as the New Project form: a brand-new bid is almost always
  // being entered the day it's delivered. Only applies on create -- editing
  // an existing bid always shows whatever's actually saved, even if blank.
  const todayStr = new Date().toISOString().slice(0, 10);

  const customerOptions = (customers || []).map((c) => {
    const loc = [c.city, c.state].filter(Boolean).join(', ');
    const selected = hasCustomer && c.id === customer.id ? ' selected' : '';
    return `<option value="${c.id}"${selected}>${esc(customerDisplayName(c))}${loc ? ` — ${esc(loc)}` : ''}</option>`;
  }).join('');

  // Excludes whichever customer is the bid's primary (set above, or none yet
  // on a brand-new bid) -- the same GC can't be both the primary customer
  // and an "additional" one on the same bid.
  const primaryId = hasCustomer ? customer.id : null;
  const additionalOptions = (customers || [])
    .filter((c) => c.id !== primaryId)
    .map((c) => {
      const loc = [c.city, c.state].filter(Boolean).join(', ');
      const selected = extraIds.includes(c.id) ? ' selected' : '';
      return `<option value="${c.id}"${selected}>${esc(customerDisplayName(c))}${loc ? ` — ${esc(loc)}` : ''}</option>`;
    }).join('');

  const body = `
    <div class="page-header">
      <h1>${isEdit ? 'Edit' : 'New'} Project &mdash; ${esc(heading)}</h1>
      <div>
        <button type="button" class="btn btn-ghost" onclick="if (window.history.length > 1) { history.back(); } else { window.location.href = '${hasCustomer ? `/customers/${customer.id}` : '/projects'}'; }">&larr; Back</button>
        <a class="btn btn-ghost" href="${hasCustomer ? `/customers/${customer.id}` : '/projects'}">Back to ${hasCustomer ? esc(customerName(customer)) : 'Projects'}</a>
      </div>
    </div>
    <form class="card form-grid" method="post" action="${action}">
      <label class="full-width">Project name<input type="text" name="project_name" value="${esc(b.project_name)}" placeholder="e.g. Riverbend Office Roof"></label>
      <label class="full-width">Location<input type="text" name="location" value="${esc(b.location)}" placeholder="Job site address or description"></label>
      ${isEdit ? `
      <label class="full-width">Customer <span class="muted small">${hasCustomer ? '(change which customer this project belongs to)' : "(no customer linked yet — pick one once you know it)"}</span>
        <select name="customer_id" class="js-searchable" data-placeholder="Search customers...">
          <option value="">&mdash; no customer yet &mdash;</option>
          ${customerOptions}
        </select>
      </label>` : ''}
      <label class="full-width">Additional customers / GCs <span class="muted small">(often you'll bid the same job to more than one GC -- select all the other customers also bidding this project, besides the primary one above)</span>
        <select name="additional_customer_ids" multiple size="5">
          ${additionalOptions}
        </select>
      </label>
      <p class="full-width muted small">Cmd/Ctrl-click to pick more than one. New customer needed? Add them on <a href="/customers/new">Customers</a> first, then come back here.</p>
      <label>Region ${marketSelect({ current: b.market || (customer && customer.market) })}</label>
      <label>Price ($)<input type="number" step="any" name="price" value="${b.price ?? ''}"></label>
      <label>GM %<input type="number" step="any" name="gm_percent" value="${b.gm_percent ?? ''}"></label>
      <label>Sales Status ${pickSelect({ name: 'sales_status', items: picklists.sales_status, current: b.sales_status, placeholder: '-- select status --' })}</label>
      <label>Estimator ${pickSelect({ name: 'estimator', items: picklists.estimator, current: b.estimator, placeholder: '-- select estimator --' })}</label>
      <label>Contract Type ${pickSelect({ name: 'contract_type', items: picklists.contract_type, current: b.contract_type, placeholder: '-- select type --' })}</label>
      <label>Vertical Market ${pickSelect({ name: 'vertical_market', items: picklists.vertical_market, current: b.vertical_market, placeholder: '-- select market --' })}</label>
      <label>Roof Type ${pickSelect({ name: 'roof_type', items: picklists.roof_type, current: b.roof_type, placeholder: '-- select roof type --' })}</label>
      <label>Squares<input type="number" step="any" name="squares" value="${b.squares ?? ''}"></label>
      <label>Delivered Date<input type="date" name="delivered_date" value="${esc(toDateInputValue(b.delivered_date) || (!isEdit ? todayStr : ''))}"></label>
      <label>Next Follow-up Date<input type="date" name="next_follow_up_date" value="${esc(toDateInputValue(b.next_follow_up_date))}"></label>
      <label class="full-width">Notes<textarea name="notes" rows="3">${esc(b.notes)}</textarea></label>
      <p class="full-width muted small">New dropdown option needed? Manage them on the <a href="/settings/dropdowns">Dropdown Lists</a> page, then come back here.</p>
      <div class="full-width form-actions">
        ${isEdit ? `<button class="btn btn-danger" type="submit" form="bid-delete-form" style="margin-right:auto">Delete bid</button>` : ''}
        <button class="btn btn-primary" type="submit">${isEdit ? 'Save changes' : 'Create bid'}</button>
      </div>
    </form>
    ${isEdit ? `<form id="bid-delete-form" method="post" action="/bids/${b.id}/delete" style="display:none" onsubmit="return confirm('Delete this bid permanently?')"></form>` : ''}
    ${isEdit ? `<div class="card" style="margin-top:1.25rem">${bidDocumentsHtml(b.id, documents)}</div>` : ''}
  `;
  return layout({ title: `${isEdit ? 'Edit' : 'New'} Bid`, active: '/customers', body, flash });
}

export function bidsTableForCustomer(bids) {
  const rows = bids.map((b) => `
    <tr>
      <td><a href="/bids/${b.id}/edit">${esc(projectLabel(b))}</a>${b.location ? `<div class="muted small">${esc(b.location)}</div>` : ''}</td>
      <td>${money(b.price)}</td>
      <td>${pct(b.gm_percent)}${b.gm_dollars !== null ? ` <span class="muted small">(${money(b.gm_dollars)})</span>` : ''}</td>
      <td>${esc(b.sales_status) || '&mdash;'}</td>
      <td>${esc(b.contract_type) || '&mdash;'}</td>
      <td>${esc(b.roof_type) || '&mdash;'}</td>
      <td>${b.squares ?? '&mdash;'}</td>
      <td>${esc(b.delivered_date) || '&mdash;'}</td>
      <td>${esc(b.next_follow_up_date) || '&mdash;'}</td>
      <td>${b.weighted_value !== null ? money(b.weighted_value) : '&mdash;'}</td>
      <td><a class="btn btn-tiny" href="/bids/${b.id}/edit">Edit</a></td>
    </tr>`).join('') || '<tr><td colspan="11" class="empty">No bids yet.</td></tr>';

  return `
    <table class="data-table compact">
      <thead><tr><th>Project</th><th>Price</th><th>GM</th><th>Status</th><th>Type</th><th>Roof</th><th>Sq</th><th>Delivered</th><th>Next Follow-up</th><th>Weighted $</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}
