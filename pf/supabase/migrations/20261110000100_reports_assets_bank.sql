-- ES-PF v2 · Migration 13: financial statements, project P&L, bank book & reconciliation,
-- employee / owner balances, fixed-asset register with monthly depreciation.
-- All report functions are SECURITY INVOKER: the caller's RLS decides what they can see.

-- ---------------------------------------------------------------------------
-- Report helpers
-- ---------------------------------------------------------------------------
-- Start of the fiscal year that contains p_date.
create or replace function public.fiscal_year_start(p_company uuid, p_date date) returns date
language sql stable security invoker set search_path = '' as $$
  select case when extract(month from p_date) >= c.fiscal_year_start_month
              then make_date(extract(year from p_date)::int, c.fiscal_year_start_month, 1)
              else make_date(extract(year from p_date)::int - 1, c.fiscal_year_start_month, 1) end
  from public.companies c where c.id = p_company
$$;

-- General ledger: every line in the range with opening and running balance per account (USD).
create or replace function public.general_ledger(
  p_company uuid, p_from date, p_to date,
  p_account uuid default null, p_project uuid default null, p_party uuid default null)
returns table (account_id uuid, account_code text, account_name text, entry_date date, document_id uuid, number text,
               kind public.doc_kind, description text, project_code text, party_name text,
               txn_currency char(3), txn_amount numeric, debit numeric, credit numeric, balance numeric, is_opening boolean)
language sql stable security invoker set search_path = '' as $$
  with l as (
    select jl.*, je.entry_date, je.document_id
    from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id
    where jl.company_id = p_company and je.entry_date <= p_to
      and (p_account is null or jl.account_id = p_account)
      and (p_project is null or jl.project_id = p_project)
      and (p_party is null or jl.party_id = p_party)
  ), opening as (
    select account_id, sum(debit - credit) as bal from l where entry_date < p_from group by account_id
  ), rows as (
    select o.account_id, (p_from - 1) as entry_date, null::uuid as document_id, null::text as number, null::public.doc_kind as kind,
           'Opening balance' as description, null::text as project_code, null::text as party_name,
           null::char(3) as txn_currency, null::numeric as txn_amount, null::numeric as debit, null::numeric as credit,
           o.bal as delta, true as is_opening, 0::bigint as ord
    from opening o
    union all
    select l.account_id, l.entry_date, l.document_id, d.number, d.kind, coalesce(l.description, d.description),
           p.code, pa.name_en, l.txn_currency, l.txn_amount, l.debit, l.credit, l.debit - l.credit, false, l.id
    from l
    join public.documents d on d.id = l.document_id
    left join public.projects p on p.id = l.project_id
    left join public.parties pa on pa.id = l.party_id
    where l.entry_date >= p_from
  )
  select r.account_id, g.code, g.name_en, r.entry_date, r.document_id, r.number, r.kind, r.description, r.project_code, r.party_name,
         r.txn_currency, r.txn_amount, r.debit, r.credit,
         sum(r.delta) over (partition by r.account_id order by r.entry_date, r.ord) as balance, r.is_opening
  from rows r join public.gl_accounts g on g.id = r.account_id
  order by g.code, r.entry_date, r.ord
$$;

-- Profit or loss by account for a period and an optional comparative period.
-- amount: income positive, expenses negative (so the sum is the profit).
create or replace function public.profit_and_loss(p_company uuid, p_from date, p_to date,
                                                  p_cmp_from date default null, p_cmp_to date default null,
                                                  p_project uuid default null)
returns table (account_id uuid, code text, name_en text, name_ar text, account_type public.account_type,
               ifrs_line text, amount numeric, cmp_amount numeric)
language sql stable security invoker set search_path = '' as $$
  select g.id, g.code, g.name_en, g.name_ar, g.account_type, g.ifrs_line,
         coalesce(sum(jl.credit - jl.debit) filter (where je.entry_date between p_from and p_to), 0),
         coalesce(sum(jl.credit - jl.debit) filter (where p_cmp_from is not null and je.entry_date between p_cmp_from and p_cmp_to), 0)
  from public.gl_accounts g
  join public.journal_lines jl on jl.account_id = g.id
  join public.journal_entries je on je.id = jl.entry_id
  where g.company_id = p_company and g.account_type in ('income', 'expense')
    and (p_project is null or jl.project_id = p_project)
    and ((je.entry_date between p_from and p_to) or (p_cmp_from is not null and je.entry_date between p_cmp_from and p_cmp_to))
  group by g.id
  order by g.code
