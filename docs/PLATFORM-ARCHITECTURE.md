# EnvironmSafe Platform — Architecture & Build Guide

How to take three separately-built systems and run them as one professional platform.

**Status:** advisory · **Last updated:** 2026-09-21

---

## 1. Where things stand today

| System | Location | Users | Owned by |
|---|---|---|---|
| Operations Console | `app.environmsafe.com/app/` | Staff only | — |
| Generator Portal | `generators.environmsafe.com` | Staff + clients | — |
| Inspection & Certification | repo `environmsafe-platform` | Staff + clients | `environmsafe@gmail.com` (personal account) |
| Marketing website | repo `environmsafe-spec/environmsafe-app` | Public | `environmsafe-spec` |

Three systems, built at different times, on at least two different GitHub accounts, with
(almost certainly) three separate user tables and three separate login screens.

That is normal for how businesses actually grow. It is also the point at which it starts to
cost you — in duplicated client records, in staff who need four passwords, and in the
awkward moment when someone leaves and you have to remember every system to disable them in.

The rest of this document is the order in which to fix that.

---

## 2. Fix the ownership problem first

**This is the highest-priority item in this document, and it is not a technical one.**

The inspection platform — the system that will issue your certificates — lives in a
repository owned by a personal Gmail account. If that account is lost, locked, or
disputed, the business does not own its own source code.

**Do this:**

1. Create a GitHub **Organization** called `environmsafe`.
2. Transfer all four repositories into it (`Settings → Transfer ownership`). Transfers keep
   history, issues, and stars, and GitHub redirects the old URLs.
3. Add `environmsafe-spec` and `environmsafe@gmail.com` as **members**, not owners.
4. Make at least two people **owners**, so no single person can lock everyone out.
5. Turn on branch protection for `main` on every repo: no direct pushes, PR required.
6. Enable 2FA enforcement for the whole organisation.

Cost: free. Time: under an hour. Do it before anything else here.

> Note: a cross-account repository transfer needs the receiving org to accept it, and the
> sending account must be an admin of the repo. Both accounts are yours, so this is
> straightforward — it just cannot be done from a session that only has access to one of them.

---

## 3. Domain and subdomain map

One application, one subdomain. Never nest a second application in a path under an
existing one — `app.environmsafe.com/app/` is already showing why (the doubled `app` reads
like an accident, and it means the two systems share an origin, cookies, and blast radius).

| Subdomain | System | Audience | Status |
|---|---|---|---|
| `www.environmsafe.com` | Marketing site (static, GitHub Pages) | Public | Live |
| `app.environmsafe.com` | Operations Console | Staff | Live — drop the `/app/` path |
| `generators.environmsafe.com` | Generator Portal | Staff + clients | Live |
| `inspect.environmsafe.com` | Inspection & Certification | Staff + clients | To deploy |
| `verify.environmsafe.com` | Public certificate verification | Public | Planned |
| `my.environmsafe.com` | Client Portal | Clients | Planned |
| `training.environmsafe.com` | Training / LMS | Clients + staff | Planned |
| `id.environmsafe.com` | Identity provider (SSO) | All | **Build next** |
| `status.environmsafe.com` | Status / uptime page | Public | Planned |

**Why separate subdomains matter:** each app gets its own TLS certificate, its own cookies,
its own deploy pipeline, and its own failure domain. A bad deploy of the training portal
cannot take down certificate issuance.

**Rule — never break this one:** the marketing site is static hosting. It must never
authenticate anyone, never hold a session, and never touch client data. It links *out* to
the applications and that is all. Everything on `www` is public by definition.

---

## 4. One login for everything (the single biggest win)

Right now each system almost certainly has its own user table. That means:

- A new engineer needs three accounts created by hand.
- Someone who leaves needs three accounts disabled — and one will be missed.
- A client who uses both the generator portal and the inspection platform has two passwords.
- You cannot answer "who has access to what?" without opening three admin panels.

**Fix:** stand up one identity provider at `id.environmsafe.com`. Every application
delegates login to it via OpenID Connect (OIDC). No application stores a password ever again.

### Choosing the identity provider

