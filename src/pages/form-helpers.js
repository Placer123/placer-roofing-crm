import { esc } from '../http-helpers.js';
import { MARKETS } from '../constants.js';

/**
 * A browser's <input type="date"> only accepts a value in exact YYYY-MM-DD
 * form -- anything else (a stored datetime with a time component, a legacy
 * MM/DD/YYYY value, an older export, etc.) it silently discards, leaving the
 * field blank with no visible error. That's harmless on its own, but a
 * blank *required* date field then silently blocks the whole form's submit
 * with native browser validation -- no error, no network request, the page
 * just doesn't do anything, which looks exactly like "Save is broken" from
 * the outside. This coerces whatever's stored into a real YYYY-MM-DD (or ''
 * if it truly can't be parsed) so an old record always pre-fills correctly
 * instead of only working for dates saved through this exact form already.
 */
export function toDateInputValue(value) {
  if (!value) return '';
  const str = String(value).trim();
  if (!str) return '';
  const isoMatch = str.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return '';
}

/**
 * Builds a <select> populated from picklist items (each {label}), preserving
 * a currently-stored value even if it's no longer (or never was) in the list
 * -- keeps legacy free-text data and deleted options from silently vanishing.
 */
export function pickSelect({ name, items, current, placeholder = '-- select --', required = false }) {
  const labels = items.map((i) => i.label);
  const currentVal = current || '';
  const needsFallback = currentVal && !labels.includes(currentVal);
  const options = [
    `<option value="">${esc(placeholder)}</option>`,
    needsFallback ? `<option value="${esc(currentVal)}" selected>${esc(currentVal)} (no longer in list)</option>` : '',
    ...labels.map((label) => `<option value="${esc(label)}"${label === currentVal ? ' selected' : ''}>${esc(label)}</option>`),
  ].join('');
  return `<select name="${esc(name)}"${required ? ' required' : ''}>${options}</select>`;
}

/**
 * The CA/AZ "Region" field on a Bid/ITB/Customer form -- which state's book
 * of business this record belongs to (see MARKETS in constants.js; the DB
 * column and every query param are named "market" internally, but that word
 * is already taken in the UI by the existing Vertical Market picklist field
 * -- Commercial/Residential/etc, a totally different thing -- so every
 * user-facing label here says "Region" instead to keep the two apart).
 * Always one or the other, so unlike pickSelect there's no blank placeholder
 * option; a brand-new record defaults to CA (decades of history there vs.
 * Arizona being the new, deliberately-chosen case) rather than whichever
 * value happens to be first in the list.
 */
export function marketSelect({ name = 'market', current } = {}) {
  const value = current || 'CA';
  const options = MARKETS.map((m) => `<option value="${m}"${m === value ? ' selected' : ''}>${m}</option>`).join('');
  return `<select name="${esc(name)}">${options}</select>`;
}

/**
 * The AZ/CA/Combined Region FILTER dropdown used on every list/dashboard tab
 * -- unlike marketSelect above, this one's blank option is meaningful ("no
 * filter" = both regions combined), matching how the existing Rep and
 * Contract Type filters on these same tabs already work.
 */
export function marketFilterSelect({ name = 'market', current } = {}) {
  const value = current || '';
  const options = [
    '<option value="">All regions (combined)</option>',
    ...MARKETS.map((m) => `<option value="${m}"${m === value ? ' selected' : ''}>${m}</option>`),
  ].join('');
  return `<select name="${esc(name)}">${options}</select>`;
}

export function monthOptions(current, monthsBack = 6, monthsForward = 12) {
  const now = new Date();
  const opts = [];
  for (let i = -monthsBack; i <= monthsForward; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    const value = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    opts.push(`<option value="${value}"${value === current ? ' selected' : ''}>${label}</option>`);
  }
  return opts.join('');
}

/** Same idea as monthOptions, but for a <select multiple> -- marks every month in `selectedList` as selected instead of just one. */
export function monthOptionsMulti(selectedList = [], monthsBack = 6, monthsForward = 6) {
  const selected = Array.isArray(selectedList) ? selectedList : [selectedList].filter(Boolean);
  const now = new Date();
  const opts = [];
  for (let i = -monthsBack; i <= monthsForward; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    const value = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    opts.push(`<option value="${value}"${selected.includes(value) ? ' selected' : ''}>${label}</option>`);
  }
  return opts.join('');
}

/**
 * Single combined filter for the Dashboard's date range picker -- replaces
 * the old two-dropdown (Week/Month/YTD preset + rolling 12-month multi-pick)
 * setup with one <select multiple>: three "preset:*" quick-range options
 * followed by the current calendar year's months, January first. Picking any
 * specific month(s) overrides the preset (see periodClause in models/bids.js,
 * which already prefers `months` over a start/end range when both are sent).
 */
export function dashFilterOptions(selectedList = []) {
  const selected = Array.isArray(selectedList) ? selectedList : [selectedList].filter(Boolean);
  const presets = [
    { value: 'preset:week', label: 'This Week' },
    { value: 'preset:month', label: 'This Month' },
    { value: 'preset:ytd', label: 'Year to Date' },
  ];
  const presetOpts = presets
    .map((p) => `<option value="${p.value}"${selected.includes(p.value) ? ' selected' : ''}>${esc(p.label)}</option>`)
    .join('');
  const year = new Date().getUTCFullYear();
  const monthOpts = [];
  for (let m = 0; m < 12; m++) {
    const value = `${year}-${String(m + 1).padStart(2, '0')}`;
    const label = new Date(Date.UTC(year, m, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    monthOpts.push(`<option value="${value}"${selected.includes(value) ? ' selected' : ''}>${label}</option>`);
  }
  return `<optgroup label="Quick range">${presetOpts}</optgroup><optgroup label="${year}">${monthOpts.join('')}</optgroup>`;
}

export function money(value) {
  if (value === null || value === undefined || value === '') return '&mdash;';
  const n = Number(value);
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function pct(value) {
  if (value === null || value === undefined || value === '') return '&mdash;';
  return `${Number(value)}%`;
}

/** A bid's customer name, from the customer fields joined onto every BID_SELECT row. A bid can now be started before a customer is known, so this handles a null customer_id too. */
export function bidCustomerName(b) {
  const name = [b.customer_first_name, b.customer_last_name].filter(Boolean).join(' ');
  if (name) return name;
  if (b.customer_company_name) return b.customer_company_name;
  return b.customer_id ? `#${b.customer_id}` : 'No customer yet';
}

/** A customer's display name for dropdown options -- includes the company name alongside the personal name so GCs/companies are easy to spot in long lists. */
export function customerDisplayName(c) {
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
  if (name && c.company_name) return `${name} — ${c.company_name}`;
  return name || c.company_name || `#${c.id}`;
}

/** How a project/bid should be identified first: its Project Name, falling back to the customer's name for older bids that predate that field. */
export function projectLabel(b) {
  return b.project_name && b.project_name.trim() ? b.project_name : bidCustomerName(b);
}

export function fileSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
