-- ES-PF Phase 6: migration of the old app (table es_records) into the new ledger.
--
-- Runs on STAGING first, against a COPY of the old table in legacy.es_records. The old database is never
-- written to. One call does everything:
--     select migration.run('<company uuid>', '<owner user uuid>');
-- and is refused if the company already holds migrated documents (re-run on a fresh database).
--
-- Every source row ends up in migration.map with an outcome (master, posted, draft, void, skipped,
-- exception) and a note; every problem in migration.exceptions. Nothing is dropped silently.
-- The views migration.recon_* are the acceptance test (old totals vs new totals).
--
-- Decisions taken with the owner (docs/migration-proposal.md):
--   A  old drafts stay drafts; Approved / Paid / Closed are posted; Cancelled and deleted-with-data are void.
--   B  expense with an employee and a company account = expense paid by the company;
--      expense with an employee and no account = the employee's claim, still to be paid.
--   C  opening balances are 0.
--   D  the "INV" accounts were a receivable placeholder: invoices go to accounts receivable, the INV accounts
--      are not money accounts.
--   E  LOAN IN against an employee advance = the employee repaying the advance.
--   F  Tadhamon accounts are company bank accounts; USD-AKRAM-QUT (ACC-0022) is the owner's personal account:
--      what was paid from it is "paid by the owner for the company" (owner current account 2200).
--   G  generator projects post their revenue to 4250 Generator maintenance services.

create schema if not exists legacy;
create table if not exists legacy.es_records (
  company_id  uuid not null,
  collection  text not null,
  record_id   text not null,
  data        jsonb not null default '{}',
  deleted     boolean not null default false,
  updated_at  timestamptz,
  updated_by  text,
  primary key (company_id, collection, record_id)
);

create schema if not exists migration;

-- ---------------------------------------------------------------------------
-- Settings (reviewed with the owner; edit before running if a decision changes)
-- ---------------------------------------------------------------------------
create table if not exists migration.category_map (
  legacy_id text primary key,
  gl_code   text not null,
  note      text
);
insert into migration.category_map values
  ('CAT-0001', '5900', 'Direct cost'),
  ('CAT-0002', '6100', 'Salary'),
  ('CAT-0003', '6700', 'Marketing'),
  ('CAT-0004', '6200', 'Transport'),
  ('CAT-0005', '6350', 'Utilities'),
  ('CAT-0006', '6800', 'Office supplies'),
  ('CAT-0007', '6400', 'Government fees'),
  ('CAT-0008', '6500', 'Professional services'),
  ('CAT-0009', '6600', 'Travel'),
  ('CAT-0010', '6990', 'Other OPEX (bank fees go to 6900, see migration.expense_account)'),
  ('CAT-0012', '1150', 'Debit'),
  ('CAT-0013', '6100', 'Motivation'),
  ('CAT-0014', '5200', 'Customer order'),
  ('CAT-0015', '5200', 'EnvironmSafe procurement'),
  ('CAT-0016', '3200', 'Owner drawings'),
  ('CAT-0017', '6990', 'Work and expenses'),
  ('CAT-0018', '6990', 'Expense claims'),
  ('CAT-0019', '1150', 'Debit (owed back)'),
  ('CAT-0020', '1260', 'Guarantee')
on conflict (legacy_id) do nothing;

-- Old bank / cash accounts that are NOT ordinary company money accounts, and kind overrides.
create table if not exists migration.account_rules (
  legacy_id text primary key,
  treatment text not null check (treatment in ('money', 'receivable', 'owner_personal')),
  kind      public.money_account_kind,
  note      text
);
insert into migration.account_rules values
  ('ACC-0022', 'owner_personal', null, 'USD-AKRAM-QUT: the owner''s personal account (decision F)')
on conflict (legacy_id) do nothing;

-- Revenue account per project (invoices); every other project uses 4100.
create table if not exists migration.project_revenue (
  legacy_id text primary key,
  gl_code   text not null,
  note      text
);
insert into migration.project_revenue values
  ('PRJ-0010',    '4250', 'UNHCR-GEN-001'),
  ('PRJ-0058',    '4250', 'UNHCR-GEN-002'),
  ('PRJ-UL-0001', '4250', 'FAO-GEN-001'),
  ('PRJ-0025',    '4200', 'ADRA-Maint-001')
on conflict (legacy_id) do nothing;

-- ---------------------------------------------------------------------------
-- Results
-- ---------------------------------------------------------------------------
create table if not exists migration.map (
  id           bigserial primary key,
  collection   text not null,
  legacy_id    text not null,      -- es_records.record_id (the row)
  old_id       text,               -- the ID people used in the old app (TRX-0001, EMP-0021), filled in automatically
  target_table text,
  target_id    uuid,
  outcome      text not null check (outcome in ('master', 'posted', 'draft', 'void', 'skipped', 'exception')),
  note         text
);
create index if not exists map_legacy on migration.map (collection, legacy_id);
create index if not exists map_old_id on migration.map (collection, old_id);

create or replace function migration.map_old_id() returns trigger language plpgsql as $$
begin
  if new.old_id is null then
    select coalesce(nullif(data ->> 'id', ''), record_id) into new.old_id
      from legacy.es_records where collection = new.collection and record_id = new.legacy_id;
  end if;
  return new;
end $$;
drop trigger if exists map_old_id on migration.map;
create trigger map_old_id before insert on migration.map for each row execute function migration.map_old_id();

