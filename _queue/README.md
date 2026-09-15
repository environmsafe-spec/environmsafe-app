# Post queue

Each `.json` file here is one ready-to-publish bilingual post. The daily GitHub Action
(`.github/workflows/daily-post.yml`) takes the **first file in alphabetical order**,
publishes it with today's date, and moves it into `published/`.

Name files with a zero-padded number so the order is explicit: `0001-topic.json`,
`0002-topic.json`, and so on.

## Format

```jsonc
{
  "slug": "keyword-slug-no-date",   // the date is prefixed automatically at publish time
  "icon": "fa-wind",                // Font Awesome 6 solid icon name
  "color": "teal",                  // one of: orange, green, blue, teal, navy, amber
  "en": {
    "title":        "...",          // H1 and <title>
    "meta_desc":    "...",          // 140-160 characters
    "category":     "...",          // short label, e.g. "HVAC"
    "body":         "<p>...</p>",   // 450-600 words; only <p> <h2> <h3> <ul> <li> <strong> <a>
    "cta_heading":  "...",
    "cta_text":     "...",
    "cta_label":    "...",
    "cta_href":     "../contact.html",   // or ../services/NAME.html
    "teaser":       "...",          // 60-90 words, news index card
    "home_summary": "..."           // 1-2 sentences, homepage card
  },
  "ar": { ...same keys, Arabic... }
}
```

Cards on the index and homepage deliberately show **no date** - the date lives in the
URL, on the post page itself, and in the sitemap and schema data.

## Safety behaviour

The publisher aborts without writing anything if the queue is empty, a required marker
is missing, a placeholder is left unreplaced, a target page already exists, or a post
has already been published for today's date. A failed run leaves the repo untouched.

## Running it by hand

Actions tab, then *Daily EnvironmSafe post*, then *Run workflow*. The optional
`publish_date` input backfills a specific date.