$$;

-- Monthly P&L for 12 months starting p_from (income positive, expense negative).
create or replace function public.profit_and_loss_monthly(p_company uuid, p_from date)
returns table (account_id uuid, code text, name_en text, name_ar text, account_type public.account_type, ifrs_line text,
               month date, amount numeric)
language sql stable security invoker set search_path = '' as $$
  select g.id, g.code, g.name_en, g.name_ar, g.account_type, g.ifrs_line, date_trunc('month', je.entry_date)::date,
         sum(jl.credit - jl.debit)
  from public.gl_accounts g
  join public.journal_lines jl on jl.account_id = g.id
  join public.journal_entries je on je.id = jl.entry_id
  where g.company_id = p_company and g.account_type in ('income', 'expense')
    and je.entry_date >= p_from and je.entry_date < (p_from + interval '12 months')
  group by g.id, date_trunc('month', je.entry_date)
  order by g.code, 7
$$;

-- Statement of financial position as at a date. There are no year-end closing entries: profit of
-- earlier fiscal years is shown in retained earnings and this year's profit on its own line.
create or replace function public.balance_sheet(p_company uuid, p_as_of date)
returns table (section text, ifrs_line text, account_id uuid, code text, name_en text, name_ar text, balance numeric)
language sql stable security invoker set search_path = '' as $$
  with fy as (select public.fiscal_year_start(p_company, p_as_of) as start),
  bal as (
    select g.id, g.code, g.name_en, g.name_ar, g.account_type, g.ifrs_line,
           coalesce(sum(jl.debit - jl.credit), 0) as dr_balance
    from public.gl_accounts g
    join public.journal_lines jl on jl.account_id = g.id
    join public.journal_entries je on je.id = jl.entry_id
    where g.company_id = p_company and je.entry_date <= p_as_of
    group by g.id
  ), pl as (
    select coalesce(sum(jl.credit - jl.debit) filter (where je.entry_date < (select start from fy)), 0) as prior,
           coalesce(sum(jl.credit - jl.debit) filter (where je.entry_date >= (select start from fy)), 0) as current
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.entry_id
    join public.gl_accounts g on g.id = jl.account_id
    where jl.company_id = p_company and je.entry_date <= p_as_of and g.account_type in ('income', 'expense')
  )
  select case account_type when 'asset' then 'assets' when 'liability' then 'liabilities' else 'equity' end,
         ifrs_line, id, code, name_en, name_ar,
         case when account_type = 'asset' then dr_balance else -dr_balance end
  from bal where account_type in ('asset', 'liability', 'equity') and dr_balance <> 0
  union all
  select 'equity', 'retained_earnings', null, null, 'Profit of earlier years', 'أرباح سنوات سابقة', prior from pl where prior <> 0
  union all
  select 'equity', 'profit_for_period', null, null, 'Profit for the year to date', 'ربح السنة حتى تاريخه', current from pl
  order by 1, 4 nulls last
$$;

-- Category of an account for the direct cash-flow statement.
create or replace function app.cash_flow_category(g public.gl_accounts) returns text
language sql immutable set search_path = '' as $$
  select case
    when g.control_kind in ('ar', 'customer_advance') or g.account_type = 'income' then 'Receipts from customers'
    when g.control_kind in ('employee_payable', 'employee_advance') or g.code = '6100' then 'Payments to and for employees'
    when g.code = '6900' then 'Bank and remittance charges'
    when g.code = '7000' then 'Exchange differences'
    when g.ifrs_line = 'property_plant_equipment' then 'Purchase of property and equipment'
    when g.control_kind = 'owner' or g.account_type = 'equity' then 'Owner contributions and drawings'
    when g.control_kind in ('ap', 'supplier_advance') or g.account_type = 'expense' then 'Payments to suppliers and for expenses'
    else 'Other operating cash flows'
  end
$$;

