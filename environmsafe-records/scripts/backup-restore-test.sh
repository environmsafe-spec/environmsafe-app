#!/usr/bin/env bash
# Backs up a database (data of the public schema + user list + file manifest)
# and proves the backup restores into a fresh, empty database with the same
# row counts.
#
#   SOURCE_URL=postgres://...  TARGET_ADMIN_URL=postgres://postgres@localhost:5432/postgres  OUT=backup-dir \
#     ./scripts/backup-restore-test.sh
set -euo pipefail
cd "$(dirname "$0")/.."
: "${SOURCE_URL:?}" "${TARGET_ADMIN_URL:?}"
OUT=${OUT:-backup}
mkdir -p "$OUT"
TABLES=$(psql "$SOURCE_URL" -Atc "select tablename from pg_tables where schemaname='public' order by 1")

echo "== 1. Backup"
pg_dump "$SOURCE_URL" --schema=public --data-only --disable-triggers --format=custom --file "$OUT/public-data.dump"
pg_dump "$SOURCE_URL" --schema=public --schema-only --file "$OUT/public-schema.sql"
psql "$SOURCE_URL" -c "\copy (select id, email, created_at from auth.users order by created_at) to '$OUT/auth-users.csv' csv header"
psql "$SOURCE_URL" -c "\copy (select name, coalesce(metadata->>'size','0') as size, coalesce(metadata->>'mimetype','') as mime, created_at from storage.objects where bucket_id='files' order by name) to '$OUT/file-manifest.csv' csv header"
: > "$OUT/row-counts.txt"
for t in $TABLES; do echo "$t $(psql "$SOURCE_URL" -Atc "select count(*) from public.\"$t\"")" >> "$OUT/row-counts.txt"; done

echo "== 2. Restore into a fresh database"
DB=restore_test_$(date +%s)
psql "$TARGET_ADMIN_URL" -qc "create database $DB"
TARGET=$(echo "$TARGET_ADMIN_URL" | sed -E "s#/[^/]*\$#/$DB#")
psql "$TARGET" -q -v ON_ERROR_STOP=1 -c "set client_min_messages=warning" -f tests/db/supabase_shim.sql >/dev/null
for f in supabase/migrations/*.sql; do PGOPTIONS='-c client_min_messages=warning' psql "$TARGET" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null; done
# Library rows inserted by the migrations are replaced by the backed-up ones.
PGOPTIONS="-c client_min_messages=warning" psql "$TARGET" -q -c "set session_replication_role = replica; $(for t in $TABLES; do echo "truncate public.\"$t\" cascade;"; done)"
psql "$TARGET" -q -v ON_ERROR_STOP=1 <<SQL
set session_replication_role = replica;
create temp table u (id uuid, email text, created_at timestamptz);
\copy u from '$OUT/auth-users.csv' csv header
insert into auth.users (id, email, created_at) select id, email, created_at from u;
SQL
pg_restore --dbname "$TARGET" --data-only --disable-triggers --no-owner "$OUT/public-data.dump"

echo "== 3. Compare row counts"
fail=0
while read -r t n; do
  m=$(psql "$TARGET" -Atc "select count(*) from public.\"$t\"")
  if [ "$n" != "$m" ]; then echo "MISMATCH $t: backup $n, restored $m"; fail=1; else echo "ok  $t $n"; fi
done < "$OUT/row-counts.txt"
psql "$TARGET_ADMIN_URL" -qc "drop database $DB"
[ "$fail" = 0 ] && echo "RESTORE TEST PASSED: every table restored with the same number of rows." 
exit $fail
