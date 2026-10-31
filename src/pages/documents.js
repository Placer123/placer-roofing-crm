import { esc } from '../http-helpers.js';
import { layout } from './layout.js';
import { DOC_TYPES } from '../constants.js';

function customerName(d) {
  const name = [d.first_name, d.last_name].filter(Boolean).join(' ');
  return name || d.company_name || (d.customer_id ? `Customer #${d.customer_id}` : '');
}

export function renderDocuments({ items, customers, query, flash }) {
  const rows = items.map((d) => `
    <tr>
      <td><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.title)}</a></td>
      <td>${esc(d.doc_type)}</td>
      <td>${d.customer_id ? `<a href="/customers/${d.customer_id}">${esc(customerName(d))}</a>` : '&mdash;'}</td>
      <td>${esc(d.created_at)}</td>
      <td>
        <form method="post" action="/documents/${d.id}/delete" onsubmit="return confirm('Remove this document link?')">
          <button class="btn btn-tiny btn-danger" type="submit">Remove</button>
        </form>
      </td>
    </tr>`).join('') || '<tr><td colspan="5" class="empty">No documents linked yet.</td></tr>';

  const customerOptions = customers.map((c) => {
    const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company_name || `#${c.id}`;
    return `<option value="${c.id}">${esc(name)}</option>`;
  }).join('');

  const body = `
    <div class="page-header">
      <h1>Documents</h1>
    </div>
    <p class="muted">Document files live in SharePoint / OneDrive — this just keeps a searchable link to them per customer, contract, or permit.</p>

    <form class="filter-bar" method="get" action="/documents">
      <select name="doc_type">
        <option value="">All types</option>
        ${DOC_TYPES.map((t) => `<option value="${t}"${query.doc_type === t ? ' selected' : ''}>${t}</option>`).join('')}
      </select>
      <button class="btn" type="submit">Filter</button>
      <a class="btn btn-ghost" href="/documents">Reset</a>
    </form>

    <table class="data-table">
      <thead><tr><th>Title</th><th>Type</th><th>Customer</th><th>Added</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="card" style="margin-top:1.5rem;max-width:640px;">
      <h3>Add a document link</h3>
      <form class="form-grid" method="post" action="/documents">
        <label>Title<input type="text" name="title" required></label>
        <label>Link (SharePoint/OneDrive URL)<input type="url" name="url" required></label>
        <label>Type
          <select name="doc_type">
            ${DOC_TYPES.map((t) => `<option value="${t}">${t}</option>`).join('')}
          </select>
        </label>
        <label>Customer (optional)
          <select name="customer_id">
            <option value="">&mdash; none &mdash;</option>
            ${customerOptions}
          </select>
        </label>
        <div class="full-width form-actions">
          <button class="btn btn-primary" type="submit">Add document</button>
        </div>
      </form>
    </div>
  `;
  return layout({ title: 'Documents', active: '/documents', body, flash });
}
