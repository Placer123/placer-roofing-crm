import { all, get, run } from '../db.js';

const FIELDS = [
  'record_type', 'stage', 'first_name', 'last_name', 'company_name',
  'email', 'phone', 'address', 'city', 'state', 'zip', 'branch', 'market',
  'source', 'assigned_to', 'notes',
];

export async function listCustomers({ recordType, stage, state, branch, market, q, limit = 200, offset = 0 } = {}) {
  const clauses = [];
  const params = [];

  if (recordType) { clauses.push('record_type = ?'); params.push(recordType); }
  if (stage) { clauses.push('stage = ?'); params.push(stage); }
  if (state) { clauses.push('state = ?'); params.push(state); }
  if (branch) { clauses.push('branch = ?'); params.push(branch); }
  if (market) { clauses.push('market = ?'); params.push(market); }
  if (q) {
    clauses.push(`(
      first_name LIKE ? OR last_name LIKE ? OR company_name LIKE ? OR
      email LIKE ? OR phone LIKE ? OR city LIKE ?
    )`);
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const sql = `SELECT * FROM customers ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`;
  params.push(Number(limit), Number(offset));
  return all(sql, params);
}

export async function countCustomers({ recordType, stage, state, branch, market, q } = {}) {
  const clauses = [];
  const params = [];
  if (recordType) { clauses.push('record_type = ?'); params.push(recordType); }
  if (stage) { clauses.push('stage = ?'); params.push(stage); }
  if (state) { clauses.push('state = ?'); params.push(state); }
  if (branch) { clauses.push('branch = ?'); params.push(branch); }
  if (market) { clauses.push('market = ?'); params.push(market); }
  if (q) {
    clauses.push(`(
      first_name LIKE ? OR last_name LIKE ? OR company_name LIKE ? OR
      email LIKE ? OR phone LIKE ? OR city LIKE ?
    )`);
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const row = await get(`SELECT COUNT(*) as n FROM customers ${where}`, params);
  return row ? row.n : 0;
}

export async function getCustomer(id) {
  return get('SELECT * FROM customers WHERE id = ?', [id]);
}

export async function createCustomer(data) {
  const cols = [];
  const placeholders = [];
  const params = [];
  for (const f of FIELDS) {
    if (data[f] !== undefined) {
      cols.push(f);
      placeholders.push('?');
      params.push(data[f]);
    }
  }
  const sql = `INSERT INTO customers (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`;
  const { lastInsertRowid } = await run(sql, params);
  return getCustomer(lastInsertRowid);
}

export async function updateCustomer(id, data) {
  const existing = await getCustomer(id);
  if (!existing) return null;

  const sets = [];
  const params = [];
  for (const f of FIELDS) {
    if (data[f] !== undefined) {
      sets.push(`${f} = ?`);
      params.push(data[f]);
    }
  }
  if (sets.length === 0) return existing;

  // Business rule: moving a lead to the "won" stage promotes it to a customer.
  if (data.stage === 'won' && data.record_type === undefined) {
    sets.push('record_type = ?');
    params.push('customer');
  }

  sets.push("updated_at = datetime('now')");
  params.push(id);
  await run(`UPDATE customers SET ${sets.join(', ')} WHERE id = ?`, params);
  return getCustomer(id);
}

export async function deleteCustomer(id) {
  const { changes } = await run('DELETE FROM customers WHERE id = ?', [id]);
  return changes > 0;
}

/** Count of customers/leads created within a date range (by created_at), for the dashboard. Pass `months` (an array of 'YYYY-MM') to match any of those specific months instead of a contiguous range. */
export async function countCreatedInPeriod({ recordType, start, end, months, rep, market } = {}) {
  const clauses = [];
  const params = [];
  if (months && months.length) {
    clauses.push(`strftime('%Y-%m', created_at) IN (${months.map(() => '?').join(',')})`);
    params.push(...months);
  } else {
    clauses.push('date(created_at) >= ?', 'date(created_at) <= ?');
    params.push(start, end);
  }
  if (recordType) { clauses.push('record_type = ?'); params.push(recordType); }
  if (rep) { clauses.push('assigned_to = ?'); params.push(rep); }
  if (market) { clauses.push('market = ?'); params.push(market); }
  const row = await get(`SELECT COUNT(*) as n FROM customers WHERE ${clauses.join(' AND ')}`, params);
  return row ? row.n : 0;
}

/** Case-insensitive exact match on email -- used to find an existing GC/customer before creating a duplicate when scrubbing a dropped email for contact info (see email-parser.js + the ITB attachments route). */
export async function findByEmail(email) {
  if (!email) return null;
  return get('SELECT * FROM customers WHERE email != \'\' AND LOWER(email) = LOWER(?) LIMIT 1', [email]);
}

/** Same idea as findByEmail, but matching company_name -- the fallback when a dropped email has no reliable address but does have a recognizable company name in its signature. */
export async function findByCompanyName(companyName) {
  if (!companyName) return null;
  return get('SELECT * FROM customers WHERE company_name != \'\' AND LOWER(company_name) = LOWER(?) LIMIT 1', [companyName]);
}

export async function pipelineSummary() {
  return all(`
    SELECT stage, COUNT(*) as count
    FROM customers
    WHERE record_type = 'lead'
    GROUP BY stage
  `);
}
