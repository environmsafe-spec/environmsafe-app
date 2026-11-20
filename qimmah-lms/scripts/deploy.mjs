// One-command deployment to Cloudflare (free plan): creates the D1 database and
// R2 bucket if missing, applies migrations, seeds a NEW database (accounts +
// course content) and deploys the Worker with the static site.
//
// First time on a computer:   npx wrangler login      (opens the browser)
// Then, every time:           npm run deploy
// In CI: set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID instead of logging in.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, SECRETS, DEFAULT_URL, ensureDir, wrangler } from './lib.mjs';
import { buildSeedSql } from './seed.mjs';

const DB = 'qimmah-lms';
const BUCKET = 'qimmah-lms-media';
const TOML = join(ROOT, 'wrangler.toml');
const step = (s) => console.log(`\n▶ ${s}`);
const die = (s) => {
  console.error(`\n✖ ${s}`);
  process.exit(1);
};

step('Checking Cloudflare login');
let r = wrangler(['whoami'], { capture: true });
if (r.status !== 0 || /not authenticated/i.test(r.stdout + r.stderr)) die('Not logged in. Run: npx wrangler login   (or set CLOUDFLARE_API_TOKEN)');

step(`D1 database "${DB}"`);
let toml = readFileSync(TOML, 'utf8');
r = wrangler(['d1', 'list', '--json'], { capture: true });
let dbId = null;
try {
  dbId = (JSON.parse(r.stdout).find((d) => d.name === DB) || {}).uuid || null;
} catch {}
if (!dbId) {
  r = wrangler(['d1', 'create', DB, '--location', 'eeur'], { capture: true });
  const m = (r.stdout + r.stderr).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  if (r.status !== 0 || !m) die('Could not create the D1 database:\n' + r.stdout + r.stderr);
  dbId = m[0];
  console.log('  created', dbId);
} else console.log('  exists', dbId);
toml = toml.replace(/database_id = "[^"]*"/, `database_id = "${dbId}"`);
writeFileSync(TOML, toml);

step(`R2 bucket "${BUCKET}" (uploaded audio, video and files)`);
r = wrangler(['r2', 'bucket', 'list'], { capture: true });
if (!(r.stdout || '').includes(BUCKET)) {
  r = wrangler(['r2', 'bucket', 'create', BUCKET], { capture: true });
  if (r.status !== 0 && !/already exists/i.test(r.stdout + r.stderr))
    die('Could not create the R2 bucket. R2 may need enabling once in the Cloudflare dashboard (R2 → Get started; free tier).\n' + r.stdout + r.stderr);
  console.log('  created');
} else console.log('  exists');

step('Applying database migrations');
r = wrangler(['d1', 'migrations', 'apply', DB, '--remote'], { input: 'y\n' });
if (r.status !== 0) die('Migrations failed.');

step('Checking whether the database needs its first data');
r = wrangler(['d1', 'execute', DB, '--remote', '--json', '--command', 'SELECT COUNT(*) AS n FROM users'], { capture: true });
let users = -1;
try {
  users = JSON.parse(r.stdout)[0].results[0].n;
} catch {}
if (users === 0) {
  if (process.env.CI && !process.env.QIMMAH_CREDENTIALS)
    die('New database, but the QIMMAH_CREDENTIALS secret is not set: the generated passwords would be lost with this CI runner. Add the secret (contents of .secrets/credentials.json) and re-run.');
  const seed = buildSeedSql(process.env.QIMMAH_URL || DEFAULT_URL);
  console.log('  seeding', seed.counts);
  r = wrangler(['d1', 'execute', DB, '--remote', '--file', seed.file], { input: 'y\n' });
  if (r.status !== 0) die('Seeding failed.');
  console.log('  login details written to', seed.doc);
} else if (users > 0) console.log(`  already has ${users} users — not touched`);
else die('Could not read the database:\n' + r.stdout + r.stderr);

step('Deploying the Worker and website');
r = wrangler(['deploy']);
if (r.status !== 0 && /custom_domain/.test(toml)) {
  console.log('\n  Deploy with the custom domain failed (is environmsafe.com a zone in this account?).');
  console.log('  Retrying on the free *.workers.dev address only…');
  ensureDir(SECRETS);
  const alt = join(ROOT, 'wrangler.workersdev.toml');
  writeFileSync(alt, toml.replace(/^routes = .*$/m, ''));
  r = wrangler(['deploy', '--config', alt]);
  if (r.status === 0) {
    // On a first deploy the custom domain can fail only because the Worker did
    // not exist yet. It exists now, so try the domain once more.
    console.log('\n  Retrying the custom domain now that the Worker exists…');
    const again = wrangler(['deploy']);
    if (again.status !== 0) console.log('\n  Custom domain unavailable. Set the workers.dev address in the Android app: open the app → "إعدادات الخادم".');
  }
}
if (r.status !== 0) die('Deploy failed.');
console.log('\n✔ Done. Open the site and sign in as "principal". Credentials: .secrets/CREDENTIALS.md');
