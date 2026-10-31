import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { all, get, run } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
export const ATTACHMENTS_DIR = path.join(projectRoot, 'data', 'attachments');

fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });

export async function listForItb(itbId) {
  return all('SELECT * FROM itb_attachments WHERE itb_id = ? ORDER BY created_at ASC', [itbId]);
}

export async function getAttachment(id) {
  return get('SELECT * FROM itb_attachments WHERE id = ?', [id]);
}

/** Saves the file bytes to disk and records it against the ITB. Returns the new row. */
export async function saveAttachment(itbId, { originalName, contentType, buffer }) {
  const ext = path.extname(originalName || '').slice(0, 20);
  const storedFilename = `${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(ATTACHMENTS_DIR, storedFilename), buffer);

  const { lastInsertRowid } = await run(
    'INSERT INTO itb_attachments (itb_id, stored_filename, original_name, content_type, size_bytes) VALUES (?, ?, ?, ?, ?)',
    [itbId, storedFilename, originalName || storedFilename, contentType || 'application/octet-stream', buffer.length]
  );
  return getAttachment(lastInsertRowid);
}

export async function deleteAttachment(id) {
  const row = await getAttachment(id);
  if (!row) return false;
  const { changes } = await run('DELETE FROM itb_attachments WHERE id = ?', [id]);
  if (changes > 0) {
    const filePath = path.join(ATTACHMENTS_DIR, row.stored_filename);
    fs.rm(filePath, { force: true }, () => {}); // best-effort; a missing file is fine
  }
  return changes > 0;
}
