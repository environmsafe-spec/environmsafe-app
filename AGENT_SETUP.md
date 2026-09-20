# EnvironmSafe Business Agent — setup

This is the company's own AI agent, running at `environmsafe.com/agent`. It
reads the company Google Drive and mailbox, builds quotations and invoices in the
house format, and prepares emails for a person to review and send.

Nothing here runs in the browser except the chat window. The Claude API key and
the Google credentials live only in the Cloudflare Pages environment.

---

## What it can do today

| Area | What the agent does |
|---|---|
| Procurement | Finds RFQs, supplier quotations and POs in Drive; works out which stage a deal is at and what is missing |
| Quotations & invoices | Builds them in the house layout, numbered `Q-YYYYMMDDNN` / `INV-YYYYMMDDNN`, filed in the right workflow folder |
| Receivables | Reads the .xlsx finance ledger directly; reports open invoices with ages and per-customer balances **per currency**, plus the data-quality limits of those figures |
| Email | Searches and reads the mailbox, prepares drafts — **it never sends** |
| Outreach | Drafts introduction emails to prospective local customers |
| EHS documents | Drafts inspection reports, safety plans and compliance documents from your own past work |

---

## One-time setup

### 1. Anthropic API key

Create a key at <https://console.anthropic.com>. Costs are usage-based; a small
business doing tens of these tasks a day should expect single-digit dollars a day.

### 2. Google access

There are two ways to give the agent access to your Google data, and they are
not interchangeable. Use the first unless you need mail.

#### A service account — for Drive and Sheets (recommended)

A service account is its own identity with its own email address. There is no
browser sign-in, no consent screen, no refresh token, and nothing that expires.
You grant it access the way you grant a colleague access: by sharing a folder
with its address.

1. Go to <https://console.cloud.google.com/iam-admin/serviceaccounts>, pick your
   project, and **Create service account**. Any name will do.
2. Skip the optional role and access steps — it needs no project permissions.
3. Open it, go to **Keys** → **Add key** → **Create new key** → **JSON**.
   A `.json` file downloads. That file is the credential.
4. Enable the **Google Drive API** and **Google Sheets API** for the project at
   <https://console.cloud.google.com/apis/library>.
5. Copy the service account's **email address** — it ends
   `.iam.gserviceaccount.com`.
6. In Google Drive, share these with that address, as **Viewer** (or **Editor**
   if the agent should file documents):
   - the **CUSTOMERS** folder
   - the **finance workbook** (if it lives outside that folder)

Set `GOOGLE_SERVICE_ACCOUNT` to the entire contents of the JSON file, from the
opening `{` to the closing `}`.

> A service account sees only what has been shared with it. That is the point:
> its reach is a list you can inspect in Drive and revoke in one click, rather
> than a token that carries the whole account.

**It cannot read Gmail.** A personal Google account cannot delegate its mailbox
to a service account — that needs Workspace domain-wide delegation. So mail
needs the second method.

#### An OAuth refresh token — for Gmail

This acts *as* the company account, which is what reading and drafting mail
requires.

1. Create an **OAuth client ID** of type **Desktop app** at
   <https://console.cloud.google.com/auth/clients>. The type matters: only a
   Desktop client may send the sign-in back to `http://localhost`, which is how
   the script below collects the result.
