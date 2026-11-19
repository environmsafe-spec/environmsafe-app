# ES-PF (EnvironmSafe Procurement & Finance): working rules for Claude sessions

Read `docs/v2-progress.md` (where the work stands) and `docs/open-items.md` (the owner's open notes) first.

The owner's standing rules:
- **Open items are never dropped.** Every note, open question or "later" item the owner raises goes into
  `docs/open-items.md` and stays there until it is fixed or the owner says to drop it. Every update to the owner
  ends with a short list of the items still open.
- Plan before building. Warn before heavy tasks with a one-line cost estimate.
- Never touch live production data without the owner's explicit OK. Use staging (Neon branch `staging`) first.
- The old app (Supabase project `mcgjrsfsppdcnvolqsgs`) stays exactly as it is: read only, no changes.
- Business data (customer names, amounts, exported records) never goes into the repository. Give it to the
  owner directly.
- Secrets never go in the repository or the frontend.
- Small commits. Deploy only with `[deploy]` in the commit message, and only when the owner has asked to publish.
- Every action the owner must take comes with a direct link.
