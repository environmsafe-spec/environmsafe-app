-- ES-PF v2 · Migration 12: purchase orders, supplier bills, quotations, sales invoices, credit notes;
-- payments and receipts settle bills and invoices; AR/AP aging and party statements.

insert into public.doc_kinds
  (kind, number_type, direction, has_lines, money_account, party_role, party_required, allows_fee, approval_applies,
   settles, post_permission, creates_journal, name_en, name_ar, sort)
values
  ('purchase_order', 'purchase_order', 'none', true, 'none', 'supplier', true, false, false, '{}',              'docs.post', false, 'Purchase order', 'أمر شراء',      200),
  ('supplier_bill',  'supplier_bill',  'none', true, 'none', 'supplier', true, false, false, '{}',              'docs.post', true,  'Supplier bill',  'فاتورة مورد',   210),
  ('quotation',      'quotation',      'none', true, 'none', 'customer', true, false, false, '{}',              'docs.post', false, 'Quotation',      'عرض سعر',       220),
  ('sales_invoice',  'sales_invoice',  'none', true, 'none', 'customer', true, false, false, '{}',              'docs.post', true,  'Sales invoice',  'فاتورة مبيعات', 230),
  ('credit_note',    'credit_note',    'none', true, 'none', 'customer', true, false, false, '{sales_invoice}', 'docs.post', true,  'Credit note',    'إشعار دائن',    240);

update public.doc_kinds set settles = '{supplier_bill}' where kind = 'supplier_payment';
update public.doc_kinds set settles = '{sales_invoice}' where kind = 'customer_receipt';

-- Default printed terms per document type (editable in company settings).
update public.companies set settings = settings || jsonb_build_object(
  'po_terms', E'Payment: As agreed upon delivery and receipt of the original invoice\nDelivery: EnvironmSafe, Aden\nInvoice To: EnvironmSafe For Engineering, Trading, and Services Ltd, Aden-Alburaqah, Yemen | Attn: General Manager | support@environmsafe.com',
  'invoice_terms', E'Payment: As agreed\nBank: Al Kuraimi Bank, account no. 3108401426 (EnvironmSafe for Engineering, Trading, and Services Ltd)',
  'quotation_terms', E'Validity: 30 days\nPayment: As agreed')
where not settings ? 'po_terms';

-- AR / AP aging as at a date (open = amount minus settlements posted on or before that date).
create or replace function public.aging(p_company uuid, p_side text, p_as_of date default current_date)
returns table (document_id uuid, number text, party_id uuid, party_name text, doc_date date, due_date date,
               currency char(3), amount numeric, open_amount numeric, days_overdue int, bucket text)
language sql stable security invoker set search_path = '' as $$
  select * from (
    select d.id, d.number, d.party_id, p.name_en, d.doc_date, coalesce(d.due_date, d.doc_date), d.currency, d.amount,
           d.amount - coalesce((select sum(l.amount) from public.document_links l
                                join public.documents s on s.id = l.from_document_id
                                where l.to_document_id = d.id and s.status = 'posted' and s.doc_date <= p_as_of), 0),
           greatest(p_as_of - coalesce(d.due_date, d.doc_date), 0),
           case when p_as_of - coalesce(d.due_date, d.doc_date) <= 0 then 'current'
                when p_as_of - coalesce(d.due_date, d.doc_date) <= 30 then '1-30'
                when p_as_of - coalesce(d.due_date, d.doc_date) <= 60 then '31-60'
                when p_as_of - coalesce(d.due_date, d.doc_date) <= 90 then '61-90'
                else '90+' end
    from public.documents d
    left join public.parties p on p.id = d.party_id
    where d.company_id = p_company and d.status = 'posted' and d.doc_date <= p_as_of
      and d.kind = case p_side when 'ar' then 'sales_invoice'::public.doc_kind when 'ap' then 'supplier_bill'::public.doc_kind end
  ) a (document_id, number, party_id, party_name, doc_date, due_date, currency, amount, open_amount, days_overdue, bucket)
  where open_amount > 0
  order by party_name, due_date
$$;

-- Statement of a customer / supplier / employee / owner: every movement on their control
-- accounts, per currency, with opening and running balance (positive = they owe us).
create or replace function public.party_statement(p_company uuid, p_party uuid, p_from date, p_to date)
returns table (entry_date date, document_id uuid, number text, kind public.doc_kind, description text,
               account_code text, currency char(3), debit numeric, credit numeric, balance numeric)
language sql stable security invoker set search_path = '' as $$
  with l as (
    select je.entry_date, je.document_id, d.number, d.kind, coalesce(jl.description, d.description) as description,
           g.code, jl.txn_currency, jl.id,
           case when jl.credit > 0 then 0 else jl.txn_amount end as dr,
           case when jl.credit > 0 then jl.txn_amount else 0 end as cr
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.entry_id
    join public.documents d on d.id = je.document_id
    join public.gl_accounts g on g.id = jl.account_id
    where jl.company_id = p_company and jl.party_id = p_party and je.entry_date <= p_to
      and g.control_kind in ('ar', 'ap', 'employee_advance', 'employee_payable', 'owner', 'customer_advance', 'supplier_advance')
  ), o as (
    select txn_currency, sum(dr - cr) as bal from l where entry_date < p_from group by txn_currency
  )
  select (p_from - 1), null::uuid, null::text, null::public.doc_kind, 'Opening balance', null::text, o.txn_currency, null::numeric, null::numeric, o.bal
  from o
  union all
  select l.entry_date, l.document_id, l.number, l.kind, l.description, l.code, l.txn_currency, l.dr, l.cr,
         coalesce(o.bal, 0) + sum(l.dr - l.cr) over (partition by l.txn_currency order by l.entry_date, l.id)
  from l left join o on o.txn_currency = l.txn_currency
  where l.entry_date >= p_from
  order by 7, 1
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.revise_document(uuid), public.convert_document(uuid, public.doc_kind),
                          public.aging(uuid, text, date), public.party_statement(uuid, uuid, date, date)
  to authenticated;
-- The verification page works without signing in.
grant execute on function public.verify_document(uuid) to anon, authenticated;
