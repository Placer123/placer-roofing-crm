import { all, get, run } from '../db.js';

export async function listDocuments({ customerId, bidId, docType, limit = 200, offset = 0 } = {}) {
  const clauses = [];
  const params = [];
  if (customerId) { clauses.push('customer_id = ?'); params.push(customerId); }
  if (bidId) { clauses.push('bid_id = ?'); params.push(bidId); }
  if (docType) { clauses.push('doc_type = ?'); params.push(docType); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const sql = `SELECT * FROM documents ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(Number(limit), Number(offset));
  return all(sql, params);
}

export async function getDocument(id) {
  return get('SELECT * FROM documents WHERE id = ?', [id]);
}

export async function createDocument(data) {
  const { lastInsertRowid } = await run(
    'INSERT INTO documents (customer_id, bid_id, title, url, doc_type) VALUES (?, ?, ?, ?, ?)',
    [data.customer_id ?? null, data.bid_id ?? null, data.title, data.url, data.doc_type || 'other']
  );
  return getDocument(lastInsertRowid);
}

export async function deleteDocument(id) {
  const { changes } = await run('DELETE FROM documents WHERE id = ?', [id]);
  return changes > 0;
}
