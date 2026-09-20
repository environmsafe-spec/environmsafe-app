#!/usr/bin/env bash
#
# Send the Google credentials from this machine straight into Cloudflare.
#
# Pasting INTO a phone terminal is easy; copying a hundred-character token OUT
# of one is where these values get truncated, or land in the wrong row of three
# fields that all truncate to "GOOGLE" on a narrow screen. So reverse the
# direction: the values never leave this machine by hand.
#
#   export CLOUDFLARE_API_TOKEN=...      (paste once)
#   bash push-secrets.sh
#
set -euo pipefail

SECRETS="${1:-$HOME/es-secrets.txt}"
PROJECT="${CF_PAGES_PROJECT:-environmsafe}"

die() { printf '\n%s\n' "$@" >&2; exit 1; }

[ -f "$SECRETS" ] || die \
  "No secrets file at $SECRETS" \
  "" \
  "Run the token script first — it writes that file:" \
  "  python3 -u ~/gt.py --new-client"

[ -n "${CLOUDFLARE_API_TOKEN:-}" ] || die \
  "CLOUDFLARE_API_TOKEN is not set." \
  "" \
  "Create a token at https://dash.cloudflare.com/profile/api-tokens" \
  "with the permission  Account -> Cloudflare Pages -> Edit," \
  "then paste it here as:" \
  "" \
  "  export CLOUDFLARE_API_TOKEN=your-token-here"

# The file is name-then-value, blank lines between. Turn it into the JSON that
# `wrangler pages secret bulk` wants, and fail loudly on anything unexpected
# rather than uploading a half-filled set.
JSON="$(mktemp)"
chmod 600 "$JSON"
trap 'rm -f "$JSON"' EXIT

python3 - "$SECRETS" "$JSON" <<'PY'
import json, re, sys

WANTED = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"]
SHAPE = {
    "GOOGLE_CLIENT_ID": (lambda v: v.endswith(".apps.googleusercontent.com"),
                         "end in .apps.googleusercontent.com"),
    "GOOGLE_CLIENT_SECRET": (lambda v: v.startswith("GOCSPX-"), "begin GOCSPX-"),
    "GOOGLE_REFRESH_TOKEN": (lambda v: v.startswith("1//"), 'begin "1//"'),
}

lines = [l.strip() for l in open(sys.argv[1])]
found = {}
for i, line in enumerate(lines):
    if line in WANTED:
        value = next((l for l in lines[i + 1:] if l), "")
        found[line] = value

missing = [k for k in WANTED if not found.get(k)]
if missing:
    sys.exit("The secrets file is missing: " + ", ".join(missing))

# Catch a swapped or truncated value before it is uploaded, not after a
# deployment: the shapes are distinctive and the cost of being wrong is an
# hour, not a second.
for key, value in found.items():
    ok, looks = SHAPE[key]
    if not ok(value):
        sys.exit(
            "%s does not look right — it should %s, but starts %r and is %d characters."
            % (key, looks, value[:7], len(value))
        )

json.dump(found, open(sys.argv[2], "w"))
print("Read %d credentials, all the right shape." % len(found))
PY

echo
echo "Uploading to the Pages project \"$PROJECT\"..."
echo

npx --yes wrangler@latest pages secret bulk "$JSON" --project-name "$PROJECT"

cat <<'DONE'

Uploaded. Two things left, and neither involves copying anything:

  1. A secret does nothing until the next build runs. In the dashboard:
     Workers & Pages -> environmsafe -> Deployments -> the newest one
     -> the ... menu -> Retry deployment.

  2. When that build is green, wipe the credentials from this machine:

       rm -f ~/client.json ~/gt.py ~/es-secrets.txt
       unset CLOUDFLARE_API_TOKEN

     Then delete the Cloudflare API token at
     https://dash.cloudflare.com/profile/api-tokens — it has served its
     purpose and a token that still exists is a token that can leak.
DONE