-- Statement of cash flows, direct method: every non-cash line of an entry that moves cash is the
-- other side of that movement, so the categories add up exactly to the change in cash.
-- A payment that settles supplier bills is looked through to what the bills bought, so paying for
-- equipment bought on credit shows as investing, not as an ordinary supplier payment.
create or replace function public.cash_flow(p_company uuid, p_from date, p_to date)
returns table (activity text, category text, amount numeric, sort smallint)
language sql stable security invoker set search_path = '' as $$
  with cash_entries as (
    select distinct jl.entry_id
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.entry_id
    join public.gl_accounts g on g.id = jl.account_id
    where jl.company_id = p_company and g.control_kind = 'bank' and je.entry_date between p_from and p_to
  ), lines as (
    select jl.credit - jl.debit as cash, g, g.control_kind, d.kind as doc_kind
    from public.journal_lines jl
    join cash_entries ce on ce.entry_id = jl.entry_id
    join public.journal_entries je on je.id = jl.entry_id
    join public.documents d on d.id = je.document_id
    join public.gl_accounts g on g.id = jl.account_id
    where g.control_kind is distinct from 'bank'
  ), settled as (       -- AP relieved by payments in the period, per bill (at the bill's rate, as posted)
    select b.id as bill_id, b.journal_entry_id, round(lk.amount / b.rate, 2) as usd
    from cash_entries ce
    join public.journal_entries je on je.id = ce.entry_id and je.kind = 'posting'
    join public.documents d on d.id = je.document_id and d.kind = 'supplier_payment'
    join public.document_links lk on lk.from_document_id = d.id
    join public.documents b on b.id = lk.to_document_id and b.kind = 'supplier_bill'
  ), bill_mix as (      -- what each bill bought, as shares of its total
    select s.bill_id, s.usd, g,
           (jl.debit - jl.credit) / nullif(sum(jl.debit - jl.credit) over (partition by s.bill_id, s.usd), 0) as share
    from settled s
    join public.journal_lines jl on jl.entry_id = s.journal_entry_id
    join public.gl_accounts g on g.id = jl.account_id
    where g.control_kind is distinct from 'ap'
  ), flows as (
    select app.cash_flow_category(g) as category, sum(cash) as amount
    from lines where not (coalesce(control_kind, '') = 'ap' and doc_kind = 'supplier_payment')   -- coalesce: a NULL here would drop the line
    group by 1
    union all
    select 'Payments to suppliers and for expenses',
           coalesce((select sum(cash) from lines where control_kind = 'ap' and doc_kind = 'supplier_payment'), 0)
           + coalesce((select sum(usd) from settled), 0)
    union all
    select app.cash_flow_category(g), -round(sum(usd * share), 2) from bill_mix group by 1
  ), totals as (
    select category, sum(amount) as amount from flows group by category
  ), cash as (
    select coalesce(sum(jl.debit - jl.credit) filter (where je.entry_date < p_from), 0) as opening,
           coalesce(sum(jl.debit - jl.credit), 0) as closing
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.entry_id
    join public.gl_accounts g on g.id = jl.account_id
    where jl.company_id = p_company and g.control_kind = 'bank' and je.entry_date <= p_to
  )
  select 'opening', 'Cash and cash equivalents at the beginning', opening, 0::smallint from cash
  union all
  select case when category = 'Purchase of property and equipment' then 'investing'
              when category = 'Owner contributions and drawings' then 'financing'
              else 'operating' end,
         category, amount,
         case when category = 'Purchase of property and equipment' then 20 when category = 'Owner contributions and drawings' then 30 else 10 end::smallint
  from totals where amount <> 0
  union all
  select 'closing', 'Cash and cash equivalents at the end', closing, 99::smallint from cash
  order by 4, 2
$$;

-- Statement of changes in equity (small company: capital, drawings, retained earnings, profit).
create or replace function public.changes_in_equity(p_company uuid, p_from date, p_to date)
returns table (component text, opening numeric, profit numeric, drawings numeric, other numeric, closing numeric)
language sql stable security invoker set search_path = '' as $$
  with l as (
    select g.code, g.account_type, je.entry_date, jl.credit - jl.debit as cr
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.entry_id
    join public.gl_accounts g on g.id = jl.account_id
    where jl.company_id = p_company and je.entry_date <= p_to and g.account_type in ('equity', 'income', 'expense')
  )
  select 'Share capital', coalesce(sum(cr) filter (where code = '3000' and entry_date < p_from), 0), 0, 0,
         coalesce(sum(cr) filter (where code = '3000' and entry_date >= p_from), 0), coalesce(sum(cr) filter (where code = '3000'), 0) from l
  union all
  select 'Retained earnings',
         coalesce(sum(cr) filter (where (code in ('3100', '3900') or account_type in ('income', 'expense')) and entry_date < p_from), 0),
         coalesce(sum(cr) filter (where account_type in ('income', 'expense') and entry_date >= p_from), 0), 0,
         coalesce(sum(cr) filter (where code in ('3100', '3900') and entry_date >= p_from), 0),
         coalesce(sum(cr) filter (where code in ('3100', '3900') or account_type in ('income', 'expense')), 0) from l
  union all
  select 'Owner drawings', coalesce(sum(cr) filter (where code = '3200' and entry_date < p_from), 0), 0,
         coalesce(sum(cr) filter (where code = '3200' and entry_date >= p_from), 0), 0, coalesce(sum(cr) filter (where code = '3200'), 0) from l
$$;

-- Project P&L with budget (budget converted to USD at the rate on the period end). Every project is listed.
create or replace function public.project_pl(p_company uuid, p_from date, p_to date)
returns table (project_id uuid, code text, name_en text, status public.project_status, revenue numeric, cost_of_sales numeric,
               operating_expenses numeric, margin numeric, margin_pct numeric, budget_usd numeric, budget_used_pct numeric)
language sql stable security invoker set search_path = '' as $$
  select p.id, p.code, p.name_en, p.status, x.revenue, x.cos, x.opex, x.revenue - x.cos - x.opex,
         case when x.revenue = 0 then null else round(100 * (x.revenue - x.cos - x.opex) / x.revenue, 1) end,
         b.budget_usd,
         case when coalesce(b.budget_usd, 0) = 0 then null else round(100 * (x.cos + x.opex) / b.budget_usd, 1) end
  from public.projects p
  cross join lateral (
    select coalesce(sum(jl.credit - jl.debit) filter (where g.account_type = 'income'), 0) as revenue,
           coalesce(sum(jl.debit - jl.credit) filter (where g.account_type = 'expense' and g.ifrs_line = 'cost_of_sales'), 0) as cos,
           coalesce(sum(jl.debit - jl.credit) filter (where g.account_type = 'expense' and g.ifrs_line <> 'cost_of_sales'), 0) as opex
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.entry_id
    join public.gl_accounts g on g.id = jl.account_id
    where jl.project_id = p.id and je.entry_date between p_from and p_to
  ) x
  cross join lateral (
    select case when p.budget_amount is null then null
                when p.budget_currency = 'USD' then p.budget_amount
                else round(p.budget_amount / nullif((select r.rate_per_usd from public.fx_rates r
                          where r.company_id = p.company_id and r.currency = p.budget_currency and r.rate_date <= p_to
                          order by r.rate_date desc limit 1), 0), 2) end as budget_usd
  ) b
  where p.company_id = p_company
  order by p.code
$$;

-- Employee and owner balances (advances, unpaid claims and salaries, owner current account), per currency.
create or replace function public.party_balances(p_company uuid, p_as_of date)
returns table (party_id uuid, party_code text, party_name text, account_code text, account_name text,
               currency char(3), balance numeric, balance_usd numeric)
language sql stable security invoker set search_path = '' as $$
  select pa.id, pa.code, pa.name_en, g.code, g.name_en, jl.txn_currency,
         sum(case when jl.credit > 0 then -jl.txn_amount else jl.txn_amount end),
         sum(jl.debit - jl.credit)
  from public.journal_lines jl
  join public.journal_entries je on je.id = jl.entry_id
  join public.gl_accounts g on g.id = jl.account_id
  join public.parties pa on pa.id = jl.party_id
  where jl.company_id = p_company and je.entry_date <= p_as_of
    and g.control_kind in ('employee_advance', 'employee_payable', 'owner')
  group by pa.id, g.code, g.name_en, jl.txn_currency
  having sum(jl.debit - jl.credit) <> 0 or sum(case when jl.credit > 0 then -jl.txn_amount else jl.txn_amount end) <> 0
  order by pa.name_en, g.code
$$;

-- ---------------------------------------------------------------------------
-- Bank / cash book and reconciliation
-- ---------------------------------------------------------------------------
create table public.bank_reconciliations (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id),
  money_account_id  uuid not null,
  statement_date    date not null,
  statement_balance numeric(18, 2) not null,
  status            text not null default 'open' check (status in ('open', 'closed')),
  closed_at         timestamptz,
  closed_by         uuid,
  created_at        timestamptz not null default now(),
  created_by        uuid default auth.uid(),
  unique (company_id, id),
  foreign key (company_id, money_account_id) references public.money_accounts(company_id, id)
);

