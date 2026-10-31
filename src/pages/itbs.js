import { esc } from '../http-helpers.js';
import { layout } from './layout.js';
import { pickSelect, marketSelect, fileSize, customerDisplayName, toDateInputValue } from './form-helpers.js';

// IMPORTANT: this section is embedded inside the main <form class="itb-form">
// in the template below, so it must never contain a nested <form> of its
// own -- HTML doesn't allow forms inside forms, and a browser hitting a
// nested form's closing </form> tag actually closes the *outer* form early,
// silently stranding everything after it (notes, customers, and critically
// the Save button) outside any form at all, so clicking Save does nothing.
// That's exactly what was happening on any ITB with at least one email
// attachment -- a new ITB with none never hit it. Each "Remove" control is
// therefore just a button wired to its own standalone <form> declared
// *outside* the main form (via the HTML5 form="..." attribute), the same
// pattern already used for the Delete button below.
function attachmentsSectionHtml(itbId, attachments) {
  const rows = attachments.map((a) => `
    <div class="attachment-item">
      <a href="/bid-calendar/attachments/${a.id}/download" download>${esc(a.original_name)}</a>
      <span class="muted small">${fileSize(a.size_bytes)}</span>
      <button class="btn btn-tiny btn-danger" type="submit" form="attachment-delete-form-${a.id}">Remove</button>
    </div>`).join('') || '<p class="muted small">No emails attached yet.</p>';

  return `
    <div class="full-width section-heading">
      <h3>Email Attachments</h3>
      <p class="muted small">Drag the original email(s) straight from Outlook here &mdash; one per GC if more than one is bidding this project &mdash; then open one any time to see the links inside. Each one dropped is also scrubbed for the sender's company/contact info and auto-added to the "Customers / GCs bidding this project" list below &mdash; it's a best-effort guess, so double check it landed on the right customer.</p>
    </div>
    <div class="full-width">
      <div class="attachment-dropzone" data-itb-id="${itbId}">
        <span>Drag emails here, or click to browse</span>
        <input type="file" class="attachment-file-input" multiple hidden>
      </div>
      <div class="attachment-list" data-itb-id="${itbId}">${rows}</div>
    </div>
  `;
}

// The standalone delete forms attachmentsSectionHtml's buttons point at via
// form="..." -- rendered as siblings *after* the main form closes, never
// nested inside it. See the comment above attachmentsSectionHtml.
function attachmentDeleteForms(itbId, attachments) {
  return attachments.map((a) => `
    <form id="attachment-delete-form-${a.id}" method="post" action="/bid-calendar/itbs/${itbId}/attachments/${a.id}/delete" style="display:none" onsubmit="return confirm('Remove this email attachment?');"></form>`).join('');
}

