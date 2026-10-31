import { all, get, run } from '../db.js';

// Every configurable dropdown in the app lives in one of these lists.
export const LIST_KEYS = [
  'contract_type',
  'vertical_market',
  'roof_type',
  'sales_status',
  'sales_rep',
  'itb_status',
];

export const LIST_META = {
  contract_type: {
    label: 'Contract Type',
    weightLabel: 'Forecast days (from bid delivered date)',
    weight2Label: 'Follow-up cadence (days)',
    hint: 'How many days out a bid of this type typically closes — drives the pipeline forecast date. Follow-up cadence is how often a rep should check back in on an open bid of this type (e.g. New Construction every 7 days, Reroof every 3) — follow-ups keep auto-scheduling at that interval until the forecast window above runs out.',
  },
  vertical_market: { label: 'Vertical Market Type', weightLabel: null, hint: '' },
  roof_type: { label: 'Roof Type', weightLabel: null, hint: '' },
  sales_status: {
    label: 'Sales Status',
    weightLabel: 'Win probability %',
    hint: 'Used to weight the pipeline forecast. 100 = Won, 0 = Lost, anything between is still open.',
  },
  sales_rep: { label: 'Sales Rep', weightLabel: null, hint: 'Also used for the Estimator dropdown on bids/projects — one list of people covers both roles.' },
  itb_status: { label: 'ITB Status', weightLabel: null, hint: 'Statuses used on the Bid Calendar.' },
};

export async function listItems(listKey) {
  return all('SELECT * FROM picklists WHERE list_key = ? ORDER BY sort_order ASC, label ASC', [listKey]);
}

export async function listAll() {
  const out = {};
  for (const key of LIST_KEYS) out[key] = await listItems(key);
  return out;
}

export async function getItem(id) {
  return get('SELECT * FROM picklists WHERE id = ?', [id]);
}

/** Looks up the weight for a given list + label (e.g. probability % for a sales status). */
export async function getWeight(listKey, label) {
  if (!label) return null;
  const row = await get('SELECT weight FROM picklists WHERE list_key = ? AND label = ?', [listKey, label]);
  return row ? row.weight : null;
}

/** Same idea as getWeight, for the second numeric field (currently only contract_type's follow-up cadence days). */
export async function getWeight2(listKey, label) {
  if (!label) return null;
  const row = await get('SELECT weight2 FROM picklists WHERE list_key = ? AND label = ?', [listKey, label]);
  return row ? row.weight2 : null;
}

export async function createItem(listKey, label, weight, weight2) {
  const maxRow = await get('SELECT MAX(sort_order) as m FROM picklists WHERE list_key = ?', [listKey]);
  const sortOrder = (maxRow?.m ?? 0) + 1;
  const { lastInsertRowid } = await run(
    'INSERT INTO picklists (list_key, label, weight, weight2, sort_order) VALUES (?, ?, ?, ?, ?)',
    [listKey, label, weight === '' || weight === undefined ? null : Number(weight),
      weight2 === '' || weight2 === undefined ? null : Number(weight2), sortOrder]
  );
  return getItem(lastInsertRowid);
}

export async function updateItem(id, { label, weight, weight2 }) {
  const existing = await getItem(id);
  if (!existing) return null;
  await run('UPDATE picklists SET label = ?, weight = ?, weight2 = ? WHERE id = ?', [
    label !== undefined ? label : existing.label,
    weight !== undefined ? (weight === '' ? null : Number(weight)) : existing.weight,
    weight2 !== undefined ? (weight2 === '' ? null : Number(weight2)) : existing.weight2,
    id,
  ]);
  return getItem(id);
}

export async function deleteItem(id) {
  const { changes } = await run('DELETE FROM picklists WHERE id = ?', [id]);
  return changes > 0;
}

/** Persists a new drag-and-drop order for a list's options. */
export async function reorderItems(listKey, orderedIds) {
  for (let i = 0; i < orderedIds.length; i++) {
    await run('UPDATE picklists SET sort_order = ? WHERE id = ? AND list_key = ?', [i, orderedIds[i], listKey]);
  }
}

/**
 * Idempotently makes sure a single default option exists in a list, even on
 * a database where seedDefaults() already ran (which only seeds a list while
 * it's completely empty). Use this to roll out a new default value later
 * (e.g. adding "Service" to Contract Type) without disturbing what's already
 * there. Safe to call every boot.
 */
export async function ensureDefaultItem(listKey, label, weight = null) {
  const existing = await get('SELECT id FROM picklists WHERE list_key = ? AND label = ?', [listKey, label]);
  if (existing) return existing;
  return createItem(listKey, label, weight);
}

/**
 * Backfills a default weight2 (e.g. follow-up cadence days) onto an
 * existing picklist item that predates the weight2 column -- only if it's
 * still NULL, so it never overwrites a value someone has since set. Safe to
 * call every boot; a no-op once the value has been set once (by this or by
 * hand in Dropdown Lists).
 */
export async function ensureWeight2Default(listKey, label, weight2) {
  const existing = await get('SELECT id, weight2 FROM picklists WHERE list_key = ? AND label = ?', [listKey, label]);
  if (!existing || existing.weight2 !== null) return;
  await run('UPDATE picklists SET weight2 = ? WHERE id = ?', [weight2, existing.id]);
}

const DEFAULTS = {
  contract_type: [
    ['Reroof', 60, 3],
    ['New Construction', 120, 7],
    ['Service', 90, 7],
  ],
  vertical_market: [
    ['Commercial', null],
    ['Residential', null],
    ['Industrial', null],
    ['Multifamily', null],
    ['Government / Education', null],
    ['Retail', null],
  ],
  roof_type: [
    ['Shingle', null],
    ['TPO', null],
    ['EPDM', null],
    ['Metal', null],
    ['Tile', null],
    ['Modified Bitumen', null],
    ['Built-Up (BUR)', null],
    ['Other', null],
  ],
  sales_status: [
    ['20%', 20],
    ['50%', 50],
    ['90%', 90],
    ['Won', 100],
    ['Lost', 0],
  ],
  sales_rep: [],
  itb_status: [
    ['New', null],
    ['Reviewing', null],
    ['Bidding', null],
    ['Declined', null],
    ['Converted', null],
  ],
};

/** Populates default dropdown values on first run. Safe to call every boot. */
export async function seedDefaults() {
  for (const listKey of LIST_KEYS) {
    const existingCount = (await get('SELECT COUNT(*) as n FROM picklists WHERE list_key = ?', [listKey])).n;
    if (existingCount > 0) continue;
    for (let i = 0; i < DEFAULTS[listKey].length; i++) {
      const [label, weight, weight2] = DEFAULTS[listKey][i];
      // ON CONFLICT DO NOTHING -- Postgres equivalent of SQLite's INSERT OR
      // IGNORE, relying on picklists' UNIQUE(list_key, label).
      await run('INSERT INTO picklists (list_key, label, weight, weight2, sort_order) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING', [listKey, label, weight, weight2 ?? null, i]);
    }
  }
}
