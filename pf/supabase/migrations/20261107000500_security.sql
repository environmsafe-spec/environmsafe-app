-- ES-PF v2 · Migration 5: Row Level Security, grants, admin functions
-- Rule: every table in public has RLS on. anon gets nothing. Writes that need business
-- checks go through SECURITY DEFINER functions with explicit permission checks.

-- ---------------------------------------------------------------------------
-- Lock everything down first, then grant back what each table needs.
-- ---------------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app    from public, anon;
-- Only the helpers used inside RLS policies are callable by API users. Everything else in
-- app (numbering, audit writes, period helpers) runs only inside SECURITY DEFINER code.
grant execute on function app.is_service(), app.aal(), app.has_perm(uuid, text),
                          app.is_member(uuid), app.shares_company(uuid),
                          app.require_perm(uuid, text)
  to authenticated, service_role;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema app    revoke execute on functions from public;
-- Postgres grants EXECUTE on new functions to PUBLIC globally; switch that off too.
alter default privileges revoke execute on functions from public;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Reference tables: readable by every signed-in user, never writable through the API.
grant select on public.currencies, public.roles, public.permissions,
               public.role_permissions, public.document_types to authenticated;
create policy read_all on public.currencies       for select to authenticated using (true);
create policy read_all on public.roles            for select to authenticated using (true);
create policy read_all on public.permissions      for select to authenticated using (true);
create policy read_all on public.role_permissions for select to authenticated using (true);
create policy read_all on public.document_types   for select to authenticated using (true);

-- Companies
grant select, update (name_en, name_ar, legal_name, settings) on public.companies to authenticated;
create policy member_read on public.companies for select to authenticated
  using ((select app.is_member(id)));
create policy admin_update on public.companies for update to authenticated
  using ((select app.has_perm(id, 'company.manage')))
  with check ((select app.has_perm(id, 'company.manage')));

-- User profiles: see yourself and colleagues; edit your own name/phone/language.
grant select on public.user_profiles to authenticated;
grant update (full_name, phone, locale) on public.user_profiles to authenticated;
create policy self_or_colleague_read on public.user_profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select app.shares_company(user_id)));
create policy self_update on public.user_profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- User roles: members see who has which role; only users.manage can grant/revoke.
grant select, insert, delete on public.user_roles to authenticated;
create policy member_read on public.user_roles for select to authenticated
  using ((select app.is_member(company_id)));
create policy admin_insert on public.user_roles for insert to authenticated
  with check ((select app.has_perm(company_id, 'users.manage')));
create policy admin_delete on public.user_roles for delete to authenticated
  using ((select app.has_perm(company_id, 'users.manage')));

grant select on public.audit_log to authenticated;
-- Audit log: read-only for audit.view (owner, accountant, auditor).
create policy audit_read on public.audit_log for select to authenticated
  using (company_id is not null and (select app.has_perm(company_id, 'audit.view')));

-- Chart of accounts: everyone with masterdata.view reads; only gl.manage (owner) writes.
grant select, insert, update, delete on public.gl_accounts to authenticated;
create policy view on public.gl_accounts for select to authenticated
  using ((select app.has_perm(company_id, 'masterdata.view')));
create policy manage_insert on public.gl_accounts for insert to authenticated
  with check ((select app.has_perm(company_id, 'gl.manage')) and not is_system);
create policy manage_update on public.gl_accounts for update to authenticated
  using ((select app.has_perm(company_id, 'gl.manage')))
  with check ((select app.has_perm(company_id, 'gl.manage')));
create policy manage_delete on public.gl_accounts for delete to authenticated
  using ((select app.has_perm(company_id, 'gl.manage')));

-- FX rates
grant select, insert, update, delete on public.fx_rates to authenticated;
create policy view on public.fx_rates for select to authenticated
  using ((select app.has_perm(company_id, 'masterdata.view')));
create policy manage_insert on public.fx_rates for insert to authenticated
  with check ((select app.has_perm(company_id, 'rates.manage')));
create policy manage_update on public.fx_rates for update to authenticated
  using ((select app.has_perm(company_id, 'rates.manage')))
  with check ((select app.has_perm(company_id, 'rates.manage')));
create policy manage_delete on public.fx_rates for delete to authenticated
  using ((select app.has_perm(company_id, 'rates.manage')));

-- Fiscal periods: read for members; changed only by close_period / reopen_period.
grant select on public.fiscal_periods, public.fiscal_period_events to authenticated;
create policy member_read on public.fiscal_periods for select to authenticated
  using ((select app.is_member(company_id)));
create policy member_read on public.fiscal_period_events for select to authenticated
  using ((select app.is_member(company_id)));

-- number_sequences: RLS on, no policy, no grant -> reachable only via functions.

-- ---------------------------------------------------------------------------
-- Master data
-- ---------------------------------------------------------------------------

-- May the current user write a party with these role flags?
-- inline = data-entry users creating a missing party from inside a form (insert only).
create or replace function app.can_write_party(
  p_company uuid, p_customer boolean, p_supplier boolean, p_employee boolean, p_owner boolean,
  p_inline_ok boolean
) returns boolean
language sql stable security definer set search_path = '' as $$
  select
    (not p_owner or app.has_perm(p_company, 'company.manage'))
    and (
      ( (not p_customer or app.has_perm(p_company, 'customers.manage'))
        and (not p_supplier or app.has_perm(p_company, 'suppliers.manage'))
        and (not p_employee or app.has_perm(p_company, 'employees.manage'))
        and (p_customer or p_supplier or p_employee or p_owner
             or app.has_perm(p_company, 'suppliers.manage')
             or app.has_perm(p_company, 'customers.manage')) )
      or (p_inline_ok and not p_owner and app.has_perm(p_company, 'masterdata.create'))
    )
