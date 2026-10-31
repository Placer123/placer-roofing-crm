import { all, get, run } from '../db.js';
import { hashPassword, verifyPassword } from '../auth.js';

const PUBLIC_FIELDS = 'id, username, display_name, role, rep_label, market, created_at';

export async function listUsers() {
  return all(`SELECT ${PUBLIC_FIELDS} FROM users ORDER BY role ASC, display_name ASC`);
}
export async function countUsers() {
  return (await get('SELECT COUNT(*) AS n FROM users')).n;
}
export async function getUser(id) {
  return get(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = ?`, [id]);
}
export async function getUserByUsername(username) {
  return get('SELECT * FROM users WHERE username = ?', [String(username || '').trim().toLowerCase()]);
}
export async function createUser({ username, password, displayName, role, repLabel, market }) {
  const { hash, salt } = hashPassword(password);
  const { lastInsertRowid } = await run(
    'INSERT INTO users (username, password_hash, password_salt, display_name, role, rep_label, market) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [String(username).trim().toLowerCase(), hash, salt, displayName || username, role === 'manager' ? 'manager' : 'rep', role === 'manager' ? '' : (repLabel || ''), market || 'CA']
  );
  return getUser(lastInsertRowid);
}
export async function updateUser(id, { displayName, role, repLabel, market, password }) {
  const existing = await get('SELECT * FROM users WHERE id = ?', [id]);
  if (!existing) return null;
  const sets = [];
  const params = [];
  if (displayName !== undefined) { sets.push('display_name = ?'); params.push(displayName); }
  if (role !== undefined) { sets.push('role = ?'); params.push(role === 'manager' ? 'manager' : 'rep'); }
  if (repLabel !== undefined) { sets.push('rep_label = ?'); params.push(role === 'manager' ? '' : (repLabel || '')); }
  if (market !== undefined) { sets.push('market = ?'); params.push(market || 'CA'); }
  if (password) {
    const { hash, salt } = hashPassword(password);
    sets.push('password_hash = ?', 'password_salt = ?');
    params.push(hash, salt);
  }
  if (sets.length === 0) return getUser(id);
  params.push(id);
  await run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
  return getUser(id);
}
export async function deleteUser(id) {
  const { changes } = await run('DELETE FROM users WHERE id = ?', [id]);
  return changes > 0;
}
export async function verifyLogin(username, password) {
  const user = await getUserByUsername(username);
  if (!user) return null;
  if (!verifyPassword(password, user.password_hash, user.password_salt)) return null;
  return user;
}
