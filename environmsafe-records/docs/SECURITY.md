# Security

## What is protected, and how

| Threat | Protection |
|---|---|
| Someone on the internet reads or changes data | Every table has Row Level Security. Anonymous visitors have no rights at all (tested). The only public function is `keepalive`, which returns a count. |
| Someone creates their own account | Sign-up is closed in the database: only e-mails an Admin has approved can be created. Turn off "Allow new users to sign up" in Supabase as well (Admin Guide step 1). |
| A user does more than their role allows | Roles (Admin, Office, Inspector, Viewer) are enforced by the database, not by the screens: inspectors edit only their own drafts, cannot issue or delete; viewers are read-only and can be limited to one client; only Admin edits the library, users and settings. Users cannot change their own role (tested). |
| A stolen Admin password | Admin rights need two-step sign-in (TOTP) in that session; without it the account has Office rights only. |
| Issued documents altered later | Issued inspections, certificates, reports and DPRs are locked by a database trigger. Changes need a new revision; the old one is kept. |
| Records quietly edited or deleted | Every create, change, delete, restore, status change, export, sign-in and user change is written to the audit log by the database. Nobody, including Admin, can edit or delete the audit log. Deletes are soft (restore possible); only Admin can purge. |
| Photos and documents seen by the wrong people | Files are in a private bucket. They are reached only through links that expire after 10 minutes, created only for users allowed to see that client (tested). File types and sizes are checked (50 MB max). |
| Stolen or lost phone | The data on the phone is protected by the app lock (PIN, fingerprint on Android) and is deleted at sign-out. Admin can sign a user out of all devices at once, which stops even unexpired sessions; blocking a user takes effect immediately. Android backups of the app's data are switched off. |
| Script injection / SQL injection | The app never inserts HTML from data (React escapes all text; tested with a script in a client name). The sync function accepts only listed tables and existing column names (tested with injection attempts). |
| Web attacks | HTTPS only with HSTS, a strict Content-Security-Policy, no framing, no sniffing, no referrer leaks. |
| Secret keys leaked | The browser and the APK contain only the public (publishable) key. The service key lives only in Supabase Edge Functions and GitHub secrets. A check (`scripts/check-secrets.sh`) runs on every build and fails if a secret is in the repository or the app. |
| Vulnerable libraries | `npm audit` runs on every push and fails on high-severity issues. Result at handover: 0 vulnerabilities. |

## What you must do

1. **Keep the Admin password and the authenticator app safe.** Use a password manager.
2. **Keep the Android signing key backup safe** (`release.keystore.enc` plus its passphrase). If both are lost, existing phones cannot receive updates and everyone must uninstall and reinstall. Store the passphrase separately from the file, e.g. in a password manager and on paper in the office safe.
3. **Keep GitHub secrets secret.** Never paste them into chat, e-mail or the code.
4. When someone leaves: Users → Block, then Sign out (all devices).
5. Turn on two-step sign-in for everyone, not only Admin (Settings → My account).
6. Review the audit log monthly (Settings → Audit log).

## Not covered (honest limits)

- Rate limiting of sign-in attempts is Supabase's built-in protection; there is no extra limit of our own.
- Data on a phone is in the browser database of the app; a rooted phone with the app unlocked can read it. The app lock and sign-out wipe reduce this risk.
- Backups are encrypted with the passphrase in GitHub secrets; anyone with admin access to the GitHub repository can run a restore.
