import { verifyApiKey } from './models/apiKeys.js';

/** Extracts an API key from the X-API-Key header or an Authorization: Bearer header. */
export function extractApiKey(req) {
  const headerKey = req.headers['x-api-key'];
  if (headerKey) return Array.isArray(headerKey) ? headerKey[0] : headerKey;
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim();
  return null;
}

/** Returns true and marks the key as used if valid; false otherwise. */
export async function isAuthorized(req) {
  const key = extractApiKey(req);
  return verifyApiKey(key);
}
