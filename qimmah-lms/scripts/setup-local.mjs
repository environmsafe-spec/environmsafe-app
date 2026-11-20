// Creates and fills the LOCAL development database (kept in .wrangler/state).
// Running it again resets the local data to the seed.
// Usage: npm run setup:local   then   npm run dev   -> http://localhost:8787
import { wrangler } from './lib.mjs';
import { buildSeedSql } from './seed.mjs';

let r = wrangler(['d1', 'migrations', 'apply', 'qimmah-lms', '--local'], { input: 'y\n' });
if (r.status !== 0) process.exit(r.status || 1);
const seed = buildSeedSql('http://localhost:8787');
r = wrangler(['d1', 'execute', 'qimmah-lms', '--local', '--file', seed.file], { input: 'y\n' });
if (r.status !== 0) process.exit(r.status || 1);
console.log('\nLocal database ready:', seed.counts);
console.log('Credentials:', seed.doc);
console.log('Now run: npm run dev   and open http://localhost:8787');
