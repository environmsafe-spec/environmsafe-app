-- ES-PF v2 · Migration 4: master data
-- Parties (customers, suppliers, employees, owner), projects, items, money accounts.
-- Every row gets a gapless code on insert; old IDs are kept in legacy_id and searchable.

-- ---------------------------------------------------------------------------
-- Parties: one table, a party can be customer and supplier at the same time.
-- ---------------------------------------------------------------------------
create table public.parties (
  id                            uuid primary key default gen_random_uuid(),
  company_id                    uuid not null references public.companies(id),
  code                          text not null,
  legacy_id                     text,
  primary_kind                  public.party_kind not null,
  is_customer                   boolean not null default false,
  is_supplier                   boolean not null default false,
  is_employee                   boolean not null default false,
  is_owner                      boolean not null default false,
  name_en                       text not null check (length(trim(name_en)) > 0),
  name_ar                       text,
  contact_person                text,
  phone                         text,
  email                         text,
  address                       text,
  city                          text,
  country                       text,
  tax_no                        text,
  default_currency              char(3) references public.currencies(code),
  default_gl_account_id         uuid,
  default_project_id            uuid,
  job_title                     text,
  -- Employee withdrawals that are really owner drawings (spec section 4).
  treat_withdrawals_as_drawings boolean not null default false,
  payment_terms_days            smallint check (payment_terms_days is null or payment_terms_days between 0 and 365),
  notes                         text,
  is_active                     boolean not null default true,
  created_at                    timestamptz not null default now(),
  created_by                    uuid default auth.uid(),
  updated_at                    timestamptz not null default now(),
  updated_by                    uuid,
  unique (company_id, code),
  unique (company_id, id),
  foreign key (company_id, default_gl_account_id) references public.gl_accounts(company_id, id),
  check (is_customer or is_supplier or is_employee or is_owner or primary_kind = 'other')
);
create index parties_name_idx   on public.parties(company_id, lower(name_en));
create index parties_legacy_idx on public.parties(company_id, legacy_id);

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------
create table public.projects (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id),
  code              text not null,
  legacy_id         text,
  name_en           text not null check (length(trim(name_en)) > 0),
  name_ar           text,
  customer_id       uuid,
  kind              public.project_kind not null default 'contract',
  status            public.project_status not null default 'active',
  budget_amount     numeric(18, 2) check (budget_amount is null or budget_amount >= 0),
  budget_currency   char(3) references public.currencies(code),
  start_date        date,
  end_date          date,
  description       text,
  drive_folder_url  text,
  created_at        timestamptz not null default now(),
  created_by        uuid default auth.uid(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  unique (company_id, code),
  unique (company_id, id),
  foreign key (company_id, customer_id) references public.parties(company_id, id),
  check (end_date is null or start_date is null or end_date >= start_date),
  check (budget_amount is null or budget_currency is not null)
);
create index projects_name_idx   on public.projects(company_id, lower(name_en));
create index projects_legacy_idx on public.projects(company_id, legacy_id);

alter table public.parties
  add foreign key (company_id, default_project_id) references public.projects(company_id, id);

-- ---------------------------------------------------------------------------
-- Items (products and services). The catalogue fills itself from documents (Phase 3).
-- ---------------------------------------------------------------------------
create table public.items (
  id                          uuid primary key default gen_random_uuid(),
  company_id                  uuid not null references public.companies(id),
  code                        text not null,
  legacy_id                   text,
  name_en                     text not null check (length(trim(name_en)) > 0),
  name_ar                     text,
  kind                        public.item_kind not null,
  unit                        text not null default 'ea',
  default_expense_account_id  uuid,
  default_revenue_account_id  uuid,
  last_cost                   numeric(18, 4),
  last_cost_currency          char(3) references public.currencies(code),
  last_sale_price             numeric(18, 4),
  last_sale_currency          char(3) references public.currencies(code),
  last_supplier_id            uuid,
  last_customer_id            uuid,
  last_document_ref           text,
  is_asset                    boolean not null default false,
  life_years                  numeric(5, 2) check (life_years is null or life_years > 0),
  is_active                   boolean not null default true,
  created_at                  timestamptz not null default now(),
  created_by                  uuid default auth.uid(),
  updated_at                  timestamptz not null default now(),
  updated_by                  uuid,
  unique (company_id, code),
  unique (company_id, id),
  foreign key (company_id, default_expense_account_id) references public.gl_accounts(company_id, id),
  foreign key (company_id, default_revenue_account_id) references public.gl_accounts(company_id, id),
  foreign key (company_id, last_supplier_id) references public.parties(company_id, id),
  foreign key (company_id, last_customer_id) references public.parties(company_id, id),
  check (not is_asset or life_years is not null)
);
create index items_name_idx   on public.items(company_id, lower(name_en));
create index items_legacy_idx on public.items(company_id, legacy_id);

-- ---------------------------------------------------------------------------
-- Money accounts: banks, exchange companies, cards, petty cash. Each one gets its
-- own GL account under 1000 Cash and bank, created automatically.
-- ---------------------------------------------------------------------------
create table public.money_accounts (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id),
  code              text not null,
  legacy_id         text,
  name_en           text not null check (length(trim(name_en)) > 0),
  name_ar           text,
  kind              public.money_account_kind not null,
  currency          char(3) not null references public.currencies(code),
  bank_name         text,
  account_no        text,
  iban              text,
  gl_account_id     uuid not null,
  holder_party_id   uuid,
  usual_fee         numeric(18, 2) check (usual_fee is null or usual_fee >= 0),
  opening_balance   numeric(18, 2) not null default 0,
  opening_date      date,
  notes             text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  created_by        uuid default auth.uid(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  unique (company_id, code),
  unique (company_id, id),
  unique (gl_account_id),
  foreign key (company_id, gl_account_id) references public.gl_accounts(company_id, id),
  foreign key (company_id, holder_party_id) references public.parties(company_id, id)
);
create index money_accounts_legacy_idx on public.money_accounts(company_id, legacy_id);

