-- ES-PF v2 · Migration 8: documents, lines, settlement links, attachments, approvals, journal.
-- Users create documents (business actions). Posting (migration 9) turns a document into a
-- balanced journal entry. Posted documents and journal entries are immutable.

create type public.doc_status as enum ('draft', 'submitted', 'posted', 'void');

create type public.doc_kind as enum (
  'expense',              -- paid now: Dr expense / project, Cr bank
  'supplier_payment',     -- Dr AP (or deposit), Cr bank
  'customer_receipt',     -- Dr bank, Cr AR
  'refund_to_customer',   -- Dr AR, Cr bank
  'refund_from_supplier', -- Dr bank, Cr AP
  'transfer',             -- Dr bank B, Cr bank A (+FX)
  'expense_claim',        -- Dr expense / project, Cr employee payable (or owner current account)
  'claim_reimbursement',  -- Dr employee payable, Cr bank (settles claims)
  'salary',               -- Dr salaries / project, Cr bank (or employee payable if unpaid)
  'employee_advance',     -- Dr employee advance (or drawings), Cr bank
  'advance_repayment',    -- Dr bank, Cr employee advance (settles advances)
  'employee_offset',      -- Dr employee payable, Cr employee advance (claims against advances)
  'owner_drawings',       -- Dr drawings, Cr bank
  'manual_journal'        -- accountant / owner only
);

-- How each kind behaves. The UI reads this too.
create table public.doc_kinds (
  kind              public.doc_kind primary key,
  number_type       text not null references public.document_types(code),
  direction         text not null check (direction in ('out', 'in', 'none', 'transfer')),
  has_lines         boolean not null,
  money_account     text not null check (money_account in ('required', 'optional', 'none')),
  party_role        text check (party_role in ('supplier', 'customer', 'employee', 'employee_or_owner', 'owner', 'any')),
  party_required    boolean not null default false,
  allows_fee        boolean not null default true,
  approval_applies  boolean not null default false,
  settles           public.doc_kind[] not null default '{}',
  post_permission   text not null references public.permissions(code),
  name_en           text not null,
  name_ar           text not null,
  sort              smallint not null
);

insert into public.doc_kinds
  (kind, number_type, direction, has_lines, money_account, party_role, party_required, allows_fee, approval_applies, settles, post_permission, name_en, name_ar, sort)
