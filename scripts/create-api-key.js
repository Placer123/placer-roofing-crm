import { createApiKey } from '../src/models/apiKeys.js';

const label = process.argv.slice(2).join(' ') || '';
const key = await createApiKey(label);

console.log('\nNew API key created' + (label ? ` (${label})` : '') + ':\n');
console.log('  ' + key + '\n');
console.log('Copy it now - it is stored only as a hash and cannot be shown again.');
console.log('Use it as header:  X-API-Key: ' + key);
console.log('or:                Authorization: Bearer ' + key + '\n');
// postgres-js keeps its connection pool open, which would otherwise keep
// this one-off script running forever instead of exiting once done.
process.exit(0);
