# Runbook – what to do when…

## The website does not open
1. Check https://www.cloudflarestatus.com. If Cloudflare is down, wait; the Android app keeps working offline.
2. Try the backup address https://environmsafe-records.pages.dev. If that works, the problem is the domain: in Cloudflare → environmsafe.com → DNS check the `records` CNAME points to `environmsafe-records.pages.dev`.
3. GitHub → Actions → **Release** → re-run the last successful run to publish again.

## "Database did not answer" / the project is paused
Free Supabase projects pause after 7 days without use (the keep-alive should prevent this).
1. supabase.com → your project → **Restore project**. It takes a few minutes. No data is lost.
2. GitHub → Actions → **Keep database awake**: check it runs every two days; re-enable it if GitHub disabled it (GitHub stops scheduled jobs in repositories with no activity for 60 days – any push or a manual run re-enables them).

## Storage is full (above 70 %)
1. **Settings → Backup & storage → Export everything** (keep the ZIP safe).
2. Short term: ask inspectors to take fewer near-identical photos; remove demo data; Admin can purge deleted items.
3. Move old files to another free store: Cloudflare R2 (10 GB free) – a developer can point old reports there; or upgrade Supabase to Pro (USD 25/month, 100 GB) – no code changes needed.

## Database near 500 MB
Upgrade Supabase to Pro (no code change), or archive old years: export, then purge jobs older than N years.

## A phone shows "need attention" on the sync bar
Tap it. Each refused change shows the server's reason. Common: "This document is issued and locked" (Office should create a revision) or "permission" (the user's role). **Retry all** after fixing; **Discard** only if the change is truly unwanted.

## Restore a backup
- **From the nightly backup** (database): download the artifact from Actions, decrypt
  `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in FILE.tgz.enc -out backup.tgz -pass pass:PASSPHRASE`, unpack, then run
  `SOURCE_URL=… TARGET_ADMIN_URL=…` style restore as in `scripts/backup-restore-test.sh` (steps 2–3) against the new database. A developer session can do this in minutes.
- **Into a new Supabase project**: create the project, apply `supabase/migrations/*` (Supabase CLI `supabase db push`), restore the data dump with `pg_restore --data-only --disable-triggers`, upload the files from an "Export everything" ZIP to the `files` bucket, and change `.env.production` to the new project.

## Lost the Android signing key
If `release.keystore.enc` or its passphrase is lost, new APKs cannot update installed apps. Generate a new key, publish, and ask every user to uninstall and install again (data on the server is not affected; unsynced changes on phones must be synced first).

## Ask for changes later
Open a new Claude Code session on the repository and describe the change in plain words. The code, tests and these documents let a new session continue safely.
