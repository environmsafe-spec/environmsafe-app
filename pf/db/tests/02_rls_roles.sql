-- Role matrix: what each role can read and write. Spec section 8.2 / Phase 1 acceptance.
begin;
select plan(46);

-- Fixtures written as the table owner
insert into public.parties (company_id, code, primary_kind, name_en) values
  (tests.es(), '', 'supplier', 'Fixture Supplier'),
  (tests.es(), '', 'employee', 'Fixture Employee'),
  (tests.other(), '', 'supplier', 'Other Co Supplier');

\set sup  '(select id from public.parties where name_en = ''Fixture Supplier'')'
\set emp  '(select id from public.parties where name_en = ''Fixture Employee'')'

-- ---------- Reading ----------------------------------------------------------
select is(tests.count_as('owner@es.test',       'select 1 from public.parties'), 2::bigint, 'owner sees ES parties only');
select is(tests.count_as('accountant@es.test',  'select 1 from public.parties'), 2::bigint, 'accountant sees ES parties');
select is(tests.count_as('procurement@es.test', 'select 1 from public.parties'), 2::bigint, 'procurement sees ES parties');
select is(tests.count_as('dataentry@es.test',   'select 1 from public.parties'), 2::bigint, 'data entry sees ES parties');
select is(tests.count_as('auditor@es.test',     'select 1 from public.parties'), 2::bigint, 'auditor sees ES parties');
select is(tests.count_as('viewer@es.test',      'select 1 from public.parties'), 2::bigint, 'viewer sees ES parties');
select is(tests.count_as('outsider@other.test', 'select 1 from public.parties'), 1::bigint, 'other company sees only its own party');
select is(tests.count_as('nobody@es.test',      'select 1 from public.parties'), 0::bigint, 'user without a role sees nothing');
select is(tests.count_as('outsider@other.test', 'select 1 from public.gl_accounts where company_id = tests.es()'), 0::bigint, 'other company cannot see ES chart of accounts');
select is(tests.count_as('outsider@other.test', 'select 1 from public.companies'), 1::bigint, 'other company sees only its own company row');

-- MFA: owner and accountant see nothing until the session passed TOTP (aal2)
select is(tests.count_as('owner@es.test', 'select 1 from public.parties', 'aal1'), 0::bigint, 'owner without MFA sees no data');
select is(tests.count_as('accountant@es.test', 'select 1 from public.projects', 'aal1'), 0::bigint, 'accountant without MFA sees no data');
select is(tests.count_as('procurement@es.test', 'select 1 from public.projects', 'aal1'), 3::bigint, 'procurement does not need MFA');

-- Audit log visibility
select ok(tests.count_as('owner@es.test',      'select 1 from public.audit_log') > 0, 'owner reads the audit log');
select ok(tests.count_as('auditor@es.test',    'select 1 from public.audit_log') > 0, 'auditor reads the audit log');
select ok(tests.count_as('accountant@es.test', 'select 1 from public.audit_log') > 0, 'accountant reads the audit log');
select is(tests.count_as('procurement@es.test','select 1 from public.audit_log'), 0::bigint, 'procurement cannot read the audit log');
select is(tests.count_as('dataentry@es.test',  'select 1 from public.audit_log'), 0::bigint, 'data entry cannot read the audit log');
select is(tests.count_as('outsider@other.test','select 1 from public.audit_log where company_id = tests.es()'), 0::bigint, 'other company cannot read ES audit log');

-- ---------- Suppliers --------------------------------------------------------
select is(tests.try_as('procurement@es.test', $$insert into public.parties (company_id, code, primary_kind, name_en) values (tests.es(), '', 'supplier', 'New Sup')$$), 'ok:1', 'procurement creates a supplier');
select is(tests.try_as('procurement@es.test', format($$update public.parties set phone = '1' where id = %s$$, :'sup')), 'ok:1', 'procurement edits a supplier');
select is(tests.try_as('dataentry@es.test',   $$insert into public.parties (company_id, code, primary_kind, name_en) values (tests.es(), '', 'supplier', 'Inline Sup')$$), 'ok:1', 'data entry creates a missing supplier inline');
select is(tests.try_as('dataentry@es.test',   format($$update public.parties set phone = '1' where id = %s$$, :'sup')), 'ok:0', 'data entry cannot edit an existing supplier');
select is(tests.try_as('auditor@es.test',     $$insert into public.parties (company_id, code, primary_kind, name_en) values (tests.es(), '', 'supplier', 'X')$$), '42501', 'auditor cannot create a supplier');
select is(tests.try_as('viewer@es.test',      $$insert into public.parties (company_id, code, primary_kind, name_en) values (tests.es(), '', 'supplier', 'X')$$), '42501', 'viewer cannot create a supplier');
select is(tests.try_as('outsider@other.test', $$insert into public.parties (company_id, code, primary_kind, name_en) values (tests.es(), '', 'supplier', 'X')$$), '42501', 'other company cannot write into ES');