values
  ('expense',              'payment',       'out',      true,  'required', 'any',               false, true,  true,  '{}',                                        'docs.post_money', 'Expense (paid now)',        'مصروف (مدفوع الآن)',     10),
  ('supplier_payment',     'payment',       'out',      false, 'required', 'supplier',          true,  true,  true,  '{}',                                        'docs.post_money', 'Supplier payment',          'دفعة لمورد',             20),
  ('salary',               'payment',       'out',      true,  'optional', 'employee',          true,  true,  true,  '{}',                                        'docs.post_money', 'Salary / wage',             'راتب / أجر',             30),
  ('employee_advance',     'payment',       'out',      false, 'required', 'employee',          true,  true,  true,  '{}',                                        'docs.post_money', 'Advance to employee',       'سلفة لموظف',             40),
  ('claim_reimbursement',  'payment',       'out',      false, 'required', 'employee_or_owner', true,  true,  true,  '{expense_claim}',                           'docs.post_money', 'Claim reimbursement',       'سداد مطالبة',            50),
  ('owner_drawings',       'payment',       'out',      false, 'required', 'owner',             false, true,  false, '{}',                                        'docs.post_money', 'Owner drawings',            'مسحوبات المالك',         60),
  ('refund_to_customer',   'payment',       'out',      false, 'required', 'customer',          true,  true,  true,  '{}',                                        'docs.post_money', 'Refund to customer',        'رد مبلغ لعميل',          70),
  ('customer_receipt',     'receipt',       'in',       false, 'required', 'customer',          true,  true,  false, '{}',                                        'docs.post_money', 'Customer receipt',          'قبض من عميل',            80),
  ('refund_from_supplier', 'receipt',       'in',       false, 'required', 'supplier',          true,  true,  false, '{}',                                        'docs.post_money', 'Refund from supplier',      'استرداد من مورد',        90),
  ('advance_repayment',    'receipt',       'in',       false, 'required', 'employee',          true,  true,  false, '{employee_advance}',                        'docs.post_money', 'Advance repayment',         'سداد سلفة',             100),
  ('transfer',             'transfer',      'transfer', false, 'required', null,                false, true,  true,  '{}',                                        'docs.post_money', 'Transfer between accounts', 'تحويل بين الحسابات',    110),
  ('expense_claim',        'expense_claim', 'none',     true,  'none',     'employee_or_owner', true,  false, false, '{}',                                        'docs.post_money', 'Expense claim',             'مطالبة مصروفات',        120),
  ('employee_offset',      'journal',       'none',     false, 'none',     'employee',          true,  false, false, '{expense_claim,employee_advance}',          'docs.post_money', 'Offset claims against advance', 'مقاصة مطالبات مع سلفة', 130),
  ('manual_journal',       'journal',       'none',     true,  'none',     null,                false, false, false, '{}',                                        'journal.manual',  'Manual journal',            'قيد يدوي',              140);

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------
create table public.documents (
  id                        uuid primary key default gen_random_uuid(),
  company_id                uuid not null references public.companies(id),
  kind                      public.doc_kind not null,
  status                    public.doc_status not null default 'draft',
  number                    text,                         -- official number, set at posting
  temp_number               text not null default app.next_draft_number(),
  doc_date                  date not null default current_date,
  party_id                  uuid,
  money_account_id          uuid,
  counter_money_account_id  uuid,                         -- transfer destination
  currency                  char(3) not null references public.currencies(code),
  rate                      numeric(18, 6) not null check (rate > 0),     -- units of currency per USD
  amount                    numeric(18, 2) not null default 0 check (amount >= 0),
  counter_amount            numeric(18, 2) check (counter_amount is null or counter_amount > 0),
  counter_rate              numeric(18, 6) check (counter_rate is null or counter_rate > 0),
  fee_amount                numeric(18, 2) not null default 0 check (fee_amount >= 0),
  purpose                   text check (purpose in ('payable', 'deposit')),
  reference_no              text,
  description               text,
  notes                     text,
  no_document_reason        text,
  source                    text not null default 'manual' check (source in ('manual', 'ai', 'import', 'migration', 'recurring')),
  migrated                  boolean not null default false,
  legacy_id                 text,
  journal_entry_id          uuid,
  reversal_entry_id         uuid,
  submitted_at              timestamptz,
  submitted_by              uuid,
  posted_at                 timestamptz,
  posted_by                 uuid,
  voided_at                 timestamptz,
  voided_by                 uuid,
  void_reason               text,
  copied_from_id            uuid references public.documents(id),
  created_at                timestamptz not null default now(),
  created_by                uuid default auth.uid(),
  updated_at                timestamptz not null default now(),
  updated_by                uuid,
  unique (company_id, id),
  unique (company_id, number),
  foreign key (company_id, party_id)                 references public.parties(company_id, id),
  foreign key (company_id, money_account_id)         references public.money_accounts(company_id, id),
  foreign key (company_id, counter_money_account_id) references public.money_accounts(company_id, id),
  check (counter_money_account_id is null or counter_money_account_id <> money_account_id),
  check (status <> 'posted' or number is not null),
  check (status <> 'void' or void_reason is not null)
);
create index documents_company_date_idx on public.documents(company_id, doc_date desc);
create index documents_status_idx       on public.documents(company_id, status);
create index documents_party_idx        on public.documents(company_id, party_id);
create index documents_money_idx        on public.documents(company_id, money_account_id);
create index documents_legacy_idx       on public.documents(company_id, legacy_id);
create index documents_reference_idx    on public.documents(company_id, reference_no);

create table public.document_lines (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  document_id   uuid not null references public.documents(id) on delete cascade,
  line_no       smallint not null default 1,
  item_id       uuid,
  description   text,
  qty           numeric(18, 4) not null default 1 check (qty > 0),
  unit          text,
  unit_price    numeric(18, 4),
  amount        numeric(18, 2) not null check (amount > 0),
  side          char(1) not null default 'D' check (side in ('D', 'C')),   -- manual journals only
  gl_account_id uuid,
  project_id    uuid,
  party_id      uuid,
  is_asset      boolean not null default false,
  created_at    timestamptz not null default now(),
  foreign key (company_id, document_id)   references public.documents(company_id, id) on delete cascade,
  foreign key (company_id, item_id)       references public.items(company_id, id),
  foreign key (company_id, gl_account_id) references public.gl_accounts(company_id, id),
  foreign key (company_id, project_id)    references public.projects(company_id, id),
  foreign key (company_id, party_id)      references public.parties(company_id, id)
);
create index document_lines_doc_idx     on public.document_lines(document_id, line_no);
create index document_lines_project_idx on public.document_lines(company_id, project_id);

-- A settling document (reimbursement, repayment, offset; later payments/receipts) settles
-- part or all of a posted document. amount is in the settled document's currency.
create table public.document_links (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id),
  from_document_id uuid not null,
  to_document_id   uuid not null,
  kind             text not null default 'settles' check (kind in ('settles')),
  amount           numeric(18, 2) not null check (amount > 0),
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid(),
  unique (from_document_id, to_document_id),
  check (from_document_id <> to_document_id),
  foreign key (company_id, from_document_id) references public.documents(company_id, id) on delete cascade,
  foreign key (company_id, to_document_id)   references public.documents(company_id, id)
);
create index document_links_to_idx on public.document_links(to_document_id);

create table public.attachments (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  document_id   uuid not null,
  storage_path  text not null,
  file_name     text not null,
  mime_type     text,
  size_bytes    bigint check (size_bytes is null or size_bytes >= 0),
  sha256        char(64) check (sha256 ~ '^[0-9a-f]{64}$'),
  kind          text not null default 'upload' check (kind in ('upload', 'generated_pdf')),
  uploaded_by   uuid default auth.uid(),
  uploaded_at   timestamptz not null default now(),
  unique (company_id, storage_path),
  foreign key (company_id, document_id) references public.documents(company_id, id) on delete cascade
);
create index attachments_doc_idx on public.attachments(document_id);

