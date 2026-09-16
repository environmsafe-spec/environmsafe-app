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

import glob
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

# Google's download is named client_secret_<long id>.json. Rather than making
# anyone retype a client id and secret into a phone keyboard — which is how a
# mismatched pair got saved here once already — take the file as it came.
CLIENT_PATTERNS = [
    "~/client.json",
    "~/client_secret*.json",
    "~/*.json",
    "~/Downloads/client_secret*.json",
]

# Exactly what the agent uses, and nothing else: it reads and files documents,
# reads the finance workbook, and prepares mail drafts. It is never permitted
# to send, so gmail.send is deliberately absent.
SCOPES = " ".join([
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/gmail.modify",
])

# Google withdrew the old "show the code on a page" redirect for apps
# registered after 2022, so a loopback address is the only one a Desktop client
# can use. Nothing listens on it: the browser is a phone and this is a server
# in a datacentre. The page fails to load, which is fine and expected — the
# code Google sent is sitting in the address bar, and that is what gets pasted
# back here. Any port will do; this one is unlikely to collide with anything.
REDIRECT = "http://localhost:8085"

RULE = "=" * 64


def die(*lines):
    print()
    for line in lines:
        print(line)
    sys.exit(1)


def extract_code(pasted):
    """Take the whole redirected address, or just the code — either is fine."""
    if not pasted:
        die("Nothing pasted. Run the script again when you have the address.")

    if pasted.startswith("http") or "code=" in pasted or "error=" in pasted:
        query = urllib.parse.urlparse(pasted).query
        if not query and "?" in pasted:
            query = pasted.split("?", 1)[1]
        fields = urllib.parse.parse_qs(query)

        code = fields.get("code", [""])[0]
        if code:
            return code

        error = fields.get("error", [""])[0]
        if error == "access_denied":
            die("The sign-in was declined, so Google sent no code.",
                "",
                "Run the script again and approve every permission it asks for.")
        if error:
            die("Google reported: " + error,
                "",
                "Run the script again and approve every permission it asks for.")

        die("That address has no code in it.",
            "",
            "Copy it only after approving, when it looks like:",
            "  http://localhost:8085/?code=4/0Ax...&scope=...")

    return pasted


def candidate_files():
    """Every file that might be the downloaded client, newest first."""
    found = []
    for pattern in CLIENT_PATTERNS:
        for path in glob.glob(os.path.expanduser(pattern)):
            if path not in found:
                found.append(path)
    found.sort(key=lambda p: os.path.getmtime(p), reverse=True)
    return found


def load_client():
    """Find a file holding a matching client id and secret, as Google wrote it."""
    for path in candidate_files():
        try:
            data = json.load(open(path))
        except (ValueError, OSError):
            continue
        block = data.get("installed") or data.get("web") or {}
        cid, csec = block.get("client_id", ""), block.get("client_secret", "")
        if cid.endswith(".apps.googleusercontent.com") and csec:
            print("Using the client file: " + path)
            return cid, csec

    return ask_for_client()


def ask_for_client():
    """No file to read, so take the two values and check them before going on."""
    print()
    print(RULE)
    print(" The client file is not here, so paste the two values instead.")
    print(RULE)
    print()
    print(" Open:  https://console.cloud.google.com/auth/clients")
    print(" Tap your client. Each value has a copy button beside it — use")
    print(" those rather than selecting the text, so nothing is lost.")
    print()
    print(" Both must come from the SAME client. An id from one and a secret")
    print(" from another is what Google calls 'client secret is invalid'.")
    print()

    try:
        cid = input("Client ID     : ").strip()
        csec = input("Client secret : ").strip()
    except (EOFError, KeyboardInterrupt):
        die("Cancelled. Nothing was changed.")

    if not cid.endswith(".apps.googleusercontent.com"):
        die("That client id looks wrong.",
            "",
            "It should end in .apps.googleusercontent.com")
    if not csec.startswith("GOCSPX-"):
        die("That client secret looks wrong.",
            "",
            "It should begin with GOCSPX-")

    check_pair(cid, csec)

    with open(os.path.expanduser("~/client.json"), "w") as handle:
        json.dump({"installed": {"client_id": cid, "client_secret": csec}}, handle)
    os.chmod(os.path.expanduser("~/client.json"), 0o600)
    print()
    print("That pair is good. Saved, so you will not be asked again.")
    return cid, csec


def check_pair(cid, csec):
    """Ask Google to redeem a code we know is nonsense.

    It refuses either way, but it refuses differently: a bad code alone is
    'invalid_grant', while a bad id or secret is 'invalid_client'. That tells
    us whether the pair is right before anyone signs in — far kinder than
    finding out after the whole approval dance."""
    body = urllib.parse.urlencode({
        "code": "probe-not-a-real-code",
        "client_id": cid,
        "client_secret": csec,
        "redirect_uri": REDIRECT,
        "grant_type": "authorization_code",
    }).encode()
    try:
        urllib.request.urlopen(
            urllib.request.Request("https://oauth2.googleapis.com/token", data=body))
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", "replace")
        if "invalid_client" in detail:
            die("Google does not accept that id and secret together.",
                "",
                detail,
                "",
                "They must be the pair from one client. Open the client at",
                "https://console.cloud.google.com/auth/clients and copy both",
                "from the same page. If the secret is not shown, add a new one",
                "there and copy that.")
        # invalid_grant, as expected: the credentials are fine.
    except urllib.error.URLError as err:
        die("Could not reach Google: " + str(err.reason))


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
    print(" Approve Drive, Sheets and Gmail.")
    print()
    print(" THEN THE PAGE WILL FAIL TO LOAD. That is correct — do not")
    print(" worry about it. Copy the whole address from the address bar.")
    print(" It begins http://localhost:8085/?code=...")
    print()
    print(RULE)
    print(" STEP 2 — paste that whole address below")
    print(RULE)
    print()

    try:
        pasted = input("Address (or just the code): ").strip()
    except (EOFError, KeyboardInterrupt):
        die("Cancelled. Nothing was changed.")

    code = extract_code(pasted)

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
