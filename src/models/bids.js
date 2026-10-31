import { all, get, run } from '../db.js';

const FIELDS = [
  'customer_id', 'itb_id', 'project_name', 'location', 'price', 'gm_percent', 'sales_status', 'estimator',
  'contract_type', 'vertical_market', 'roof_type', 'squares', 'market',
  'delivered_date', 'next_follow_up_date', 'notes',
];

// Every bid list/forecast query starts from this shape: the bid itself,
// joined to its customer (for name + rep), joined to the two picklists whose
// weight actually drives math (sales_status -> win probability, contract_type
// -> forecast days). expected_close_date and weighted_value are computed
// here in SQL so every query (UI + API) sees the same numbers.
//
// "rep" here is the bid's own Estimator when one is set, falling back to its
// customer's assigned rep only when it isn't (an older bid from before
// Estimator was in regular use, or one quick-created without it). It used to
// be just the customer's assigned rep, full stop -- which quietly broke in
// exactly the scenario Estimator exists for: a rep estimating a bid for a
// customer someone else owns couldn't filter Pipeline/Sales/Projects/
// Dashboard to it, and (since every rep-owned-record access check reads this
// same "rep") couldn't necessarily even open it. Every rep-filtered query
// and every rep-based access check (canAccessOwner in ui-routes.js) reads
// this one column, so this is the only place that needed to change.
//
// expected_close_date's date arithmetic is hand-written as native Postgres
// (b.delivered_date::date + N, formatted back to 'YYYY-MM-DD' text) rather
// than going through db.js's generic translate() -- it's SQLite's two-
// argument date(x, '+N days') form, the one date-function shape used in
// this app that doesn't have a single generic Postgres stand-in worth
// pattern-matching for everywhere else.
const BID_SELECT = `
  SELECT
    b.*,
    c.first_name AS customer_first_name,
    c.last_name AS customer_last_name,
    c.company_name AS customer_company_name,
    COALESCE(NULLIF(b.estimator, ''), c.assigned_to) AS rep,
    c.branch AS branch,
    ss.weight AS probability,
    COALESCE(cdr.days, ct.weight) AS forecast_days,
    CASE
      WHEN b.delivered_date IS NOT NULL AND b.delivered_date != '' AND COALESCE(cdr.days, ct.weight) IS NOT NULL
      THEN to_char(b.delivered_date::date + CAST(COALESCE(cdr.days, ct.weight) AS INTEGER), 'YYYY-MM-DD')
      ELSE NULL
    END AS expected_close_date,
    CASE
      WHEN b.price IS NOT NULL AND ss.weight IS NOT NULL
      THEN ROUND(CAST(b.price * ss.weight / 100.0 AS NUMERIC), 2)::float8
      ELSE NULL
    END AS weighted_value,
    CASE
      WHEN b.price IS NOT NULL AND b.gm_percent IS NOT NULL
      THEN ROUND(CAST(b.price * b.gm_percent / 100.0 AS NUMERIC), 2)::float8
      ELSE NULL
    END AS gm_dollars
  FROM bids b
  LEFT JOIN customers c ON c.id = b.customer_id
  LEFT JOIN picklists ss ON ss.list_key = 'sales_status' AND ss.label = b.sales_status
  LEFT JOIN picklists ct ON ct.list_key = 'contract_type' AND ct.label = b.contract_type
  LEFT JOIN close_day_rules cdr ON cdr.contract_type = b.contract_type AND cdr.vertical_market = b.vertical_market
`;

export async function listBidsForCustomer(customerId) {
  return all(`${BID_SELECT} WHERE b.customer_id = ? ORDER BY b.created_at DESC`, [customerId]);
}

export async function getBid(id) {
  return get(`${BID_SELECT} WHERE b.id = ?`, [id]);
}