-- ---------- Employees and owner ---------------------------------------------
select is(tests.try_as('procurement@es.test', format($$update public.parties set phone = '1' where id = %s$$, :'emp')), 'ok:0', 'procurement cannot edit employees');
select is(tests.try_as('accountant@es.test',  format($$update public.parties set phone = '1' where id = %s$$, :'emp')), 'ok:1', 'accountant edits employees');
select is(tests.try_as('accountant@es.test',  $$insert into public.parties (company_id, code, primary_kind, name_en) values (tests.es(), '', 'owner', 'Owner 2')$$), '42501', 'accountant cannot create an owner party');
select is(tests.try_as('owner@es.test',       $$insert into public.parties (company_id, code, primary_kind, name_en) values (tests.es(), '', 'owner', 'Akram')$$), 'ok:1', 'owner creates the owner party');

-- ---------- Projects, items, money accounts ---------------------------------
select is(tests.try_as('accountant@es.test',  $$insert into public.projects (company_id, code, name_en) values (tests.es(), '', 'P')$$), 'ok:1', 'accountant creates a project');
select is(tests.try_as('procurement@es.test', $$insert into public.projects (company_id, code, name_en) values (tests.es(), '', 'P')$$), '42501', 'procurement cannot create a project');
select is(tests.try_as('dataentry@es.test',   $$insert into public.items (company_id, code, name_en, kind) values (tests.es(), '', 'Bolt', 'goods')$$), 'ok:1', 'data entry creates a missing item inline');
select is(tests.try_as('dataentry@es.test',   $$update public.items set unit = 'pc'$$), 'ok:0', 'data entry cannot edit items');
select is(tests.try_as('accountant@es.test',  $$insert into public.money_accounts (company_id, code, name_en, kind, currency) values (tests.es(), '', 'Kuraimi USD', 'bank', 'USD')$$), 'ok:1', 'accountant creates a money account');
select is(tests.try_as('procurement@es.test', $$insert into public.money_accounts (company_id, code, name_en, kind, currency) values (tests.es(), '', 'X', 'bank', 'USD')$$), '42501', 'procurement cannot create a money account');

-- ---------- Chart of accounts, rates ----------------------------------------
select is(tests.try_as('owner@es.test',      $$update public.gl_accounts set name_ar = 'x' where code = '6990' and company_id = tests.es()$$), 'ok:1', 'owner edits the chart of accounts');
select is(tests.try_as('accountant@es.test', $$update public.gl_accounts set name_ar = 'x' where code = '6990' and company_id = tests.es()$$), 'ok:0', 'accountant cannot edit the chart of accounts');
select is(tests.try_as('owner@es.test',      $$insert into public.gl_accounts (company_id, code, name_en, account_type, ifrs_line, parent_id) values (tests.es(), '6995', 'Insurance', 'expense', 'administrative_expenses', (select id from public.gl_accounts where code = '6000' and company_id = tests.es()))$$), 'ok:1', 'owner adds an account');
select is(tests.try_as('accountant@es.test', $$insert into public.fx_rates (company_id, rate_date, currency, rate_per_usd) values (tests.es(), '2026-11-01', 'YER', 1560)$$), 'ok:1', 'accountant maintains FX rates');
select is(tests.try_as('dataentry@es.test',  $$insert into public.fx_rates (company_id, rate_date, currency, rate_per_usd) values (tests.es(), '2026-11-01', 'YER', 1560)$$), '42501', 'data entry cannot change FX rates');

-- ---------- Users and roles --------------------------------------------------
select is(tests.try_as('owner@es.test',      format($$insert into public.user_roles (company_id, user_id, role_code) values (tests.es(), %L, 'viewer')$$, tests.uid('nobody@es.test'))), 'ok:1', 'owner grants a role');
select is(tests.try_as('accountant@es.test', format($$insert into public.user_roles (company_id, user_id, role_code) values (tests.es(), %L, 'viewer')$$, tests.uid('nobody@es.test'))), '42501', 'accountant cannot grant roles');
select is(tests.try_as('dataentry@es.test',  format($$insert into public.user_roles (company_id, user_id, role_code) values (tests.es(), %L, 'owner')$$, tests.uid('dataentry@es.test'))), '42501', 'nobody can make themselves owner');
select is(tests.try_as('dataentry@es.test',  $$update public.user_profiles set is_active = false where user_id = auth.uid()$$), '42501', 'users cannot change their own active flag');
select is(tests.try_as('dataentry@es.test',  $$update public.user_profiles set locale = 'en' where user_id = auth.uid()$$), 'ok:1', 'users change their own language');

select * from finish();
rollback;
