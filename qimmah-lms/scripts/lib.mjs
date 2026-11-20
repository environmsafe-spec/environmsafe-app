// Shared helpers for the command-line scripts.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { pbkdf2Sync, randomBytes, randomInt } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SECRETS = join(ROOT, '.secrets');
export const DEFAULT_URL = 'https://qimmah.environmsafe.com';

export function iterations() {
  const toml = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');
  const m = toml.match(/PBKDF2_ITERATIONS\s*=\s*"(\d+)"/);
  return m ? Number(m[1]) : 100000;
}

export function hashPassword(pw, iter = iterations()) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(pw, salt, iter, 32, 'sha256');
  return `pbkdf2$${iter}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function digits(n) {
  let s = String(1 + randomInt(9)); // no leading zero: easier to read and type
  for (let i = 1; i < n; i++) s += randomInt(10);
  return s;
}
export function strongPassword(len = 10) {
  const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += a[randomInt(a.length)];
  return s;
}

export const sq = (v) =>
  v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;

export function wrangler(args, { capture = false, input } = {}) {
  return spawnSync('npx', ['wrangler', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: capture ? ['pipe', 'pipe', 'pipe'] : input ? ['pipe', 'inherit', 'inherit'] : 'inherit',
    input,
    shell: process.platform === 'win32',
  });
}

export function ensureDir(d) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

// Load or create the seed credentials. They live in .secrets/ (git-ignored):
// the repository is public, so neither passwords nor their hashes are committed.
export function loadCredentials() {
  ensureDir(SECRETS);
  const file = join(SECRETS, 'credentials.json');
  if (process.env.QIMMAH_CREDENTIALS && !existsSync(file)) writeFileSync(file, process.env.QIMMAH_CREDENTIALS);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const users = [
    { username: 'principal', full_name: 'مدير المدرسة', role: 'principal', password: strongPassword(10) },
    { username: 'teacher', full_name: 'مدرس الصف السادس', role: 'teacher', password: strongPassword(10) },
  ];
  for (let i = 1; i <= 30; i++) {
    const n = String(i).padStart(2, '0');
    users.push({ username: `6${n}`, full_name: `التلميذ ${n}`, role: 'student', password: digits(6) });
  }
  const creds = { created: new Date().toISOString(), users };
  writeFileSync(file, JSON.stringify(creds, null, 2));
  return creds;
}

export function writeCredentialsDoc(creds, url = DEFAULT_URL) {
  const rows = (role) =>
    creds.users
      .filter((u) => u.role === role)
      .map((u) => `| ${u.full_name} | \`${u.username}\` | \`${u.password}\` |`)
      .join('\n');
  const md = `# بيانات الدخول — منصة مدارس القمة النموذجية (الصف السادس)

> **سرّي.** لا تنشر هذا الملف ولا ترفعه إلى GitHub. أعطِ كل تلميذ بطاقته فقط.
> يستطيع المدير تغيير أي كلمة مرور وطباعة بطاقات جديدة من داخل المنصة: **المستخدمون ← طباعة بطاقات الدخول**.

العنوان: ${url}

## المدير

| الاسم | اسم المستخدم | كلمة المرور |
|---|---|---|
${rows('principal')}

## المدرس

| الاسم | اسم المستخدم | كلمة المرور |
|---|---|---|
${rows('teacher')}

## التلاميذ (30)

اسم المستخدم هو رقم التلميذ: من 601 إلى 630. كلمة المرور 6 أرقام.

| الاسم | اسم المستخدم | كلمة المرور |
|---|---|---|
${rows('student')}

أُنشئت في: ${creds.created}
`;
  const file = join(SECRETS, 'CREDENTIALS.md');
  writeFileSync(file, md);
  return file;
}
