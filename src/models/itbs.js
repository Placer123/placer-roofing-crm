import { all, get, run } from '../db.js';

const FIELDS = [
  'project_name', 'location', 'due_date', 'received_date', 'status', 'assigned_to',
  'contract_type', 'vertical_market', 'notes', 'market',
  'source_subject', 'source_from', 'source_received_at',
];

const CUSTOMER_NAME_EXPR = `
  CASE WHEN TRIM(c.first_name || ' ' || c.last_name) != ''
       THEN TRIM(c.first_name || ' ' || c.last_name)
       ELSE c.company_name END
`;

// Every ITB list query starts here: the ITB plus a comma-joined summary of
// its linked customers/GCs and how many there are, for calendar cards.
// STRING_AGG is Postgres's name for what SQLite calls GROUP_CONCAT -- same
// two-argument (expression, separator) shape, same NULL-skipping behavior.
const ITB_SELECT = `
  SELECT
    itbs.*,
    (SELECT STRING_AGG(${CUSTOMER_NAME_EXPR}, ', ')
       FROM itb_customers ic JOIN customers c ON c.id = ic.customer_id
       WHERE ic.itb_id = itbs.id) AS customer_names,
    (SELECT COUNT(*) FROM itb_customers WHERE itb_id = itbs.id) AS customer_count
  FROM itbs
`;

export async function listByRange({ start, end, rep, status, market } = {}) {
  const clauses = ['due_date >= ?', 'due_date <= ?'];
  const params = [start, end];
  if (rep) { clauses.push('assigned_to = ?'); params.push(rep); }
  if (status) { clauses.push('status = ?'); params.push(status); }
  if (market) { clauses.push('market = ?'); params.push(market); }
  return all(`${ITB_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY due_date ASC`, params);
}

export async function listUpcoming({ rep, market, limit = 10 } = {}) {
  const clauses = ["status != 'Converted'", "status != 'Declined'"];
  const params = [];
  if (rep) { clauses.push('assigned_to = ?'); params.push(rep); }
  if (market) { clauses.push('market = ?'); params.push(market); }
  params.push(Number(limit));
  return all(`${ITB_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY due_date ASC LIMIT ?`, params);
}

export async function getItb(id) {
  return get(`${ITB_SELECT} WHERE itbs.id = ?`, [id]);
}

export async function createItb(data) {
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
  const sql = `INSERT INTO itbs (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`;
  const { lastInsertRowid } = await run(sql, params);
  return getItb(lastInsertRowid);
}

export async function updateItb(id, data) {
  const existing = await get('SELECT * FROM itbs WHERE id = ?', [id]);
  if (!existing) return null;
  const sets = [];
  const params = [];
  for (const f of FIELDS) {
    if (data[f] !== undefined) {
      sets.push(`${f} = ?`);
      params.push(data[f]);
    }
  }
  if (sets.length === 0) return getItb(id);
  sets.push("updated_at = datetime('now')");
  params.push(id);
  await run(`UPDATE itbs SET ${sets.join(', ')} WHERE id = ?`, params);
  return getItb(id);
}

export async function rescheduleItb(id, dueDate) {
  return updateItb(id, { due_date: dueDate });
}

export async function deleteItb(id) {
  // bids.itb_id has no ON DELETE CASCADE (see schema.sql) -- a bid that
  // already came from converting this ITB is a real, independent record at
  // this point though, so unlink it rather than deleting it out from under
  // whoever's looking at it.
  await run('UPDATE bids SET itb_id = NULL WHERE itb_id = ?', [id]);
  const { changes } = await run('DELETE FROM itbs WHERE id = ?', [id]);
  return changes > 0;
}

export async function listLinkedCustomers(itbId) {
  return all(`
    SELECT c.* FROM itb_customers ic
    JOIN customers c ON c.id = ic.customer_id
    WHERE ic.itb_id = ?
    ORDER BY c.first_name, c.last_name, c.company_name
  `, [itbId]);
}

export async function setLinkedCustomers(itbId, customerIds = []) {
  await run('DELETE FROM itb_customers WHERE itb_id = ?', [itbId]);
  const uniqueIds = [...new Set(customerIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  for (const customerId of uniqueIds) {
    // ON CONFLICT DO NOTHING -- Postgres equivalent of SQLite's INSERT OR
    // IGNORE, relying on itb_customers' UNIQUE(itb_id, customer_id).
    await run('INSERT INTO itb_customers (itb_id, customer_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [itbId, customerId]);
  }
}
