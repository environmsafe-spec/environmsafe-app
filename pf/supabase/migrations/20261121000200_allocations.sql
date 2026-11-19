-- ES-PF v2 · step 2 (brief v2, items A3, A4, A5): every receipt and payment settles what it pays, in any currency.
--
-- A3  A receipt / supplier payment settles invoices / bills (links). What is not linked is NOT revenue or cost:
--     it waits on Customer advances (2150) or Advances to suppliers (1250) until it is applied to an invoice / bill
--     (public.apply_payment, which moves it with an 'allocation' entry). Project required on receipts, payments,
--     invoice and bill lines. Small differences are written off in one click (public.write_off, account 6950).
-- A4  A receipt in another currency settles the invoice all the same: the link records the amount in each
--     currency; the invoice is relieved at its own rate and the difference is realised FX gain / loss (7000).
-- A5  A payment with no bill shows as a prepayment, not a negative payable; an expense paid now never shows as owed.

-- ---------------------------------------------------------------------------
-- Links in two currencies; allocation entries
-- ---------------------------------------------------------------------------
alter table public.document_links add column if not exists from_amount numeric(18, 2) check (from_amount is null or from_amount > 0);
comment on column public.document_links.amount is 'Amount settled, in the currency of the settled document (to_document_id)';
comment on column public.document_links.from_amount is 'The same, in the currency of the settling document when it differs';
alter table public.journal_entries drop constraint if exists journal_entries_kind_check;
alter table public.journal_entries add constraint journal_entries_kind_check check (kind in ('posting', 'reversal', 'allocation'));
alter table public.document_links add column if not exists entry_id uuid references public.journal_entries(id);
alter table public.document_links add column if not exists applied_later boolean not null default false;

