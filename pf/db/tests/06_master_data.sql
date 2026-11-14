-- Master-data behaviour: party flags, money-account GL accounts, guards.
begin;
select plan(10);

insert into public.parties (company_id, code, primary_kind, name_en, is_supplier)
values (tests.es(), '', 'customer', 'UNHCR', true);
select ok((select is_customer and is_supplier from public.parties where name_en = 'UNHCR'), 'Primary kind sets its flag; extra roles are kept');
select is((select code from public.parties where name_en = 'UNHCR'), 'CU-0001', 'Customer code CU-0001');
select throws_ok($$update public.parties set primary_kind = 'supplier' where name_en = 'UNHCR'$$, null, null, 'Primary kind cannot change');

insert into public.money_accounts (company_id, code, name_en, kind, currency, legacy_id)
values (tests.es(), '', 'Al Kuraimi USD', 'bank', 'USD', 'ACC-0003'),
       (tests.es(), '', 'Al Kuraimi YER', 'bank', 'YER', 'ACC-0008');
select is((select g.code from public.money_accounts m join public.gl_accounts g on g.id = m.gl_account_id where m.legacy_id = 'ACC-0003'),
  '1000-001', 'Each money account gets its own GL account 1000-NNN');
select is((select g.control_kind || '/' || g.parent_id::text from public.money_accounts m join public.gl_accounts g on g.id = m.gl_account_id where m.legacy_id = 'ACC-0008'),
  'bank/' || (select id::text from public.gl_accounts where company_id = tests.es() and code = '1000'), 'GL account is a bank control account under 1000');
update public.money_accounts set name_en = 'Kuraimi YER' where legacy_id = 'ACC-0008';
select is((select g.name_en from public.money_accounts m join public.gl_accounts g on g.id = m.gl_account_id where m.legacy_id = 'ACC-0008'),
  'Kuraimi YER (YER)', 'Renaming the money account renames its GL account');
select throws_ok($$delete from public.gl_accounts where code = '2000' and company_id = tests.es()$$, null, null, 'System accounts cannot be deleted');
select throws_ok($$update public.gl_accounts set account_type = 'expense' where code = '1100' and company_id = tests.es()$$, null, null, 'System account type is fixed');
insert into public.parties (company_id, code, primary_kind, name_en) values (tests.other(), '', 'customer', 'Other Co customer');
select throws_ok($$insert into public.projects (company_id, code, name_en, customer_id) values (tests.es(), '', 'Cross', (select id from public.parties where company_id = tests.other() limit 1))$$,
  '23503', null, 'A project cannot point to another company''s customer');
select is(app.rate_on(tests.es(), 'YER', '2026-11-07'), 1556::numeric, 'Default YER rate 1556 per USD');

select * from finish();
rollback;