-- ---------------------------------------------------------------------------
-- Code assignment and immutable columns
-- ---------------------------------------------------------------------------
create or replace function app.assign_master_code() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_prefix text;
  v_width  int := 4;
begin
  if tg_table_name = 'parties' then
    v_prefix := case new.primary_kind
                  when 'customer' then 'CU' when 'supplier' then 'SU'
                  when 'employee' then 'EM' when 'owner' then 'OW' else 'PT' end;
  elsif tg_table_name = 'projects' then v_prefix := 'PJ';
  elsif tg_table_name = 'items' then v_prefix := 'IT';
  elsif tg_table_name = 'money_accounts' then v_prefix := 'MA'; v_width := 3;
  end if;
  -- Codes are always generated by the database (rule: serial, no gaps).
  new.code := app.next_master_code(new.company_id, v_prefix, v_width);
  return new;
end $$;

create or replace function app.guard_master_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.company_id <> old.company_id then
    raise exception 'company_id cannot change';
  end if;
  if new.code <> old.code then
    raise exception 'code cannot change';
  end if;
  if tg_table_name = 'money_accounts' then
    if new.gl_account_id <> old.gl_account_id then
      raise exception 'The GL account of a money account cannot change';
    end if;
    -- Phase 2 adds: currency cannot change once the account has postings.
  end if;
  return new;
end $$;

create or replace function app.party_flags() returns trigger
language plpgsql set search_path = '' as $$
begin
  case new.primary_kind
    when 'customer' then new.is_customer := true;
    when 'supplier' then new.is_supplier := true;
    when 'employee' then new.is_employee := true;
    when 'owner'    then new.is_owner    := true;
    else null;
  end case;
  if tg_op = 'UPDATE' and new.primary_kind <> old.primary_kind then
    raise exception 'primary_kind cannot change (add a role flag instead)';
  end if;
  return new;
end $$;

-- Every money account gets its own postable GL account 1000-NNN.
create or replace function app.money_account_gl() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_parent uuid;
  v_n      int;
  v_id     uuid;
begin
  if new.gl_account_id is not null then
    if not exists (select 1 from public.gl_accounts
                   where id = new.gl_account_id and company_id = new.company_id
                     and control_kind = 'bank' and is_postable) then
      raise exception 'gl_account_id must be a postable bank/cash account of this company';
    end if;
    return new;
  end if;
  select id into v_parent from public.gl_accounts
  where company_id = new.company_id and code = '1000';
  if v_parent is null then
    raise exception 'Chart of accounts not seeded: header account 1000 is missing';
  end if;
  v_n := app.next_seq(new.company_id, 'gl:1000', '');
  insert into public.gl_accounts
    (company_id, code, name_en, name_ar, account_type, subtype, parent_id, ifrs_line,
     control_kind, is_postable, is_system)
  values
    (new.company_id, '1000-' || lpad(v_n::text, 3, '0'),
     new.name_en || ' (' || new.currency || ')', new.name_ar,
     'asset', 'cash_and_bank', v_parent, 'cash_and_cash_equivalents',
     'bank', true, true)
  returning id into v_id;
  new.gl_account_id := v_id;
  return new;
end $$;

-- Keep the GL account name in step with the money account name.
create or replace function app.money_account_gl_rename() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.name_en is distinct from old.name_en or new.name_ar is distinct from old.name_ar then
    update public.gl_accounts
       set name_en = new.name_en || ' (' || new.currency || ')', name_ar = new.name_ar
     where id = new.gl_account_id;
  end if;
  return new;
end $$;

-- Order matters: BEFORE triggers fire alphabetically.
create trigger a_parties_flags         before insert or update on public.parties for each row execute function app.party_flags();
create trigger b_parties_code          before insert on public.parties        for each row execute function app.assign_master_code();
create trigger b_projects_code         before insert on public.projects       for each row execute function app.assign_master_code();
create trigger b_items_code            before insert on public.items          for each row execute function app.assign_master_code();
create trigger b_money_accounts_code   before insert on public.money_accounts for each row execute function app.assign_master_code();
create trigger c_money_accounts_gl     before insert on public.money_accounts for each row execute function app.money_account_gl();

create trigger parties_immutable        before update on public.parties        for each row execute function app.guard_master_immutable();
create trigger projects_immutable       before update on public.projects       for each row execute function app.guard_master_immutable();
create trigger items_immutable          before update on public.items          for each row execute function app.guard_master_immutable();
create trigger money_accounts_immutable before update on public.money_accounts for each row execute function app.guard_master_immutable();
create trigger money_accounts_gl_rename after update on public.money_accounts  for each row execute function app.money_account_gl_rename();

create trigger parties_touch        before update on public.parties        for each row execute function app.touch();
create trigger projects_touch       before update on public.projects       for each row execute function app.touch();
create trigger items_touch          before update on public.items          for each row execute function app.touch();
create trigger money_accounts_touch before update on public.money_accounts for each row execute function app.touch();

create trigger audit_parties        after insert or update or delete on public.parties        for each row execute function app.audit_row();
create trigger audit_projects       after insert or update or delete on public.projects       for each row execute function app.audit_row();
create trigger audit_items          after insert or update or delete on public.items          for each row execute function app.audit_row();
create trigger audit_money_accounts after insert or update or delete on public.money_accounts for each row execute function app.audit_row();