-- A journal line on a bank account is "cleared" when it appears on the bank statement.
create table public.bank_cleared_lines (
  journal_line_id   bigint primary key references public.journal_lines(id),
  company_id        uuid not null references public.companies(id),
  reconciliation_id uuid not null,
  cleared_at        timestamptz not null default now(),
  cleared_by        uuid default auth.uid(),
  foreign key (company_id, reconciliation_id) references public.bank_reconciliations(company_id, id) on delete cascade
);

create or replace function app.bank_rec_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r public.bank_reconciliations;
  v_ok boolean;
begin
  select * into r from public.bank_reconciliations
  where id = coalesce(new.reconciliation_id, old.reconciliation_id);
  if r.status = 'closed' then
    raise exception 'This reconciliation is closed' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    select exists (select 1 from public.journal_lines jl join public.money_accounts m on m.gl_account_id = jl.account_id
                   where jl.id = new.journal_line_id and m.id = r.money_account_id) into v_ok;
    if not v_ok then
      raise exception 'That line is not on this bank account';
    end if;
    new.company_id := r.company_id;
    return new;
  end if;
  return old;
end $$;
create trigger bank_cleared_guard before insert or delete on public.bank_cleared_lines
  for each row execute function app.bank_rec_guard();

-- Close a reconciliation once book balance of cleared lines equals the statement balance.
create or replace function public.close_bank_reconciliation(p_id uuid) returns public.bank_reconciliations
language plpgsql security definer set search_path = '' as $$
declare
  r public.bank_reconciliations;
  v_cleared numeric;
