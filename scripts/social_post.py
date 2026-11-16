#!/usr/bin/env python3
"""Share a published post on the Facebook page and the LinkedIn company page.

    python scripts/social_post.py 2026-11-17-the-rcd-test-button-nobody-presses

Run by .github/workflows/daily-post.yml after a post has been published and
pushed. The post's titles and homepage summaries are read from the ledger
(_published.json), which the publisher has just updated.

The post itself is made by the Make scenario "EnvironmSafe - social post"
(team "My Team"), which this script calls through its webhook. The webhook URL
is the GitHub secret MAKE_SOCIAL_WEBHOOK_URL. The scenario answers
"posted <slug>" only after both networks have accepted the post, so any other
answer means at least one of them did not get it.

Environment:
  MAKE_SOCIAL_WEBHOOK_URL  webhook to call; if unset, nothing is shared and a
                           warning is printed (exit 0)
  SOCIAL_DRY_RUN=1         print the payload instead of sending it
"""
import json
import os
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEDGER = os.path.join(ROOT, "_published.json")
BASE = "https://www.environmsafe.com"
TARGETS = "fb,li"


def build_payload(dated_slug):
    ledger = json.load(open(LEDGER, encoding="utf-8"))
    for e in ledger:
        if "%s-%s" % (e["iso"], e["slug"]) == dated_slug:
            break
    else:
        raise SystemExit("::error::%s is not in _published.json" % dated_slug)

    url_en = "%s/news/%s.html" % (BASE, dated_slug)
    url_ar = "%s/ar/news/%s.html" % (BASE, dated_slug)
    message = (
        "%s\n\n%s\n\nRead more: %s\n\n%s\n\n%s\n\nاقرأ المزيد: %s"
        % (e["en"]["title"], e["en"]["home_summary"], url_en,
           e["ar"]["title"], e["ar"]["home_summary"], url_ar)
    )
    return {
        "slug": dated_slug,
        "targets": TARGETS,
        "link": url_en,          # Facebook builds its link preview from this
        "fb_message": message,
        "li_message": message,   # LinkedIn text share has no link field; URLs are in the text
    }


def main():
    if len(sys.argv) != 2 or not sys.argv[1]:
        raise SystemExit("usage: social_post.py YYYY-MM-DD-slug")
    payload = build_payload(sys.argv[1])

    if os.environ.get("SOCIAL_DRY_RUN"):
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return

    url = os.environ.get("MAKE_SOCIAL_WEBHOOK_URL", "").strip()
    if not url:
        print("::warning::MAKE_SOCIAL_WEBHOOK_URL is not set - post not shared on Facebook or LinkedIn")
        return

    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"), method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=240) as resp:
            status, body = resp.status, resp.read().decode("utf-8", "replace").strip()
    except urllib.error.HTTPError as exc:
        status, body = exc.code, exc.read().decode("utf-8", "replace").strip()
    except urllib.error.URLError as exc:
        raise SystemExit("::error::could not reach the Make webhook: %s" % exc.reason)

    expected = "posted %s" % payload["slug"]
    if status != 200 or body != expected:
        raise SystemExit(
            "::error::Make did not confirm the social post (HTTP %s, %r). The website post is live; "
            "check the scenario's history in Make, and whether it has been switched off after an error."
            % (status, body[:200])
        )
    print("shared on Facebook and LinkedIn: %s" % payload["slug"])


if __name__ == "__main__":
    main()