2. Download its JSON, then run `scripts/google-token.py` in Google Cloud Shell.
   It asks Google for exactly three scopes — Drive, Sheets and
   `gmail.modify` — signs in, and then **spends the token once to prove it
   works** before printing it.
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REFRESH_TOKEN`.

> A refresh token is a long-lived key to the whole account. Treat it like a bank
> password, and revoke it at <https://myaccount.google.com/permissions> if it
> ever leaks. It is also bound to the client that issued it: a token from one
> client and an id from another produce `invalid_grant`, which says nothing
> about the real mistake. `scripts/push-secrets.sh` sends all three together
> from Cloud Shell for that reason.

#### Which is used

If `GOOGLE_SERVICE_ACCOUNT` is set, it is used for everything it can do.
The OAuth credentials are then only consulted for mail. Setting both is the
normal arrangement for a complete agent; setting only the service account gives
you everything except email drafting.

### 3. Cloudflare Pages environment variables

In the Cloudflare dashboard: **Workers & Pages → environmsafe → Settings →
Variables and Secrets**. Add each of these as a **Secret** (not a plain text
variable) so the values are write-only once saved:

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | from step 1 |
| `GOOGLE_SERVICE_ACCOUNT` | the whole service account JSON key — Drive and Sheets |
| `GOOGLE_CLIENT_ID` | *only for mail* — from step 2 |
| `GOOGLE_CLIENT_SECRET` | *only for mail* — from step 2 |
| `GOOGLE_REFRESH_TOKEN` | *only for mail* — from step 2 |
| `STAFF_PASSCODE` | the passcode your staff will type to sign in |
| `SESSION_SECRET` | 32+ random characters — generate with `openssl rand -base64 32` |
| `ES_PROFILE` | the company profile JSON — see below |
| `ES_MODEL` | *optional* — which model answers. Omit for `claude-opus-5`. |

#### Choosing a model

This is the only part of the system that costs money; the hosting, the Google
APIs and the database are all on free tiers. Price per million tokens:

| Model | `ES_MODEL` | Input | Output |
|---|---|---|---|
| Haiku 4.5 | `claude-haiku-4-5` | $1 | $5 |
| Sonnet 5 | `claude-sonnet-5` | $2 | $10 |
| Opus 5 | *(omit)* | $5 | $25 |

A task that reads a few documents and drafts a quotation is roughly 30,000
tokens in and 2,000 out — about $0.04 on Haiku, $0.08 on Sonnet, $0.20 on Opus.
Start low and move up if the answers are not good enough; the change is one
variable and a redeploy, with no code edit.

Two things already reduce the bill without costing quality: the system prompt
and company profile are sent with `cache_control`, so repeated questions in a
session re-read them at a fraction of the price, and work that can wait can go
through the Batch API at half rate.

#### `ES_PROFILE`

The company's own details are kept out of the repository and supplied here
instead, so the code contains nothing specific to one company's filing system.
Paste a single line of JSON shaped like this:

```json
{
  "company": {
    "legalName": "...", "tradingName": "...",
    "offices": ["..."], "phones": ["..."],
    "email": "...", "website": "https://environmsafe.com",
    "currency": "USD", "vatRate": 0.05,
    "banks": ["..."]
  },
  "drive": {
    "rootId": "<folder id of the company Drive root>",
    "customersRootId": "<folder id of CUSTOMERS — one subfolder per deal>",
    "templatesId": "<folder id of the blank house-format documents>"
  },
  "ledgerFileId": "<drive file id of the finance workbook>",
  "customers": ["..."],
  "suppliers": ["..."]
}
```

Open a folder in Drive; the ID is the last part of the URL.

`drive.customersRootId` is the one that matters most. The filing system is **one
folder per deal** — each named `<number> <customer>`, e.g. `161 YCII Food Oil
Refinery` — and that deal folder is what holds the workflow subfolders:

```
CUSTOMERS/
  161 YCII Food Oil Refinery/
    01 RFQ In/   02 RFQ Out/   03 Quotations In/   04 Quotations Out/
    05 Invoices In/   06 Invoices Out/   07 PO-Contracts In/
    08 PO-Contracts Out/   09 Examples/   10 Others/
  166 Block 52 OMV/
    ...
```

So there is no company-wide "Quotations Out" folder to name here, and none is
configured: the agent finds a deal with `list_deals`, looks inside it with
`open_deal`, and resolves a workflow folder relative to that deal — creating it
if the deal has not got one yet. Older deals predate the convention and use
their own subfolder names, so the agent reads what is actually there rather than
assuming the ten exist.

The `customers` and `suppliers` lists only help the agent recognise names it
sees; they do not need to be complete.

### 4. Deploy

Connect the repository in **Workers & Pages → Create → Pages → Connect to Git**
and pick this repo. Build settings:

| Field | Value |
|---|---|
| Framework preset | None |
| Build command | `npm install` |
| Build output directory | `public` |

The build command is **not** optional here, even though the site itself has no
build step. Leaving it empty makes Cloudflare skip the whole build phase —
including `npm install` — and the Functions then fail to bundle with
`Could not resolve "@anthropic-ai/sdk"`, because their dependencies were never
installed.

Only `public/` is published. `functions/` and `lib/` stay outside it, so the
agent's server-side source is never served to visitors.

### 5. Turn on the nodejs_compat flag

**Required — the agent will not run without it.** It provides `Buffer`,
`node:crypto` and the `.xlsx` parser on the Workers runtime.

In the project: **Settings → Runtime → Compatibility flags**. Add
`nodejs_compat` to **both Production and Preview**, and set the compatibility
date to today or later. Then redeploy.

This lives in the dashboard rather than a `wrangler.toml` on purpose: a config
file has to carry the project's exact name, and a mismatch fails the build for
a reason the log states obscurely.

Then add `environmsafe.com` under the project's **Custom domains** tab and open
`https://environmsafe.com/agent`.