export function renderItbForm({ itb, linkedCustomerIds, customers, picklists, reps, defaultDate, attachments, flash, returnQS }) {
  const isEdit = Boolean(itb);
  const repItems = reps.map((r) => ({ label: r }));
  // Whatever month/rep/status/region the calendar was filtered to when this
  // ITB was opened (or created, via +New ITB or a dropped email) -- carried
  // on the way back so saving or deleting doesn't reset the calendar to
  // "everything". See filterQS in pages/calendar.js, which builds this.
  const qs = returnQS ? `?${returnQS}` : '';

  const customerOptions = customers.map((c) => {
    const loc = [c.city, c.state].filter(Boolean).join(', ');
    const selected = linkedCustomerIds.includes(c.id) ? ' selected' : '';
    return `<option value="${c.id}"${selected}>${esc(customerDisplayName(c))}${loc ? ` — ${esc(loc)}` : ''}</option>`;
  }).join('');

  const body = `
    <div class="page-header">
      <h1>${isEdit ? 'Edit ITB' : 'New ITB'}</h1>
      <a class="btn btn-ghost" href="/bid-calendar${qs}">Back to Bid Calendar</a>
    </div>

    <div class="drop-banner" hidden>📧 Prefilled from a dropped email — double check the details below before saving.</div>

    <form class="card form-grid itb-form" method="post" action="${isEdit ? `/bid-calendar/itbs/${itb.id}${qs}` : `/bid-calendar/itbs${qs}`}">
      <input type="hidden" name="source_subject" value="${esc(itb?.source_subject || '')}">
      <input type="hidden" name="source_from" value="${esc(itb?.source_from || '')}">
      <input type="hidden" name="source_received_at" value="${esc(itb?.source_received_at || '')}">

      <label class="full-width">Project / job name
        <input type="text" name="project_name" value="${esc(itb?.project_name || '')}">
      </label>
      <label class="full-width">Location
        <input type="text" name="location" value="${esc(itb?.location || '')}" placeholder="Job site address or description">
      </label>

      <label>Bid due date
        <input type="date" name="due_date" value="${esc(toDateInputValue(itb?.due_date) || defaultDate || '')}">
      </label>
      <label>Received date
        <input type="date" name="received_date" value="${esc(toDateInputValue(itb?.received_date))}">
      </label>
      <label>Status ${pickSelect({ name: 'status', items: picklists.itb_status, current: itb?.status || 'New', placeholder: '-- select status --' })}</label>
      <label>Assigned rep ${pickSelect({ name: 'assigned_to', items: repItems, current: itb?.assigned_to || '', placeholder: '-- select rep --' })}</label>
      <label>Region ${marketSelect({ current: itb?.market })}</label>
      <label>Contract Type ${pickSelect({ name: 'contract_type', items: picklists.contract_type, current: itb?.contract_type || '', placeholder: '-- select type --' })}</label>
      <label>Vertical Market ${pickSelect({ name: 'vertical_market', items: picklists.vertical_market, current: itb?.vertical_market || '', placeholder: '-- select market --' })}</label>

      <label class="full-width">Notes
        <textarea name="notes" rows="5">${esc(itb?.notes || '')}</textarea>
      </label>

      <label class="full-width">Customers / GCs bidding this project <span class="muted small">(select all that apply — some projects have more than one GC bidding)</span>
        <select name="customer_ids" multiple size="6">
          ${customerOptions}
        </select>
      </label>
      <p class="full-width muted small">Cmd-click (Mac) to select more than one. New customer needed? Add them on <a href="/customers/new">Customers</a> first, then come back here.</p>

      ${isEdit ? attachmentsSectionHtml(itb.id, attachments || []) : ''}

      <div class="full-width form-actions" style="justify-content: space-between;">
        <div>
          ${isEdit ? `<a class="btn" href="/bid-calendar/itbs/${itb.id}/convert">Convert to Bid</a>` : ''}
          ${isEdit ? `<button class="btn btn-danger" type="submit" form="itb-delete-form">Delete</button>` : ''}
        </div>
        <button class="btn btn-primary" type="submit">${isEdit ? 'Save ITB' : 'Create ITB'}</button>
      </div>
    </form>
    ${isEdit ? `<form id="itb-delete-form" method="post" action="/bid-calendar/itbs/${itb.id}/delete${qs}" style="display:none"></form>` : ''}
    ${isEdit ? attachmentDeleteForms(itb.id, attachments || []) : ''}
  `;

  return layout({ title: isEdit ? 'Edit ITB' : 'New ITB', active: '/bid-calendar', body, flash });
}

