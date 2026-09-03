#!/usr/bin/env python3
"""
Publish the next queued EnvironmSafe daily post.

Reads the first JSON file in _queue/ (sorted by filename), builds the English and
Arabic post pages from the stored templates, adds a card to each news index, rebuilds
the three-card "Latest" block on both homepages, adds both URLs to the sitemap, and
retires the queue file into _queue/published/.

Designed to run unattended from GitHub Actions. It never overwrites an existing post
page and it aborts before writing anything if a required marker is missing, so a
partial publish is not possible.
"""

import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QUEUE_DIR = os.path.join(ROOT, "_queue")
PUBLISHED_DIR = os.path.join(QUEUE_DIR, "published")
LEDGER = os.path.join(ROOT, "_published.json")

AR_MONTHS = {
    1: "يناير", 2: "فبراير", 3: "مارس", 4: "أبريل", 5: "مايو", 6: "يونيو",
    7: "يوليو", 8: "أغسطس", 9: "سبتمبر", 10: "أكتوبر", 11: "نوفمبر", 12: "ديسمبر",
}

EN_NEWS_MARKER = "<!-- NEWS-ENTRIES: add each new daily post as a new <article> directly below this line, newest first -->"
AR_NEWS_MARKER = "<!-- NEWS-ENTRIES: أضف كل منشور يومي جديد كعنصر <article> جديد مباشرة أسفل هذا السطر، الأحدث أولاً -->"
SITEMAP_MARKER = "<!-- SITEMAP-POSTS: add each new post URL pair directly below this line, newest first -->"
LATEST_START = "<!-- LATEST-NEWS:START -->"
LATEST_END = "<!-- LATEST-NEWS:END -->"

PLACEHOLDER_RE = re.compile(r"\{\{[A-Z_]+\}\}")


class Abort(Exception):
    pass


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def next_queue_file():
    if not os.path.isdir(QUEUE_DIR):
        raise Abort("no _queue directory")
    names = sorted(
        n for n in os.listdir(QUEUE_DIR)
        if n.endswith(".json") and not n.startswith("_")
    )
    if not names:
        raise Abort("queue is empty - add more posts to _queue/")
    return os.path.join(QUEUE_DIR, names[0])


def build_page(template_path, target_path, values):
    if os.path.exists(target_path):
        raise Abort("target already exists, refusing to overwrite: %s" % target_path)
    html = read(template_path)
    html = html.replace('  <meta name="robots" content="noindex" />\n', "")
    for key, val in values.items():
        html = html.replace("{{%s}}" % key, val)
    leftover = PLACEHOLDER_RE.findall(html)
    if leftover:
        raise Abort("unreplaced placeholders in %s: %s" % (target_path, sorted(set(leftover))))
    return html


def card(post, lang, iso, include_id, text):
    """One .service-card article. No visible date line - deliberate site convention."""
    arrow = "fa-arrow-right" if lang == "en" else "fa-arrow-left"
    cta = "Read the full post" if lang == "en" else "اقرأ المنشور كاملاً"
    ident = ' id="post-%s"' % iso if include_id else ""
    href = "news/%s-%s.html" % (iso, post["slug"])
    return (
        '        <article class="service-card fade-up"%s>\n'
        '          <div class="service-card__icon service-card__icon--%s"><i class="fa-solid %s"></i></div>\n'
        '          <h3 class="service-card__title">%s</h3>\n'
        '          <p class="service-card__desc">\n'
        '            %s\n'
        '          </p>\n'
        '          <a href="%s" class="service-card__cta">%s <i class="fa-solid %s"></i></a>\n'
        '        </article>'
        % (ident, post["color"], post["icon"], post[lang]["title"], text, href, cta, arrow)
    )


def insert_after(text, marker, addition, path):
    if text.count(marker) != 1:
        raise Abort("marker appears %d times in %s (expected 1)" % (text.count(marker), path))
    return text.replace(marker, marker + "\n" + addition)


def replace_between(text, start, end, new_block, path):
    if text.count(start) != 1 or text.count(end) != 1:
        raise Abort("LATEST-NEWS markers not found exactly once in %s" % path)
    head, rest = text.split(start, 1)
    _, tail = rest.split(end, 1)
    return head + start + "\n" + new_block + end + tail


