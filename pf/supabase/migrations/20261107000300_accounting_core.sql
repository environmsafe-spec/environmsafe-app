-- ES-PF v2 · Migration 3: accounting core
-- Chart of accounts, FX rates, fiscal periods, gapless numbering, document types.

-- ---------------------------------------------------------------------------
-- Chart of accounts
-- ---------------------------------------------------------------------------
create table public.gl_accounts (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id),
  code             text not null check (code ~ '^[0-9]{4}(-[0-9]{3})?$'),
  name_en          text not null,
  name_ar          text,
  account_type     public.account_type not null,
  subtype          text,
  parent_id        uuid references public.gl_accounts(id),
  -- Line on the IFRS-for-SMEs statements (see docs/chart-of-accounts.md).
  ifrs_line        text not null,
  -- P&L lines must carry a project, unless the account says otherwise (e.g. bank charges).
  requires_project boolean not null default false,
  -- Control accounts are only posted to by documents that carry a party.
  control_kind     text check (control_kind in ('bank', 'ar', 'ap', 'employee_advance', 'employee_payable', 'owner', 'customer_advance', 'supplier_advance')),
  is_postable      boolean not null default true,
  is_system        boolean not null default false,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  unique (company_id, code),
  unique (company_id, id)
);
create index gl_accounts_parent_idx on public.gl_accounts(parent_id);

create or replace function app.guard_gl_account() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_parent public.gl_accounts;
begin
  if tg_op = 'UPDATE' then
    if new.company_id <> old.company_id or new.code <> old.code then
      raise exception 'The code of an account cannot change (create a new account instead)';
    end if;
    if old.is_system and (new.account_type <> old.account_type
                          or new.control_kind is distinct from old.control_kind
                          or new.is_postable <> old.is_postable) then
      raise exception 'System account %: type, control kind and postability are fixed', old.code;
    end if;
  end if;

  if new.parent_id is not null then
    select * into v_parent from public.gl_accounts where id = new.parent_id;
    if v_parent.company_id <> new.company_id then
      raise exception 'Parent account belongs to another company';
    end if;
    if v_parent.account_type <> new.account_type then
      raise exception 'Account % must have the same type as its parent %', new.code, v_parent.code;
    end if;
    if v_parent.is_postable then
      raise exception 'Parent account % is postable; only header accounts can have children', v_parent.code;
    end if;
  end if;
  return new;
end $$;
create trigger gl_accounts_guard before insert or update on public.gl_accounts
  for each row execute function app.guard_gl_account();

create or replace function app.block_system_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.is_system then
    raise exception 'System account % cannot be deleted (deactivate it instead)', old.code;
  end if;
  return old;
end $$;
create trigger gl_accounts_no_system_delete before delete on public.gl_accounts
  for each row execute function app.block_system_delete();

-- ---------------------------------------------------------------------------
-- FX rates: units of currency per 1 USD (USD 1, SAR 3.79, YER 1556)
-- ---------------------------------------------------------------------------
create table public.fx_rates (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  rate_date     date not null,
  currency      char(3) not null references public.currencies(code),
  rate_per_usd  numeric(18, 6) not null check (rate_per_usd > 0),
  source        text,
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  unique (company_id, currency, rate_date)
);

-- Latest rate on or before p_date. USD is always 1.
create or replace function app.rate_on(p_company uuid, p_currency char(3), p_date date)
returns numeric
language sql stable security definer set search_path = '' as $$
  select case when p_currency = 'USD' then 1::numeric else (
    select r.rate_per_usd from public.fx_rates r
    where r.company_id = p_company and r.currency = p_currency and r.rate_date <= p_date
    order by r.rate_date desc limit 1) end
$$;

-- ---------------------------------------------------------------------------
-- Fiscal periods (monthly). Closed periods reject posting (app.assert_period_open).
-- ---------------------------------------------------------------------------
create table public.fiscal_periods (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  year        smallint not null check (year between 2000 and 2100),
  month       smallint not null check (month between 1 and 12),
  status      public.period_status not null default 'open',
  closed_at   timestamptz,
  closed_by   uuid,
  unique (company_id, year, month)
);

create table public.fiscal_period_events (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  period_id   uuid not null references public.fiscal_periods(id),
  action      text not null check (action in ('close', 'reopen')),
  reason      text,
  at          timestamptz not null default now(),
  by_user     uuid default auth.uid()
);

create or replace function app.ensure_periods(p_company uuid, p_year int) returns void
language sql security definer set search_path = '' as $$
  insert into public.fiscal_periods (company_id, year, month)
  select p_company, p_year, m from generate_series(1, 12) m
  on conflict (company_id, year, month) do nothing
$$;

