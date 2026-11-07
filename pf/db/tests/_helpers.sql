-- Test fixtures: one user per role in EnvironmSafe (ES), plus a second company (OTHER)
-- with its own owner, to prove company isolation. Loaded once after the seed.

create schema if not exists tests;
grant usage on schema tests to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000001', 'owner@es.test',       '{"full_name":"Owner"}'),
  ('00000000-0000-0000-0000-000000000002', 'accountant@es.test',  '{"full_name":"Accountant"}'),
  ('00000000-0000-0000-0000-000000000003', 'procurement@es.test', '{"full_name":"Procurement"}'),
  ('00000000-0000-0000-0000-000000000004', 'dataentry@es.test',   '{"full_name":"Data entry","locale":"ar"}'),
  ('00000000-0000-0000-0000-000000000005', 'auditor@es.test',     '{"full_name":"Auditor"}'),
  ('00000000-0000-0000-0000-000000000006', 'viewer@es.test',      '{"full_name":"Viewer"}'),
  ('00000000-0000-0000-0000-000000000007', 'outsider@other.test', '{"full_name":"Other owner"}'),
  ('00000000-0000-0000-0000-000000000008', 'nobody@es.test',      '{"full_name":"No role"}');

create or replace function tests.uid(p_email text) returns uuid
language sql stable security definer as $$ select id from auth.users where email = p_email $$;

create or replace function tests.es() returns uuid
language sql immutable as $$ select 'dee3dc12-55bb-4acc-9c44-46721b36651b'::uuid $$;

create or replace function tests.other() returns uuid
language sql immutable as $$ select '00000000-0000-0000-0000-0000000000aa'::uuid $$;

select app.bootstrap_company(tests.other(), 'Other Co', null, tests.uid('outsider@other.test'), 2026);

insert into public.user_roles (company_id, user_id, role_code) values
  (tests.es(), tests.uid('owner@es.test'),       'owner'),
  (tests.es(), tests.uid('accountant@es.test'),  'accountant'),
  (tests.es(), tests.uid('procurement@es.test'), 'procurement'),
  (tests.es(), tests.uid('dataentry@es.test'),   'data_entry'),
  (tests.es(), tests.uid('auditor@es.test'),     'auditor'),
  (tests.es(), tests.uid('viewer@es.test'),      'viewer');

-- Act as a signed-in API user for the rest of the transaction.
create or replace function tests.login(p_email text, p_aal text default 'aal2') returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', tests.uid(p_email), 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function tests.login_service() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end $$;

grant execute on all functions in schema tests to authenticated, anon, service_role;

-- Run p_sql as p_email and return how it went, always rolling the statement back:
--   'ok:<rows>'  statement succeeded and touched <rows> rows
--   '<sqlstate>' statement failed (42501 = permission / RLS denied)
create or replace function tests.try_as(p_email text, p_sql text, p_aal text default 'aal2') returns text
language plpgsql as $$
declare
  v_rows bigint;
  v_res  text;
begin
  perform tests.login(p_email, p_aal);
  begin
    execute p_sql;
    get diagnostics v_rows = row_count;
    raise exception using errcode = 'TOK01', message = v_rows::text;
  exception
    when sqlstate 'TOK01' then v_res := 'ok:' || sqlerrm;
    when others then v_res := sqlstate;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  return v_res;
end $$;

-- Count rows of a query as seen by p_email.
create or replace function tests.count_as(p_email text, p_sql text, p_aal text default 'aal2') returns bigint
language plpgsql as $$
declare
  n bigint;
begin
  perform tests.login(p_email, p_aal);
  execute 'select count(*) from (' || p_sql || ') q' into n;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  return n;
end $$;

-- ---------------- Phase 2 helpers ----------------
create or replace function tests.logout() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Money accounts, parties and projects used by the posting tests (call inside the test transaction).
create or replace function tests.phase2_fixtures() returns void
language plpgsql as $$
begin
  insert into public.money_accounts (company_id, code, name_en, kind, currency, legacy_id) values
    (tests.es(), '', 'T Kuraimi USD', 'bank', 'USD', 'T-USD'),
    (tests.es(), '', 'T Kuraimi YER', 'bank', 'YER', 'T-YER'),
    (tests.es(), '', 'T Qutaibi SAR', 'exchange', 'SAR', 'T-SAR');
  insert into public.parties (company_id, code, primary_kind, name_en, treat_withdrawals_as_drawings) values
    (tests.es(), '', 'supplier', 'T Supplier', false),
    (tests.es(), '', 'customer', 'T Customer', false),
    (tests.es(), '', 'employee', 'T Employee', false),
    (tests.es(), '', 'owner',    'T Owner',    false),
    (tests.es(), '', 'employee', 'T Drawer',   true);
  insert into public.projects (company_id, code, name_en) values
    (tests.es(), '', 'T Project A'), (tests.es(), '', 'T Project B');
end $$;

create or replace function tests.ma(p_legacy text) returns uuid
language sql stable as $$ select id from public.money_accounts where legacy_id = p_legacy $$;
create or replace function tests.party(p_name text) returns uuid
language sql stable as $$ select id from public.parties where name_en = p_name $$;
create or replace function tests.project(p_name text) returns uuid
language sql stable as $$ select id from public.projects where name_en = p_name $$;
create or replace function tests.acct(p_code text) returns uuid
language sql stable as $$ select id from public.gl_accounts where company_id = tests.es() and code = p_code $$;

-- Compact view of a document's journal: '6200 D 60.00 | 1000-001 C 60.00'
create or replace function tests.je(p_doc uuid, p_kind text default 'posting') returns text
language sql stable as $$
  select string_agg(g.code || ' ' || case when jl.debit > 0 then 'D ' || jl.debit else 'C ' || jl.credit end, ' | ' order by jl.line_no)
  from public.journal_entries je
  join public.journal_lines jl on jl.entry_id = je.id
  join public.gl_accounts g on g.id = jl.account_id
  where je.document_id = p_doc and je.kind = p_kind
$$;

-- Post as a user; returns the resulting status (or the error message).
create or replace function tests.post_as(p_email text, p_doc uuid) returns text
language plpgsql as $$
declare v text;
begin
  perform tests.login(p_email);
  begin
    select status::text into v from public.post_document(p_doc);
  exception when others then
    v := 'ERROR: ' || sqlerrm;
  end;
  perform tests.logout();
  return v;
end $$;

grant execute on all functions in schema tests to authenticated, anon, service_role;

-- What an anonymous visitor of the QR verification page sees.
create or replace function tests.anon_verify(p_token uuid) returns text
language plpgsql as $$
declare v text; n int;
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
  select count(*), max(status || ' ' || total) into n, v from public.verify_document(p_token);
  perform tests.logout();
  return coalesce(v, 'none:' || n);
end $$;
grant execute on function tests.anon_verify(uuid) to anon, authenticated;