create table if not exists migration.exceptions (
  id         bigserial primary key,
  collection text not null,
  legacy_id  text not null,
  problem    text not null,
  detail     text
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function migration.t(d jsonb, k text) returns text
language sql immutable as $$ select nullif(trim(d ->> k), '') $$;

-- The ID people used in the old app. es_records.record_id is an internal key; an ID can appear twice when a
-- record was deleted and the ID reused, so lookups prefer the live record.
create or replace function migration.bid(r legacy.es_records) returns text
language sql immutable as $$ select coalesce(nullif(r.data ->> 'id', ''), r.record_id) $$;

create or replace function migration.num(p text) returns numeric
language plpgsql immutable as $$
begin
  return nullif(replace(trim(p), ',', ''), '')::numeric;
exception when others then
  return null;
end $$;

-- The value of an old transaction: amount, or else the debit / credit figure (no conflicts in the data).
create or replace function migration.val(d jsonb) returns numeric
language sql immutable as $$
  select coalesce(nullif(migration.num(d ->> 'amount'), 0),
                  nullif(greatest(coalesce(migration.num(d ->> 'debit'), 0), coalesce(migration.num(d ->> 'credit'), 0)), 0))
$$;

create or replace function migration.is_done(d jsonb) returns boolean
language sql immutable as $$ select lower(coalesce(d ->> 'status', '')) in ('approved', 'paid', 'closed') $$;

create or replace function migration.note(p_company uuid, p_collection text, p_legacy text, p_problem text, p_detail text default null)
returns void language sql as $$
  insert into migration.exceptions (collection, legacy_id, problem, detail) values (p_collection, p_legacy, p_problem, p_detail)
$$;

-- How the old account is treated: money / receivable / owner_personal, or null when missing.
create or replace function migration.account_treatment(p_company uuid, p_legacy text) returns text
language sql stable as $$
  select coalesce(
    (select treatment from migration.account_rules where legacy_id = p_legacy),
    (select case when coalesce(r.data ->> 'bank', '') ilike '%INV%' or coalesce(r.data ->> 'nameEn', '') ~* '-INV$'
                 then 'receivable' else 'money' end
       from legacy.es_records r
      where r.company_id = p_company and r.collection = 'accounts' and r.data ->> 'id' = p_legacy and r.data <> '{}'
      order by r.deleted limit 1))
$$;

create or replace function migration.gl(p_company uuid, p_code text) returns uuid
language sql stable as $$ select id from public.gl_accounts where company_id = p_company and code = p_code $$;

-- Expense account for an old row: category, bank-fee wording, else the fallback.
create or replace function migration.expense_account(p_company uuid, d jsonb, p_fallback text) returns uuid
language sql stable as $$
  select migration.gl(p_company,
    case when migration.t(d, 'categoryId') = 'CAT-0010'
              and coalesce(migration.t(d, 'description'), migration.t(d, 'notes'), '') ~* '^\s*(bank|remittance|transfer)\s+(fee|charge)'
         then '6900'
         else coalesce((select gl_code from migration.category_map where legacy_id = migration.t(d, 'categoryId')), p_fallback) end)
$$;

create or replace function migration.party(p_company uuid, p_legacy text) returns uuid
language sql stable as $$
  select id from public.parties where company_id = p_company and legacy_id = p_legacy order by is_active desc, created_at desc limit 1 $$;

create or replace function migration.project(p_company uuid, p_legacy text) returns uuid
language sql stable as $$
  select id from public.projects where company_id = p_company and legacy_id = p_legacy order by status = 'closed', created_at desc limit 1 $$;

create or replace function migration.money_account(p_company uuid, p_legacy text) returns uuid
language sql stable as $$
  select id from public.money_accounts where company_id = p_company and legacy_id = p_legacy order by is_active desc, created_at desc limit 1 $$;

create or replace function migration.doc_of(p_legacy text) returns uuid
language sql stable as $$
  select m.target_id from migration.map m join public.documents d on d.id = m.target_id
   where m.collection = 'transactions' and m.old_id = p_legacy and m.target_table = 'documents'
   order by d.status = 'void', m.id desc limit 1
$$;

-- A new migrated document (draft) with the common fields of an old row.
create or replace function migration.new_doc(p_company uuid, p_kind public.doc_kind, d jsonb, p_amount numeric,
  p_money uuid, p_party uuid, p_currency text default null) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_notes text;
begin
  v_notes := concat_ws(E'\n',
    'Migrated from the old app: ' || (d ->> 'id') || ' (' || (d ->> 'type') || ', ' || coalesce(d ->> 'status', '?') || ')',
    migration.t(d, 'notes'),
    'Against: ' || migration.t(d, 'againstRef'),
    'Case no.: ' || migration.t(d, 'caseNo'),
    'Phase: ' || migration.t(d, 'phase'),
    'Attachment note: ' || migration.t(d, 'attachNote'),
    'Old document type: ' || migration.t(d, 'docType'));
  perform app.begin_internal();
  insert into public.documents (id, company_id, kind, status, doc_date, party_id, money_account_id, currency, amount,
                                reference_no, party_reference, description, notes, no_document_reason,
                                source, migrated, legacy_id, created_at)
  values (v_id, p_company, p_kind, 'draft', (d ->> 'date')::date, p_party, p_money,
          coalesce(p_currency, migration.t(d, 'currency'), 'USD'), coalesce(p_amount, 0),
          migration.t(d, 'refNo'), migration.t(d, 'docRef'),
          coalesce(migration.t(d, 'description'), left(migration.t(d, 'notes'), 200), d ->> 'type'),
          v_notes,
          case when coalesce(jsonb_array_length(case when jsonb_typeof(d -> 'attachments') = 'array' then d -> 'attachments' end), 0) = 0
               then 'No file was attached in the old app' end,
          'migration', true, d ->> 'id',
          coalesce(nullif(d ->> 'createdAt', '')::timestamptz, now()));
  return v_id;
end $$;

create or replace function migration.add_line(p_doc uuid, d jsonb, p_amount numeric, p_gl uuid, p_item uuid default null,
  p_kind text default 'item') returns void
language plpgsql as $$
declare
  v_qty numeric := migration.num(d ->> 'qty');
  v_up  numeric := migration.num(d ->> 'unitPrice');
  v_n   int;
  v_company uuid := (select company_id from public.documents where id = p_doc);
begin
  if coalesce(p_amount, 0) <= 0 then return; end if;
  -- Keep quantity x unit price only when it reproduces the amount.
  if not coalesce(v_qty > 0 and v_up > 0 and round(v_qty * v_up, 2) = round(p_amount, 2), false) then
    v_qty := 1; v_up := p_amount;
  end if;
  select count(*) + 1 into v_n from public.document_lines where document_id = p_doc;
  perform app.begin_internal();
  insert into public.document_lines (document_id, line_no, line_kind, item_id, description, qty, unit_price, amount,
                                     gl_account_id, project_id)
  values (p_doc, v_n, p_kind, p_item,
          coalesce(migration.t(d, 'description'), left(migration.t(d, 'notes'), 200), d ->> 'type'),
          v_qty, v_up, p_amount, p_gl,
          -- Overheads without a project in the old app go to the internal project "General".
          coalesce(migration.project(v_company, migration.t(d, 'projectId')),
                   (select id from public.projects where company_id = v_company and kind = 'internal' and name_en = 'General')));
end $$;

create or replace function migration.add_link(p_from uuid, p_to uuid, p_amount numeric) returns boolean
language plpgsql as $$
declare
  v_open numeric;
begin
  if p_to is null then return false; end if;
  select open_amount into v_open from public.v_document_balances where id = p_to;
  if coalesce(v_open, 0) <= 0 then return false; end if;
  perform app.begin_internal();
  insert into public.document_links (company_id, from_document_id, to_document_id, amount)
  select company_id, p_from, p_to, least(p_amount, v_open) from public.documents where id = p_from;
  return true;
end $$;

-- Attachments: the files stay where they are until the copy script moves them to the new bucket
-- (documents/<company>/legacy/<old path>) and fills in the SHA-256.
create or replace function migration.add_attachments(p_company uuid, p_doc uuid, d jsonb) returns int
language plpgsql as $$
declare
  a jsonb;
  n int := 0;
begin
  if jsonb_typeof(d -> 'attachments') <> 'array' then return 0; end if;
  for a in select * from jsonb_array_elements(d -> 'attachments') loop
    if jsonb_typeof(a) <> 'object' or migration.t(a, 'path') is null then
      perform migration.note(p_company, 'transactions', d ->> 'id', 'Attachment without a path', a::text);
      continue;
    end if;
    perform app.begin_internal();
    -- The same file can belong to two old records (e.g. a slip and its fee): each document gets its own copy.
    insert into public.attachments (company_id, document_id, storage_path, file_name, mime_type, size_bytes)
    select p_company, p_doc, path,
           coalesce(migration.t(a, 'name'), regexp_replace(a ->> 'path', '^.*/', '')),
           migration.t(a, 'type'), migration.num(a ->> 'size')::bigint
      from (select case when exists (select 1 from public.attachments x where x.company_id = p_company
                                      and x.storage_path = p_company || '/legacy/' || (a ->> 'path'))
                        then p_company || '/legacy-copy/' || p_doc || '/' || (a ->> 'path')
                        else p_company || '/legacy/' || (a ->> 'path') end as path) p;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Post / keep / void a migrated document according to the old status. Returns the outcome.
create or replace function migration.finish(p_doc uuid, d jsonb, p_deleted boolean, p_post boolean default true) returns text
language plpgsql as $$
declare
  v_status public.doc_status;
begin
  if p_deleted or lower(coalesce(d ->> 'status', '')) = 'cancelled' then
    perform public.void_document(p_doc, case when p_deleted then 'Deleted in the old app' else 'Cancelled in the old app' end);
    return 'void';
  end if;
  if not (p_post and migration.is_done(d)) then
    return 'draft';
  end if;
  begin
    select status into v_status from public.post_document(p_doc);
  exception when others then
    perform migration.note(null, 'transactions', d ->> 'id', 'Could not post: left as a draft to complete', sqlerrm);
    return 'draft';
  end;
  return case v_status when 'posted' then 'posted' else v_status::text end;
end $$;

-- ---------------------------------------------------------------------------
-- Masters
-- ---------------------------------------------------------------------------
create or replace function migration.migrate_masters(p_company uuid) returns void
language plpgsql as $$
declare
  r legacy.es_records;
  v_id uuid;
  v_treat text;
  v_kind public.money_account_kind;
  v_used boolean;
begin
  -- Parties: customers, suppliers, employees (deleted ones come in inactive, so old records still find them).
  for r in select * from legacy.es_records
            where company_id = p_company and collection in ('customers', 'suppliers', 'employees') and data <> '{}'
            order by collection, deleted desc, record_id loop
    insert into public.parties (company_id, legacy_id, primary_kind, name_en, name_ar, contact_person, phone, email,
                                address, job_title, notes, is_active)
    values (p_company, migration.bid(r),
            case r.collection when 'customers' then 'customer' when 'suppliers' then 'supplier' else 'employee' end::public.party_kind,
            coalesce(migration.t(r.data, 'nameEn'), migration.t(r.data, 'name'), migration.t(r.data, 'nameAr'), migration.bid(r)),
            migration.t(r.data, 'nameAr'), migration.t(r.data, 'contact'), migration.t(r.data, 'phone'),
            migration.t(r.data, 'email'), migration.t(r.data, 'address'), migration.t(r.data, 'position'),
            concat_ws(E'\n', migration.t(r.data, 'notes'),
                      'Salary in old app: ' || migration.t(r.data, 'salary')),
            not r.deleted)
    returning id into v_id;
    insert into migration.map (collection, legacy_id, target_table, target_id, outcome, note)
    values (r.collection, r.record_id, 'parties', v_id, 'master', case when r.deleted then 'inactive (deleted in old app)' end);
    if coalesce(migration.num(r.data ->> 'opening'), 0) <> 0 then
      perform migration.note(p_company, r.collection, migration.bid(r), 'Opening balance not migrated (decision C: 0)', r.data ->> 'opening');
    end if;
  end loop;

  -- The owner (receives "paid by the owner" claims and drawings).
  if not exists (select 1 from public.parties where company_id = p_company and is_owner) then
    insert into public.parties (company_id, primary_kind, name_en, name_ar, notes)
    values (p_company, 'owner', 'Owner', 'المالك', 'Created by the migration for owner drawings and payments the owner made for the company');
  end if;

  -- Projects
  for r in select * from legacy.es_records
            where company_id = p_company and collection = 'projects' and data <> '{}' order by deleted desc, record_id loop
    insert into public.projects (company_id, legacy_id, name_en, name_ar, customer_id, status, budget_amount, budget_currency, description)
    values (p_company, migration.bid(r),
            coalesce(migration.t(r.data, 'nameEn'), migration.t(r.data, 'name'), migration.bid(r)),
            migration.t(r.data, 'nameAr'),
            migration.party(p_company, migration.t(r.data, 'customerId')),
            case when r.deleted or lower(coalesce(r.data ->> 'status', '')) in ('closed', 'completed', 'done') then 'closed' else 'active' end::public.project_status,
            nullif(migration.num(r.data ->> 'budget'), 0), case when coalesce(migration.num(r.data ->> 'budget'), 0) > 0 then 'USD' end,
            concat_ws(E'\n', migration.t(r.data, 'notes'), 'Type in old app: ' || migration.t(r.data, 'kind')))
    returning id into v_id;
    insert into migration.map (collection, legacy_id, target_table, target_id, outcome, note)
    values ('projects', r.record_id, 'projects', v_id, 'master', case when r.deleted then 'closed (deleted in old app)' end);
  end loop;

  -- Items
  for r in select * from legacy.es_records
            where company_id = p_company and collection = 'items' and data <> '{}' order by deleted desc, record_id loop
    insert into public.items (company_id, legacy_id, name_en, name_ar, kind, unit, is_asset, life_years,
                              default_expense_account_id, default_revenue_account_id,
                              last_cost, last_cost_currency, last_sale_price, last_sale_currency, is_active)
    values (p_company, migration.bid(r),
            coalesce(migration.t(r.data, 'nameEn'), migration.t(r.data, 'nameAr'), migration.bid(r)), migration.t(r.data, 'nameAr'),
            case when lower(coalesce(r.data ->> 'kind', '')) = 'goods' then 'goods' else 'service' end::public.item_kind,
            coalesce(migration.t(r.data, 'unit'), 'ea'),
            lower(coalesce(r.data ->> 'isAsset', '')) in ('yes', 'true') and coalesce(migration.num(r.data ->> 'lifeYears'), 0) > 0,
            case when lower(coalesce(r.data ->> 'isAsset', '')) in ('yes', 'true') then nullif(migration.num(r.data ->> 'lifeYears'), 0) end,
            migration.gl(p_company, case when lower(coalesce(r.data ->> 'kind', '')) = 'goods' then '5200' else '5900' end),
            migration.gl(p_company, case when lower(coalesce(r.data ->> 'kind', '')) = 'goods' then '4500' else '4100' end),
            nullif(migration.num(r.data ->> 'costPrice'), 0),
            case when coalesce(migration.num(r.data ->> 'costPrice'), 0) > 0 then coalesce(migration.t(r.data, 'currency'), 'USD') end,
            nullif(migration.num(r.data ->> 'salePrice'), 0),
            case when coalesce(migration.num(r.data ->> 'salePrice'), 0) > 0 then coalesce(migration.t(r.data, 'currency'), 'USD') end,
            not r.deleted)
    returning id into v_id;
    insert into migration.map (collection, legacy_id, target_table, target_id, outcome) values ('items', r.record_id, 'items', v_id, 'master');
    if lower(coalesce(r.data ->> 'isAsset', '')) in ('yes', 'true') and coalesce(migration.num(r.data ->> 'lifeYears'), 0) <= 0 then
      perform migration.note(p_company, 'items', migration.bid(r), 'Marked as an asset without a useful life: imported as a normal item');
    end if;
  end loop;

  -- Generic service item for old invoices without an item.
  insert into public.items (company_id, legacy_id, name_en, name_ar, kind, unit, default_revenue_account_id, default_expense_account_id)
  values (p_company, 'MIGRATION-SERVICE', 'Services (old invoices)', 'خدمات (فواتير قديمة)', 'service', 'job',
          migration.gl(p_company, '4100'), migration.gl(p_company, '5900'));

  -- Money accounts (not the receivable placeholders, not the owner's personal account).
  for r in select * from legacy.es_records
            where company_id = p_company and collection = 'accounts' and data <> '{}' order by deleted desc, record_id loop
    v_treat := migration.account_treatment(p_company, migration.bid(r));
    if v_treat <> 'money' then
      insert into migration.map (collection, legacy_id, target_table, outcome, note)
      values ('accounts', r.record_id, null, 'skipped',
              case v_treat when 'receivable' then 'Receivable placeholder (decision D): invoices go to accounts receivable'
                           else 'Owner''s personal account (decision F): payments from it = paid by the owner' end);
      continue;
    end if;
    v_kind := coalesce((select kind from migration.account_rules where legacy_id = migration.bid(r)),
      case lower(coalesce(r.data ->> 'kind', ''))
        when 'cash' then 'cash' when 'card' then 'card'
        else case when coalesce(r.data ->> 'bank', '') ~* '(qut|qoat|rok|tamk)' then 'exchange' else 'bank' end
      end::public.money_account_kind);
    v_used := exists (select 1 from legacy.es_records t where t.company_id = p_company and t.collection = 'transactions'
                        and not t.deleted and t.data ->> 'accountId' = migration.bid(r));
    insert into public.money_accounts (company_id, legacy_id, name_en, name_ar, kind, currency, bank_name, account_no, notes, is_active)
    values (p_company, migration.bid(r), coalesce(migration.t(r.data, 'nameEn'), migration.bid(r)), migration.t(r.data, 'nameAr'), v_kind,
            coalesce(migration.t(r.data, 'currency'), 'USD'), migration.t(r.data, 'bank'), migration.t(r.data, 'number'),
            migration.t(r.data, 'notes'), not r.deleted or v_used)
    returning id into v_id;
    insert into migration.map (collection, legacy_id, target_table, target_id, outcome) values ('accounts', r.record_id, 'money_accounts', v_id, 'master');
    if coalesce(migration.num(r.data ->> 'opening'), 0) <> 0 then
      perform migration.note(p_company, 'accounts', migration.bid(r), 'Opening balance not migrated (decision C: 0)', r.data ->> 'opening');
    end if;
  end loop;

  -- Collections that have no place in the new app are listed, not imported.
  insert into migration.map (collection, legacy_id, outcome, note)
  select collection, record_id, 'skipped',
         case collection
           when 'categories' then 'Mapped to GL accounts (migration.category_map)'
           when 'users' then 'Users are re-invited; passwords are not migrated'
           when 'audit' then 'Old audit trail kept in the old database'
           when 'assets' then 'Re-registered from the asset purchase in the new app (listed for review)'
           else 'Not migrated' end
    from legacy.es_records
   where company_id = p_company and data <> '{}'
     and collection not in ('customers', 'suppliers', 'employees', 'projects', 'items', 'accounts', 'transactions');
  insert into migration.exceptions (collection, legacy_id, problem, detail)
  select 'assets', coalesce(data ->> 'id', record_id), 'Fixed asset in old app: check it is registered in the new asset register',
         concat_ws(' / ', data ->> 'nameEn', data ->> 'cost', data ->> 'acquiredOn', data ->> 'sourceTx')
    from legacy.es_records where company_id = p_company and collection = 'assets' and data <> '{}' and not deleted;
end $$;

-- ---------------------------------------------------------------------------
-- One old transaction (not transfers)
-- ---------------------------------------------------------------------------
create or replace function migration.migrate_transaction(p_company uuid, r legacy.es_records) returns void
language plpgsql as $$
declare
  d       jsonb := r.data;
  t       text := upper(d ->> 'type');
  v       numeric := migration.val(r.data);
  v_treat text := migration.account_treatment(p_company, migration.t(r.data, 'accountId'));
  v_money uuid := case when migration.account_treatment(p_company, migration.t(r.data, 'accountId')) = 'money'
                       then migration.money_account(p_company, migration.t(r.data, 'accountId')) end;
  v_sup   uuid := migration.party(p_company, migration.t(r.data, 'supplierId'));
  v_cus   uuid := migration.party(p_company, migration.t(r.data, 'customerId'));
  v_emp   uuid := migration.party(p_company, migration.t(r.data, 'employeeId'));
  v_owner uuid := (select id from public.parties where company_id = p_company and is_owner order by created_at limit 1);
  v_item  uuid := (select id from public.items where company_id = p_company and legacy_id = migration.t(r.data, 'itemId')
                   order by is_active desc limit 1);
  v_against text := migration.t(r.data, 'againstRef');
  v_ag_doc  uuid := migration.doc_of(migration.t(r.data, 'againstRef'));
  v_ag_kind public.doc_kind;
  v_doc   uuid;
  v_bill  uuid;
  v_out   text;
  v_note  text;
  v_disc  numeric := coalesce(migration.num(r.data ->> 'discount'), 0);
begin
  select kind into v_ag_kind from public.documents where id = v_ag_doc;

  if v is null and migration.is_done(d) then
    perform migration.note(p_company, 'transactions', coalesce(d ->> 'id', r.record_id), 'No amount in the old record: left as a draft');
  end if;
  if v_treat = 'receivable' and t <> 'INVOICE OUT' then
    v_note := 'Old account was the INV receivable placeholder: check this record';
    perform migration.note(p_company, 'transactions', coalesce(d ->> 'id', r.record_id), v_note, d ->> 'accountId');
  end if;

  if t in ('EXPENSE', 'EXPENSE CLAIM')
     or (t = 'PAYMENT OUT' and v_money is null and v_treat is distinct from 'receivable')
     or (t = 'SALARY' and v_treat = 'owner_personal') then
    if t = 'EXPENSE' and v_money is not null then
      v_doc := migration.new_doc(p_company, 'expense', d, v, v_money, coalesce(v_sup, v_emp, v_cus));
      v_note := coalesce(v_note, 'Expense paid by the company');
    else
      -- Paid personally: by the employee (decision B: still owed to them) or by the owner (decision F).
      v_doc := migration.new_doc(p_company, 'expense_claim', d, v, null,
                 case when v_treat = 'owner_personal' then v_owner else coalesce(v_emp, v_owner) end);
      v_note := coalesce(v_note, case when v_treat = 'owner_personal' or v_emp is null then 'Paid by the owner for the company (2200)'
                                      else 'Employee claim (paid personally, not yet reimbursed)' end);
    end if;
    perform migration.add_line(v_doc, d, v,
      migration.expense_account(p_company, d, case when t = 'SALARY' then '6100' when t = 'PAYMENT OUT' and migration.t(d, 'projectId') is not null then '5900' else '6990' end),
      v_item);

  elsif t = 'PAYMENT OUT' then
    if v_ag_kind = 'expense_claim' then
      v_doc := migration.new_doc(p_company, 'claim_reimbursement', d, v, v_money,
                 (select party_id from public.documents where id = v_ag_doc));
      perform migration.add_link(v_doc, v_ag_doc, v);
      v_note := 'Reimbursement of ' || v_against;
    elsif migration.t(d, 'categoryId') = 'CAT-0002' and v_emp is not null then
      v_doc := migration.new_doc(p_company, 'salary', d, v, v_money, v_emp);
      perform migration.add_line(v_doc, d, v, migration.gl(p_company, '6100'));
      v_note := 'Salary payment';
    elsif v_sup is not null and v_item is not null then
      -- Supplier bill + its payment the same day, so the item catalogue and payables stay right.
      v_bill := migration.new_doc(p_company, 'supplier_bill', d, v, null, v_sup);
      perform migration.add_line(v_bill, d, v + v_disc, null, v_item);
      if v_disc > 0 then perform migration.add_line(v_bill, d - 'qty' - 'unitPrice', v_disc, null, null, 'discount'); end if;
      v_out := migration.finish(v_bill, d, r.deleted);
      insert into migration.map (collection, legacy_id, target_table, target_id, outcome, note)
      values ('transactions', r.record_id, 'documents', v_bill, v_out, 'Supplier bill for the payment');
      v_doc := migration.new_doc(p_company, 'supplier_payment', d, v, v_money, v_sup);
      if v_out = 'posted' then perform migration.add_link(v_doc, v_bill, v); end if;
      v_note := 'Supplier payment';
    elsif v_sup is not null then
      v_doc := migration.new_doc(p_company, 'expense', d, v, v_money, v_sup);
      perform migration.add_line(v_doc, d, v,
        migration.expense_account(p_company, d, case when migration.t(d, 'projectId') is not null then '5900' else '6990' end), v_item);
      v_note := 'Payment to a supplier without a bill: recorded as an expense';
    elsif v_emp is not null then
      -- Decision B: employees paid personally and the company paid them back.
      v_doc := migration.new_doc(p_company, 'claim_reimbursement', d, v, v_money, v_emp);
      v_note := 'Paid back to the employee (no claim linked in the old app)';
      perform migration.note(p_company, 'transactions', coalesce(d ->> 'id', r.record_id), 'Employee payment without a linked claim: check the employee balance');
    else
      v_doc := migration.new_doc(p_company, 'expense', d, v, v_money, v_cus);
      perform migration.add_line(v_doc, d, v, migration.expense_account(p_company, d, '6990'), v_item);
      v_note := 'Payment without a party: recorded as an expense';
    end if;

  elsif t = 'SALARY' then
    if v_emp is null then
      v_doc := migration.new_doc(p_company, 'expense', d, v, v_money, null);
      perform migration.note(p_company, 'transactions', coalesce(d ->> 'id', r.record_id), 'Salary without an employee: recorded as an expense on 6100');
    else
      v_doc := migration.new_doc(p_company, 'salary', d, v, v_money, v_emp);
    end if;
    perform migration.add_line(v_doc, d, v, migration.expense_account(p_company, d, '6100'));
    v_note := coalesce(v_note, case when v_money is null then 'Salary owed (not paid from an account)' else 'Salary paid' end);

  elsif t = 'INVOICE OUT' then
    v_doc := migration.new_doc(p_company, 'sales_invoice', d, v, null, v_cus);
    perform migration.add_line(v_doc, d, v + v_disc,
      migration.gl(p_company, coalesce((select gl_code from migration.project_revenue where legacy_id = migration.t(d, 'projectId')), '4100')),
      coalesce(v_item, (select id from public.items where company_id = p_company and legacy_id = 'MIGRATION-SERVICE')));
    if v_disc > 0 then perform migration.add_line(v_doc, d - 'qty' - 'unitPrice', v_disc, null, null, 'discount'); end if;
    v_note := 'Sales invoice (to accounts receivable)';

  elsif t = 'RECEIPT' then
    v_doc := migration.new_doc(p_company, 'customer_receipt', d, v, v_money, v_cus);
    if v_ag_kind = 'sales_invoice' then
      perform migration.add_link(v_doc, v_ag_doc, v);
    elsif migration.is_done(d) and v_cus is not null then
      -- Same customer, currency and amount: the oldest open invoice.
      perform migration.add_link(v_doc, (
        select b.id from public.v_document_balances b join public.documents i on i.id = b.id
         where b.company_id = p_company and b.kind = 'sales_invoice' and b.party_id = v_cus
           and b.currency = (select currency from public.documents where id = v_doc) and b.open_amount = v
           and i.doc_date <= (d ->> 'date')::date
         order by i.doc_date limit 1), v);
    end if;
    v_note := 'Customer receipt';

  elsif t = 'OWNER DRAWINGS' then
    if v_treat = 'owner_personal' then
      insert into migration.map (collection, legacy_id, outcome, note)
      values ('transactions', r.record_id, 'skipped', 'Drawing from the owner''s personal account: no effect on the company');
      return;
    end if;
    v_doc := migration.new_doc(p_company, 'owner_drawings', d, v, v_money, v_owner);
    v_note := 'Owner drawings';

  elsif t = 'ADVANCE TO EMPLOYEE' then
    v_doc := migration.new_doc(p_company, 'employee_advance', d, v, v_money, v_emp);
    v_note := 'Advance to employee';

  elsif t = 'LOAN IN' and v_ag_kind = 'employee_advance' then
    -- Decision E: the employee paid the advance back.
    v_doc := migration.new_doc(p_company, 'advance_repayment', d, v, v_money,
               (select party_id from public.documents where id = v_ag_doc));
    perform migration.add_link(v_doc, v_ag_doc, v);
    v_note := 'Repayment of advance ' || v_against;

  elsif t = 'DEPOSIT PAID' then
    if v_sup is not null then
      v_doc := migration.new_doc(p_company, 'supplier_payment', d, v, v_money, v_sup);
      perform app.begin_internal();
      update public.documents set purpose = 'deposit' where id = v_doc;
    else
      v_doc := migration.new_doc(p_company, 'expense', d, v, v_money, v_cus);
      perform migration.add_line(v_doc, d, v, migration.gl(p_company, '1260'));
    end if;
    v_note := 'Deposit / guarantee paid (1260)';

  elsif t = 'REFUND TO CUSTOMER' and v_money is not null then
    v_doc := migration.new_doc(p_company, 'refund_to_customer', d, v, v_money, v_cus);
    v_note := 'Refund to customer';

  elsif t in ('SALES RETURN', 'REFUND TO CUSTOMER') then
    -- Reduces what the customer owes: a credit note against the invoice.
    v_doc := migration.new_doc(p_company, 'credit_note', d, v, null, v_cus);
    perform migration.add_line(v_doc, d, v, null,
      coalesce(v_item, (select id from public.items where company_id = p_company and legacy_id = 'MIGRATION-SERVICE')));
    if v_ag_kind = 'sales_invoice' then
      perform app.begin_internal();
      update public.documents set source_document_id = v_ag_doc where id = v_doc;
    end if;
    v_note := 'Credit note (sales return)';

  elsif t = 'REFUND FROM SUPPLIER' then
    v_doc := migration.new_doc(p_company, 'refund_from_supplier', d, v, v_money, v_sup);
    v_note := 'Refund from supplier';

  else
    insert into migration.map (collection, legacy_id, outcome, note)
    values ('transactions', r.record_id, 'exception', 'No rule for type ' || coalesce(t, '(none)'));
    perform migration.note(p_company, 'transactions', coalesce(d ->> 'id', r.record_id), 'No rule for this type', t);
    return;
  end if;

  if v_money is null and v_treat = 'money' then
    perform migration.note(p_company, 'transactions', coalesce(d ->> 'id', r.record_id), 'Old account not found', d ->> 'accountId');
  end if;
  perform migration.add_attachments(p_company, v_doc, d);
  v_out := migration.finish(v_doc, d, r.deleted);
  insert into migration.map (collection, legacy_id, target_table, target_id, outcome, note)
  values ('transactions', r.record_id, 'documents', v_doc, v_out, v_note);
end $$;

-- ---------------------------------------------------------------------------
-- Transfers: TRANSFER OUT + TRANSFER IN (paired by againstRef) = one transfer
-- ---------------------------------------------------------------------------
create or replace function migration.migrate_transfers(p_company uuid) returns void
language plpgsql as $$
declare
  o legacy.es_records;
  i legacy.es_records;
  v_doc uuid;
  v_out text;
  v_from uuid; v_to uuid;
begin
  for o in select * from legacy.es_records
            where company_id = p_company and collection = 'transactions' and data <> '{}'
              and upper(data ->> 'type') = 'TRANSFER OUT'
            order by data ->> 'date', record_id loop
    select * into i from legacy.es_records x
     where x.company_id = p_company and x.collection = 'transactions' and upper(x.data ->> 'type') = 'TRANSFER IN'
       and (x.data ->> 'againstRef' = o.data ->> 'id' or o.data ->> 'againstRef' = x.data ->> 'id')
       and x.deleted = o.deleted
       and not exists (select 1 from migration.map m where m.collection = 'transactions' and m.legacy_id = x.record_id)
     order by x.record_id limit 1;
    if i.record_id is null then
      continue;   -- unpaired: listed below
    end if;
    v_from := migration.money_account(p_company, migration.t(o.data, 'accountId'));
    v_to   := migration.money_account(p_company, migration.t(i.data, 'accountId'));
    -- Out of and back into the same account: no movement.
    if o.data ->> 'accountId' = i.data ->> 'accountId' then
      insert into migration.map (collection, legacy_id, outcome, note) values
        ('transactions', o.record_id, 'skipped', 'Transfer out of and into the same account: no movement'),
        ('transactions', i.record_id, 'skipped', 'Transfer out of and into the same account: no movement');
      i := null;
      continue;
    end if;
    -- Company money sent to the owner's personal account (decision F): the company pays back what the owner
    -- paid for it, owner current account 2200.
    if migration.account_treatment(p_company, migration.t(i.data, 'accountId')) = 'owner_personal' then
      begin
        v_doc := migration.new_doc(p_company, 'claim_reimbursement', o.data, migration.val(o.data), v_from,
                   (select id from public.parties where company_id = p_company and is_owner order by created_at limit 1));
        perform migration.add_attachments(p_company, v_doc, o.data);
        perform migration.add_attachments(p_company, v_doc, i.data);
        v_out := migration.finish(v_doc, case when migration.is_done(i.data) then o.data else o.data || '{"status":"Draft"}' end, o.deleted);
        insert into migration.map (collection, legacy_id, target_table, target_id, outcome, note) values
          ('transactions', o.record_id, 'documents', v_doc, v_out, 'Paid to the owner''s personal account (2200)'),
          ('transactions', i.record_id, 'documents', v_doc, v_out, 'Received in the owner''s personal account');
      exception when others then
        insert into migration.map (collection, legacy_id, outcome, note) values
          ('transactions', o.record_id, 'exception', sqlerrm), ('transactions', i.record_id, 'exception', sqlerrm);
        perform migration.note(p_company, 'transactions', migration.bid(o), 'Transfer could not be created', sqlerrm);
      end;
      i := null;
      continue;
    end if;
    begin
      v_doc := migration.new_doc(p_company, 'transfer', o.data, migration.val(o.data), v_from, null);
      perform app.begin_internal();
      update public.documents
         set counter_money_account_id = v_to,
             counter_amount = migration.val(i.data),
             counter_rate = app.rate_on(p_company, (select currency from public.money_accounts where id = v_to), (o.data ->> 'date')::date),
             notes = notes || E'\nReceiving leg: ' || migration.bid(i) || coalesce(' (' || migration.t(i.data, 'notes') || ')', '')
       where id = v_doc;
      perform migration.add_attachments(p_company, v_doc, o.data);
      perform migration.add_attachments(p_company, v_doc, i.data);
      -- Post only when both legs were completed in the old app.
      v_out := migration.finish(v_doc, case when migration.is_done(i.data) then o.data else o.data || '{"status":"Draft"}' end, o.deleted);
      insert into migration.map (collection, legacy_id, target_table, target_id, outcome, note) values
        ('transactions', o.record_id, 'documents', v_doc, v_out, 'Transfer (sending leg), with ' || migration.bid(i)),
        ('transactions', i.record_id, 'documents', v_doc, v_out, 'Transfer (receiving leg), with ' || migration.bid(o));
    exception when others then
      insert into migration.map (collection, legacy_id, outcome, note) values
        ('transactions', o.record_id, 'exception', sqlerrm), ('transactions', i.record_id, 'exception', sqlerrm);
      perform migration.note(p_company, 'transactions', migration.bid(o), 'Transfer could not be created', sqlerrm);
    end;
    i := null;
  end loop;

  -- Unpaired legs.
  insert into migration.map (collection, legacy_id, outcome, note)
  select 'transactions', record_id, 'exception', 'Unpaired ' || lower(data ->> 'type') || ': enter the other side by hand'
    from legacy.es_records x
   where company_id = p_company and collection = 'transactions' and data <> '{}'
     and upper(data ->> 'type') in ('TRANSFER OUT', 'TRANSFER IN')
     and not exists (select 1 from migration.map m where m.collection = 'transactions' and m.legacy_id = x.record_id);
  insert into migration.exceptions (collection, legacy_id, problem, detail)
  select 'transactions', old_id, 'Unpaired transfer leg', null
    from migration.map where collection = 'transactions' and outcome = 'exception' and note like 'Unpaired%';
end $$;

-- ---------------------------------------------------------------------------
-- The job
-- ---------------------------------------------------------------------------
create or replace function migration.run(p_company uuid, p_actor uuid) returns table (outcome text, n bigint)
language plpgsql as $$
declare
  r legacy.es_records;
  v_threshold jsonb;
begin
  if exists (select 1 from public.documents where company_id = p_company and migrated) then
    raise exception 'This company already holds migrated documents: run the migration on a fresh database';
  end if;
  if not exists (select 1 from public.user_roles where company_id = p_company and user_id = p_actor and role_code = 'owner') then
    raise exception 'The migration runs as an owner of the company';
  end if;
  truncate migration.map, migration.exceptions;

  -- Act as the owner (with MFA), so every posting is checked and logged like a real one.
  perform set_config('request.jwt.claims', json_build_object('sub', p_actor, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  -- Old records were already approved in the old app: no new approval round for them.
  select settings -> 'approval_threshold_usd' into v_threshold from public.companies where id = p_company;
  update public.companies set settings = settings - 'approval_threshold_usd' where id = p_company;
  -- Periods for every year in the old data.
  perform app.ensure_periods(p_company, y)
     from (select distinct extract(year from (data ->> 'date')::date)::int y from legacy.es_records
            where company_id = p_company and collection = 'transactions' and data ->> 'date' ~ '^\d{4}-\d{2}-\d{2}$') years;

  perform migration.migrate_masters(p_company);

  -- Empty tombstones: listed only.
  insert into migration.map (collection, legacy_id, outcome, note)
  select 'transactions', record_id, 'skipped', 'Empty record (deleted in the old app)'
    from legacy.es_records where company_id = p_company and collection = 'transactions' and data = '{}';

  -- Documents that others settle come first, then the rest, by date.
  for r in select * from legacy.es_records x
            where company_id = p_company and collection = 'transactions' and data <> '{}'
              and upper(data ->> 'type') not in ('TRANSFER OUT', 'TRANSFER IN')
            order by case when upper(data ->> 'type') in ('INVOICE OUT', 'EXPENSE CLAIM', 'ADVANCE TO EMPLOYEE') then 0 else 1 end,
                     data ->> 'date', record_id loop
    begin
      perform migration.migrate_transaction(p_company, r);
    exception when others then
      insert into migration.map (collection, legacy_id, outcome, note) values ('transactions', r.record_id, 'exception', sqlerrm);
      perform migration.note(p_company, 'transactions', migration.bid(r), 'Could not be migrated', sqlerrm);
    end;
  end loop;

  perform migration.migrate_transfers(p_company);

  update public.companies set settings = case when v_threshold is null then settings
                                              else jsonb_set(settings, '{approval_threshold_usd}', v_threshold) end
   where id = p_company;
  perform app.log_event(p_company, 'migration', p_company::text,
    format('Old app migrated: %s documents', (select count(distinct target_id) from migration.map where target_table = 'documents')));

  return query select m.outcome, count(*) from migration.map m group by m.outcome order by 1;
end $$;

-- ---------------------------------------------------------------------------
-- Reconciliation (the acceptance test)
-- ---------------------------------------------------------------------------

-- Every old record has exactly one line per resulting document, or one outcome.
create or replace view migration.recon_counts as
select coalesce(upper(r.data ->> 'type'), '(empty)') as old_type,
       count(distinct r.record_id) as old_records,
       count(distinct r.record_id) filter (where m.outcome = 'posted')    as posted,
       count(distinct r.record_id) filter (where m.outcome = 'draft')     as draft,
       count(distinct r.record_id) filter (where m.outcome = 'void')      as void,
       count(distinct r.record_id) filter (where m.outcome = 'skipped')   as skipped,
       count(distinct r.record_id) filter (where m.outcome = 'exception') as exception,
       count(distinct r.record_id) filter (where m.id is null)            as missing
from legacy.es_records r
left join migration.map m on m.collection = 'transactions' and m.legacy_id = r.record_id
where r.collection = 'transactions'
group by 1;

-- Money: old completed movements per account vs the new ledger, in the account's currency.
create or replace view migration.recon_money as
with old as (
  select r.company_id, r.data ->> 'accountId' as legacy_id,
         sum(case when upper(r.data ->> 'type') in ('RECEIPT', 'TRANSFER IN', 'LOAN IN', 'REFUND FROM SUPPLIER')
                  then migration.val(r.data) else -migration.val(r.data) end) as old_net,
         count(*) as old_records
    from legacy.es_records r
   where r.collection = 'transactions' and r.data <> '{}' and not r.deleted and migration.is_done(r.data)
     and upper(r.data ->> 'type') not in ('INVOICE OUT', 'EXPENSE CLAIM', 'SALES RETURN')
   group by 1, 2
)
select ma.legacy_id, ma.name_en, ma.currency,
       coalesce(o.old_records, 0) as old_records,
       coalesce(o.old_net, 0)::numeric(18, 2) as old_net,
       b.balance as new_balance,
       (b.balance - coalesce(o.old_net, 0))::numeric(18, 2) as difference
from public.money_accounts ma
join public.v_money_account_balances b on b.id = ma.id
left join old o on o.company_id = ma.company_id and o.legacy_id = ma.legacy_id
where ma.legacy_id is not null;

-- Why an account differs: the old records behind it that are not posted in the new ledger.
create or replace view migration.recon_money_open_items as
select r.data ->> 'accountId' as account, m.old_id as record_id, upper(r.data ->> 'type') as old_type, r.data ->> 'date' as date,
       migration.val(r.data) as amount, m.outcome, m.note
from legacy.es_records r
join migration.map m on m.collection = 'transactions' and m.legacy_id = r.record_id
where r.collection = 'transactions' and r.data <> '{}' and not r.deleted and migration.is_done(r.data)
  and m.outcome <> 'posted' and upper(r.data ->> 'type') not in ('INVOICE OUT', 'EXPENSE CLAIM', 'SALES RETURN');

-- Projects: old completed revenue and cost per project and currency vs the new ledger.
create or replace view migration.recon_projects as
with old as (
  select r.data ->> 'projectId' as legacy_id, r.data ->> 'currency' as currency,
         sum(round(migration.val(r.data), 2)) filter (where upper(r.data ->> 'type') = 'INVOICE OUT') as old_revenue,
         sum(round(migration.val(r.data), 2)) filter (where upper(r.data ->> 'type') in ('EXPENSE', 'EXPENSE CLAIM', 'SALARY')
                                              or (upper(r.data ->> 'type') = 'PAYMENT OUT' and r.data ->> 'supplierId' <> '')) as old_cost
    from legacy.es_records r
   where r.collection = 'transactions' and r.data <> '{}' and not r.deleted and migration.is_done(r.data)
     and coalesce(r.data ->> 'projectId', '') <> ''
   group by 1, 2
), new as (
  select p.legacy_id, jl.txn_currency as currency,
         sum(jl.txn_amount) filter (where g.account_type = 'income' and jl.credit > 0) as new_revenue,
         sum(jl.txn_amount) filter (where g.account_type = 'expense' and jl.debit > 0) as new_cost
    from public.journal_lines jl
    join public.projects p on p.id = jl.project_id
    join public.gl_accounts g on g.id = jl.account_id
   where p.legacy_id is not null
   group by 1, 2
)
select coalesce(o.legacy_id, n.legacy_id) as project, coalesce(o.currency, n.currency) as currency,
       coalesce(o.old_revenue, 0) as old_revenue, coalesce(n.new_revenue, 0) as new_revenue,
       coalesce(o.old_cost, 0) as old_cost, coalesce(n.new_cost, 0) as new_cost
from old o full join new n on n.legacy_id = o.legacy_id and n.currency = o.currency;

-- Attachments: every old file reference has a row in the new app (the copy script fills the hash).
create or replace view migration.recon_attachments as
select (select count(*) from legacy.es_records r, jsonb_array_elements(case when jsonb_typeof(r.data -> 'attachments') = 'array'
                                                                       then r.data -> 'attachments' else '[]' end) a
         where r.collection = 'transactions' and r.data <> '{}') as old_files,
       (select count(*) from public.attachments where storage_path ~ '/legacy(-copy)?/') as new_files,
       (select count(*) from public.attachments where storage_path ~ '/legacy(-copy)?/' and sha256 is null) as waiting_for_copy;