| Option | Good for | Watch out for |
|---|---|---|
| **Microsoft Entra ID** | If you already pay for Microsoft 365 — staff accounts already exist | External client accounts need Entra External ID, which is a separate concept |
| **Keycloak** (self-hosted) | Full control, no per-user cost, handles staff + clients equally well | You operate it — patching, backups, upgrades |
| **Auth0 / Clerk** | Fastest to working, excellent developer experience | Per-user pricing grows as you add client accounts |

**Recommendation:** if EnvironmSafe already runs Microsoft 365, use **Entra ID** for staff
and add external identities for clients. If not, use **Keycloak** on a small VPS — it is free,
it is the standard, and at your user count a modest server runs it comfortably.

### What to configure

- **Staff realm** and **client realm** kept separate. Staff log in with their work email;
  clients log in with an account tied to their organisation.
- **MFA mandatory for all staff.** No exceptions, including owners.
- **MFA required for client accounts that can approve or sign off work.**
- **One group per client organisation**, so access can be granted and revoked as a unit
  when a contract starts or ends.
- **Session lifetimes:** short for staff (8 hours), shorter for anything that can issue a
  certificate.

Retrofitting SSO into three live apps is real work — budget a week per app. But do it before
you build the fourth, fifth and sixth systems, or you will be retrofitting six.

---

## 5. Access control: roles and tenant scoping

Two separate mechanisms. Both are required. Confusing them is how B2B platforms leak data.

**Roles** decide *what actions* you can take:

| Role | Can do |
|---|---|
| `staff.admin` | Everything, including user management |
| `staff.engineer` | Create and complete inspections, record test results |
| `staff.approver` | Sign off reports and issue certificates |
| `client.admin` | See all their organisation's data, manage their own users |
| `client.viewer` | Read-only on their organisation's data |
| `public` | Certificate verification only |

Note that `staff.engineer` and `staff.approver` are deliberately separate. The person who
performs an inspection should not be the person who signs it off. That separation is what
an auditor will look for.

**Tenant scoping** decides *whose data* you can take those actions on.

> Every single database query that touches client data must be filtered by
> `organisation_id`, derived from the authenticated session — never from a URL, a form
> field, or a request header.

This is the rule that stops Client A from seeing Client B's inspection findings by changing
a number in a URL. Enforce it at the lowest layer you can — row-level security in the
database, or a base query class that every repository inherits from — so that an individual
developer cannot forget it. Write an automated test that attempts a cross-tenant read and
asserts that it fails, and run it in CI on every commit.

---

## 6. One source of truth for shared data

Clients, sites, assets and users are referenced by every system. Do not let three systems
each keep their own copy — within a year the same client will exist three times under three
spellings, and nobody will know which is correct.

**The Operations Console is the master record** for:

- Client organisations
- Sites and locations
- Assets and equipment
- Contracts and their validity periods

Every other system reads that data rather than storing its own copy.

**How to connect them, in order of preference:**

1. **Shared database, separate schemas** — simplest, and honest about the fact that these
   systems are one product. Best choice at your scale.
2. **A small internal API** on the operations console that the others call. More moving
   parts, but cleaner boundaries if you later want to split teams.
3. **Scheduled sync jobs.** Avoid. This is how you get three divergent copies with a delay.

Start with option 1. You can move to option 2 later if you outgrow it; the reverse is painful.

---

## 7. Certificates: get this part right

Certificates are the product. If a client's insurer cannot trust one, the service has no
value. Four rules:

**1. Every certificate gets a serial number.**
Structured and predictable: `ES-PSV-2026-00412` — company, discipline, year, sequence.
Never random, never reused.

**2. Issued certificates are immutable.**
Once issued, the record is never edited. A mistake is corrected by issuing a *new revision*
that supersedes the old one, with both kept and the supersession recorded. An auditor who
finds that certificates can be silently edited will discount all of them.

**3. Every certificate carries a QR code** linking to
`verify.environmsafe.com/c/ES-PSV-2026-00412`.
The verification page is public and shows: valid / expired / revoked, what the certificate
covers, issue and expiry dates, and the issuing engineer. It shows nothing else — no client
contact details, no commercial terms, no findings.

**4. Store a hash of the issued PDF** alongside the record, so a document presented to you
years later can be proved to be the one you issued.

This combination — serial, immutability, public verification, hash — is what turns a PDF
into a credential. It is also a genuine differentiator: very few regional providers offer
verifiable certificates, and insurers and auditors notice.

