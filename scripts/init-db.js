// Running this file is enough to create data/crm.db with the current schema.
import '../src/db.js';
import { seedDefaults } from '../src/models/picklists.js';

await seedDefaults();
console.log('Database initialized.');
// postgres-js keeps its connection pool open (sockets stay alive waiting for
// more queries), which would otherwise keep this one-off script running
// forever instead of exiting once its work is done.
process.exit(0);
