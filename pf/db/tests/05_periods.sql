-- Fiscal periods: close / reopen permissions, reasons, logging, and the posting guard.
begin;
select plan(11);

select is((select count(*)::int from public.fiscal_periods where company_id = tests.es() and year = 2025), 12, 'Periods exist from the first migrated year (2025)');
select lives_ok($$select app.assert_period_open(tests.es(), '2026-06-15')$$, 'Open period accepts posting');

select is(tests.try_as('procurement@es.test', $$select public.close_period(tests.es(), 2026, 6)$$), '42501', 'procurement cannot close a period');
select is(tests.try_as('accountant@es.test', $$select public.close_period(tests.es(), 2026, 6)$$, 'aal1'), '42501', 'accountant must pass MFA to close');

select tests.login('accountant@es.test');
select public.close_period(tests.es(), 2026, 6);
select set_config('role', 'postgres', true);

select is((select status::text from public.fiscal_periods where company_id = tests.es() and year = 2026 and month = 6), 'closed', 'accountant closed June 2026');
select throws_ok($$select app.assert_period_open(tests.es(), '2026-06-15')$$, 'P0001', null, 'Closed period rejects posting');
select lives_ok($$select app.assert_period_open(tests.es(), '2027-02-01')$$, 'A future year is created open on demand');

select is(tests.try_as('accountant@es.test', $$select public.reopen_period(tests.es(), 2026, 6, 'Late supplier bill')$$), '42501', 'accountant cannot reopen');
select is(tests.try_as('owner@es.test', $$select public.reopen_period(tests.es(), 2026, 6, '')$$), 'P0001', 'reopen needs a reason');
select is(tests.try_as('owner@es.test', $$select public.reopen_period(tests.es(), 2026, 6, 'Late supplier bill')$$), 'ok:1', 'owner reopens with a reason');
select ok(exists(select 1 from public.audit_log where table_name = 'fiscal_periods' and action = 'EVENT' and note like 'Closed period 2026-06%'), 'Closing is logged as an event');

select * from finish();
rollback;