create table public.approvals (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  document_id uuid not null,
  decision    text not null check (decision in ('approved', 'rejected')),
  note        text,
  decided_by  uuid not null default auth.uid(),
  decided_at  timestamptz not null default now(),
  foreign key (company_id, document_id) references public.documents(company_id, id)
);
create index approvals_doc_idx on public.approvals(document_id);

-- ---------------------------------------------------------------------------
-- Journal (written only by posting functions)
-- ---------------------------------------------------------------------------
create table public.journal_entries (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  document_id uuid not null,
  entry_date  date not null,
  period_id   uuid not null references public.fiscal_periods(id),
  kind        text not null check (kind in ('posting', 'reversal')),
  memo        text,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  unique (company_id, id),
  foreign key (company_id, document_id) references public.documents(company_id, id)
);
create index journal_entries_doc_idx  on public.journal_entries(document_id);
create index journal_entries_date_idx on public.journal_entries(company_id, entry_date);

alter table public.documents
  add foreign key (company_id, journal_entry_id)  references public.journal_entries(company_id, id),
  add foreign key (company_id, reversal_entry_id) references public.journal_entries(company_id, id);

create table public.journal_lines (
  id               bigint generated always as identity primary key,
  company_id       uuid not null references public.companies(id),
  entry_id         uuid not null,
  line_no          smallint not null,
  account_id       uuid not null,
  debit            numeric(18, 2) not null default 0 check (debit >= 0),
  credit           numeric(18, 2) not null default 0 check (credit >= 0),
  txn_currency     char(3) not null references public.currencies(code),
  txn_amount       numeric(18, 2) not null check (txn_amount >= 0),
  rate             numeric(18, 6) not null check (rate > 0),
  project_id       uuid,
  party_id         uuid,
  item_id          uuid,
  document_line_id uuid references public.document_lines(id),
  description      text,
  check (debit = 0 or credit = 0),
  check (debit > 0 or credit > 0 or txn_amount > 0),
  foreign key (company_id, entry_id)   references public.journal_entries(company_id, id),
  foreign key (company_id, account_id) references public.gl_accounts(company_id, id),
  foreign key (company_id, project_id) references public.projects(company_id, id),
  foreign key (company_id, party_id)   references public.parties(company_id, id),
  foreign key (company_id, item_id)    references public.items(company_id, id)
);
create index journal_lines_entry_idx   on public.journal_lines(entry_id);
create index journal_lines_account_idx on public.journal_lines(company_id, account_id);
create index journal_lines_project_idx on public.journal_lines(company_id, project_id);
create index journal_lines_party_idx   on public.journal_lines(company_id, party_id);

-- Every journal line must respect its account's rules.
create or replace function app.check_journal_line() returns trigger
language plpgsql set search_path = '' as $$
declare
  a public.gl_accounts;
begin
  select * into a from public.gl_accounts where id = new.account_id;
  if not a.is_postable then
    raise exception 'Account % % is a header account and cannot be posted to', a.code, a.name_en;
  end if;
  if a.requires_project and new.project_id is null then
    raise exception 'Account % % needs a project on every line', a.code, a.name_en;
  end if;
  if a.control_kind in ('ar', 'ap', 'employee_advance', 'employee_payable', 'owner', 'customer_advance', 'supplier_advance')
     and new.party_id is null then
    raise exception 'Account % % needs a party (customer / supplier / employee)', a.code, a.name_en;
  end if;
  return new;
end $$;
create trigger journal_lines_check before insert on public.journal_lines
  for each row execute function app.check_journal_line();

-- Balanced entries: checked at commit so all lines of an entry are in.
create or replace function app.check_entry_balanced() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_dr numeric; v_cr numeric; v_n int;
begin
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) into v_dr, v_cr, v_n
  from public.journal_lines where entry_id = new.entry_id;
  if v_dr <> v_cr then
    raise exception 'Journal entry % is not balanced: debit % vs credit %', new.entry_id, v_dr, v_cr;
  end if;
  if v_n < 2 then
    raise exception 'Journal entry % needs at least two lines', new.entry_id;
  end if;
  return null;
end $$;
create constraint trigger journal_lines_balanced after insert on public.journal_lines
  deferrable initially deferred for each row execute function app.check_entry_balanced();

-- Nothing in the journal can be changed or deleted, ever. Corrections are reversals.
create or replace function app.journal_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'The journal is immutable (% on %): reverse the document instead', tg_op, tg_table_name
    using errcode = '42501';
end $$;
create trigger journal_entries_immutable before update or delete on public.journal_entries
  for each row execute function app.journal_immutable();
create trigger journal_lines_immutable before update or delete on public.journal_lines
  for each row execute function app.journal_immutable();
create trigger journal_entries_no_truncate before truncate on public.journal_entries
  for each statement execute function app.journal_immutable();
create trigger journal_lines_no_truncate before truncate on public.journal_lines
  for each statement execute function app.journal_immutable();
