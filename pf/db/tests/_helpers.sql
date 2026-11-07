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
