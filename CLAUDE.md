# CLAUDE.md — environmsafe-app

The EnvironmSafe marketing website: **www.environmsafe.com**.

Read this before changing anything. It records how the site is built and
deployed, and the specific ways it has broken before.

---

## Check this first

**The daily post queue empties silently.** When `_queue/*.json` is empty the
scheduled workflow fails every morning, nothing is published, and nothing on
the site says so. It has happened twice.

```bash
ls -1 _queue/*.json | wc -l          # 0 means the pipeline is dead
```

As of 4 November 2026 the queue holds posts `0025`–`0040`, enough for 5–20
November. **It runs dry on 21 November** unless more are added. (It emptied on
1 November and runs #42 and #43 failed before it was refilled.) Refilling it is
described under *Daily posts* below.

---

## What this is

A **static site**. No CMS, no WordPress, no database, no build step for the
pages. 133 hand-written HTML files. Each page is a real file that Cloudflare
serves directly.

| | |
|---|---|
| Hosting | Cloudflare Pages, project **`environmsafe`** |
| Cloudflare account | `52e4e5ca8c5d60d092cd547b12b1ff92` |
| Deploy trigger | push to **`main`** — no other step |
| Published directory | **`public/`** |
| Live in | about a minute after a push |

Netlify is **not** used. It hosted the maintenance app until 7 October 2026;
nothing points at it now.

### Repository layout

```
public/              what gets published — the web root
  index.html         English homepage
  ar/                the Arabic site, RTL, mirrors the English tree
  services/          eight service pages (+ ar/services/)
  news/              published posts (+ ar/news/), with _template.html
  css/ js/ img/      12 stylesheets+scripts, images, img/partners/ logos
  sitemap.xml  robots.txt  _headers  _redirects
functions/           Cloudflare Pages Functions — real server-side code
lib/                 shared modules used by functions/
scripts/             publish_next_post.py and other command-line tools
_queue/              posts waiting to be published, + published/ archive
_published.json      the ledger that rebuilds the homepage news block
docs/                PLATFORM-ARCHITECTURE.md
AGENT_SETUP.md       setup for the internal business agent, not the site
```

`package.json` exists for the command-line scripts (`@anthropic-ai/sdk`,
`xlsx`). **No build runs for the website.**

---

## Bilingual

Every page exists twice: English at `public/`, Arabic at `public/ar/`. The
Arabic pages are RTL (`dir="rtl"`) and share one stylesheet.

**Change both, always.** A change to one language only is a bug.

`functions/index.js` routes `/` by cookie and `Accept-Language` — never by user
agent, which would be cloaking.

---

## Daily posts

A post is published every morning by `.github/workflows/daily-post.yml`
(cron `0 6 * * *`, 09:00 Asia/Aden) running `scripts/publish_next_post.py`.

It takes the **first file alphabetically** from `_queue/`, publishes it under
today's date, and moves it to `_queue/published/`. Number files `0001-…`,
`0002-…` so the order is explicit. Format is documented in `_queue/README.md`.

The workflow also accepts a `publish_date` input for backfilling a specific
date, from the Actions tab.

### Verify a queue change before pushing

Copy the site to a scratch directory and actually run the publisher, once per
queued post, until the queue empties:

```bash
cp -r public _queue _published.json scripts "$T"/ && cd "$T"
PUBLISH_DATE=2026-11-04 python3 scripts/publish_next_post.py
```

Then check the generated pages: one `<h1>`, a canonical link, valid JSON-LD, a
meta description in range, `dir="rtl"` on the Arabic only, and **no `noindex`**.

### Traps in this pipeline

**`noindex` leaking into posts.** Five commits on 22 October removed stray
`noindex` tags from published posts and from both `_template.html` files. A post
carrying `noindex` is invisible to Google. Grep for it after any template edit.

**The `NEWS-ENTRIES` marker.** Both `news.html` and `ar/news.html` contain:

```html
<!-- NEWS-ENTRIES: add each new daily post as a new <article> directly below this line, newest first -->
```

The publisher **aborts** without it. The marker itself contains the text
`<article>`, so a regex that strips `<article>…</article>` across the whole
document will eat the closing `-->` and swallow the rest of the page. This has
happened. **Remove cards line-wise against each card's `id="post-YYYY-MM-DD"`
anchor**, never with a document-wide regex.

**`_published.json` desync.** The ledger drives the homepage "latest news"
block, which the publisher **rebuilds from scratch** on every run. A post added
to the site by hand without a ledger entry will have its homepage card silently
deleted at the next publish. If you add a post outside the pipeline, add its
ledger entry too — or better, use the queue with a `publish_date`.

**Duplicate posts.** The fire-protection article was published three times, two
of them sharing a slug, competing with itself for the same search terms.
Before queueing a topic, check it against the published slugs:

```bash
ls -1 public/news/*.html | sed -E 's#.*/[0-9-]{11}##; s#\.html$##' | sort
```

---

## Partners & clients section

On both homepages, `<section class="partners">`.

- **22 logo cards** — `img/partners/*.jpg|png`, one `<img>` per `.partner-card`
- **11 symbol cards** — `.partner-card--name`, an inline SVG plus the client's
  name, for clients whose logo we do not have

The symbol is **inline SVG on purpose**. It was a Font Awesome glyph first; the
icon font comes from a CDN, so the cards rendered completely empty when the
font could not be fetched, and that could not be seen before publishing. Do not
reintroduce a CDN dependency here.

To promote a symbol card to a logo: drop the file in `public/img/partners/`,
replace the `.partner-card--name` div with a normal `.partner-card` + `<img>`,
in **both** languages.

**Logos cannot be sourced from this sandbox.** There is no outbound web access
(see *Network* below). The client has to supply the file. Do not substitute a
lookalike found elsewhere.

Client project folders live in the team's Google Drive, one per job, named
`<number> <CLIENT>`. Reachable through the Google Drive MCP tools when
connected. 56 folders as of November 2026.

---

## Server-side code

`functions/` runs on Cloudflare's edge. The site is not purely static.

| File | What it does |
|---|---|
| `functions/index.js` | language routing at `/` |
| `functions/api/login.js` | staff passcode check, constant-time |
| `functions/api/receivables.js` | internal receivables page |
| `functions/api/agent.js` | internal business agent |

`/receivables.html` and `/agent.html` are internal pages on the public domain,
gated by a passcode checked **server-side** against the `STAFF_PASSCODE`
environment variable. That secret is **not** in the repository and must never
be. `robots.txt` disallows both, which is advisory and not access control.

See `AGENT_SETUP.md` for the agent's own configuration.

---

## Network and tooling limits

This sandbox has **no general outbound web access**. Blocked: Google,
Wikipedia, Cloudflare dashboard and API, `*.pages.dev`, the live site itself.
Reachable: Anthropic APIs and package registries (npm, PyPI, crates).

Consequences:

- **The live site cannot be fetched to check a change.** Render locally with
  the Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` driven
  by `playwright-core` (`npm i playwright-core@1.49.1` with
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`). This catches real problems — it is how
  the empty icon cards were found.
