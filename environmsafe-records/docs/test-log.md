# Test iteration log

| When (UTC) | Suite | Result | Fixes made |
|---|---|---|---|
| 2026-10-10 22:55 | Database / RLS (65) | 62 pass, 3 fail | Real bug: a user signed out of all devices could still read client data (`can_see_client` did not check revoked sessions). Two test-setup errors corrected. |
| 2026-10-10 23:00 | Database / RLS (65) | 65 pass | — |
| 2026-10-10 23:05 | Unit – calculations (19) | 19 pass | — |
| 2026-10-10 23:22 | Generated documents (6 types, Word + PDF), visual check round 1 | Generated; visual faults found | Word: logo, photos and signature clipped (fixed line spacing); header company block wrapped to 6 lines; equipment table split over a page. |
| 2026-10-10 23:27 | Visual check round 2 | Mostly correct | Word footer page number in larger font; footer document number wrapped; conclusion statement separated from its text. |
| 2026-10-10 23:31 | Visual check round 3 | Correct | Long header titles shrunk; DPR summary column header wrapped. |
| 2026-10-10 23:50 | End-to-end workflow (desktop), runs 1–6 | Failures in test selectors and | Real bugs fixed: rows created on the phone lacked database defaults (screen crashed – added local defaults and an error screen); Dexie index missing for readings by client (report crash). |
| 2026-10-11 00:01 | End-to-end workflow (desktop), runs 7–12 | Import step failed; carry-over lost | Real bugs fixed: queued change folded ahead of a record it depended on (foreign key refusal); changes left "sending" when the app was reloaded mid-sync were never retried; network calls had no time limit; a field edited on the phone before the record reached the server was rejected as "older" (signature lost). Last one fixed in `sync_apply` (database). |
| 2026-10-11 00:14 | End-to-end workflow (desktop) | 14 / 14 pass | — |
| 2026-10-11 00:18 | End-to-end workflow (desktop + phone) | 28 / 28 pass | Test selector made specific to the run's tag. |
| 2026-10-11 00:30 | Offline + conflict (2), security (10), full suite desktop + phone | 40 / 40 pass | Offline test: test read the new record's address too early (test fix). |
| 2026-10-11 10:00 | Lighthouse mobile (sign-in page) | Perf 88 → 96, A11y 100, BP 100 | Login logo 197 KB PNG replaced by 9 KB WebP with fixed size. |
| 2026-10-11 10:20 | Generated documents, visual round 4–5 | Orphaned heading in PDF; first fix produced blank pages | Headings now kept with the following block. |
| 2026-10-11 10:40 | Backup + restore test (local) | 28 / 28 tables identical | psql meta-command quoting fixed. |
| 2026-10-11 10:45 | Final local run: unit + documents 25, database 65, browser 42 (desktop + phone, incl. offline and security), audit 0 vulnerabilities, secrets scan clean | **All pass** | — |