---

## 8. Make the apps look like one platform

Three systems built at different times will look like three systems. Fix it cheaply:

- **Extract the design tokens** already defined in the marketing site's `css/styles.css`
  (`--clr-primary: #1B2A4A`, `--clr-accent: #E3A038`, the font stack, radii, shadows) into a
  small shared package that every application imports.
- **Same header everywhere:** logo, app switcher, user menu, language toggle.
- **An app switcher** in the header — a grid icon that drops down the list of applications
  the signed-in user can actually reach. With SSO behind it, switching apps requires no
  second login.
- **Arabic and RTL from day one** in every new application, not bolted on later. The
  marketing site already does this properly — copy its `[dir="rtl"]` approach.

---

## 9. Environments and deployment

Each application needs three environments: `dev`, `staging`, `production`. Staging must use
**anonymised** data — never a copy of real client records.

Minimum CI on every repository, running on every pull request:

- Linting and type checks
- Automated tests, including the cross-tenant access test from §5
- Dependency vulnerability scan
- Secret scanning (GitHub's is free and catches committed credentials)

Deploy to production only from `main`, only after a PR review and green CI.

Keep secrets in the platform's secret manager or GitHub Actions secrets. Never in the
repository, never in a `.env` that gets committed. If a credential has ever been committed,
rotate it — removing it from a later commit does not remove it from history.

---

## 10. Security baseline

Non-negotiable, all systems:

- **HTTPS only**, HSTS enabled, certificates auto-renewed
- **MFA** for all staff accounts
- **Role-based access plus tenant scoping** as in §5
- **Audit logging** on every write to inspection records and certificates — who, what, when,
  from where. Append-only.
- **Encryption at rest** for the database
- **Automated backups**, retained per your record-keeping obligations. Certificates may need
  to be retrievable for a decade or more.
- **Test a restore quarterly.** An untested backup is not a backup.
- **Access reviews quarterly** — every account, still needed or revoked.
- **Same-day revocation** when someone leaves. With SSO this is one action instead of six.
- **Dependency updates** via Dependabot, reviewed monthly.

---

## 11. Suggested build order

| Phase | Work | Why here |
|---|---|---|
| **0** | Move all repos into a GitHub org; enable 2FA and branch protection | Protects the asset. Costs nothing. Do it this week. |
| **1** | Publish this Platform page on the website (**done — see `platform.html`**) | Clients and staff get one place to find every system |
| **2** | Stand up `id.environmsafe.com`; migrate the operations console to SSO | Proves the pattern on the system you control best |
| **3** | Move generator portal and inspection platform onto SSO | One login. Revocation becomes a single action. |
| **4** | Deploy the inspection platform at `inspect.environmsafe.com` | The system is built — get it in front of users |
| **5** | Consolidate client/site/asset records into the operations console | Stops the data diverging before it gets worse |
| **6** | Ship `verify.environmsafe.com` with QR codes on certificates | Highest-visibility differentiator, small build |
| **7** | Client portal at `my.environmsafe.com` | Cuts the email traffic clients currently generate |
| **8** | PSV valve register, training portal, CMMS | Build in the order clients ask for them |

Phases 0 and 1 are days. Phases 2–3 are the real investment and the one worth making
properly — everything after them is cheaper because of them.

---

## 12. What was built on the website

This repository now contains:

- **`platform.html`** — the English Platform hub: all applications, who can sign in to each,
  status (live / in rollout / planned), how access is requested, and the security posture.
- **`ar/platform.html`** — the full Arabic RTL equivalent.
- **A "Platform" nav dropdown** added to all 95 pages of the site (English and Arabic),
  linking to the hub, the operations console, the generator portal, and the inspection system.
- **Footer links** to the hub and the applications on every page.
- **New CSS** in `css/styles.css` — access badges, application cards with status indicators,
  access steps, and the security panel, all using the existing design tokens and with RTL rules.
- **Sitemap entries** for both language versions.

**Before this goes live, check the copy.** The descriptions of what the operations console
and generator portal actually do were written from their names and your service lines. Where
a detail is wrong, correct it in `platform.html` and `ar/platform.html` — the feature bullets
in each application card are the parts most likely to need adjusting. The subdomains marked
*planned* are proposals, not commitments.