- **Cloudflare build logs cannot be read.** Deploy status comes from the
  GitHub check run on the commit; `::error::`/`::notice::` annotations are
  readable through the API when raw logs are not.
- `WebSearch` works (it runs Anthropic-side) but returns links only. It cannot
  download files.

---

## Branches — one is a trap

**`claude/godaddy-redirection-2O2Wn` is a dead end. Never push to it.**

It holds 231 commits of an abandoned layout where pages sit at the repository
root instead of `public/`. A fresh container may check it out by name. Its
history is unrelated to `main`, so a push is rejected and a force-push would
destroy work that exists nowhere else.

Work on a new branch off `main` and open a PR. Several merged branches are
still present and can be deleted.

---

## Conventions

- **Both languages, every time.**
- Posts and pages are plain HTML; match the surrounding markup rather than
  introducing a framework or a build step.
- JSON-LD on every page must parse. Check after any edit:
  `json.loads` over every `<script type="application/ld+json">`.
- Phone numbers shown as text are wrapped in `<span dir="ltr">` so Arabic pages
  do not reverse the digits. `tel:` hrefs and JSON-LD `telephone` fields are
  left alone.
- Address is `VX8C+7C Al Mansourah, Aden, Yemen`; coordinates 12.8532 /
  44.9724.