begin
  select * into r from public.bank_reconciliations where id = p_id for update;
  if r.id is null then raise exception 'Reconciliation not found'; end if;
  perform app.require_perm(r.company_id, 'docs.post_money');
  if r.status = 'closed' then raise exception 'Already closed'; end if;
  select coalesce(sum(case when jl.debit > 0 then jl.txn_amount else -jl.txn_amount end), 0) into v_cleared
  from public.bank_cleared_lines c join public.journal_lines jl on jl.id = c.journal_line_id
  join public.money_accounts m on m.gl_account_id = jl.account_id and m.id = r.money_account_id;
  if v_cleared <> r.statement_balance then
    raise exception 'Cleared lines add up to % but the statement says %: difference %',
      v_cleared, r.statement_balance, r.statement_balance - v_cleared;
  end if;
  update public.bank_reconciliations set status = 'closed', closed_at = now(), closed_by = auth.uid()
   where id = p_id returning * into r;
  perform app.log_event(r.company_id, 'bank_reconciliations', r.id::text,
    format('Reconciled to statement of %s: %s', r.statement_date, r.statement_balance));
  return r;
end $$;

-- Bank / cash book in the account's own currency, with running balance and cleared status.
create or replace function public.bank_book(p_company uuid, p_money_account uuid, p_from date, p_to date)
returns table (journal_line_id bigint, entry_date date, document_id uuid, number text, kind public.doc_kind,
               party_name text, description text, money_in numeric, money_out numeric, balance numeric,
               cleared boolean, is_opening boolean)
