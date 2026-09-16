#!/usr/bin/env python3
"""
Mint the agent's Google refresh token, once.

Run this in Google Cloud Shell after creating a Desktop-app OAuth client and
saving its JSON as ~/client.json. It prints the three values that go into
Cloudflare as secrets, and nothing is stored anywhere but this machine.

    python3 google-token.py

Why not `gcloud auth application-default login`? That command insists on
adding the broad cloud-platform scope whenever you give it scopes of your own,
and its flag names have moved between releases. The agent needs three scopes
and no more, so this asks Google directly and grants exactly those.
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

CLIENT_FILE = os.path.expanduser("~/client.json")

# Exactly what the agent uses, and nothing else: it reads and files documents,
# reads the finance workbook, and prepares mail drafts. It is never permitted
# to send, so gmail.send is deliberately absent.
SCOPES = " ".join([
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/gmail.modify",
])

# The code is shown on a Google page for the person to copy, rather than being
# redirected to a local port — the browser here is a phone, not this machine.
REDIRECT = "urn:ietf:wg:oauth:2.0:oob"

RULE = "=" * 64


def die(*lines):
    print()
    for line in lines:
        print(line)
    sys.exit(1)


def load_client():
    if not os.path.exists(CLIENT_FILE):
        die("Cannot find " + CLIENT_FILE,
            "",
            "Save the OAuth client JSON you downloaded from Google there first.")
    try:
        data = json.load(open(CLIENT_FILE))
    except ValueError:
        die(CLIENT_FILE + " is not valid JSON.",
            "Download the client JSON from Google again and save it there.")

    block = data.get("installed") or data.get("web") or {}
    cid, csec = block.get("client_id", ""), block.get("client_secret", "")
    if not cid or not csec:
        die(CLIENT_FILE + " has no client_id / client_secret in it.",
            "Make sure it is the file Google gave you, unedited.")
    return cid, csec


def main():
    cid, csec = load_client()

    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
        "client_id": cid,
        "redirect_uri": REDIRECT,
        "response_type": "code",
        "scope": SCOPES,
        # offline + consent together are what guarantee a refresh token comes
        # back, even if this account has approved this app before.
        "access_type": "offline",
        "prompt": "consent",
    })

    print()
    print(RULE)
    print(" STEP 1 — open this link on your phone or computer")
    print(RULE)
    print()
    print(url)
    print()
    print(" Sign in as the company Google account.")
    print(" If it warns the app is not verified: Advanced -> Go to ...")
    print(" Approve Drive, Sheets and Gmail. The last page shows a code.")
    print()
    print(RULE)
    print(" STEP 2 — paste that code below")
    print(RULE)
    print()

    try:
        code = input("Code: ").strip()
    except (EOFError, KeyboardInterrupt):
        die("Cancelled. Nothing was changed.")

    if not code:
        die("No code entered. Run the script again when you have it.")

    body = urllib.parse.urlencode({
        "code": code,
        "client_id": cid,
        "client_secret": csec,
        "redirect_uri": REDIRECT,
        "grant_type": "authorization_code",
    }).encode()

    try:
        with urllib.request.urlopen(
            urllib.request.Request("https://oauth2.googleapis.com/token", data=body)
        ) as response:
            token = json.load(response)
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", "replace")
        hint = ""
        if "invalid_grant" in detail:
            hint = ("The code was already used, or it expired. Codes last only a "
                    "few minutes — run the script again and be quick with it.")
        elif "redirect_uri_mismatch" in detail:
            hint = ("The OAuth client is the wrong type. It must be created as "
                    "an application of type Desktop app.")
        die("Google refused the code.", "", detail, *(["", hint] if hint else []))
    except urllib.error.URLError as err:
        die("Could not reach Google: " + str(err.reason))

    refresh = token.get("refresh_token", "")
    if not refresh:
        die("Signed in, but Google sent no refresh token.",
            "",
            "Remove this app's access at https://myaccount.google.com/permissions",
            "and run the script again.")

    print()
    print(RULE)
    print(" THE THREE CLOUDFLARE SECRETS")
    print(RULE)
    print()
    print("GOOGLE_CLIENT_ID")
    print(cid)
    print()
    print("GOOGLE_CLIENT_SECRET")
    print(csec)
    print()
    print("GOOGLE_REFRESH_TOKEN")
    print(refresh)
    print()
    print(RULE)
    print()
    print(" Add each as a Secret (not a plain text variable) under")
    print(" Workers & Pages -> environmsafe -> Settings -> Variables and Secrets.")
    print()
    print(" When all three are saved there, wipe them from this machine:")
    print()
    print("   rm -f ~/client.json ~/google-token.py")
    print()


if __name__ == "__main__":
    main()