- **Adding a service** touches more than its page: the nav dropdown and footer
  list on every page (news templates included), both homepage service grids,
  the quote form `<select id="service">` in both `contact.html` files (each
  `<option>` has an English `value` and a `data-svc` slug), the slug map in
  `js/feedback.js`, the sitemap, `llms.txt` and `lib/knowledge.js`. Service
  pages link their quote buttons to `contact.html?service=<slug>#contactForm`,
  which pre-selects the option. Calibration was missed from the form once.
- **Environmental services are planned, not offered.** They appear only as
  *coming soon*: a dashed card on both homepages, a box on both HSE pages, and
  a quote-form option (`data-svc="environmental"`). Keep the wording general
  ("environmental monitoring and compliance services") until the scope is
  decided; do not list specific environmental services as available, and do
  not add them to the menus or the service count. The brand line
  "Environmental · Safety · Engineering" and the NEBOSH Environmental Award
  course are fine.
- **Calibration is laboratory-only.** On-site calibration of large or installed
  equipment is shown as *coming soon*; do not list it as available.
- **Website forms do not send email.** The quote, feedback, complaint and
  grievance forms post into Google Forms owned by `environmsafe.gm@gmail.com`
  (ids in `public/js/form-config.js`). Email per response comes from the Apps
  Script in `docs/forms/` installed inside each form; see its README.
- **Homepage hero is light** (white-to-grey, navy text, amber arc echoing the
  logo; the arc is hidden under 860 px and mirrored on Arabic). The rest of the
  site keeps navy and amber.
- **Bump the stylesheet version after editing `css/styles.css`.** Every page
  links `css/styles.css?v=YYYYMMDD`. Browsers and Cloudflare keep serving a
  cached stylesheet otherwise: the light-hero change was on `main` and did not
  show on the live site until the link changed. Replace the `?v=` value in
  every `public/**/*.html` (templates included) in the same commit.
- **Icons are self-hosted.** Font Awesome 6.5.0 is served from
  `public/vendor/fontawesome/` (linked as `/vendor/fontawesome/css/all.min.css`),
  not the cdnjs CDN: on slow mobile data the CDN font often failed and every
  icon showed as an empty box. Do not switch back to a CDN link. The WhatsApp
  and back-to-top icons are inline SVG in `js/main.js`.
- **Floating buttons on phones (< 900 px):** nothing floats over content. The
  WhatsApp button sits in the header bar beside the menu (`.header-wa`), and
  back-to-top is a small tab on the side edge (right; left on Arabic). Wide
  screens keep both floating bottom-right.
- Social links: LinkedIn and Facebook only. There is no Twitter/X account —
  that icon was removed deliberately.

---

## The other repository

**`environmsafe-spec/ES-Maintenance-Tracking`** (private) — the Client Assets &
Equipment Maintenance Tracking app at `generators.environmsafe.com`. One
self-contained HTML file on Firebase/Firestore, deployed to Cloudflare Pages
project `es-maintenance-tracking`. It has its own `CLAUDE.md` and `SCOPING.md`.

Relevant here: the Applications page links to it, and its card says **Staff
only** because per-client scoping is built but **not yet enforced** — the
scoped Firestore rules are written and deliberately unpublished. Do not change
that card's wording until they are live.

---

## Open items

- **Refill `_queue/` before 21 November** — the current queue ends with the 20 November post.
- **`UCSPI` and `United Sponge Company`** on the partners section are probably
  one company, and the real name may be *National* Company for Sponge & Plastic
  Industry rather than *United*. Needs the client's confirmation.
- **Petromasila** is a symbol card awaiting its logo file.
- **`NATCO` and `YCFMS`** appear to be HSA subsidiaries; HSA's logo is already
  on the page. Possibly fine, worth knowing.
- Several merged `claude/*` branches can be deleted.