export async function createBid(data) {
  const cols = [];
  const placeholders = [];
  const params = [];
  for (const f of FIELDS) {
    if (data[f] !== undefined) {
      cols.push(f);
      placeholders.push('?');
      params.push(data[f] === '' && ['price', 'gm_percent', 'squares'].includes(f) ? null : data[f]);
    }
  }
  const sql = `INSERT INTO bids (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`;
  const { lastInsertRowid } = await run(sql, params);
  return getBid(lastInsertRowid);
}

export async function updateBid(id, data) {
  const existing = await get('SELECT * FROM bids WHERE id = ?', [id]);
  if (!existing) return null;
  const sets = [];
  const params = [];
  for (const f of FIELDS) {
    if (data[f] !== undefined) {
      sets.push(`${f} = ?`);
      const val = data[f] === '' && ['price', 'gm_percent', 'squares'].includes(f) ? null : data[f];
      params.push(val);
    }
  }
  if (sets.length === 0) return getBid(id);
  sets.push("updated_at = datetime('now')");
  params.push(id);
  await run(`UPDATE bids SET ${sets.join(', ')} WHERE id = ?`, params);
  return getBid(id);
}

export async function deleteBid(id) {
  // tasks.bid_id has no ON DELETE CASCADE (see schema.sql), so without this,
  // deleting a bid that still has its auto-created follow-up task attached
  // violates the foreign key and throws, and the request never gets a
  // response at all (see the global error handler added in server.js for
  // the case where this kind of thing happens elsewhere too).
  await run('DELETE FROM tasks WHERE bid_id = ?', [id]);
  const { changes } = await run('DELETE FROM bids WHERE id = ?', [id]);
  return changes > 0;
}

/** Open pipeline: bids whose sales status probability is strictly between 0 and 100. */
export async function listPipelineBids({ month, rep, market, limit = 1000, offset = 0 } = {}) {
  const clauses = ['x.probability IS NOT NULL', 'x.probability > 0', 'x.probability < 100'];
  const params = [];
  if (rep) { clauses.push('x.rep = ?'); params.push(rep); }
  if (market) { clauses.push('x.market = ?'); params.push(market); }
  if (month) { clauses.push("x.expected_close_date IS NOT NULL AND strftime('%Y-%m', x.expected_close_date) = ?"); params.push(month); }
  const sql = `
    SELECT * FROM (${BID_SELECT}) x
    WHERE ${clauses.join(' AND ')}
    ORDER BY (x.expected_close_date IS NULL), x.expected_close_date ASC
    LIMIT ? OFFSET ?
  `;
  params.push(Number(limit), Number(offset));
  return all(sql, params);
}

export async function pipelineForecastTotal({ month, rep, market } = {}) {
  const items = await listPipelineBids({ month, rep, market, limit: 100000 });
  return items.reduce((sum, b) => sum + (b.weighted_value || 0), 0);
}

/** Won sales: bids whose sales status probability is exactly 100. */
export async function listWonBids({ month, rep, market, limit = 1000, offset = 0 } = {}) {
  const clauses = ['x.probability = 100'];
  const params = [];
  if (rep) { clauses.push('x.rep = ?'); params.push(rep); }
  if (market) { clauses.push('x.market = ?'); params.push(market); }
  if (month) { clauses.push("x.delivered_date IS NOT NULL AND x.delivered_date != '' AND strftime('%Y-%m', x.delivered_date) = ?"); params.push(month); }
  const sql = `
    SELECT * FROM (${BID_SELECT}) x
    WHERE ${clauses.join(' AND ')}
    ORDER BY x.delivered_date DESC
    LIMIT ? OFFSET ?
  `;
  params.push(Number(limit), Number(offset));
  return all(sql, params);
}

export async function listAllBids({ limit = 1000, offset = 0 } = {}) {
  return all(`${BID_SELECT} ORDER BY b.created_at DESC LIMIT ? OFFSET ?`, [Number(limit), Number(offset)]);
}

