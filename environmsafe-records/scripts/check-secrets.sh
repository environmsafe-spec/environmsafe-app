#!/usr/bin/env bash
# Fails if a server secret has been committed or bundled into the app.
set -euo pipefail
cd "$(dirname "$0")/.."
fail=0
# 1. Supabase service keys are JWTs with "role":"service_role" in the payload.
check_jwts() {
  grep -rhoE 'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}' "$@" 2>/dev/null | sort -u | while read -r t; do
    payload=$(echo "$t" | cut -d. -f2 | tr '_-' '/+'); pad=$(( (4 - ${#payload} % 4) % 4 )); payload="$payload$(printf '=%.0s' $(seq 1 $pad))"
    if echo "$payload" | base64 -d 2>/dev/null | grep -q '"service_role"'; then echo "SERVICE KEY FOUND"; fi
  done
}
if [ -n "$(check_jwts $(git ls-files) dist 2>/dev/null)" ]; then echo "A service_role key is present"; fail=1; fi
# 2. New-style secret keys and private material.
if git grep -nE 'sb_secret_[A-Za-z0-9]{10,}|BEGIN (RSA |EC )?PRIVATE KEY' -- ':!scripts/check-secrets.sh' ; then fail=1; fi
if [ -d dist ] && grep -rlE 'sb_secret_[A-Za-z0-9_-]{20,}' dist; then echo "A secret key is in the built app"; fail=1; fi
# 3. Keystore must only be present encrypted.
if git ls-files | grep -E '\.(jks|keystore)$'; then echo "Unencrypted keystore committed"; fail=1; fi
[ "$fail" = 0 ] && echo "No secrets found in the repository or the built app."
exit $fail
