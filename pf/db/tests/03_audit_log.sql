-- Audit log: every change is recorded with who/what/before/after, and nobody can alter it.
begin;
select plan(11);

select tests.login('accountant@es.test');
insert into public.projects (company_id, code, name_en) values (tests.es(), '', 'Audit Test Project');
update public.projects set budget_amount = 500, budget_currency = 'USD' where name_en = 'Audit Test Project';
delete from public.projects where name_en = 'Audit Test Project';
select set_config('role', 'postgres', true);

select is((select count(*)::int from public.audit_log where table_name = 'projects' and after ->> 'name_en' = 'Audit Test Project' and action = 'INSERT'),
  1, 'INSERT recorded');
select is((select user_id from public.audit_log where table_name = 'projects' and action = 'INSERT' and after ->> 'name_en' = 'Audit Test Project'),
  tests.uid('accountant@es.test'), 'the audit row carries the acting user');
select is((select changed_fields from public.audit_log where table_name = 'projects' and action = 'UPDATE' and after ->> 'name_en' = 'Audit Test Project'),
  array['budget_amount', 'budget_currency'], 'UPDATE records exactly the changed fields');
select is((select before ->> 'budget_amount' from public.audit_log where table_name = 'projects' and action = 'DELETE' and before ->> 'name_en' = 'Audit Test Project'),
  '500.00', 'DELETE keeps the full before image');
select is((select company_id from public.audit_log where table_name = 'projects' and action = 'DELETE' and before ->> 'name_en' = 'Audit Test Project'),
  tests.es(), 'audit rows are tagged with the company');

-- Request metadata (PostgREST passes headers in request.headers)
select set_config('request.headers', '{"x-forwarded-for":"10.1.2.3, 10.0.0.1","user-agent":"Mozilla/5.0 test"}', true);
insert into public.fx_rates (company_id, rate_date, currency, rate_per_usd) values (tests.es(), '2026-10-01', 'SAR', 3.75);
select is((select ip || ' | ' || user_agent from public.audit_log where table_name = 'fx_rates' order by id desc limit 1),
  '10.1.2.3 | Mozilla/5.0 test', 'client IP and user agent are captured');

-- Immutability, even for the table owner
select throws_ok($$update public.audit_log set note = 'x'$$, '42501', null, 'audit log cannot be updated (even by the owner)');
select throws_ok($$delete from public.audit_log$$,         '42501', null, 'audit log cannot be deleted (even by the owner)');
select throws_ok($$truncate public.audit_log$$,            '42501', null, 'audit log cannot be truncated');
select is(tests.try_as('owner@es.test', $$insert into public.audit_log (table_name, action) values ('x', 'EVENT')$$), '42501', 'API users cannot insert audit rows directly');
select is(tests.try_as('owner@es.test', $$delete from public.audit_log$$), '42501', 'owner cannot delete audit rows through the API');

select * from finish();
rollback;