/** Projects list (all bids), with the same filters as Pipeline/Sales plus contract type, and a count of linked additional customers. */
export async function listProjects({ status, rep, contractType, market, q, limit = 1000, offset = 0 } = {}) {
  const clauses = [];
  const params = [];
  if (status) { clauses.push('x.sales_status = ?'); params.push(status); }
  if (rep) { clauses.push('x.rep = ?'); params.push(rep); }
  if (contractType) { clauses.push('x.contract_type = ?'); params.push(contractType); }
  if (market) { clauses.push('x.market = ?'); params.push(market); }
  if (q) {
    clauses.push(`(
      x.project_name LIKE ? OR x.location LIKE ? OR
      x.customer_first_name LIKE ? OR x.customer_last_name LIKE ? OR x.customer_company_name LIKE ?
    )`);
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const sql = `
    SELECT x.*, (SELECT COUNT(*) FROM bid_customers WHERE bid_id = x.id) AS additionalCount
    FROM (${BID_SELECT}) x
    ${where}
    ORDER BY x.created_at DESC
    LIMIT ? OFFSET ?
  `;
  params.push(Number(limit), Number(offset));
  return all(sql, params);
}

// Builds a "was this within the selected period" SQL clause for a date/datetime
// column. If one or more specific months were picked on the dashboard filter,
// that takes precedence (any of those months matches); otherwise falls back
// to the start/end range from the Week/Month/YTD preset. date(...) wrapping
// keeps this safe for both plain 'YYYY-MM-DD' columns (delivered_date) and
// full datetime columns (created_at).
function periodClause(dateExpr, { start, end, months }, params) {
  if (months && months.length) {
    const placeholders = months.map(() => '?').join(',');
    params.push(...months);
    return `${dateExpr} IS NOT NULL AND ${dateExpr} != '' AND strftime('%Y-%m', ${dateExpr}) IN (${placeholders})`;
  }
  params.push(start, end);
  return `${dateExpr} IS NOT NULL AND ${dateExpr} != '' AND date(${dateExpr}) >= ? AND date(${dateExpr}) <= ?`;
}

/** Total $ of all bids delivered within a date range (any status) - "bid dollars out" for the dashboard. */
export async function bidDollarsOut({ start, end, months, rep, contractType, market } = {}) {
  const params = [];
  const clauses = [periodClause('x.delivered_date', { start, end, months }, params)];
  if (rep) { clauses.push('x.rep = ?'); params.push(rep); }
  if (contractType) { clauses.push('x.contract_type = ?'); params.push(contractType); }
  if (market) { clauses.push('x.market = ?'); params.push(market); }
  const row = await get(`SELECT COALESCE(SUM(x.price), 0) AS total, COUNT(*) AS count FROM (${BID_SELECT}) x WHERE ${clauses.join(' AND ')}`, params);
  return row || { total: 0, count: 0 };
}

/** Total $ of Won bids delivered within a date range - dashboard's Sales tile. */
export async function salesTotalForPeriod({ start, end, months, rep, contractType, market } = {}) {
  const params = [];
  const clauses = ['x.probability = 100', periodClause('x.delivered_date', { start, end, months }, params)];
  if (rep) { clauses.push('x.rep = ?'); params.push(rep); }
  if (contractType) { clauses.push('x.contract_type = ?'); params.push(contractType); }
  if (market) { clauses.push('x.market = ?'); params.push(market); }
  const row = await get(`SELECT COALESCE(SUM(x.price), 0) AS total, COUNT(*) AS count FROM (${BID_SELECT}) x WHERE ${clauses.join(' AND ')}`, params);
  return row || { total: 0, count: 0 };
}

/** Count of bids/projects created within a date range (by created_at) - "new opportunities posted" for the dashboard. */
export async function countCreatedInPeriod({ start, end, months, rep, contractType, market } = {}) {
  const params = [];
  const clauses = [periodClause('x.created_at', { start, end, months }, params)];
  if (rep) { clauses.push('x.rep = ?'); params.push(rep); }
  if (contractType) { clauses.push('x.contract_type = ?'); params.push(contractType); }
  if (market) { clauses.push('x.market = ?'); params.push(market); }
  const row = await get(`SELECT COUNT(*) as n FROM (${BID_SELECT}) x WHERE ${clauses.join(' AND ')}`, params);
  return row ? row.n : 0;
}

/**
 * Win rate ("kill ratio"): Won bids / total bids delivered, among bids
 * delivered in the period (any status -- same population as "Bid $ Out").
 * With no date filters given at all, this is an all-time figure.
 */
export async function killRatio({ start, end, months, rep, contractType, market } = {}) {
  const params = [];
  const clauses = [];
  if ((months && months.length) || (start && end)) {
    clauses.push(periodClause('x.delivered_date', { start, end, months }, params));
  } else {
    clauses.push("x.delivered_date IS NOT NULL AND x.delivered_date != ''");
  }
  if (rep) { clauses.push('x.rep = ?'); params.push(rep); }
  if (contractType) { clauses.push('x.contract_type = ?'); params.push(contractType); }
  if (market) { clauses.push('x.market = ?'); params.push(market); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const row = await get(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN x.probability = 100 THEN 1 ELSE 0 END) AS won,
      COALESCE(SUM(x.price), 0) AS total_dollars,
      COALESCE(SUM(CASE WHEN x.probability = 100 THEN x.price ELSE 0 END), 0) AS won_dollars
    FROM (${BID_SELECT}) x ${where}
  `, params);
  const total = row?.total || 0;
  const won = row?.won || 0;
  const totalDollars = row?.total_dollars || 0;
  const wonDollars = row?.won_dollars || 0;
  return {
    won, total, ratio: total ? (won / total) * 100 : null,
    // Dollar-weighted kill ratio: won bid dollars / total delivered bid
    // dollars in the same period -- a big job that dies pulls this down more
    // than a small one does, unlike the count-based ratio above.
    wonDollars, totalDollars, dollarRatio: totalDollars ? (wonDollars / totalDollars) * 100 : null,
  };
}

/** Most recent project name among a customer's bids, if any -- used to show "project name first" on lead/customer summaries that aren't bid rows themselves (e.g. the dashboard's Recent Leads box). */
export async function latestProjectNameForCustomer(customerId) {
  const row = await get("SELECT project_name FROM bids WHERE customer_id = ? AND project_name IS NOT NULL AND project_name != '' ORDER BY created_at DESC LIMIT 1", [customerId]);
  return row ? row.project_name : null;
}

/** Distinct rep names seen on customers or as a bid's Estimator, for filter dropdowns (covers legacy free-text values too, from either field). */
export async function distinctReps() {
  const rows = await all(`
    SELECT assigned_to AS name FROM customers WHERE assigned_to != ''
    UNION
    SELECT estimator AS name FROM bids WHERE estimator != ''
    ORDER BY name
  `);
  return rows.map((r) => r.name);
}

// --- Additional customers on a bid (multi-property / New Construction) -----

export async function listAdditionalCustomers(bidId) {
  return all(`
    SELECT c.* FROM bid_customers bc
    JOIN customers c ON c.id = bc.customer_id
    WHERE bc.bid_id = ?
    ORDER BY c.first_name, c.last_name, c.company_name
  `, [bidId]);
}

export async function setAdditionalCustomers(bidId, customerIds = []) {
  await run('DELETE FROM bid_customers WHERE bid_id = ?', [bidId]);
  const uniqueIds = [...new Set(customerIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  for (const customerId of uniqueIds) {
    // ON CONFLICT DO NOTHING -- Postgres equivalent of SQLite's INSERT OR
    // IGNORE, relying on bid_customers' UNIQUE(bid_id, customer_id).
    await run('INSERT INTO bid_customers (bid_id, customer_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [bidId, customerId]);
  }
}

/** All bids (as primary or additional customer) a given customer is linked to - shown on their detail page. */
export async function listBidsLinkedToCustomer(customerId) {
  return all(`
    SELECT * FROM (${BID_SELECT}) x
    WHERE x.customer_id = ? OR x.id IN (SELECT bid_id FROM bid_customers WHERE customer_id = ?)
    ORDER BY x.created_at DESC
  `, [customerId, customerId]);
}
