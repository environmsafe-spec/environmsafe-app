-- Recurring templates and the AI extraction log.
begin;
select plan(9);
select tests.phase2_fixtures();

insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, no_document_reason, description)
values (tests.es(), 'salary', '2026-10-28', tests.ma('T-USD'), tests.party('T Employee'), 'Payroll', 'Monthly salary') returning id as sal \gset
insert into public.document_lines (company_id, document_id, amount, project_id) values (tests.es(), :'sal', 800, tests.project('T Project A'));
select tests.post_as('accountant@es.test', :'sal');
insert into public.recurring_templates (company_id, name, source_document_id, day_of_month) values (tests.es(), 'Field engineer salary', :'sal', 28);

select is(tests.try_as('viewer@es.test', $$select public.generate_recurring(tests.es(), 2026, 11)$$), '42501', 'a viewer cannot create recurring drafts');
select tests.login('dataentry@es.test');
select is(public.generate_recurring(tests.es(), 2026, 11), 1, 'one draft created for November');
select is(public.generate_recurring(tests.es(), 2026, 11), 0, 'running it again for the same month creates nothing');
select tests.logout();
select is((select status::text || ' ' || doc_date || ' ' || amount || ' ' || source from public.documents where source = 'recurring'),
  'draft 2026-11-28 800.00 recurring', 'the draft copies the lines, lands on the chosen day and is marked recurring');
select is((select created_by from public.documents where source = 'recurring'), tests.uid('dataentry@es.test'), 'the draft belongs to the person who created it');
select ok((select description like 'Monthly salary — Nov 2026' from public.documents where source = 'recurring'), 'the description says which month');

select is(tests.try_as('dataentry@es.test', $$insert into public.ai_extractions (company_id, storage_path, status) values (tests.es(), tests.es() || '/inbox/a.jpg', 'done')$$), 'ok:1', 'extractions are logged for the company');
select is(tests.try_as('dataentry@es.test', $$insert into public.ai_extractions (company_id, storage_path, status) values (tests.es(), tests.other() || '/inbox/a.jpg', 'done')$$), '42501', 'a file path of another company is refused');
select is(tests.count_as('outsider@other.test', 'select 1 from public.recurring_templates'), 0::bigint, 'another company sees no templates');

select * from finish();
rollback;