-- Settlement differences (one-click write-off of small amounts left open): in the standard chart for new companies,
-- and added to the existing ones.
create or replace function app.seed_chart_of_accounts(p_company uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  for r in
    select * from (values
      -- Assets
      ('1000', null,   'asset', 'Cash and bank',                         'النقد والبنوك',                 'cash_and_cash_equivalents', false, false, null, 'cash_and_bank'),
      ('1100', null,   'asset', 'Accounts receivable',                   'ذمم مدينة - عملاء',             'trade_receivables',         true,  false, 'ar', null),
      ('1150', null,   'asset', 'Other receivables (owed back)',         'ذمم مدينة أخرى',                'other_receivables',         true,  false, null, null),
      ('1200', null,   'asset', 'Employee advances',                     'سلف الموظفين',                  'other_receivables',         true,  false, 'employee_advance', null),
      ('1250', null,   'asset', 'Advances to suppliers and prepayments', 'دفعات مقدمة للموردين',          'prepayments',               true,  false, 'supplier_advance', null),
      ('1260', null,   'asset', 'Deposits and guarantees paid',          'تأمينات وضمانات مدفوعة',        'prepayments',               true,  false, null, null),
      ('1300', null,   'asset', 'Inventory',                             'المخزون',                       'inventories',               true,  false, null, null),
      ('1400', null,   'asset', 'Tax receivable',                        'ضرائب مستردة',                  'other_receivables',         true,  false, null, null),
      ('1500', null,   'asset', 'Property, plant and equipment',         'الممتلكات والمعدات',            'property_plant_equipment',  false, false, null, null),
      ('1510', '1500', 'asset', 'Vehicles',                              'السيارات',                      'property_plant_equipment',  true,  false, null, 'ppe_cost'),
      ('1520', '1500', 'asset', 'Equipment and tools',                   'المعدات والأدوات',              'property_plant_equipment',  true,  false, null, 'ppe_cost'),
      ('1530', '1500', 'asset', 'Furniture and IT equipment',            'الأثاث وأجهزة الحاسوب',         'property_plant_equipment',  true,  false, null, 'ppe_cost'),
      ('1590', '1500', 'asset', 'Accumulated depreciation',              'مجمع الإهلاك',                  'property_plant_equipment',  true,  false, null, 'accumulated_depreciation'),
      -- Liabilities
      ('2000', null,   'liability', 'Accounts payable',                  'ذمم دائنة - موردون',            'trade_payables',            true,  false, 'ap', null),
      ('2100', null,   'liability', 'Employee payables (claims, salaries)', 'مستحقات الموظفين',          'other_payables',            true,  false, 'employee_payable', null),
      ('2150', null,   'liability', 'Customer advances',                 'دفعات مقدمة من العملاء',        'contract_liabilities',      true,  false, 'customer_advance', null),
      ('2200', null,   'liability', 'Owner current account',             'جاري المالك',                   'related_party_payables',    true,  false, 'owner', null),
      ('2300', null,   'liability', 'VAT and withholding payable',       'ضريبة مستحقة',                  'tax_payables',              true,  false, null, null),
      ('2400', null,   'liability', 'Accrued expenses',                  'مصروفات مستحقة',                'other_payables',            true,  false, null, null),
      ('2900', null,   'liability', 'Suspense (to be reviewed)',         'حساب معلق',                     'other_payables',            true,  false, null, 'suspense'),
      -- Equity
      ('3000', null,   'equity', 'Share capital',                        'رأس المال',                     'share_capital',             true,  false, null, null),
      ('3100', null,   'equity', 'Retained earnings',                    'الأرباح المحتجزة',              'retained_earnings',         true,  false, null, 'retained_earnings'),
      ('3200', null,   'equity', 'Owner drawings',                       'مسحوبات المالك',                'drawings',                  true,  false, null, 'drawings'),
      ('3900', null,   'equity', 'Opening balance equity',               'أرصدة افتتاحية',                'retained_earnings',         true,  false, null, 'opening_balance'),
      -- Income
      ('4000', null,   'income', 'Revenue',                              'الإيرادات',                     'revenue',                   false, true,  null, null),
      ('4100', '4000', 'income', 'Inspection and certification',         'التفتيش وإصدار الشهادات',       'revenue',                   true,  true,  null, null),
      ('4200', '4000', 'income', 'Maintenance services',                 'خدمات الصيانة',                 'revenue',                   true,  true,  null, null),
      ('4250', '4000', 'income', 'Generator maintenance services',       'خدمات صيانة المولدات',          'revenue',                   true,  true,  null, null),
      ('4300', '4000', 'income', 'HSE and training',                     'السلامة والتدريب',              'revenue',                   true,  true,  null, null),
      ('4400', '4000', 'income', 'Engineering services',                 'الخدمات الهندسية',              'revenue',                   true,  true,  null, null),
      ('4500', '4000', 'income', 'Trading (sale of goods)',              'المبيعات التجارية',             'revenue',                   true,  true,  null, null),
      ('4900', null,   'income', 'Other income',                         'إيرادات أخرى',                  'other_income',              true,  true,  null, null),
      -- Cost of services
      ('5000', null,   'expense', 'Cost of services',                    'تكلفة الخدمات',                 'cost_of_sales',             false, true,  null, null),
      ('5100', '5000', 'expense', 'Subcontractors',                      'مقاولون من الباطن',             'cost_of_sales',             true,  true,  null, null),
      ('5200', '5000', 'expense', 'Materials and spare parts',           'مواد وقطع غيار',                'cost_of_sales',             true,  true,  null, null),
      ('5300', '5000', 'expense', 'Direct labour',                       'عمالة مباشرة',                  'cost_of_sales',             true,  true,  null, null),
      ('5400', '5000', 'expense', 'Equipment hire',                      'استئجار معدات',                 'cost_of_sales',             true,  true,  null, null),
      ('5500', '5000', 'expense', 'Site transport and logistics',        'نقل ولوجستيات المواقع',         'cost_of_sales',             true,  true,  null, null),
      ('5600', '5000', 'expense', 'Cost of goods sold',                  'تكلفة البضاعة المباعة',         'cost_of_sales',             true,  true,  null, null),
      ('5900', '5000', 'expense', 'Other direct costs',                  'تكاليف مباشرة أخرى',            'cost_of_sales',             true,  true,  null, null),
      -- Operating expenses
      ('6000', null,   'expense', 'Operating expenses',                  'المصروفات التشغيلية',           'administrative_expenses',   false, true,  null, null),
      ('6100', '6000', 'expense', 'Salaries and wages',                  'الرواتب والأجور',               'administrative_expenses',   true,  true,  null, null),
      ('6200', '6000', 'expense', 'Transport and fuel',                  'المواصلات والوقود',             'administrative_expenses',   true,  true,  null, null),
      ('6300', '6000', 'expense', 'Rent',                                'الإيجارات',                     'administrative_expenses',   true,  true,  null, null),
      ('6350', '6000', 'expense', 'Utilities and communications',        'الخدمات والاتصالات',            'administrative_expenses',   true,  true,  null, null),
      ('6400', '6000', 'expense', 'Government fees and licences',        'رسوم حكومية وتراخيص',           'administrative_expenses',   true,  true,  null, null),
      ('6500', '6000', 'expense', 'Professional fees',                   'أتعاب مهنية',                   'administrative_expenses',   true,  true,  null, null),
      ('6600', '6000', 'expense', 'Travel and accommodation',            'السفر والإقامة',                'administrative_expenses',   true,  true,  null, null),
      ('6700', '6000', 'expense', 'Marketing',                           'التسويق',                       'distribution_costs',        true,  true,  null, null),
      ('6800', '6000', 'expense', 'Office and supplies',                 'المكتب واللوازم',               'administrative_expenses',   true,  true,  null, null),
      ('6850', '6000', 'expense', 'IT and subscriptions',                'تقنية المعلومات والاشتراكات',   'administrative_expenses',   true,  true,  null, null),
      ('6900', '6000', 'expense', 'Bank and remittance charges',         'رسوم بنكية وحوالات',            'administrative_expenses',   true,  false, null, 'bank_charges'),
      ('6950', '6000', 'expense', 'Settlement differences',              'فروقات التسوية',                 'administrative_expenses',   true,  false, null, null),
      ('6990', '6000', 'expense', 'Other operating expenses',            'مصروفات تشغيلية أخرى',          'administrative_expenses',   true,  true,  null, null),
      -- Other gains / losses, depreciation
      ('7000', null,   'expense', 'Foreign exchange gain / loss',        'أرباح / خسائر فروق العملة',     'other_gains_losses',        true,  false, null, 'fx'),
      ('7100', null,   'expense', 'Depreciation',                        'الإهلاك',                       'depreciation',              true,  false, null, 'depreciation')
    ) as t(code, parent, typ, name_en, name_ar, ifrs, postable, req_project, control, subtype)
    order by (parent is not null), code
  loop
    insert into public.gl_accounts
      (company_id, code, name_en, name_ar, account_type, subtype, parent_id, ifrs_line,
       requires_project, control_kind, is_postable, is_system)
    values
      (p_company, r.code, r.name_en, r.name_ar, r.typ::public.account_type, r.subtype,
       (select id from public.gl_accounts where company_id = p_company and code = r.parent),
       r.ifrs, r.req_project, r.control, r.postable, true)
    on conflict (company_id, code) do nothing;
  end loop;
end $$;

insert into public.gl_accounts (company_id, code, name_en, name_ar, account_type, subtype, parent_id, ifrs_line,
                                requires_project, control_kind, is_postable, is_system)
select c.id, '6950', 'Settlement differences', 'فروقات التسوية', 'expense', null,
       (select id from public.gl_accounts g where g.company_id = c.id and g.code = '6000'), 'administrative_expenses',
       false, null, true, true
  from public.companies c
on conflict (company_id, code) do nothing;
update public.companies set settings = settings || '{"writeoff_limit_usd": 5}'::jsonb where not settings ? 'writeoff_limit_usd';

-- Where money waits until it is applied.
create or replace function app.advance_account(d public.documents, p_ctrl uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select case
    when d.kind = 'customer_receipt' then app.acct(d.company_id, '2150')
    when d.kind = 'supplier_payment' and coalesce(d.purpose, 'payable') = 'payable' then app.acct(d.company_id, '1250')
    else p_ctrl end
$$;

-- Control-account side of a settling document: each settled document is relieved in its own currency at its own
-- rate; what is not linked waits as an advance / prepayment at this document's rate.
create or replace function app.jl_settled(p_entry uuid, d public.documents, p_ctrl uuid, p_side char) returns void
language plpgsql security definer set search_path = '' as $$
declare
  l record;
  v_sum numeric := 0;
begin
  for l in select lk.amount, lk.from_amount, sd.rate, sd.currency, sd.number from public.document_links lk
           join public.documents sd on sd.id = lk.to_document_id
           where lk.from_document_id = d.id order by sd.doc_date, sd.id loop
    perform app.jl(p_entry, d.company_id, p_ctrl, p_side, app.fn(l.amount, l.rate), l.currency, l.amount, l.rate,
                   d.project_id, d.party_id, null, null, 'Settles ' || l.number);
    v_sum := v_sum + coalesce(l.from_amount, l.amount);
  end loop;
  if d.amount - v_sum > 0 then
    perform app.jl(p_entry, d.company_id, app.advance_account(d, p_ctrl), p_side, app.fn(d.amount - v_sum, d.rate), d.currency,
                   d.amount - v_sum, d.rate, d.project_id, d.party_id, null, null,
                   case when d.kind = 'customer_receipt' then 'Customer advance (not yet applied)'
                        when d.kind = 'supplier_payment' and coalesce(d.purpose, 'payable') = 'payable' then 'Prepayment (not yet applied)'
                        when v_sum > 0 then 'On account' else d.description end);
  end if;
end $$;

create or replace function app.validate_document(d public.documents) returns void
language plpgsql security definer set search_path = '' as $$
declare
  k public.doc_kinds;
  p public.parties;
  ma public.money_accounts;
  v_lines int;
  v_dr numeric; v_cr numeric;
  l record;
  v_settled public.documents;
begin
  select * into k from public.doc_kinds where kind = d.kind;
  select * into p from public.parties where id = d.party_id;
  select * into ma from public.money_accounts where id = d.money_account_id;

  if k.money_account = 'required' and d.money_account_id is null then
    raise exception 'Choose the bank / cash account';
  end if;
  if k.money_account = 'none' and d.money_account_id is not null then
    raise exception '% does not use a bank / cash account', k.name_en;
  end if;
  if ma.id is not null and not ma.is_active then
    raise exception 'Bank / cash account % is inactive', ma.name_en;
  end if;
  if k.party_required and d.party_id is null then
    raise exception 'Choose the % for this %', coalesce(k.party_role, 'party'), k.name_en;
  end if;
  if p.id is not null then
    if (k.party_role = 'supplier' and not p.is_supplier)
       or (k.party_role = 'customer' and not p.is_customer)
       or (k.party_role = 'employee' and not p.is_employee)
       or (k.party_role = 'owner' and not p.is_owner)
       or (k.party_role = 'employee_or_owner' and not (p.is_employee or p.is_owner)) then
      raise exception '% must be a % for a %', p.name_en, replace(k.party_role, '_', ' '), k.name_en;
    end if;
  end if;
  if not k.allows_fee and d.fee_amount > 0 then
    raise exception '% cannot carry a bank fee', k.name_en;
  end if;
  if d.kind = 'salary' and d.money_account_id is null and d.fee_amount > 0 then
    raise exception 'An unpaid salary cannot carry a bank fee';
  end if;
  if k.direction = 'in' and d.fee_amount >= d.amount then
    raise exception 'The fee must be smaller than the amount received';
  end if;

  if k.has_lines then
    select count(*), coalesce(sum(amount) filter (where side = 'D'), 0), coalesce(sum(amount) filter (where side = 'C'), 0)
      into v_lines, v_dr, v_cr
    from public.document_lines where document_id = d.id;
    if v_lines = 0 then
      raise exception 'Add at least one line';
    end if;
    if d.kind = 'manual_journal' and v_dr <> v_cr then
      raise exception 'Journal is not balanced: debits % vs credits %', v_dr, v_cr;
    end if;
    if d.kind in ('expense', 'salary', 'expense_claim', 'manual_journal') then
      for l in
        select dl.*, coalesce(dl.gl_account_id, i.default_expense_account_id,
                              case when d.kind = 'salary' then app.acct(d.company_id, '6100') end) as acc
        from public.document_lines dl left join public.items i on i.id = dl.item_id
        where dl.document_id = d.id
      loop
        if l.acc is null then
          raise exception 'Line %: choose the account (what was it for?)', l.line_no;
        end if;
      end loop;
    else
      perform app.prepare_trade_document(d);
    end if;
  elsif d.amount <= 0 and d.kind <> 'employee_offset' then  -- an offset's amount comes from its links
    raise exception 'Enter the amount';
  end if;

  if d.kind = 'transfer' then
    if d.counter_money_account_id is null then
      raise exception 'Choose the account the money goes to';
    end if;
    if d.counter_amount is null or d.counter_rate is null then
      raise exception 'Enter the amount received in the destination account';
    end if;
  end if;

  -- Settlement links
  if exists (select 1 from public.document_links where from_document_id = d.id) and cardinality(k.settles) = 0 then
    raise exception '% cannot settle other documents', k.name_en;
  end if;
  for l in select * from public.document_links where from_document_id = d.id loop
    select * into v_settled from public.documents where id = l.to_document_id;
    if v_settled.status <> 'posted' then
      raise exception 'Document % is not posted and cannot be settled', coalesce(v_settled.number, v_settled.temp_number);
    end if;
    if not v_settled.kind = any (k.settles) then
      raise exception '% cannot settle a %', k.name_en, v_settled.kind;
    end if;
    if v_settled.party_id is distinct from d.party_id then
      raise exception 'Document % belongs to another party', v_settled.number;
    end if;
    -- Another currency (rule A4): only receipts and supplier payments, and the link says what it covers in
    -- each currency (amount = in the settled document's currency, from_amount = in this document's currency).
    if v_settled.currency <> d.currency then
      if d.kind::text not in ('customer_receipt', 'supplier_payment') then
        raise exception 'Document % is in %; settle it from a % account', v_settled.number, v_settled.currency, v_settled.currency;
      end if;
      if l.from_amount is null then
        raise exception 'Document % is in %: enter how much of this % % payment goes to it', v_settled.number, v_settled.currency, d.amount, d.currency;
      end if;
    elsif l.from_amount is not null and l.from_amount <> l.amount then
      raise exception 'Document % is in the same currency: one amount only', v_settled.number;
    end if;
    if l.amount > app.open_amount(v_settled.id, d.id) then
      raise exception 'Document % has only % % open', v_settled.number, app.open_amount(v_settled.id, d.id), v_settled.currency;
    end if;
  end loop;

  if d.kind = 'supplier_payment' and d.purpose = 'deposit' and exists (select 1 from public.document_links where from_document_id = d.id) then
    raise exception 'A deposit / guarantee cannot settle bills; choose "Pay the supplier"';
  end if;
  if d.kind in ('claim_reimbursement', 'advance_repayment', 'supplier_payment', 'customer_receipt', 'credit_note')
     and coalesce((select sum(coalesce(from_amount, amount)) from public.document_links where from_document_id = d.id), 0) > d.amount then
    raise exception 'The documents settled add up to more than the amount';
  end if;
  if d.kind = 'employee_offset' then
    select coalesce(sum(l2.amount) filter (where s.kind = 'expense_claim'), 0),
           coalesce(sum(l2.amount) filter (where s.kind = 'employee_advance'), 0)
      into v_dr, v_cr
    from public.document_links l2 join public.documents s on s.id = l2.to_document_id
    where l2.from_document_id = d.id;
    if v_dr = 0 or v_dr <> v_cr then
      raise exception 'Offset: claims settled (%) must equal advances settled (%)', v_dr, v_cr;
    end if;
    update public.documents set amount = v_dr where id = d.id and amount <> v_dr;
  end if;

  -- Project on every receipt, payment, invoice and bill (rule A3). A receipt / payment takes the project of
  -- the first document it settles when none is chosen.
  if d.kind::text in ('customer_receipt', 'supplier_payment') and not (d.kind::text = 'supplier_payment' and d.purpose = 'deposit')
     and d.project_id is null then
    select coalesce(s.project_id, (select sl.project_id from public.document_lines sl
                                    where sl.document_id = s.id and sl.project_id is not null order by sl.line_no limit 1))
      into d.project_id
      from public.document_links lk join public.documents s on s.id = lk.to_document_id
     where lk.from_document_id = d.id order by s.doc_date, s.id limit 1;
    d.project_id := coalesce(d.project_id, p.default_project_id);     -- the party's usual project
    if d.project_id is null then
      raise exception 'Choose the project this % belongs to', lower(k.name_en);
    end if;
    update public.documents set project_id = d.project_id where id = d.id;   -- posting is already internal here
  end if;
  if d.kind::text in ('sales_invoice', 'supplier_bill', 'credit_note') then
    if d.project_id is not null then
      update public.document_lines set project_id = d.project_id where document_id = d.id and project_id is null;
    end if;
    if exists (select 1 from public.document_lines where document_id = d.id and line_kind = 'item' and project_id is null) then
      raise exception 'Choose the project for every line (line %)',
        (select min(line_no) from public.document_lines where document_id = d.id and line_kind = 'item' and project_id is null);
    end if;
  end if;

  -- Evidence: every cash movement needs a file or a stated reason.
  if d.money_account_id is not null
     and not exists (select 1 from public.attachments where document_id = d.id)
     and coalesce(trim(d.no_document_reason), '') = '' then
    raise exception 'Attach the voucher / receipt, or say why there is no document';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Apply an advance / prepayment / credit note to an invoice or bill afterwards (any currency)
-- ---------------------------------------------------------------------------
create or replace function app.unapplied_amount(p_doc uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select d.amount - coalesce((select sum(coalesce(l.from_amount, l.amount)) from public.document_links l where l.from_document_id = d.id), 0)
  from public.documents d where d.id = p_doc
$$;

drop function if exists public.apply_payment(uuid, uuid, numeric);
-- p_amount: amount applied in the invoice / bill currency (default: as much as possible);
-- p_from_amount: the same in the payment's currency (needed only when the currencies differ).
create or replace function public.apply_payment(p_payment uuid, p_document uuid, p_amount numeric default null, p_from_amount numeric default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.documents;
  t public.documents;
  v numeric;            -- in t's currency
  vf numeric;           -- in p's currency
  v_entry uuid;
  v_date date;
  v_adv uuid;
  v_ctrl uuid;
  v_link uuid;
begin
  select * into p from public.documents where id = p_payment;
  select * into t from public.documents where id = p_document;
  if p.id is null or t.id is null or not app.has_perm(p.company_id, 'docs.view') or t.company_id <> p.company_id then
    raise exception 'Document not found';
  end if;
  perform app.require_perm(p.company_id, (select post_permission from public.doc_kinds where kind = p.kind));
  if p.status <> 'posted' or t.status <> 'posted' then raise exception 'Both documents must be posted'; end if;
  if (p.kind::text, t.kind::text) not in (('supplier_payment', 'supplier_bill'), ('customer_receipt', 'sales_invoice'), ('credit_note', 'sales_invoice')) then
    raise exception 'A % cannot be applied to a %', p.kind, t.kind;
  end if;
  if p.kind::text = 'supplier_payment' and p.purpose = 'deposit' then
    raise exception 'A deposit / guarantee is not an advance on a bill';
  end if;
  if p.party_id is distinct from t.party_id then raise exception 'The documents belong to different parties'; end if;
  if p.currency = t.currency then
    v := least(app.unapplied_amount(p.id), app.open_amount(t.id));
    if p_amount is not null then
      if p_amount <= 0 or p_amount > v then raise exception 'At most % % can be applied', v, t.currency; end if;
      v := p_amount;
    end if;
    vf := v;
  else
    if p.kind::text = 'credit_note' then raise exception 'A credit note settles invoices in its own currency'; end if;
    if p_amount is null or p_from_amount is null then
      raise exception 'Different currencies: enter the amount in % (invoice) and in % (payment)', t.currency, p.currency;
    end if;
    if p_amount <= 0 or p_amount > app.open_amount(t.id) then raise exception 'Only % % is open on %', app.open_amount(t.id), t.currency, t.number; end if;
    if p_from_amount <= 0 or p_from_amount > app.unapplied_amount(p.id) then
      raise exception 'Only % % of the payment is not yet applied', app.unapplied_amount(p.id), p.currency;
    end if;
    v := p_amount; vf := p_from_amount;
  end if;
  if v <= 0 then raise exception 'Nothing left to apply'; end if;

  -- The entry: advance / prepayment -> receivable / payable, each at its own rate; the rest is FX.
  v_ctrl := app.acct(p.company_id, case when t.kind::text = 'supplier_bill' then '2000' else '1100' end);
  v_adv := app.advance_account(p, v_ctrl);
  v_date := greatest(p.doc_date, t.doc_date);
  begin
    perform app.assert_period_open(p.company_id, v_date);
  exception when others then
    v_date := current_date;
  end;
  perform app.begin_internal();
  if v_adv <> v_ctrl or p.rate <> t.rate or p.currency <> t.currency then
    insert into public.journal_entries (company_id, document_id, entry_date, period_id, kind, memo)
    values (p.company_id, p.id, v_date, app.assert_period_open(p.company_id, v_date), 'allocation',
            format('%s applied to %s', coalesce(p.number, ''), t.number))
    returning id into v_entry;
    if t.kind::text = 'supplier_bill' then       -- Dr payable (bill's rate) / Cr prepayment (payment's rate)
      perform app.jl(v_entry, p.company_id, v_ctrl, 'D', app.fn(v, t.rate), t.currency, v, t.rate, t.project_id, p.party_id, null, null, 'Settles ' || t.number);
      perform app.jl(v_entry, p.company_id, v_adv, 'C', app.fn(vf, p.rate), p.currency, vf, p.rate, p.project_id, p.party_id, null, null, 'Prepayment applied');
    else                                          -- Dr customer advance (receipt's rate) / Cr receivable (invoice's rate)
      perform app.jl(v_entry, p.company_id, v_adv, 'D', app.fn(vf, p.rate), p.currency, vf, p.rate, p.project_id, p.party_id, null, null, 'Advance applied');
      perform app.jl(v_entry, p.company_id, v_ctrl, 'C', app.fn(v, t.rate), t.currency, v, t.rate, t.project_id, p.party_id, null, null, 'Settles ' || t.number);
    end if;
    perform app.jl_balance_fx(v_entry, p);
  end if;
  insert into public.document_links (company_id, from_document_id, to_document_id, amount, from_amount, entry_id, applied_later)
  values (p.company_id, p.id, t.id, v, case when p.currency <> t.currency then vf end, v_entry, true)
  returning id into v_link;
  perform app.end_internal();
  perform app.log_event(p.company_id, 'documents', p.id::text,
    format('Applied %s %s to %s%s', vf, p.currency, t.number, case when p.currency <> t.currency then format(' (= %s %s)', v, t.currency) else '' end));
end $$;
grant execute on function public.apply_payment(uuid, uuid, numeric, numeric) to authenticated;

-- Undo an application made afterwards (the entry is reversed; the payment is an advance again).
create or replace function public.unapply_payment(p_payment uuid, p_document uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.documents;
  lk public.document_links;
  v_entry uuid;
  e public.journal_entries;
begin
  select * into p from public.documents where id = p_payment;
  if p.id is null or not app.has_perm(p.company_id, 'docs.view') then raise exception 'Document not found'; end if;
  perform app.require_perm(p.company_id, (select post_permission from public.doc_kinds where kind = p.kind));
  select * into lk from public.document_links where from_document_id = p_payment and to_document_id = p_document;
  if lk.id is null then raise exception 'Nothing applied to this document'; end if;
  if not lk.applied_later then
    raise exception 'This was settled when the payment was posted: void the payment instead';
  end if;
  perform app.begin_internal();
  if lk.entry_id is not null then
    select * into e from public.journal_entries where id = lk.entry_id;
    insert into public.journal_entries (company_id, document_id, entry_date, period_id, kind, memo)
    values (e.company_id, e.document_id, greatest(e.entry_date, current_date), app.assert_period_open(e.company_id, greatest(e.entry_date, current_date)),
            'allocation', 'Undo: ' || coalesce(e.memo, ''))
    returning id into v_entry;
    insert into public.journal_lines (company_id, entry_id, line_no, account_id, debit, credit, txn_currency, txn_amount, rate,
                                      project_id, party_id, item_id, document_line_id, description)
    select company_id, v_entry, line_no, account_id, credit, debit, txn_currency, txn_amount, rate,
           project_id, party_id, item_id, document_line_id, 'Undo: ' || coalesce(description, '')
      from public.journal_lines where entry_id = e.id;
  end if;
  delete from public.document_links where id = lk.id;
  perform app.end_internal();
  perform app.log_event(p.company_id, 'documents', p.id::text, 'Application undone');
end $$;
grant execute on function public.unapply_payment(uuid, uuid) to authenticated;

drop view if exists public.v_unapplied;
create view public.v_unapplied with (security_invoker = true) as
select d.id, d.company_id, d.kind, d.number, d.doc_date, d.party_id, d.project_id, d.currency, d.rate, d.amount,
       (d.amount - coalesce(sum(coalesce(l.from_amount, l.amount)), 0))::numeric(18, 2) as unapplied
  from public.documents d left join public.document_links l on l.from_document_id = d.id
 where d.status = 'posted' and d.kind::text in ('supplier_payment', 'customer_receipt', 'credit_note')
   and not (d.kind::text = 'supplier_payment' and d.purpose = 'deposit')
 group by d.id
having d.amount - coalesce(sum(coalesce(l.from_amount, l.amount)), 0) > 0;
grant select on public.v_unapplied to authenticated;

-- A payment / receipt with money applied afterwards is voided only once those applications are undone.
alter function public.void_document(uuid, text, date) rename to void_document_core;
revoke execute on function public.void_document_core(uuid, text, date) from public, authenticated;
create or replace function public.void_document(p_id uuid, p_reason text, p_reversal_date date default null)
returns public.documents
language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  select string_agg(t.number, ', ') into v from public.document_links lk join public.documents t on t.id = lk.to_document_id
   where lk.from_document_id = p_id and lk.applied_later;
  if v is not null then
    raise exception 'Undo what was applied afterwards first (Unapply): %', v;
  end if;
  return public.void_document_core(p_id, p_reason, p_reversal_date);
end $$;
grant execute on function public.void_document(uuid, text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Write off a small amount left open on an invoice / bill (e.g. 0.50 short) to Settlement differences
-- ---------------------------------------------------------------------------
create or replace function public.write_off(p_document uuid, p_reason text default 'Small settlement difference') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  t public.documents;
  v_open numeric;
  v_limit numeric;
  v_doc uuid;
  v_ctrl text;
begin
  select * into t from public.documents where id = p_document;
  if t.id is null or not app.has_perm(t.company_id, 'docs.view') then raise exception 'Document not found'; end if;
  perform app.require_perm(t.company_id, 'docs.reverse');
  if t.status <> 'posted' or t.kind::text not in ('sales_invoice', 'supplier_bill') then
    raise exception 'Only a posted invoice or bill can have its difference written off';
  end if;
  v_open := app.open_amount(t.id);
  select coalesce((settings ->> 'writeoff_limit_usd')::numeric, 5) into v_limit from public.companies where id = t.company_id;
  if v_open <= 0 then raise exception 'Nothing is open on %', t.number; end if;
  if round(v_open / t.rate, 2) > v_limit then
    raise exception 'Only small differences (up to % USD) are written off; % has % % open', v_limit, t.number, v_open, t.currency;
  end if;
  v_ctrl := case when t.kind::text = 'supplier_bill' then '2000' else '1100' end;
  perform app.begin_internal();
  insert into public.documents (company_id, kind, doc_date, currency, rate, party_id, project_id, description)
  values (t.company_id, 'manual_journal', greatest(t.doc_date, current_date), t.currency, t.rate, t.party_id, t.project_id,
          format('Write-off of %s %s left on %s: %s', v_open, t.currency, t.number, coalesce(nullif(trim(p_reason), ''), 'small difference')))
  returning id into v_doc;
  insert into public.document_lines (company_id, document_id, line_no, gl_account_id, project_id, party_id, side, amount, description)
  values (t.company_id, v_doc, 1, app.acct(t.company_id, '6950'), t.project_id, t.party_id,
          case when v_ctrl = '1100' then 'D' else 'C' end, v_open, 'Settlement difference ' || t.number),
         (t.company_id, v_doc, 2, app.acct(t.company_id, v_ctrl), null, t.party_id,
          case when v_ctrl = '1100' then 'C' else 'D' end, v_open, 'Settles ' || t.number);
  perform app.end_internal();
  perform public.post_document(v_doc);
  perform app.begin_internal();
  insert into public.document_links (company_id, from_document_id, to_document_id, amount) values (t.company_id, v_doc, t.id, v_open);
  perform app.end_internal();
  return v_doc;
end $$;
grant execute on function public.write_off(uuid, text) to authenticated;
