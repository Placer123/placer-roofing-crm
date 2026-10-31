import { esc } from '../http-helpers.js';
import { layout } from './layout.js';
import { STAGES, US_STATES } from '../constants.js';
import { pickSelect, marketSelect, marketFilterSelect } from './form-helpers.js';
import { bidsTableForCustomer } from './bids.js';

function stageLabel(id) {
  return STAGES.find((s) => s.id === id)?.label || id;
}

function optionList(values, selected, labelFn = (v) => v) {
  return values.map((v) => {
    const id = typeof v === 'object' ? v.id : v;
    const label = typeof v === 'object' ? v.label : labelFn(v);
    return `<option value="${esc(id)}"${id === selected ? ' selected' : ''}>${esc(label)}</option>`;
  }).join('');
}

function customerName(c) {
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
  return name || c.company_name || `Customer #${c.id}`;
}

export function renderCustomerList({ items, total, query, flash }) {
  const rows = items.map((c) => `
    <tr>
      <td><a href="/customers/${c.id}">${esc(customerName(c))}</a>${c.company_name && (c.first_name || c.last_name) ? `<div class="muted">${esc(c.company_name)}</div>` : ''}</td>
      <td><span class="badge badge-${esc(c.record_type)}">${c.record_type === 'lead' ? 'Lead' : 'Customer'}</span></td>
      <td>${esc(stageLabel(c.stage))}</td>
      <td>${esc(c.phone)}</td>
      <td>${esc(c.email)}</td>
      <td>${esc([c.city, c.state].filter(Boolean).join(', '))}</td>
      <td>${esc(c.branch)}</td>
      <td>${esc(c.market)}</td>
      <td>${esc(c.assigned_to)}</td>
    </tr>`).join('') || `<tr><td colspan="9" class="empty">No records match. <a href="/customers/new">Add one</a>.</td></tr>`;

  const body = `
    <div class="page-header">
      <h1>Customers</h1>
      <a class="btn btn-primary" href="/customers/new">+ New Lead / Customer</a>
    </div>

    <form class="filter-bar" method="get" action="/customers">
      <input type="text" name="q" placeholder="Search name, company, email, phone, city..." value="${esc(query.q)}">
      <select name="type">
        <option value="">All types</option>
        <option value="lead"${query.type === 'lead' ? ' selected' : ''}>Leads</option>
        <option value="customer"${query.type === 'customer' ? ' selected' : ''}>Customers</option>
      </select>
      <select name="stage">
        <option value="">All stages</option>
        ${optionList(STAGES, query.stage)}
      </select>
      <select name="state">
        <option value="">All states</option>
        ${optionList(US_STATES, query.state)}
      </select>
      <input type="text" name="branch" placeholder="Branch" value="${esc(query.branch)}">
      ${marketFilterSelect({ current: query.market })}
      <button class="btn" type="submit">Filter</button>
      <a class="btn btn-ghost" href="/customers">Reset</a>
    </form>

    <p class="muted">${total} record${total === 1 ? '' : 's'}</p>

    <table class="data-table">
      <thead>
        <tr><th>Name</th><th>Type</th><th>Stage</th><th>Phone</th><th>Email</th><th>Location</th><th>Branch</th><th>Region</th><th>Rep</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  return layout({ title: 'Customers', active: '/customers', body, flash });
}

export function renderCustomerForm({ customer, salesReps = [], flash }) {
  const isEdit = Boolean(customer && customer.id);
  const c = customer || {};
  const action = isEdit ? `/customers/${c.id}` : '/customers';

  const body = `
    <div class="page-header">
      <h1>${isEdit ? 'Edit' : 'New'} Lead / Customer</h1>
      ${isEdit ? `<a class="btn btn-ghost" href="/customers/${c.id}">Back to detail</a>` : `<a class="btn btn-ghost" href="/customers">Back to list</a>`}
    </div>
    <form class="card form-grid" method="post" action="${action}">
      <label>First name<input type="text" name="first_name" value="${esc(c.first_name)}"></label>
      <label>Last name<input type="text" name="last_name" value="${esc(c.last_name)}"></label>
      <label>Company name<input type="text" name="company_name" value="${esc(c.company_name)}"></label>
      <label>Email<input type="email" name="email" value="${esc(c.email)}"></label>
      <label>Phone<input type="text" name="phone" value="${esc(c.phone)}"></label>
      <label>Address<input type="text" name="address" value="${esc(c.address)}"></label>
      <label>City<input type="text" name="city" value="${esc(c.city)}"></label>
      <label>State
        <select name="state">
          <option value="">--</option>
          ${optionList(US_STATES, c.state)}
        </select>
      </label>
      <label>ZIP<input type="text" name="zip" value="${esc(c.zip)}"></label>
      <label>Branch<input type="text" name="branch" value="${esc(c.branch)}" placeholder="e.g. Sacramento"></label>
      <label>Region ${marketSelect({ current: c.market })}</label>
      <label>Record type
        <select name="record_type">
          <option value="lead"${c.record_type === 'lead' || !c.record_type ? ' selected' : ''}>Lead</option>
          <option value="customer"${c.record_type === 'customer' ? ' selected' : ''}>Customer</option>
        </select>
      </label>
      ${isEdit ? `
      <label>Pipeline stage
        <select name="stage">
          ${optionList(STAGES, c.stage || 'new')}
        </select>
      </label>` : ''}
      <label>Lead source<input type="text" name="source" value="${esc(c.source)}" placeholder="Referral, website, ad..."></label>
      <label>Assigned rep ${pickSelect({ name: 'assigned_to', items: salesReps, current: c.assigned_to, placeholder: '-- select rep --' })}</label>
      <label class="full-width">Notes<textarea name="notes" rows="4">${esc(c.notes)}</textarea></label>
      <div class="full-width form-actions">
        <button class="btn btn-primary" type="submit">${isEdit ? 'Save changes' : 'Create'}</button>
      </div>
    </form>
  `;
  return layout({ title: isEdit ? 'Edit Customer' : 'New Customer', active: '/customers', body, flash });
}

export function renderCustomerDetail({ customer, tasks, documents, bids, flash }) {
  const c = customer;
  const taskRows = tasks.map((t) => `
    <tr class="${t.status === 'done' ? 'row-done' : ''}">
      <td>
        ${t.bid_project_name && t.bid_project_name.trim() ? `<div class="muted small">${t.bid_id ? `<a href="/bids/${t.bid_id}/edit">${esc(t.bid_project_name)}</a>` : esc(t.bid_project_name)}</div>` : ''}
        ${esc(t.title)}
        ${t.email_sent ? '<span class="badge-email-sent">Email sent</span>' : ''}
        <details class="task-notes">
          <summary>Notes${t.notes ? ' &middot; ' + esc(t.notes.slice(0, 30)) + (t.notes.length > 30 ? '&hellip;' : '') : ''}</summary>
          <form method="post" action="/tasks/${t.id}/notes" class="task-notes-form">
            <textarea name="notes" rows="2" placeholder="Follow-up notes...">${esc(t.notes)}</textarea>
            <label class="checkbox-label"><input type="checkbox" name="email_sent" value="1"${t.email_sent ? ' checked' : ''}> Email sent</label>
            <button class="btn btn-tiny" type="submit">Save notes</button>
          </form>
        </details>
      </td>
      <td>${esc(t.due_date)}</td>
      <td>${esc(t.assigned_to)}</td>
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
    </tr>`).join('') || '<tr><td colspan="4" class="empty">No follow-up tasks yet.</td></tr>';

  const docRows = documents.map((d) => `
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

  const body = `
    <div class="page-header">
      <h1>${esc(customerName(c))}</h1>
      <div class="header-actions">
        <a class="btn" href="/customers/${c.id}/edit">Edit</a>
        <form method="post" action="/customers/${c.id}/delete" onsubmit="return confirm('Delete this record permanently?')">
          <button class="btn btn-danger" type="submit">Delete</button>
        </form>
      </div>
    </div>

    <div class="detail-grid">
      <div class="card">
        <h3>Details</h3>
        <dl class="def-list">
          <dt>Type</dt><dd><span class="badge badge-${esc(c.record_type)}">${c.record_type === 'lead' ? 'Lead' : 'Customer'}</span></dd>
          <dt>Stage</dt><dd>${esc(stageLabel(c.stage))}</dd>
          <dt>Company</dt><dd>${esc(c.company_name) || '&mdash;'}</dd>
          <dt>Email</dt><dd>${esc(c.email) || '&mdash;'}</dd>
          <dt>Phone</dt><dd>${esc(c.phone) || '&mdash;'}</dd>
          <dt>Address</dt><dd>${esc([c.address, c.city, c.state, c.zip].filter(Boolean).join(', ')) || '&mdash;'}</dd>
          <dt>Branch</dt><dd>${esc(c.branch) || '&mdash;'}</dd>
          <dt>Region</dt><dd>${esc(c.market) || '&mdash;'}</dd>
          <dt>Source</dt><dd>${esc(c.source) || '&mdash;'}</dd>
          <dt>Assigned rep</dt><dd>${esc(c.assigned_to) || '&mdash;'}</dd>
          <dt>Notes</dt><dd class="notes">${esc(c.notes) || '&mdash;'}</dd>
        </dl>
      </div>

      <div class="card">
        <h3>Follow-up tasks</h3>
        <table class="data-table compact">
          <thead><tr><th>Title</th><th>Due</th><th>Rep</th><th></th></tr></thead>
          <tbody>${taskRows}</tbody>
        </table>
        <form class="inline-form" method="post" action="/customers/${c.id}/tasks">
          <input type="text" name="title" placeholder="New follow-up task..." required>
          <input type="date" name="due_date">
          <input type="text" name="assigned_to" placeholder="Rep">
          <button class="btn btn-small" type="submit">Add task</button>
        </form>
      </div>

      <div class="card full-width">
        <h3>Bids</h3>
        ${bidsTableForCustomer(bids)}
        <a class="btn btn-small" href="/customers/${c.id}/bids/new">+ Add bid</a>
      </div>

      <div class="card full-width">
        <h3>Documents</h3>
        <table class="data-table compact">
          <thead><tr><th>Title</th><th>Type</th><th>Added</th><th></th></tr></thead>
          <tbody>${docRows}</tbody>
        </table>
        <form class="inline-form" method="post" action="/documents">
          <input type="hidden" name="customer_id" value="${c.id}">
          <input type="text" name="title" placeholder="Document title..." required>
          <input type="url" name="url" placeholder="SharePoint / OneDrive link..." required>
          <select name="doc_type">
            <option value="contract">Contract</option>
            <option value="permit">Permit</option>
            <option value="estimate">Estimate</option>
            <option value="invoice">Invoice</option>
            <option value="photo">Photo</option>
            <option value="other" selected>Other</option>
          </select>
          <button class="btn btn-small" type="submit">Add document</button>
        </form>
      </div>
    </div>
  `;
  return layout({ title: customerName(c), active: '/customers', body, flash });
}
