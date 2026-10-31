import { esc } from '../http-helpers.js';
import { layout } from './layout.js';

export function renderCloseDays({ contractTypes, verticalMarkets, matrix, flash }) {
  const headerRow = contractTypes.map((ct) => `<th>${esc(ct.label)}<div class="muted small">default ${ct.weight ?? '&mdash;'}d</div></th>`).join('');

  const bodyRows = verticalMarkets.map((vm) => {
    const cells = contractTypes.map((ct) => {
      const override = matrix[ct.label]?.[vm.label];
      const placeholder = ct.weight ?? '';
      return `<td><input type="number" step="1" name="days_${ct.id}_${vm.id}" value="${override ?? ''}" placeholder="${placeholder}" style="width:80px"></td>`;
    }).join('');
    return `<tr><th class="row-label">${esc(vm.label)}</th>${cells}</tr>`;
  }).join('');

  const body = `
    <div class="page-header">
      <h1>Close Days by Vertical Market</h1>
      <a class="btn btn-ghost" href="/settings/dropdowns">Back to Dropdown Lists</a>
    </div>
    <p class="muted">
      Overrides the default forecast days (set per Contract Type on the
      <a href="/settings/dropdowns">Dropdown Lists</a> page) for a specific
      Contract Type + Vertical Market combination. Leave a cell blank to use
      that contract type's default. This drives the Expected Close Date on
      the Pipeline tab.
    </p>

    ${contractTypes.length === 0 || verticalMarkets.length === 0 ? `
      <p class="empty">Add at least one Contract Type and one Vertical Market on the
      <a href="/settings/dropdowns">Dropdown Lists</a> page first.</p>
    ` : `
    <form method="post" action="/settings/close-days">
      <table class="data-table compact close-days-table">
        <thead><tr><th></th>${headerRow}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
      <div class="form-actions" style="margin-top:1rem">
        <button class="btn btn-primary" type="submit">Save close days</button>
      </div>
    </form>
    `}
  `;
  return layout({ title: 'Close Days', active: '/settings/dropdowns', body, flash });
}
