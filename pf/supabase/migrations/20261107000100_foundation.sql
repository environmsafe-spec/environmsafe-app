-- ES-PF v2 · Migration 1: foundation
-- Companies, users, roles & permissions, helper functions used by every RLS policy.

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------
create type public.account_type       as enum ('asset', 'liability', 'equity', 'income', 'expense');
create type public.period_status      as enum ('open', 'closed');
create type public.project_kind       as enum ('contract', 'internal');
create type public.project_status     as enum ('active', 'on_hold', 'closed');
create type public.party_kind         as enum ('customer', 'supplier', 'employee', 'owner', 'other');
create type public.item_kind          as enum ('goods', 'service');
create type public.money_account_kind as enum ('bank', 'cash', 'card', 'exchange');

-- ---------------------------------------------------------------------------
-- Reference tables (global, read-only for users, maintained by migrations)
-- ---------------------------------------------------------------------------
create table public.currencies (
  code      char(3) primary key check (code ~ '^[A-Z]{3}$'),
  name_en   text not null,
  name_ar   text not null,
  decimals  smallint not null default 2 check (decimals between 0 and 4),
  sort      smallint not null default 100
);

create table public.roles (
  code          text primary key,
  name_en       text not null,
  name_ar       text not null,
  description   text,
  requires_mfa  boolean not null default false,
  sort          smallint not null default 100
);

create table public.permissions (
  code        text primary key check (code ~ '^[a-z_]+\.[a-z_]+$'),
  module      text not null,
  description text not null
);

create table public.role_permissions (
  role_code       text not null references public.roles(code) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role_code, permission_code)
);

-- ---------------------------------------------------------------------------
-- Companies and users
-- ---------------------------------------------------------------------------
create table public.companies (
  id                      uuid primary key default gen_random_uuid(),
  name_en                 text not null,
  name_ar                 text,
  legal_name              text,
  functional_currency     char(3) not null default 'USD' references public.currencies(code),
  fiscal_year_start_month smallint not null default 1 check (fiscal_year_start_month between 1 and 12),
  -- Printed-document settings, bank lines, approval thresholds (Phase 2/3 read these).
  settings                jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  updated_by              uuid
);

create table public.user_profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  phone       text,
  locale      text not null default 'en' check (locale in ('en', 'ar')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

create table public.user_roles (
  company_id  uuid not null references public.companies(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role_code   text not null references public.roles(code),
  granted_by  uuid,
  granted_at  timestamptz not null default now(),
  primary key (company_id, user_id, role_code)
);
create index user_roles_user_idx on public.user_roles(user_id);

-- ---------------------------------------------------------------------------
-- Helper functions (schema app is not exposed through the API)
-- ---------------------------------------------------------------------------

-- True when the request comes with the service-role key (Edge Functions, migration jobs).
create or replace function app.is_service() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(auth.role(), '') = 'service_role'
$$;

-- Authentication assurance level of the current session ('aal1' password, 'aal2' password + TOTP).
create or replace function app.aal() returns text
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1')
$$;

-- Does the current user hold permission p_perm in company p_company?
-- Roles flagged requires_mfa only count when the session passed MFA (aal2).
create or replace function app.has_perm(p_company uuid, p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_service() or exists (
    select 1
    from public.user_roles ur
    join public.roles r             on r.code = ur.role_code
    join public.role_permissions rp on rp.role_code = ur.role_code
    join public.user_profiles up    on up.user_id = ur.user_id
    where ur.user_id = auth.uid()
      and ur.company_id = p_company
      and rp.permission_code = p_perm
      and up.is_active
      and (not r.requires_mfa or app.aal() = 'aal2')
  )
$$;

-- Is the current user an active member of the company (any role)?
create or replace function app.is_member(p_company uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_service() or exists (
    select 1
    from public.user_roles ur
    join public.user_profiles up on up.user_id = ur.user_id
    where ur.user_id = auth.uid() and ur.company_id = p_company and up.is_active
  )
$$;

-- Does the current user share at least one company with p_user?
create or replace function app.shares_company(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles a
    join public.user_roles b on b.company_id = a.company_id
    where a.user_id = auth.uid() and b.user_id = p_user
  )
$$;

-- Raise a clean error unless the user holds the permission.
create or replace function app.require_perm(p_company uuid, p_perm text) returns void
language plpgsql stable set search_path = '' as $$
begin
  if not app.has_perm(p_company, p_perm) then
    raise exception 'Permission denied: % is required', p_perm
      using errcode = '42501';
  end if;
end $$;

-- Generic updated_at / updated_by maintenance.
create or replace function app.touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

create trigger companies_touch     before update on public.companies     for each row execute function app.touch();
create trigger user_profiles_touch before update on public.user_profiles for each row execute function app.touch();

-- Create a profile for every new auth user.
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.user_profiles (user_id, email, full_name, locale)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    case when new.raw_user_meta_data ->> 'locale' = 'ar' then 'ar' else 'en' end
  )
  on conflict (user_id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- Users may edit only these columns of their own profile; is_active is changed by an admin function.
create or replace function app.guard_profile_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.user_id <> old.user_id then
    raise exception 'user_id cannot change';
  end if;
  if new.is_active is distinct from old.is_active
     and not app.is_service()
     and current_setting('app.allow_profile_admin', true) is distinct from 'on' then
    raise exception 'Use set_user_active() to activate or deactivate a user' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger user_profiles_guard before update on public.user_profiles
  for each row execute function app.guard_profile_update();

-- Keep at least one owner per company, and only owners can grant the owner role.
create or replace function app.guard_user_roles() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := coalesce(new.company_id, old.company_id);
begin
  if tg_op = 'INSERT' and new.role_code = 'owner'
     and not app.is_service()
     and exists (select 1 from public.user_roles where company_id = v_company and role_code = 'owner')
     and not exists (select 1 from public.user_roles
                     where company_id = v_company and role_code = 'owner' and user_id = auth.uid()) then
    raise exception 'Only an owner can grant the owner role' using errcode = '42501';
  end if;

  if tg_op in ('DELETE', 'UPDATE') and old.role_code = 'owner'
     and not exists (select 1 from public.user_roles
                     where company_id = v_company and role_code = 'owner'
                       and user_id <> old.user_id) then
    raise exception 'A company must keep at least one owner';
  end if;

  if tg_op = 'INSERT' then
    new.granted_by := coalesce(new.granted_by, auth.uid());
    return new;
  elsif tg_op = 'UPDATE' then
    return new;
  end if;
  return old;
end $$;
create trigger user_roles_guard before insert or update or delete on public.user_roles
  for each row execute function app.guard_user_roles();
