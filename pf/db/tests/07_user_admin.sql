begin;
select plan(4);
select is(tests.try_as('owner@es.test', $$select public.grant_role_by_email(tests.es(), 'NOBODY@es.test', 'data_entry')$$), 'ok:1', 'owner grants a role by email (case-insensitive)');
select is(tests.try_as('accountant@es.test', $$select public.grant_role_by_email(tests.es(), 'nobody@es.test', 'data_entry')$$), '42501', 'accountant cannot grant roles');
select is(tests.try_as('owner@es.test', $$select public.grant_role_by_email(tests.es(), 'ghost@es.test', 'viewer')$$), 'P0001', 'unknown email is refused with a clear message');
select is(tests.try_as('owner@es.test', $$delete from public.user_roles where role_code = 'owner' and company_id = tests.es()$$), 'P0001', 'the last owner cannot be removed');
select * from finish();
rollback;
