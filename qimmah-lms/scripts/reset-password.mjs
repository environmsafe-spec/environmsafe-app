// Emergency password reset from the command line (e.g. the principal forgot).
// Usage: npm run reset-password -- <username> [--local]
// Prints the new password once. Uses the same hashing as the app.
import { hashPassword, strongPassword, digits, wrangler } from './lib.mjs';

const args = process.argv.slice(2);
const local = args.includes('--local');
const username = args.find((a) => !a.startsWith('--'));
if (!username || !/^[a-z0-9._-]+$/i.test(username)) {
  console.error('Usage: npm run reset-password -- <username> [--local]');
  process.exit(1);
}
const password = /^\d+$/.test(username) ? digits(6) : strongPassword(10);
const hash = hashPassword(password);
const sql = `SELECT COUNT(*) AS n FROM users WHERE username = '${username.toLowerCase()}'; UPDATE users SET pass_hash = '${hash}', active = 1 WHERE username = '${username.toLowerCase()}'; DELETE FROM login_attempts WHERE k = 'u:${username.toLowerCase()}'; DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = '${username.toLowerCase()}');`;
const r = wrangler(['d1', 'execute', 'qimmah-lms', local ? '--local' : '--remote', '--json', '--command', sql], { capture: true });
if (r.status !== 0) {
  console.error(r.stdout + r.stderr);
  process.exit(1);
}
let changed = 0;
try {
  changed = JSON.parse(r.stdout)[0].results[0].n;
} catch {}
if (!changed) {
  console.error(`No user named "${username}".`);
  process.exit(1);
}
console.log(`New password for ${username}: ${password}`);