$$;

grant select, insert, update, delete on public.parties to authenticated;
create policy view on public.parties for select to authenticated
  using ((select app.has_perm(company_id, 'masterdata.view')));
create policy write_insert on public.parties for insert to authenticated
  with check ((select app.can_write_party(company_id, is_customer, is_supplier, is_employee, is_owner, true)));
create policy write_update on public.parties for update to authenticated
  using ((select app.can_write_party(company_id, is_customer, is_supplier, is_employee, is_owner, false)))
  with check ((select app.can_write_party(company_id, is_customer, is_supplier, is_employee, is_owner, false)));
create policy write_delete on public.parties for delete to authenticated
  using ((select app.can_write_party(company_id, is_customer, is_supplier, is_employee, is_owner, false)));

grant select, insert, update, delete on public.projects to authenticated;
create policy view on public.projects for select to authenticated
  using ((select app.has_perm(company_id, 'masterdata.view')));
create policy manage_insert on public.projects for insert to authenticated
  with check ((select app.has_perm(company_id, 'projects.manage')));
create policy manage_update on public.projects for update to authenticated
  using ((select app.has_perm(company_id, 'projects.manage')))
  with check ((select app.has_perm(company_id, 'projects.manage')));
create policy manage_delete on public.projects for delete to authenticated
  using ((select app.has_perm(company_id, 'projects.manage')));

grant select, insert, update, delete on public.items to authenticated;
create policy view on public.items for select to authenticated
  using ((select app.has_perm(company_id, 'masterdata.view')));
create policy manage_insert on public.items for insert to authenticated
  with check ((select app.has_perm(company_id, 'items.manage'))
              or (select app.has_perm(company_id, 'masterdata.create')));
create policy manage_update on public.items for update to authenticated
  using ((select app.has_perm(company_id, 'items.manage')))
  with check ((select app.has_perm(company_id, 'items.manage')));
create policy manage_delete on public.items for delete to authenticated
  using ((select app.has_perm(company_id, 'items.manage')));

grant select, insert, update, delete on public.money_accounts to authenticated;
create policy view on public.money_accounts for select to authenticated
  using ((select app.has_perm(company_id, 'masterdata.view')));
create policy manage_insert on public.money_accounts for insert to authenticated
  with check ((select app.has_perm(company_id, 'money_accounts.manage')));
create policy manage_update on public.money_accounts for update to authenticated
  using ((select app.has_perm(company_id, 'money_accounts.manage')))
  with check ((select app.has_perm(company_id, 'money_accounts.manage')));
create policy manage_delete on public.money_accounts for delete to authenticated
  using ((select app.has_perm(company_id, 'money_accounts.manage')));

-- ---------------------------------------------------------------------------
-- Admin functions exposed through the API
-- ---------------------------------------------------------------------------
create or replace function public.set_user_active(p_company uuid, p_user uuid, p_active boolean)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_perm(p_company, 'users.manage');
  if not exists (select 1 from public.user_roles where company_id = p_company and user_id = p_user) then
    raise exception 'User is not a member of this company';
  end if;
  if p_user = auth.uid() and not p_active then
    raise exception 'You cannot deactivate yourself';
  end if;
  perform set_config('app.allow_profile_admin', 'on', true);
  update public.user_profiles set is_active = p_active where user_id = p_user;
  perform set_config('app.allow_profile_admin', 'off', true);
end $$;

-- What the current user may do in a company (the UI mirrors this; the DB enforces it).
create or replace function public.my_permissions(p_company uuid)
returns table (permission_code text)
language sql stable security definer set search_path = '' as $$
  select rp.permission_code
  from public.permissions p
  join public.role_permissions rp on rp.permission_code = p.code
  where app.has_perm(p_company, p.code)
  group by rp.permission_code
$$;

-- Companies the current user belongs to, with roles and whether MFA is still needed.
create or replace function public.my_companies()
returns table (company_id uuid, name_en text, name_ar text, roles text[], mfa_required boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name_en, c.name_ar,
         array_agg(ur.role_code order by r.sort),
         bool_or(r.requires_mfa) and app.aal() <> 'aal2'
  from public.user_roles ur
  join public.companies c on c.id = ur.company_id
  join public.roles r on r.code = ur.role_code
  join public.user_profiles up on up.user_id = ur.user_id and up.is_active
  where ur.user_id = auth.uid()
  group by c.id, c.name_en, c.name_ar
$$;

grant execute on function public.close_period(uuid, int, int)              to authenticated;
grant execute on function public.reopen_period(uuid, int, int, text)       to authenticated;
grant execute on function public.set_user_active(uuid, uuid, boolean)      to authenticated;
grant execute on function public.my_permissions(uuid)                      to authenticated;
grant execute on function public.my_companies()                            to authenticated;
grant execute on function app.can_write_party(uuid, boolean, boolean, boolean, boolean, boolean) to authenticated, service_role;

-- Belt and braces: nothing in public is callable without signing in.
revoke execute on all functions in schema public from public, anon;
