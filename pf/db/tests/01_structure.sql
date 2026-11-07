-- Structure and hardening checks that hold for every table and function.
begin;
select plan(9);

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0, 'Every table in public has Row Level Security enabled');

select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon'),
  0, 'anon (not signed in) has no privilege on any table');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app') and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  0, 'Every SECURITY DEFINER function pins its search_path');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not like '\_%' and p.proname <> 'verify_document' and p.oid not in (select objid from pg_depend where deptype = 'e')),
  0, 'anon cannot execute any of our API functions (except the public QR verification)');

select ok(not has_function_privilege('authenticated', 'app.next_seq(uuid,text,text)', 'execute'),
  'API users cannot call the numbering function directly');
select ok(not has_function_privilege('authenticated', 'app.write_audit(uuid,text,text,text,jsonb,jsonb,text[],text)', 'execute'),
  'API users cannot write the audit log directly');
select ok(not has_table_privilege('authenticated', 'public.number_sequences', 'select'),
  'API users cannot read or change number sequences');

select is(
  (select count(*)::int from public.gl_accounts c join public.gl_accounts p on p.id = c.parent_id
   where p.account_type <> c.account_type or p.is_postable),
  0, 'Chart of accounts: children share their parent type and parents are headers');

select is(
  (select count(*)::int from public.gl_accounts where company_id = tests.es()),
  54, 'Default chart of accounts seeded (54 accounts)');

select * from finish();
rollback;
