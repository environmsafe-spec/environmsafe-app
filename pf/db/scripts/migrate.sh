#!/usr/bin/env bash
# Bring a live database up to date: applies each migration once, in order, and records it.
# Usage: DATABASE_URL=postgresql://... pf/db/scripts/migrate.sh
# Never prints the connection string. Each file runs in one transaction; a failure stops everything.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/../.." && pwd)"   # pf/
: "${DATABASE_URL:?set DATABASE_URL}"
psqlq() { psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

psqlq -c "create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())"
psqlq -c "revoke all on public.schema_migrations from public"

apply() {   # name file
  local name="$1" file="$2"
  if [ "$(psqlq -At -c "select count(*) from public.schema_migrations where name = '$name'")" = "1" ]; then
    return
  fi
  echo "applying $name"
  psqlq -1 -f "$file" -c "insert into public.schema_migrations (name) values ('$name')"
}

# The auth schema stand-in (roles anon/authenticated/service_role, auth.users, auth.uid()) comes first.
apply 00000000000000_auth_shim "$HERE/db/local/supabase_shim.sql"
for f in "$HERE"/supabase/migrations/*.sql; do
  apply "$(basename "$f" .sql)" "$f"
done
# The company itself (same id as the old app), once.
apply 99999999999999_company_seed "$HERE/supabase/seed.sql"
echo "database up to date"
