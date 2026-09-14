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

The agent acts as the company Google account — the one that owns the procurement
Drive folders and receives customer mail.

1. Go to <https://console.cloud.google.com>, create a project, and enable the
   **Google Drive API**, **Google Sheets API** and **Gmail API**.
2. Under **APIs & Services → Credentials**, create an **OAuth client ID** of type
   *Web application*. Add `https://developers.google.com/oauthplayground` as an
   authorised redirect URI. Note the client ID and client secret.
3. Open <https://developers.google.com/oauthplayground>. Click the gear icon,
   tick **Use your own OAuth credentials**, and paste the client ID and secret.
4. In the scope list on the left, authorise these scopes:

   ```
   https://www.googleapis.com/auth/drive
   https://www.googleapis.com/auth/spreadsheets
   https://www.googleapis.com/auth/gmail.modify
   ```

5. Sign in as the company account, then click **Exchange authorization code for
   tokens**. Copy the **refresh token**.

> The refresh token is a long-lived key to the company Drive and mailbox. Treat it
> like a bank password. If it ever leaks, revoke it at
> <https://myaccount.google.com/permissions>.

### 3. Cloudflare Pages environment variables

In the Cloudflare dashboard: **Workers & Pages → environmsafe → Settings →
Variables and Secrets**. Add each of these as a **Secret** (not a plain text
variable) so the values are write-only once saved:

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | from step 1 |
| `GOOGLE_CLIENT_ID` | from step 2 |
| `GOOGLE_CLIENT_SECRET` | from step 2 |
| `GOOGLE_REFRESH_TOKEN` | from step 2 |
| `STAFF_PASSCODE` | the passcode your staff will type to sign in |
| `SESSION_SECRET` | 32+ random characters — generate with `openssl rand -base64 32` |
| `ES_PROFILE` | the company profile JSON — see below |

#### `ES_PROFILE`

The company's own details are kept out of the repository and supplied here
instead, so the code contains nothing specific to one company's filing system.
Paste a single line of JSON shaped like this, filling in your real Drive folder
IDs (open a folder in Drive; the ID is the last part of the URL):

```json
{
  "company": {
    "legalName": "...", "tradingName": "...",
    "offices": ["..."], "phones": ["..."],
    "email": "...", "website": "https://environmsafe.com",
    "currency": "USD", "vatRate": 0.05,
    "banks": ["..."]
  },
  "folders": {
    "01 RFQ In": "<drive folder id>",
    "02 RFQ Out": "<drive folder id>",
    "03 Quotations In": "<drive folder id>",
    "04 Quotations Out": "<drive folder id>",
    "05 Invoices In": "<drive folder id>",
    "06 Invoices Out": "<drive folder id>",
    "07 PO-Contracts In": "<drive folder id>",
    "08 PO-Contracts Out": "<drive folder id>",
    "09 Examples": "<drive folder id>",
    "10 Others": "<drive folder id>"
  },
  "ledgerFileId": "<drive file id of the finance workbook>",
  "customers": ["..."],
  "suppliers": ["..."]
}
```

The `customers` and `suppliers` lists only help the agent recognise names it
sees; they do not need to be complete.

### 4. Deploy

Connect the repository in **Workers & Pages → Create → Pages → Connect to Git**,
pick this repo, and leave the build command empty — the site has no build step.
The build output directory is `public`; `functions/` and `lib/` sit outside it so
the agent's server-side source is never served to visitors.
`wrangler.toml` supplies the rest, including the `nodejs_compat` flag the agent
needs for `Buffer`, `node:crypto` and `.xlsx` parsing.

Then add `environmsafe.com` under the project's **Custom domains** tab and open
`https://environmsafe.com/agent`.

> Cloudflare Pages serves `agent.html` at the extensionless path `/agent` and
> redirects `/agent.html` to it. Both work; `/agent` is the address to share.

---

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
  css/agent.css              its styling
  js/agent.js                chat UI; talks to /api/agent, holds no secrets
functions/api/agent.js       the agent loop, streamed over SSE
functions/api/login.js       passcode sign-in
lib/runtime.js               hands Cloudflare's bindings to the library
lib/config.js                loads the company profile from ES_PROFILE
lib/knowledge.js             the agent's rules and behaviour  ← edit this
lib/tools.js                 what the agent can do
lib/google.js                Drive, Sheets and Gmail access
lib/documents.js             quotation / invoice rendering
lib/ledger.js                reads the .xlsx ledger, derives receivables
lib/session.js               signed session cookies
wrangler.toml                Cloudflare Pages configuration
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
