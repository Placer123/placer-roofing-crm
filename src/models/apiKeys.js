import crypto from 'node:crypto';
import { all, get, run } from '../db.js';

function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/** Generate a new API key, store its hash, and return the plaintext key (shown once). */
export async function createApiKey(label = '') {
  const key = `rcrm_${crypto.randomBytes(24).toString('hex')}`;
  await run('INSERT INTO api_keys (label, key_hash) VALUES (?, ?)', [label, hashKey(key)]);
  return key;
}

export async function verifyApiKey(key) {
  if (!key) return false;
  const row = await get('SELECT id FROM api_keys WHERE key_hash = ?', [hashKey(key)]);
  if (!row) return false;
  await run("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?", [row.id]);
  return true;
}

export async function listApiKeys() {
  return all('SELECT id, label, created_at, last_used_at FROM api_keys ORDER BY created_at DESC');
}

export async function revokeApiKey(id) {
  const { changes } = await run('DELETE FROM api_keys WHERE id = ?', [id]);
  return changes > 0;
}