export function renderConvertItbForm({ itb, linkedCustomers, customers, picklists, flash }) {
  // Same default as New Project / New Bid: converting an ITB into a priced
  // bid is almost always being done the day it's delivered.
  const todayStr = new Date().toISOString().slice(0, 10);
  const primaryOptions = customers.map((c) => {
    const loc = [c.city, c.state].filter(Boolean).join(', ');
    return `<option value="${c.id}">${esc(customerDisplayName(c))}${loc ? ` — ${esc(loc)}` : ''}</option>`;
  }).join('');

  const additionalOptions = customers.map((c) => `<option value="${c.id}">${esc(customerDisplayName(c))}</option>`).join('');

  const defaultPrimaryId = linkedCustomers[0]?.id || '';

  const body = `
    <div class="page-header">
      <h1>Convert ITB to Bid</h1>
      <a class="btn btn-ghost" href="/bid-calendar/itbs/${itb.id}/edit">Back to ITB</a>
    </div>
    <p class="muted">Turning &ldquo;${esc(itb.project_name)}&rdquo; into a priced bid. Pick the primary customer this bid should live under — any other linked GCs will be kept as additional customers on the bid.</p>

    <form class="card form-grid" method="post" action="/bid-calendar/itbs/${itb.id}/convert">
      <label class="full-width">Project name<input type="text" name="project_name" value="${esc(itb.project_name || '')}" required></label>
      <label class="full-width">Location<input type="text" name="location" value="${esc(itb.location || '')}" placeholder="Job site address or description"></label>
      <label>Region ${marketSelect({ current: itb.market })}</label>

      <label class="full-width">Primary customer
        <select name="primary_customer_id" required class="js-searchable" data-placeholder="Search customers...">
          <option value="">${itb.project_name ? '-- select the primary customer --' : ''}</option>
          ${primaryOptions}
        </select>
      </label>

      <label>Price ($)<input type="number" step="any" name="price"></label>
      <label>GM %<input type="number" step="any" name="gm_percent"></label>
      <label>Sales Status ${pickSelect({ name: 'sales_status', items: picklists.sales_status, current: '', placeholder: '-- select status --' })}</label>
      <label>Estimator ${pickSelect({ name: 'estimator', items: picklists.estimator, current: '', placeholder: '-- select estimator --' })}</label>
      <label>Contract Type ${pickSelect({ name: 'contract_type', items: picklists.contract_type, current: itb.contract_type || '', placeholder: '-- select type --' })}</label>
      <label>Vertical Market ${pickSelect({ name: 'vertical_market', items: picklists.vertical_market, current: itb.vertical_market || '', placeholder: '-- select market --' })}</label>
      <label>Roof Type ${pickSelect({ name: 'roof_type', items: picklists.roof_type, current: '', placeholder: '-- select roof type --' })}</label>
      <label>Squares<input type="number" step="any" name="squares"></label>
      <label>Delivered Date<input type="date" name="delivered_date" value="${todayStr}"></label>
      <label>Next Follow-up Date<input type="date" name="next_follow_up_date"></label>
      <label class="full-width">Notes<textarea name="notes" rows="3">${esc(itb.notes || '')}</textarea></label>

      <label class="full-width">Additional customers <span class="muted small">(other GCs linked to this ITB, if any)</span>
        <select name="additional_customer_ids" multiple size="6">
          ${additionalOptions}
        </select>
      </label>

      <div class="full-width form-actions">
        <button class="btn btn-primary" type="submit">Create bid &amp; mark ITB converted</button>
      </div>
    </form>
    <script>
      // Pre-select the primary customer + additional GCs from what was linked on the ITB.
      (function() {
        var primary = document.querySelector('select[name="primary_customer_id"]');
        var additional = document.querySelector('select[name="additional_customer_ids"]');
        var linkedIds = ${JSON.stringify(linkedCustomers.map((c) => c.id))};
        var defaultPrimary = ${JSON.stringify(defaultPrimaryId)};
        if (primary && defaultPrimary) primary.value = String(defaultPrimary);
        if (additional) {
          Array.from(additional.options).forEach(function(opt) {
            if (linkedIds.indexOf(Number(opt.value)) !== -1 && opt.value !== String(defaultPrimary)) {
              opt.selected = true;
            }
          });
        }
      })();
    </script>
  `;

  return layout({ title: 'Convert ITB to Bid', active: '/bid-calendar', body, flash });
}