-- Called by the posting engine (Phase 2) before writing a journal entry.
create or replace function app.assert_period_open(p_company uuid, p_date date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_period public.fiscal_periods;
begin
  perform app.ensure_periods(p_company, extract(year from p_date)::int);
  select * into v_period from public.fiscal_periods
  where company_id = p_company
    and year = extract(year from p_date)
    and month = extract(month from p_date)
  for share;
  if v_period.status = 'closed' then
    raise exception 'Period %-% is closed; posting on % is not allowed',
      v_period.year, lpad(v_period.month::text, 2, '0'), p_date
      using errcode = 'P0001';
  end if;
  return v_period.id;
end $$;

create or replace function public.close_period(p_company uuid, p_year int, p_month int)
returns public.fiscal_periods
language plpgsql security definer set search_path = '' as $$
declare
  v public.fiscal_periods;
begin
  perform app.require_perm(p_company, 'periods.close');
  perform app.ensure_periods(p_company, p_year);
  update public.fiscal_periods
     set status = 'closed', closed_at = now(), closed_by = auth.uid()
   where company_id = p_company and year = p_year and month = p_month and status = 'open'
  returning * into v;
  if v.id is null then
    raise exception 'Period %-% is already closed', p_year, p_month;
  end if;
  insert into public.fiscal_period_events (company_id, period_id, action)
  values (p_company, v.id, 'close');
  perform app.log_event(p_company, 'fiscal_periods', v.id::text,
                        format('Closed period %s-%s', p_year, lpad(p_month::text, 2, '0')));
  return v;
end $$;

create or replace function public.reopen_period(p_company uuid, p_year int, p_month int, p_reason text)
returns public.fiscal_periods
language plpgsql security definer set search_path = '' as $$
declare
  v public.fiscal_periods;
begin
  perform app.require_perm(p_company, 'periods.reopen');
  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'A reason (at least 5 characters) is required to reopen a period';
  end if;
  update public.fiscal_periods
     set status = 'open', closed_at = null, closed_by = null
   where company_id = p_company and year = p_year and month = p_month and status = 'closed'
  returning * into v;
  if v.id is null then
    raise exception 'Period %-% is not closed', p_year, p_month;
  end if;
  insert into public.fiscal_period_events (company_id, period_id, action, reason)
  values (p_company, v.id, 'reopen', p_reason);
  perform app.log_event(p_company, 'fiscal_periods', v.id::text,
                        format('Reopened period %s-%s: %s', p_year, lpad(p_month::text, 2, '0'), p_reason));
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Document types and gapless numbering
-- ---------------------------------------------------------------------------
create table public.document_types (
  code        text primary key,
  prefix      text not null,
  -- 'daily'  -> PREFIX + YYYYMMDD + NN   (PO 2026110701, INV-2026110701)
  -- 'yearly' -> PREFIX-YYYY-NNNN         (PV-2026-0001)
  numbering   text not null check (numbering in ('daily', 'yearly')),
  name_en     text not null,
  name_ar     text not null,
  module      text not null check (module in ('procurement', 'sales', 'money', 'accounting')),
  sort        smallint not null default 100
);

-- One counter row per company / scope / period. The upsert takes a row lock that is held
-- until commit, so concurrent posts queue up and a rolled-back post releases its number:
-- the series stays gapless.
create table public.number_sequences (
  company_id  uuid not null references public.companies(id),
  scope       text not null,
  period_key  text not null default '',
  last_no     integer not null,
  primary key (company_id, scope, period_key)
);

create or replace function app.next_seq(p_company uuid, p_scope text, p_period_key text default '')
returns integer
language sql security definer set search_path = '' as $$
  insert into public.number_sequences as s (company_id, scope, period_key, last_no)
  values (p_company, p_scope, coalesce(p_period_key, ''), 1)
  on conflict (company_id, scope, period_key) do update set last_no = s.last_no + 1
  returning last_no
$$;

-- Final document number, assigned at posting time (Phase 2 calls this).
create or replace function app.next_document_number(p_company uuid, p_doc_type text, p_date date)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  t public.document_types;
  n integer;
begin
  select * into t from public.document_types where code = p_doc_type;
  if t.code is null then
    raise exception 'Unknown document type %', p_doc_type;
  end if;
  if t.numbering = 'daily' then
    n := app.next_seq(p_company, 'doc:' || t.code, to_char(p_date, 'YYYYMMDD'));
    return t.prefix || to_char(p_date, 'YYYYMMDD') || case when n < 100 then lpad(n::text, 2, '0') else n::text end;
  else
    n := app.next_seq(p_company, 'doc:' || t.code, to_char(p_date, 'YYYY'));
    return t.prefix || '-' || to_char(p_date, 'YYYY') || '-' || case when n < 10000 then lpad(n::text, 4, '0') else n::text end;
  end if;
end $$;

-- Draft number: not part of the official series, so drafts never consume official numbers.
create sequence app.draft_number_seq;
create or replace function app.next_draft_number() returns text
language sql security definer set search_path = '' as $$
  select 'DRAFT-' || nextval('app.draft_number_seq')::text
$$;

-- Master-data code (PJ-0001 ...), gapless per company.
create or replace function app.next_master_code(p_company uuid, p_prefix text, p_width int)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  n integer := app.next_seq(p_company, 'code:' || p_prefix, '');
begin
  return p_prefix || '-' || case when length(n::text) < p_width then lpad(n::text, p_width, '0') else n::text end;
end $$;

create trigger gl_accounts_touch before update on public.gl_accounts for each row execute function app.touch();
create trigger fx_rates_touch    before update on public.fx_rates    for each row execute function app.touch();

create trigger audit_gl_accounts          after insert or update or delete on public.gl_accounts          for each row execute function app.audit_row();
create trigger audit_fx_rates             after insert or update or delete on public.fx_rates             for each row execute function app.audit_row();
create trigger audit_fiscal_periods       after insert or update or delete on public.fiscal_periods       for each row execute function app.audit_row();
create trigger audit_fiscal_period_events after insert or update or delete on public.fiscal_period_events for each row execute function app.audit_row();
