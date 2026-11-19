-- Sign-in tables (Better Auth): mirrored into auth.users, invisible to the data API roles.
begin;
select plan(5);

insert into public.auth_user (id, name, email, "emailVerified") values ('00000000-0000-0000-0000-0000000000b1', 'New Person', 'New.Person@ES.test', true);
select is((select email from auth.users where id = '00000000-0000-0000-0000-0000000000b1'), 'new.person@es.test', 'sign-in user mirrored into auth.users');
select is((select full_name from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000000b1'), 'New Person', 'and gets a profile');

select is(tests.try_as('owner@es.test', 'select * from public.auth_user'), '42501', 'owner cannot read sign-in users through the API');
select is(tests.try_as('owner@es.test', 'select * from public.auth_account'), '42501', 'nor password hashes');
select is(tests.try_as('owner@es.test', 'select * from public.auth_two_factor'), '42501', 'nor two-factor secrets');

select * from finish();
rollback;
