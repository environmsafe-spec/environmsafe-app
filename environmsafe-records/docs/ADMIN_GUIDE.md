# Admin Guide

## First day (one time)
1. **Supabase dashboard → Authentication → Sign In / Providers → Email**: turn off **Allow new users to sign up**. Under **Authentication → Policies / Passwords**, set minimum length 10 and require lower case, upper case and digits. (The app already refuses unknown sign-ups and weak passwords; this adds a second lock.)
2. Sign in with the Admin account and the temporary password, choose your own password, then set up **two-step sign-in** (Google or Microsoft Authenticator). Admin accounts cannot skip this.
3. **Settings → Company**: check company details; upload the logo if it differs.
4. Try everything with the demo data (**Settings → Demo data → Load**), then **Remove demo data**.

## Users
**Users → Add user**: name, e-mail, role, optional inspector certificate number. The app suggests a strong first password – give it to the person; they must change it at first sign-in.

| Role | Can |
|---|---|
| Admin | Everything: users, library, settings, purge, backup |
| Office | All drafts, issue reports and certificates, clients, assets, jobs |
| Inspector | Own inspections, findings, DPRs and photos; sees all assets and history; cannot issue or delete |
| Viewer | Read only; can be limited to one client |

Forgotten password: **Set password**. Lost phone or person leaves: **Block** and **Sign out**. Lost authenticator: **Reset two-step**. **Sign out all devices** signs everyone else out at once.

## Library (no programming needed)
**Library** holds equipment types (with their extra fields and default intervals), inspection types and checklists, standards, text blocks (methodology, limitations, recommendations), report templates (section order, on/off, wording) and lists (damage mechanisms, finding categories, severity, priorities, conclusion wording, units). Changes apply to everyone at once. Default intervals are only defaults – confirm them against the current code edition, the client requirement and local regulation.

**Settings → Numbering** sets the number format per document (e.g. `ES/{CLIENT}-{TYPE}-{YYYY}-{NNN}`, `ES-R-12-{NNN}`). Numbers are never reused.

## Importing old data
**More → Import from Excel**: choose Assets, Historical inspections or Previous findings, choose the client, pick the file, check the column matching and the preview, then **Import**. Existing tags are skipped, not duplicated.

## Backup and restore
- **Automatic**: every night GitHub Actions saves the database, the user list and a list of all files, then restores the copy into an empty database to prove it works. Find them in GitHub → the repository → **Actions → Nightly backup** (kept 30 days, encrypted with the `ANDROID_KEYSTORE_PASSPHRASE` secret, or `BACKUP_PASSPHRASE` if you add one).
- **Manual, including photos**: **Settings → Backup & storage → Export everything** downloads one ZIP (JSON + Excel-ready CSV + all files). Do this monthly and keep it off-site.
- **Restore**: see RUNBOOK.md, "Restore a backup".

## Storage
**Settings → Backup & storage** shows the space used. Above 70 % it turns red. See RUNBOOK.md "Storage is full".

## Conflicts and audit
- **Settings → Conflicts**: when two people changed the same field while one was offline, the newer change is kept and both values are listed here. Check and press **Mark as checked**.
- **Settings → Audit log**: every change, issue, export and sign-in.

## Releasing a new version
Change the version in `package.json` (e.g. 1.0.1) and push to `main`. GitHub Actions tests, builds the website and the APK, publishes both and checks the live site. Phones show "A new version is available".