language sql stable security invoker set search_path = '' as $$
  with m as (select gl_account_id from public.money_accounts where id = p_money_account and company_id = p_company),
  l as (
    select jl.id, je.entry_date, je.document_id, jl.party_id, jl.description,
           case when jl.debit > 0 then jl.txn_amount else 0 end as money_in,
           case when jl.credit > 0 then jl.txn_amount else 0 end as money_out
    from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id
    where jl.account_id = (select gl_account_id from m) and je.entry_date <= p_to
  )
  select null::bigint, (p_from - 1), null::uuid, null::text, null::public.doc_kind, null::text, 'Opening balance',
         null::numeric, null::numeric, coalesce(sum(money_in - money_out), 0), null::boolean, true
  from l where entry_date < p_from
  union all
  select l.id, l.entry_date, l.document_id, d.number, d.kind, pa.name_en, coalesce(l.description, d.description),
         l.money_in, l.money_out,
         (select coalesce(sum(money_in - money_out), 0) from l l0 where l0.entry_date < p_from)
           + sum(l.money_in - l.money_out) over (order by l.entry_date, l.id),
         exists (select 1 from public.bank_cleared_lines c where c.journal_line_id = l.id), false
  from l join public.documents d on d.id = l.document_id left join public.parties pa on pa.id = l.party_id
  where l.entry_date >= p_from
  order by 2, 1 nulls first
$$;

-- ---------------------------------------------------------------------------
-- Fixed assets and depreciation
-- ---------------------------------------------------------------------------
create table public.assets (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id),
  code                text not null,
  legacy_id           text,
  name_en             text not null,
  name_ar             text,
  item_id             uuid,
  source_line_id      uuid unique references public.document_lines(id),
  gl_account_id       uuid not null,          -- PPE cost account (15xx)
  acquisition_date    date not null,
  cost_usd            numeric(18, 2) not null check (cost_usd > 0),
  cost_currency       char(3) references public.currencies(code),
  cost_original       numeric(18, 2),
  life_months         smallint not null check (life_months > 0),
  salvage_usd         numeric(18, 2) not null default 0 check (salvage_usd >= 0),
  method              text not null default 'straight_line' check (method = 'straight_line'),
  location            text,
  holder_party_id     uuid,
  status              text not null default 'active' check (status in ('active', 'disposed', 'fully_depreciated')),
  disposed_on         date,
  notes               text,
  created_at          timestamptz not null default now(),
  created_by          uuid default auth.uid(),
  updated_at          timestamptz not null default now(),
  updated_by          uuid,
  unique (company_id, code),
  unique (company_id, id),
  foreign key (company_id, gl_account_id) references public.gl_accounts(company_id, id),
  foreign key (company_id, item_id) references public.items(company_id, id),
  foreign key (company_id, holder_party_id) references public.parties(company_id, id),
  check (salvage_usd < cost_usd)
);

alter table public.document_lines add column asset_id uuid references public.assets(id);

create table public.depreciation_runs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  year        smallint not null,
  month       smallint not null check (month between 1 and 12),
  document_id uuid not null references public.documents(id),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  unique (company_id, year, month)
);

create or replace function app.asset_code() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.code := app.next_master_code(new.company_id, 'FA', 4);
  return new;
end $$;
create trigger b_assets_code before insert on public.assets for each row execute function app.asset_code();
create trigger assets_touch before update on public.assets for each row execute function app.touch();
create trigger audit_assets after insert or update or delete on public.assets for each row execute function app.audit_row();
create trigger audit_bank_reconciliations after insert or update or delete on public.bank_reconciliations for each row execute function app.audit_row();
create trigger audit_bank_cleared_lines after insert or update or delete on public.bank_cleared_lines for each row execute function app.audit_row();

