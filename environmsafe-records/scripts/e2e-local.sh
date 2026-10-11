#!/usr/bin/env bash
# Runs the browser tests locally against the mock backend.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p test-results
for f in test-results/.mock.pid test-results/.preview.pid; do
  [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null || true
done
node scripts/e2e-db.mjs
MOCK_TRACE=${MOCK_TRACE:-} node scripts/mock-supabase.mjs > test-results/mock.log 2>&1 &
echo $! > test-results/.mock.pid
VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_ANON_KEY=local-anon-key VITE_PUBLIC_URL=http://localhost:4173 npx vite build --mode e2e > test-results/build.log 2>&1
VITE_SUPABASE_URL=http://localhost:54321 node node_modules/vite/bin/vite.js preview --port 4173 --strictPort > test-results/preview.log 2>&1 &
echo $! > test-results/.preview.pid
sleep 2
E2E_MOCK=1 npx playwright test "$@"
