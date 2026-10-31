import { esc } from '../http-helpers.js';
import { layout } from './layout.js';
import { LIST_KEYS, LIST_META } from '../models/picklists.js';

function listCard(listKey, items) {
  const meta = LIST_META[listKey];
  const hasWeight = Boolean(meta.weightLabel);
  const hasWeight2 = Boolean(meta.weight2Label);
  const colCount = 2 + (hasWeight ? 1 : 0) + (hasWeight2 ? 1 : 0) + 1;

  // A <form> can't legally be a direct child of <tr> -- only <td>/<th> can.
  // A browser hitting that immediately discards the form (its <td> children
  // end up as plain siblings under <tr>, completely disconnected from any
  // form), so the "Save" button and its inputs did nothing at all when
  // clicked -- no error, no popup, just silently ignored. Each row's edit
  // form is now declared as a standalone form (collected in editForms below
  // and rendered after the table closes), with every input/button in the
  // row wired to it via the HTML5 form="..." attribute instead of wrapping
  // them. The per-row Delete form is unaffected -- it's correctly nested
  // inside its own <td>, which is a valid place for a form to live.
  const editForms = [];
  const rows = items.map((item) => {
    const formId = `dropdown-edit-form-${item.id}`;
    editForms.push(`<form id="${formId}" method="post" action="/settings/dropdowns/${listKey}/${item.id}" style="display:none"></form>`);
    return `
    <tr draggable="true" data-id="${item.id}">
      <td class="drag-handle" title="Drag to reorder">&#8942;&#8942;</td>
      <td><input type="text" name="label" form="${formId}" value="${esc(item.label)}"></td>
        ${hasWeight ? `<td><input type="number" step="any" name="weight" form="${formId}" value="${item.weight === null || item.weight === undefined ? '' : item.weight}" style="width:90px"></td>` : ''}
        ${hasWeight2 ? `<td><input type="number" step="any" name="weight2" form="${formId}" value="${item.weight2 === null || item.weight2 === undefined ? '' : item.weight2}" style="width:90px"></td>` : ''}
        <td class="dropdown-row-actions">
          <button class="btn btn-tiny" type="submit" form="${formId}">Save</button>
        </td>
      <td>
        <form method="post" action="/settings/dropdowns/${listKey}/${item.id}/delete" onsubmit="return confirm('Delete this option? Existing records keep the old value as free text.')">
          <button class="btn btn-tiny btn-danger" type="submit">Delete</button>
        </form>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="${colCount}" class="empty">No options yet.</td></tr>`;

  return `
    <div class="card dropdown-card">
      <h3>${esc(meta.label)}</h3>
      ${meta.hint ? `<p class="muted small">${esc(meta.hint)}</p>` : ''}
      ${listKey === 'contract_type' ? `<p class="small"><a href="/settings/close-days">Fine-tune close days by vertical market &rarr;</a></p>` : ''}
      <table class="data-table compact dropdown-table" data-list-key="${listKey}">
        <thead><tr><th></th><th>Option</th>${hasWeight ? `<th>${esc(meta.weightLabel)}</th>` : ''}${hasWeight2 ? `<th>${esc(meta.weight2Label)}</th>` : ''}<th colspan="2"></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${editForms.join('')}
      <p class="muted small">Drag the &#8942;&#8942; handle to reorder options.</p>
      <form class="inline-form" method="post" action="/settings/dropdowns/${listKey}">
        <input type="text" name="label" placeholder="New option..." required>
        ${hasWeight ? `<input type="number" step="any" name="weight" placeholder="${esc(meta.weightLabel)}" style="width:160px">` : ''}
        ${hasWeight2 ? `<input type="number" step="any" name="weight2" placeholder="${esc(meta.weight2Label)}" style="width:160px">` : ''}
        <button class="btn btn-small" type="submit">Add</button>
      </form>
    </div>
  `;
}

export function renderDropdowns({ picklists, flash }) {
  const cards = LIST_KEYS.map((key) => listCard(key, picklists[key] || [])).join('');
  const body = `
    <div class="page-header">
      <h1>Dropdown Lists</h1>
    </div>
    <p class="muted">Manage the options that show up in Contract Type, Vertical Market, Roof Type, Sales Status, Estimator, and Sales Rep dropdowns throughout the app.</p>
    <div class="dropdown-grid">${cards}</div>
  `;
  return layout({ title: 'Dropdown Lists', active: '/settings/dropdowns', body, flash });
}