-- When a posted bill / expense has lines marked "asset", register the assets.
create or replace function app.register_assets(p_doc uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.documents;
  l record;
begin
  select * into d from public.documents where id = p_doc;
  for l in
    select dl.*, i.name_en as item_name, i.life_years, g.ifrs_line
    from public.document_lines dl
    left join public.items i on i.id = dl.item_id
    join public.gl_accounts g on g.id = dl.gl_account_id
    where dl.document_id = p_doc and dl.is_asset and dl.line_kind = 'item'
  loop
    if l.ifrs_line <> 'property_plant_equipment' then
      raise exception 'Line %: an asset must be booked to a property & equipment account (15xx)', l.line_no;
    end if;
    insert into public.assets (company_id, code, name_en, item_id, source_line_id, gl_account_id, acquisition_date,
                               cost_usd, cost_currency, cost_original, life_months, holder_party_id)
    values (d.company_id, '', coalesce(l.description, l.item_name, 'Asset'), l.item_id, l.id, l.gl_account_id, d.doc_date,
            app.fn(l.amount, d.rate), d.currency, l.amount, greatest(1, round(coalesce(l.life_years, 3) * 12))::smallint, null)
    on conflict (source_line_id) do nothing;
  end loop;
end $$;

create or replace function app.after_post_assets() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'posted' and old.status is distinct from 'posted' and new.kind in ('supplier_bill', 'expense') then
    perform app.register_assets(new.id);
  end if;
  return new;
end $$;
create trigger z_documents_assets after update on public.documents for each row execute function app.after_post_assets();

-- Item lines inherit "asset" from the item (bills and expenses).
create or replace function app.line_asset_default() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.item_id is not null and new.line_kind = 'item' and not new.is_asset then
    new.is_asset := coalesce((select is_asset from public.items where id = new.item_id), false)
      and exists (select 1 from public.documents where id = new.document_id and kind in ('supplier_bill', 'expense'));
  end if;
  return new;
end $$;
create trigger b_document_lines_asset before insert on public.document_lines for each row execute function app.line_asset_default();

-- Fixed-asset register as at a date: cost, accumulated depreciation, net book value.
create or replace function public.asset_register(p_company uuid, p_as_of date)
returns table (asset_id uuid, code text, name_en text, account_code text, acquisition_date date, cost_usd numeric,
               life_months smallint, monthly_charge numeric, accumulated numeric, net_book_value numeric, status text)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.code, a.name_en, g.code, a.acquisition_date, a.cost_usd, a.life_months,
         round((a.cost_usd - a.salvage_usd) / a.life_months, 2),
         coalesce(dep.acc, 0), a.cost_usd - coalesce(dep.acc, 0), a.status
  from public.assets a
  join public.gl_accounts g on g.id = a.gl_account_id
  left join lateral (
    select sum(jl.credit - jl.debit) as acc
    from public.document_lines dl
    join public.journal_lines jl on jl.document_line_id = dl.id
    join public.journal_entries je on je.id = jl.entry_id
    where dl.asset_id = a.id and je.entry_date <= p_as_of
  ) dep on true
  where a.company_id = p_company and a.acquisition_date <= p_as_of
  order by a.code
$$;

-- Monthly straight-line depreciation: one manual journal for all assets, posted through the engine.
-- Charge starts the month after acquisition and stops at cost minus salvage.
create or replace function public.run_depreciation(p_company uuid, p_year int, p_month int) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_end    date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
  v_doc    uuid;
  v_n      int := 0;
  fa       record;
  v_charge numeric;
  v_done   numeric;
begin
  perform app.require_perm(p_company, 'journal.manual');
  if exists (select 1 from public.depreciation_runs where company_id = p_company and year = p_year and month = p_month) then
    raise exception 'Depreciation for %-% has already been run', p_year, lpad(p_month::text, 2, '0');
  end if;
  insert into public.documents (company_id, kind, doc_date, currency, rate, description)
  values (p_company, 'manual_journal', v_end, 'USD', 1, format('Depreciation %s-%s', p_year, lpad(p_month::text, 2, '0')))
  returning id into v_doc;

  for fa in select * from public.assets
           where company_id = p_company and status = 'active' and acquisition_date < make_date(p_year, p_month, 1)
           order by code loop
    select coalesce(sum(jl.credit - jl.debit), 0) into v_done
    from public.document_lines dl join public.journal_lines jl on jl.document_line_id = dl.id
    where dl.asset_id = fa.id;
    v_charge := least(round((fa.cost_usd - fa.salvage_usd) / fa.life_months, 2), fa.cost_usd - fa.salvage_usd - v_done);
    continue when v_charge <= 0;
    v_n := v_n + 1;
    insert into public.document_lines (company_id, document_id, line_no, amount, side, gl_account_id, description, asset_id)
    values (p_company, v_doc, v_n * 2 - 1, v_charge, 'D', app.acct(p_company, '7100'), 'Depreciation ' || fa.code || ' ' || fa.name_en, null),
           (p_company, v_doc, v_n * 2,     v_charge, 'C', app.acct(p_company, '1590'), 'Depreciation ' || fa.code || ' ' || fa.name_en, fa.id);
  end loop;

  if v_n = 0 then
    delete from public.documents where id = v_doc;
    raise exception 'No asset needs depreciation for %-%', p_year, lpad(p_month::text, 2, '0');
  end if;
  perform public.post_document(v_doc);
  insert into public.depreciation_runs (company_id, year, month, document_id) values (p_company, p_year, p_month, v_doc);
  update public.assets a set status = 'fully_depreciated'
   where a.company_id = p_company and a.status = 'active'
     and (select coalesce(sum(jl.credit - jl.debit), 0) from public.document_lines dl
          join public.journal_lines jl on jl.document_line_id = dl.id where dl.asset_id = a.id) >= a.cost_usd - a.salvage_usd;
  return v_doc;
end $$;

-- ---------------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------------
alter table public.bank_reconciliations enable row level security;
alter table public.bank_cleared_lines   enable row level security;
alter table public.assets               enable row level security;
alter table public.depreciation_runs    enable row level security;
revoke all on public.bank_reconciliations, public.bank_cleared_lines, public.assets, public.depreciation_runs from anon, authenticated;

grant select, insert on public.bank_reconciliations to authenticated;
grant select, insert, delete on public.bank_cleared_lines to authenticated;
create policy view on public.bank_reconciliations for select to authenticated
  using ((select app.has_perm(company_id, 'docs.view')) or (select app.has_perm(company_id, 'reports.financial')));
create policy add on public.bank_reconciliations for insert to authenticated
  with check ((select app.has_perm(company_id, 'docs.post_money')));
create policy view on public.bank_cleared_lines for select to authenticated
  using ((select app.has_perm(company_id, 'docs.view')) or (select app.has_perm(company_id, 'reports.financial')));
create policy add on public.bank_cleared_lines for insert to authenticated
  with check ((select app.has_perm(company_id, 'docs.post_money')));
create policy remove on public.bank_cleared_lines for delete to authenticated
  using ((select app.has_perm(company_id, 'docs.post_money')));

grant select, update (name_en, name_ar, life_months, salvage_usd, location, holder_party_id, status, disposed_on, notes)
  on public.assets to authenticated;
grant select on public.depreciation_runs to authenticated;
create policy view on public.assets for select to authenticated
  using ((select app.has_perm(company_id, 'masterdata.view')));
create policy manage on public.assets for update to authenticated
  using ((select app.has_perm(company_id, 'journal.manual'))) with check ((select app.has_perm(company_id, 'journal.manual')));
create policy view on public.depreciation_runs for select to authenticated
  using ((select app.has_perm(company_id, 'masterdata.view')));

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon, authenticated;
grant execute on function app.is_service(), app.aal(), app.has_perm(uuid, text), app.is_member(uuid),
                          app.shares_company(uuid), app.require_perm(uuid, text),
                          app.can_write_party(uuid, boolean, boolean, boolean, boolean, boolean),
                          app.can_edit_doc(uuid), app.can_view_doc(uuid), app.next_draft_number(),
                          app.cash_flow_category(public.gl_accounts)
  to authenticated, service_role;
grant execute on function public.fiscal_year_start(uuid, date), public.general_ledger(uuid, date, date, uuid, uuid, uuid),
  public.profit_and_loss(uuid, date, date, date, date, uuid), public.profit_and_loss_monthly(uuid, date),
  public.balance_sheet(uuid, date), public.cash_flow(uuid, date, date), public.changes_in_equity(uuid, date, date),
  public.project_pl(uuid, date, date), public.party_balances(uuid, date), public.bank_book(uuid, uuid, date, date),
  public.close_bank_reconciliation(uuid), public.asset_register(uuid, date), public.run_depreciation(uuid, int, int)
  to authenticated;
grant execute on function public.verify_document(uuid) to anon, authenticated;