def main():
    override = os.environ.get("PUBLISH_DATE", "").strip()
    if override:
        try:
            now = datetime.strptime(override, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            raise Abort("PUBLISH_DATE must be YYYY-MM-DD, got %r" % override)
    else:
        now = datetime.now(timezone.utc)
    iso = now.strftime("%Y-%m-%d")
    en_date = "%s %d, %d" % (now.strftime("%B"), now.day, now.year)
    ar_date = "%d %s %d" % (now.day, AR_MONTHS[now.month], now.year)

    qpath = next_queue_file()
    post = json.loads(read(qpath))
    for field in ("slug", "icon", "color", "en", "ar"):
        if field not in post:
            raise Abort("queue file %s missing field '%s'" % (os.path.basename(qpath), field))

    slug = "%s-%s" % (iso, post["slug"])
    targets = {
        "en": os.path.join(ROOT, "news", slug + ".html"),
        "ar": os.path.join(ROOT, "ar", "news", slug + ".html"),
    }
    templates = {
        "en": os.path.join(ROOT, "news", "_template.html"),
        "ar": os.path.join(ROOT, "ar", "news", "_template.html"),
    }

    # ---- build both pages in memory first; nothing is written until all checks pass
    pages = {}
    for lang in ("en", "ar"):
        d = post[lang]
        pages[lang] = build_page(templates[lang], targets[lang], {
            "TITLE": d["title"],
            "META_DESC": d["meta_desc"],
            "SLUG": slug,
            "ISO_DATE": iso,
            "DISPLAY_DATE": en_date if lang == "en" else ar_date,
            "CATEGORY": d["category"],
            "BODY": d["body"],
            "CTA_HEADING": d["cta_heading"],
            "CTA_TEXT": d["cta_text"],
            "CTA_LABEL": d["cta_label"],
            "CTA_HREF": d["cta_href"],
        })

    # ---- refuse to publish twice in one day (would create duplicate element ids)
    news_en = read(os.path.join(ROOT, "news.html"))
    if ('id="post-%s"' % iso) in news_en:
        raise Abort("a post for %s is already on the news index - nothing to do today" % iso)

    # ---- news indexes
    edits = {}
    for lang, path, marker in (
        ("en", os.path.join(ROOT, "news.html"), EN_NEWS_MARKER),
        ("ar", os.path.join(ROOT, "ar", "news.html"), AR_NEWS_MARKER),
    ):
        edits[path] = insert_after(
            read(path), marker,
            card(post, lang, iso, True, post[lang]["teaser"]),
            path,
        )

    # ---- homepage blocks: this post plus the two most recent from the ledger
    ledger = json.loads(read(LEDGER)) if os.path.exists(LEDGER) else []
    entry = {
        "iso": iso, "slug": post["slug"], "icon": post["icon"], "color": post["color"],
        "en": {"title": post["en"]["title"], "home_summary": post["en"]["home_summary"]},
        "ar": {"title": post["ar"]["title"], "home_summary": post["ar"]["home_summary"]},
    }
    recent = ([entry] + ledger)[:3]

    for lang, path in (
        ("en", os.path.join(ROOT, "index.html")),
        ("ar", os.path.join(ROOT, "ar", "index.html")),
    ):
        block = "".join(
            card(r, lang, r["iso"], False, r[lang]["home_summary"]) + "\n" for r in recent
        )
        edits[path] = replace_between(read(path), LATEST_START, LATEST_END, block, path)

    # ---- sitemap
    base = "https://www.environmsafe.com"
    urls = ""
    for loc in ("%s/news/%s.html" % (base, slug), "%s/ar/news/%s.html" % (base, slug)):
        urls += (
            "  <url>\n"
            "    <loc>%s</loc>\n"
            '    <xhtml:link rel="alternate" hreflang="en" href="%s/news/%s.html"/>\n'
            '    <xhtml:link rel="alternate" hreflang="ar" href="%s/ar/news/%s.html"/>\n'
            "    <lastmod>%s</lastmod>\n"
            "    <changefreq>yearly</changefreq>\n"
            "    <priority>0.6</priority>\n"
            "  </url>\n" % (loc, base, slug, base, slug, iso)
        )
    smpath = os.path.join(ROOT, "sitemap.xml")
    edits[smpath] = insert_after(read(smpath), SITEMAP_MARKER, urls.rstrip("\n"), smpath)

    # ---- all checks passed; write everything
    for lang in ("en", "ar"):
        write(targets[lang], pages[lang])
    for path, text in edits.items():
        write(path, text)
    write(LEDGER, json.dumps(recent + ledger[2:][:27], ensure_ascii=False, indent=2) + "\n")

    os.makedirs(PUBLISHED_DIR, exist_ok=True)
    shutil.move(qpath, os.path.join(PUBLISHED_DIR, os.path.basename(qpath)))

    remaining = len([n for n in os.listdir(QUEUE_DIR) if n.endswith(".json") and not n.startswith("_")])
    summary = {
        "slug": slug,
        "title_en": post["en"]["title"],
        "url_en": "%s/news/%s.html" % (base, slug),
        "url_ar": "%s/ar/news/%s.html" % (base, slug),
        "queue_remaining": remaining,
    }
    print(json.dumps(summary, ensure_ascii=False))
    gh_out = os.environ.get("GITHUB_OUTPUT")
    if gh_out:
        with open(gh_out, "a", encoding="utf-8") as fh:
            fh.write("slug=%s\n" % slug)
            fh.write("queue_remaining=%d\n" % remaining)
    if remaining <= 5:
        sys.stderr.write("WARNING: only %d queued posts remain\n" % remaining)


if __name__ == "__main__":
    try:
        main()
    except Abort as exc:
        sys.stderr.write("publish aborted: %s\n" % exc)
        sys.exit(1)
