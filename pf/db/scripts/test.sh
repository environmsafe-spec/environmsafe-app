#!/usr/bin/env bash
# Build a throw-away database from the migrations and run the pgTAP suite.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres pf/db/scripts/test.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")/../.." && pwd)"   # pf/
DB="${TEST_DB:-espf_test}"
export PGUSER="${PGUSER:-postgres}"

dropdb --if-exists "$DB" >/dev/null
createdb "$DB"
run() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" >/dev/null; }

run "$HERE/db/local/supabase_shim.sql"
for f in "$HERE"/supabase/migrations/*.sql; do run "$f"; done
run "$HERE/supabase/seed.sql"
psql -X -q -d "$DB" -c 'create extension if not exists pgtap' >/dev/null
run "$HERE/db/tests/_helpers.sql"

pg_prove -d "$DB" --ext .sql "$HERE"/db/tests/[0-9]*.sql
