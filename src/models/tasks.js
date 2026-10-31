import { all, get, run } from '../db.js';

const FIELDS = ['customer_id', 'bid_id', 'title', 'description', 'due_date', 'status', 'assigned_to', 'notes', 'email_sent'];

export async function listTasks({ customerId, status, assignedTo, dueBefore, limit = 200, offset = 0 } = {}) {
  const clauses = [];
  const params = [];
  if (customerId) { clauses.push('tasks.customer_id = ?'); params.push(customerId); }
  if (status) { clauses.push('tasks.status = ?'); params.push(status); }
  if (assignedTo) { clauses.push('tasks.assigned_to = ?'); params.push(assignedTo); }
  if (dueBefore) { clauses.push('tasks.due_date != \'\' AND tasks.due_date <= ?'); params.push(dueBefore); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const sql = `
    SELECT tasks.*, customers.first_name, customers.last_name, customers.company_name,
           bids.project_name AS bid_project_name
    FROM tasks
    LEFT JOIN customers ON customers.id = tasks.customer_id
    LEFT JOIN bids ON bids.id = tasks.bid_id
    ${where}
    ORDER BY (tasks.due_date = '') ASC, tasks.due_date ASC, tasks.created_at DESC
    LIMIT ? OFFSET ?
  `;
  params.push(Number(limit), Number(offset));
  return all(sql, params);
}

export async function getTask(id) {
  return get('SELECT * FROM tasks WHERE id = ?', [id]);
}

/** The open follow-up task linked to a bid, if one exists -- used to keep a bid's Next Follow-up Date in sync with its task instead of creating duplicates. */
export async function getOpenTaskForBid(bidId) {
  return get("SELECT * FROM tasks WHERE bid_id = ? AND status = 'open' ORDER BY due_date ASC LIMIT 1", [bidId]);
}

/**
 * Enforces "only one open follow-up at a time per bid" -- marks every OTHER
 * open task on this bid as done, keeping only `keepTaskId` open. Call this
 * right after whatever action just created or reopened the task that should
 * be the sole survivor (completing a follow-up and auto-scheduling the next
 * one, manually scheduling a next follow-up, or reopening a done task) --
 * without it, a bid could end up with two or more open follow-ups (e.g. the
 * auto-scheduled next one AND a manually-added "+ Next follow-up", or a
 * reopened old one alongside a newer auto-created one), which is exactly the
 * bug that made a just-completed follow-up look like it never went away: the
 * row for that job stayed on the dashboard because a second, unrelated open
 * task for the same bid was still sitting there the whole time.
 */
export async function closeOtherOpenTasksForBid(bidId, keepTaskId) {
  if (!bidId) return;
  await run("UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE bid_id = ? AND status = 'open' AND id != ?", [bidId, keepTaskId]);
}

export async function createTask(data) {
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
  const sql = `INSERT INTO tasks (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`;
  const { lastInsertRowid } = await run(sql, params);
  return getTask(lastInsertRowid);
}

export async function updateTask(id, data) {
  const existing = await getTask(id);
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
  sets.push("updated_at = datetime('now')");
  params.push(id);
  await run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, params);
  return getTask(id);
}

export async function deleteTask(id) {
  const { changes } = await run('DELETE FROM tasks WHERE id = ?', [id]);
  return changes > 0;
}