> Cloudflare Pages serves `agent.html` at the extensionless path `/agent` and
> redirects `/agent.html` to it. Both work; `/agent` is the address to share.

---

## On a phone

The console is a web page, so there is nothing to install from a store. Open
`environmsafe.com/agent` in Chrome, then **⋮ → Add to Home screen**. It installs
as its own app: full screen, no browser bar, its own icon.

It is built for the phone rather than merely surviving on one — every control is
at least 44px, the text box is 16px so the browser does not zoom when you tap it,
and the layout follows the real viewport as the keyboard opens.

The service worker at `public/agent-sw.js` caches **nothing** and exists only so
Android offers a real install rather than a bookmark. That is deliberate: the
console streams its answers and sits behind a session cookie, so a cached page
could show one person's work to the next.

## The receivables page

`/receivables` shows the same figures the agent reports, as a page rather than a
conversation: open invoices oldest first, an ageing breakdown, and each
customer's invoiced / received / difference per currency.

**It makes no model call.** Ageing an invoice and summing a balance is
arithmetic, so the page needs no `ANTHROPIC_API_KEY`, costs nothing to run, and
keeps working when the agent cannot. It shares the staff passcode and session
cookie with the agent, and reads the same workbook through `lib/ledger.js`.

The data-quality warnings are printed above the figures rather than below them,
because a balance from this ledger is not the amount owed and the reasons why
should be read first.

## Everyday use

Open the page, enter the staff passcode, and type what you want done. The agent
shows what it is doing as it goes — which folder it is searching, which document
it is reading — so you can see where a figure came from.

**Ask it things like:**

- *"Which quotations from the last 30 days have not come back as a PO?"*
- *"Who owes us money, and how old is each invoice?"*
- *"Build a quotation for this customer for these three items, 18% margin."*
- *"Check the inbox for RFQs from this week we haven't replied to."*
- *"Draft an introduction email for engineering companies in our area."*

---

## The rules it works under

These are built into the agent, not optional settings:

- **It never sends email.** It prepares drafts. A person reviews and sends.
- **It never invents a figure.** Prices, quantities and part numbers must come
  from a document it has actually read, or from you.
- **It never assumes a margin.** It asks, then shows cost, margin and selling
  price separately so you can check the arithmetic.
- **It cites its sources.** When it tells you an amount, it names the file or
  email it read that from.

---

## Changing how it works

There are two places, and the split matters:

- **Which model answers** — the `ES_MODEL` environment variable. Change it in
  Cloudflare and redeploy.
- **Company data** — letterhead, folder IDs, customer and supplier lists — lives
  in the `ES_PROFILE` environment variable. Change it in Cloudflare and redeploy;
  no code change, and nothing private ends up in the repository.
- **Rules and behaviour** — the trading cycle, numbering, default quotation
  terms, and the standing instructions above — live in
  `lib/knowledge.js`. Edit that file and redeploy.

To add a new capability, add a tool in `lib/tools.js`: a definition in
`TOOLS` describing what it does, and a matching `case` in `executeTool`.

---

## Files

```
public/                      everything served to visitors
  agent.html                 the staff console
  receivables.html           the ageing report; no model call
  css/agent.css              its styling
  js/agent.js                chat UI; talks to /api/agent, holds no secrets
functions/api/agent.js       the agent loop, streamed over SSE
functions/api/receivables.js the ageing report as JSON; no model call
functions/api/login.js       passcode sign-in
lib/runtime.js               hands Cloudflare's bindings to the library
lib/config.js                loads the company profile from ES_PROFILE
lib/knowledge.js             the agent's rules and behaviour  ← edit this
lib/tools.js                 what the agent can do
lib/google.js                Drive, Sheets and Gmail access
lib/documents.js             quotation / invoice rendering
lib/ledger.js                reads the .xlsx ledger, derives receivables
lib/session.js               signed session cookies
```

---

## Security notes

- The console is behind a shared staff passcode and a signed, 12-hour session
  cookie. That is proportionate for a small team. If staff numbers grow, or
  someone leaves, move to per-person logins — a shared passcode cannot be
  revoked for one person.
- `/agent` is marked `noindex` and is not linked from the public site, but
  **the passcode is what protects it**, not obscurity.
- Cloudflare Access can replace the shared passcode with per-person email
  sign-in, free for up to 50 users. That is the recommended next step: a shared
  passcode cannot be revoked for one person who leaves.
- The agent has full read/write access to the company Drive and mailbox. Anyone
  with the passcode has that access through it.
- The repository holds no folder IDs, customer names or letterhead details —
  those are supplied at runtime through `ES_PROFILE`.
