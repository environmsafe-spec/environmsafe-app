-- ES-PF v2 · Phase 7: Deals (back-to-back procurement and sales in one file).
--
-- A deal file is a PROJECT. Every document can carry it (documents.project_id), and the deal page shows
-- the whole chain:
--   customer request -> RFQs to suppliers -> supplier offers -> our quotation -> customer order
--   -> purchase orders (one or several suppliers) -> goods receipts -> supplier bills / payments
--   -> shipping, customs (expenses on the project) -> delivery notes -> sales invoices -> receipts -> close.
-- Every step is optional. Lines remember the line they were made from (source_line_id), so one customer
-- order line can be bought from several suppliers, and receipts, deliveries and invoices can be partial:
-- the progress of each line is always known (public.deal_lines).
-- The new documents (request, RFQ, offer, order, receipt, delivery note) are tracking documents: they get
-- a number when issued and never touch the ledger.

-- ---------------------------------------------------------------------------
-- New document kinds
-- ---------------------------------------------------------------------------
insert into public.document_types (code, prefix, numbering, name_en, name_ar, module, sort) values
  ('customer_request', 'REQ', 'yearly', 'Customer request',     'طلب عميل',          'sales', 110),
  ('supplier_rfq',     'RFQ', 'yearly', 'Request for quotation', 'طلب عرض سعر',      'procurement', 120),
  ('supplier_offer',   'OFR', 'yearly', 'Supplier offer',       'عرض مورد',          'procurement', 130),
  ('sales_order',      'SO',  'yearly', 'Customer order',       'أمر بيع',           'sales', 140),
  ('goods_receipt',    'GRN', 'yearly', 'Goods receipt',        'استلام بضاعة',      'procurement', 150),
  ('delivery_note',    'DN',  'yearly', 'Delivery note',        'إشعار تسليم',       'sales', 160)
on conflict (code) do nothing;

insert into public.doc_kinds
  (kind, number_type, direction, has_lines, money_account, party_role, party_required, allows_fee, approval_applies, settles,
   post_permission, creates_journal, name_en, name_ar, sort)
values
  ('customer_request', 'customer_request', 'none', true, 'none', 'customer', true, false, false, '{}', 'docs.post', false, 'Customer request', 'طلب عميل',        300),
  ('supplier_rfq',     'supplier_rfq',     'none', true, 'none', 'supplier', true, false, false, '{}', 'docs.post', false, 'Request for quotation', 'طلب عرض سعر', 310),
  ('supplier_offer',   'supplier_offer',   'none', true, 'none', 'supplier', true, false, false, '{}', 'docs.post', false, 'Supplier offer',   'عرض مورد',        320),
  ('sales_order',      'sales_order',      'none', true, 'none', 'customer', true, false, false, '{}', 'docs.post', false, 'Customer order',   'أمر بيع',         330),
  ('goods_receipt',    'goods_receipt',    'none', true, 'none', 'supplier', true, false, false, '{}', 'docs.post', false, 'Goods receipt',    'استلام بضاعة',    340),
  ('delivery_note',    'delivery_note',    'none', true, 'none', 'customer', true, false, false, '{}', 'docs.post', false, 'Delivery note',    'إشعار تسليم',     350)
on conflict (kind) do nothing;

create or replace function app.is_tracking_kind(k public.doc_kind) returns boolean
language sql immutable set search_path = '' as $$
  select k::text in ('customer_request', 'supplier_rfq', 'supplier_offer', 'sales_order', 'goods_receipt', 'delivery_note')
$$;

-- ---------------------------------------------------------------------------
-- The deal file on documents, line lineage, deal fields on projects
-- ---------------------------------------------------------------------------
alter table public.documents add column if not exists project_id uuid;
alter table public.documents add constraint documents_project_fk foreign key (company_id, project_id)
  references public.projects (company_id, id);
create index if not exists documents_project_idx on public.documents (project_id) where project_id is not null;

alter table public.document_lines add column if not exists source_line_id uuid references public.document_lines (id) on delete set null;
alter table public.document_lines add column if not exists cost_price numeric(18, 4);    -- quotation: what the chosen offer costs us
create index if not exists document_lines_source_idx on public.document_lines (source_line_id) where source_line_id is not null;

-- Tracking documents may carry lines without a price (a request, an RFQ, a receipt): amount 0 is allowed
-- for them. Every other kind still needs an amount above zero (checked here for money documents and in
-- prepare_trade_document for trade documents).
alter table public.document_lines drop constraint if exists document_lines_amount_check;
alter table public.document_lines add constraint document_lines_amount_check check (amount >= 0);

create or replace function app.line_amount_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k public.doc_kind;
begin
  select kind into k from public.documents where id = new.document_id;
  if new.amount <= 0 and not app.is_tracking_kind(k)
     and k::text not in ('purchase_order', 'supplier_bill', 'quotation', 'sales_invoice', 'credit_note') then
    raise exception 'Every line needs an amount above zero';
  end if;
  return new;
end $$;
create trigger b_document_lines_amount before insert or update on public.document_lines
  for each row execute function app.line_amount_guard();

alter table public.projects add column if not exists deal_outcome text check (deal_outcome in ('won', 'lost', 'cancelled'));
alter table public.projects add column if not exists closed_on date;
alter table public.projects add column if not exists close_note text;

-- Copies keep the lineage and the cost (revisions, duplicates).
create or replace function app.copy_lines(p_from uuid, p_to uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.document_lines
    (company_id, document_id, line_no, line_kind, item_id, description, detail, qty, unit, unit_price, amount, percent,
     percent_base, side, gl_account_id, project_id, party_id, is_asset, source_line_id, cost_price)
  select company_id, p_to, line_no, line_kind, item_id, description, detail, qty, unit, unit_price, amount, percent,
         percent_base, side, gl_account_id, project_id, party_id, is_asset, source_line_id, cost_price
  from public.document_lines where document_id = p_from
$$;

-- ---------------------------------------------------------------------------
-- Validation of the tracking documents (trade documents keep their own rules)
-- ---------------------------------------------------------------------------
alter function app.prepare_trade_document(public.documents) rename to prepare_priced_document;

create or replace function app.prepare_tracking_document(d public.documents) returns void
language plpgsql security definer set search_path = '' as $$
declare l record;
begin
  if not exists (select 1 from public.document_lines where document_id = d.id) then
    raise exception 'Add at least one line';
  end if;
  for l in select * from public.document_lines where document_id = d.id order by line_no loop
    if l.item_id is null and coalesce(trim(l.description), '') = '' then
      raise exception 'Line %: choose the item or describe what is needed', l.line_no;
    end if;
    if l.qty <= 0 then
      raise exception 'Line %: the quantity must be above zero', l.line_no;
    end if;
  end loop;
  -- Priced tracking documents (offers, customer orders): amount = qty x price where a price is given.
  update public.document_lines set amount = round(qty * unit_price, 2)
   where document_id = d.id and unit_price is not null and amount <> round(qty * unit_price, 2);
  update public.document_lines set amount = 0 where document_id = d.id and unit_price is null and amount <> 0
     and d.kind::text in ('customer_request', 'supplier_rfq', 'goods_receipt', 'delivery_note');
  if d.kind::text = 'sales_order' and exists (select 1 from public.document_lines where document_id = d.id and unit_price is null) then
    raise exception 'A customer order needs a price on every line';
  end if;
  if d.kind::text = 'supplier_offer' and not exists (select 1 from public.document_lines where document_id = d.id and unit_price is not null) then
    raise exception 'Enter the supplier''s price on at least one line';
  end if;
end $$;

create or replace function app.prepare_trade_document(d public.documents) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if app.is_tracking_kind(d.kind) then
    perform app.prepare_tracking_document(d);
  else
    perform app.prepare_priced_document(d);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Create the next document of a deal from chosen lines ("Make RFQ / quotation / order / receipt / bill ...")
-- ---------------------------------------------------------------------------
create table if not exists public.deal_flows (
  from_kind public.doc_kind not null,
  to_kind   public.doc_kind not null,
  sort      smallint not null default 0,
  primary key (from_kind, to_kind)
);
insert into public.deal_flows values
  ('customer_request', 'supplier_rfq', 1), ('customer_request', 'quotation', 2), ('customer_request', 'sales_order', 3),
  ('supplier_rfq', 'supplier_offer', 1),
  ('supplier_offer', 'quotation', 1), ('supplier_offer', 'purchase_order', 2),
  ('quotation', 'sales_order', 1), ('quotation', 'sales_invoice', 2),
  ('sales_order', 'purchase_order', 1), ('sales_order', 'delivery_note', 2), ('sales_order', 'sales_invoice', 3),
  ('purchase_order', 'goods_receipt', 1), ('purchase_order', 'supplier_bill', 2),
  ('goods_receipt', 'supplier_bill', 1),
  ('delivery_note', 'sales_invoice', 1)
on conflict do nothing;
alter table public.deal_flows enable row level security;
create policy deal_flows_read on public.deal_flows for select to authenticated using (true);
grant select on public.deal_flows to authenticated;

create or replace function app.supplier_side(k public.doc_kind) returns boolean
language sql immutable set search_path = '' as $$
  select k::text in ('supplier_rfq', 'supplier_offer', 'purchase_order', 'goods_receipt', 'supplier_bill')
$$;

-- Quantity of a line already taken into documents of a kind (void documents do not count).
create or replace function app.used_qty(p_line uuid, p_kind public.doc_kind) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(c.qty), 0) from public.document_lines c join public.documents d on d.id = c.document_id
   where c.source_line_id = p_line and d.kind = p_kind and d.status <> 'void' and c.line_kind = 'item'
$$;

-- The price of a line in USD, looking back through receipts / deliveries to the priced line.
create or replace function app.line_price_usd(p_line uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  with recursive up as (
    select l.id, l.source_line_id, l.unit_price, d.kind, d.rate, 0 as depth
      from public.document_lines l join public.documents d on d.id = l.document_id where l.id = p_line
    union all
    select l.id, l.source_line_id, l.unit_price, d.kind, d.rate, up.depth + 1
      from up join public.document_lines l on l.id = up.source_line_id join public.documents d on d.id = l.document_id
     where up.depth < 10
  )
  select unit_price / rate from up
   where unit_price is not null and kind::text not in ('goods_receipt', 'delivery_note', 'customer_request', 'supplier_rfq')
   order by depth limit 1
$$;

-- What a supplier offered for this line (USD), found anywhere earlier in the chain
-- (customer order line <- quotation line <- offer line). Null when that supplier made no offer.
create or replace function app.offer_price_usd(p_line uuid, p_supplier uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  with recursive up as (
    select l.id, l.source_line_id, 0 as depth from public.document_lines l where l.id = p_line
    union all
    select l.id, l.source_line_id, up.depth + 1
      from up join public.document_lines l on l.id = up.source_line_id where up.depth < 10
  ), offers as (
    -- offer lines in the chain, and every offer line made from the same RFQ / request line
    select o.unit_price, d.rate, d.party_id, d.doc_date
      from up join public.document_lines o on o.id = up.id join public.documents d on d.id = o.document_id
     where d.kind = 'supplier_offer' and d.status = 'posted'
    union all
    select o.unit_price, d.rate, d.party_id, d.doc_date
      from up join public.document_lines r on r.source_line_id = up.id
      join public.document_lines o on o.source_line_id = r.id join public.documents d on d.id = o.document_id
     where d.kind = 'supplier_offer' and d.status = 'posted'
  )
  select unit_price / rate from offers where party_id = p_supplier and unit_price is not null
   order by doc_date desc limit 1
$$;

-- Steps that compare suppliers (RFQs, offers) or quote the customer take the full quantity every time;
-- the others (orders, receipts, deliveries, invoices, bills) use up the quantity, so they can be split.
create or replace function app.consumes_qty(k public.doc_kind) returns boolean
language sql immutable set search_path = '' as $$
  select k::text not in ('supplier_rfq', 'supplier_offer', 'quotation')
$$;

create or replace function public.make_document(
  p_kind public.doc_kind, p_line_ids uuid[], p_party uuid default null, p_margin numeric default null,
  p_currency char(3) default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  src       public.documents;
  v_from    public.doc_kind;
  v_count   int;
  v_docs    int;
  v_parties int;
  v_source  uuid;
  v_party   uuid;
  v_new     uuid;
  v_no      int := 0;
  ln        record;
  v_qty     numeric;
  v_usd     numeric;
  v_price   numeric;
  v_cost    numeric;
  v_rate    numeric;
  v_ccy     char(3);
  v_project uuid;
begin
  if p_line_ids is null or cardinality(p_line_ids) = 0 then raise exception 'Choose at least one line'; end if;
  select count(distinct d.kind), count(distinct d.id), count(distinct d.party_id) into v_count, v_docs, v_parties
    from public.document_lines l join public.documents d on d.id = l.document_id where l.id = any(p_line_ids);
  if v_count <> 1 then raise exception 'The chosen lines must come from documents of one kind'; end if;
  select d.* into src from public.document_lines l join public.documents d on d.id = l.document_id
   where l.id = any(p_line_ids) order by d.doc_date, d.created_at limit 1;
  if src.id is null or not app.has_perm(src.company_id, 'docs.view') then raise exception 'Document not found'; end if;
  perform app.require_perm(src.company_id, 'docs.create');
  if exists (select 1 from public.document_lines l join public.documents d on d.id = l.document_id
              where l.id = any(p_line_ids) and (d.company_id <> src.company_id or d.status <> 'posted')) then
    raise exception 'Issue the document first (only issued documents can be taken further)';
  end if;
  v_from := src.kind;
  if not exists (select 1 from public.deal_flows where from_kind = v_from and to_kind = p_kind) then
    raise exception 'A % cannot be made from a %', p_kind, v_from;
  end if;

  -- The party: given, or the source's when the side does not change, or the deal's customer.
  v_project := src.project_id;
  if p_party is null and v_parties > 1 and app.supplier_side(v_from) = app.supplier_side(p_kind) then
    raise exception 'The chosen lines are from different parties: choose the % for the new document',
      case when app.supplier_side(p_kind) then 'supplier' else 'customer' end;
  end if;
  v_party := coalesce(p_party,
    case when app.supplier_side(v_from) = app.supplier_side(p_kind) then src.party_id end,
    case when not app.supplier_side(p_kind) then (select customer_id from public.projects where id = v_project) end);
  if v_party is null then
    raise exception 'Choose the % for the new document', case when app.supplier_side(p_kind) then 'supplier' else 'customer' end;
  end if;
  if not exists (select 1 from public.parties where id = v_party and company_id = src.company_id
                   and case when app.supplier_side(p_kind) then is_supplier else is_customer end) then
    raise exception 'Choose a % for the new document', case when app.supplier_side(p_kind) then 'supplier' else 'customer' end;
  end if;
  v_ccy := coalesce(p_currency, src.currency);

  -- One source document of the same party is linked as the source (bill from PO); across sides
  -- (customer order -> purchase order) the lines carry the lineage.
  v_source := case when v_docs = 1 and v_party = src.party_id then src.id end;
  insert into public.documents (company_id, kind, doc_date, party_id, currency, rate, source_document_id, project_id,
                                attention, party_reference, terms, description)
  values (src.company_id, p_kind, current_date, v_party, v_ccy, null, v_source, v_project, null,
          case when p_kind::text in ('supplier_bill', 'supplier_offer') then null
               when v_party = src.party_id then src.party_reference else null end,
          case when v_party = src.party_id then src.terms end,
          src.description)
  returning id into v_new;
  select rate into v_rate from public.documents where id = v_new;

  for ln in select dl.*, d.rate as src_rate from public.document_lines dl join public.documents d on d.id = dl.document_id
            where dl.id = any(p_line_ids) and dl.line_kind = 'item' order by d.doc_date, d.created_at, dl.line_no loop
    v_qty := case when app.consumes_qty(p_kind) then ln.qty - app.used_qty(ln.id, p_kind) else ln.qty end;
    if v_qty <= 0 then continue; end if;
    v_usd := null; v_cost := null;
    if p_kind::text in ('supplier_rfq', 'supplier_offer', 'goods_receipt', 'delivery_note') then
      v_usd := null;                         -- the supplier prices the offer; receipts and deliveries are quantities
    elsif v_from::text = 'supplier_offer' and p_kind::text = 'quotation' then
      v_cost := round(ln.unit_price / ln.src_rate * v_rate, 4);
      v_usd := ln.unit_price / ln.src_rate * (1 + coalesce(p_margin, 0) / 100);
    elsif p_kind::text = 'purchase_order' and v_from::text = 'sales_order' then
      -- that supplier's offer if there was one, else the catalogue's last cost (a starting point to edit)
      v_usd := coalesce(app.offer_price_usd(ln.id, v_party),
        (select i.last_cost / app.rate_on(src.company_id, i.last_cost_currency, current_date)
           from public.items i where i.id = ln.item_id and i.last_cost is not null));
    elsif p_kind::text = 'quotation' and p_margin is not null then
      v_usd := (select i.last_cost / app.rate_on(src.company_id, i.last_cost_currency, current_date)
                  from public.items i where i.id = ln.item_id and i.last_cost is not null) * (1 + p_margin / 100);
    else
      v_usd := app.line_price_usd(ln.id);
    end if;
    v_price := round(v_usd * v_rate, 4);
    v_no := v_no + 1;
    insert into public.document_lines (company_id, document_id, line_no, line_kind, item_id, description, detail, qty, unit,
                                       unit_price, amount, project_id, source_line_id, cost_price)
    values (src.company_id, v_new, v_no, 'item', ln.item_id, ln.description, ln.detail, v_qty, ln.unit,
            v_price, coalesce(round(v_qty * v_price, 2), 0), coalesce(ln.project_id, v_project), ln.id, v_cost);
  end loop;
  if v_no = 0 then
    raise exception 'Nothing left to take: these lines are already fully in other documents of this kind';
  end if;

  -- Charges, discounts and tax of a priced source go along the first time only (never twice on partial steps).
  if v_source is not null and v_ccy = src.currency and p_kind::text in ('sales_order', 'sales_invoice', 'supplier_bill')
     and v_from::text in ('quotation', 'sales_order', 'purchase_order')
     and not exists (select 1 from public.documents x where x.source_document_id = src.id and x.kind = p_kind
                      and x.id <> v_new and x.status <> 'void') then
    insert into public.document_lines (company_id, document_id, line_no, line_kind, description, detail, qty, unit_price,
                                       amount, percent, percent_base, project_id)
    select company_id, v_new, v_no + row_number() over (order by line_no), line_kind, description, detail, qty, unit_price,
           amount, percent, percent_base, coalesce(project_id, v_project)
      from public.document_lines where document_id = src.id and line_kind <> 'item';
  end if;
  perform app.log_event(src.company_id, 'documents', v_new::text, format('Made from %s', coalesce(src.number, src.temp_number)));
  return v_new;
end $$;

-- ---------------------------------------------------------------------------
-- Progress of each order line, and the deals
-- ---------------------------------------------------------------------------
-- For each line of a customer order or purchase order: what has been bought, received, delivered,
-- invoiced and billed against it, through every step made from it (void documents do not count).
create or replace function public.deal_lines(p_project uuid)
returns table (line_id uuid, document_id uuid, kind text, number text, party_id uuid, line_no smallint, item_id uuid,
               description text, unit text, qty numeric, unit_price numeric, currency char(3),
               purchased numeric, received numeric, delivered numeric, invoiced numeric, billed numeric)
language sql stable security definer set search_path = '' as $$
  with recursive roots as (
    select l.id, l.document_id, d.kind, d.number, d.party_id, l.line_no, l.item_id, l.description, l.unit, l.qty, l.unit_price, d.currency
      from public.document_lines l join public.documents d on d.id = l.document_id
     where d.project_id = p_project and d.kind::text in ('sales_order', 'purchase_order') and d.status = 'posted'
       and l.line_kind = 'item' and app.has_perm(d.company_id, 'docs.view')
  ), tree as (
    select r.id as root, l.id, d.kind, l.qty, 1 as depth
      from roots r join public.document_lines l on l.source_line_id = r.id join public.documents d on d.id = l.document_id
     where d.status <> 'void'
    union all
    select t.root, l.id, d.kind, l.qty, t.depth + 1
      from tree t join public.document_lines l on l.source_line_id = t.id join public.documents d on d.id = l.document_id
     where d.status <> 'void' and t.depth < 8
  )
  select r.id, r.document_id, r.kind::text, r.number, r.party_id, r.line_no, r.item_id, r.description, r.unit, r.qty, r.unit_price, r.currency,
         coalesce(sum(t.qty) filter (where t.kind::text = 'purchase_order'), 0),
         coalesce(sum(t.qty) filter (where t.kind::text = 'goods_receipt'), 0),
         coalesce(sum(t.qty) filter (where t.kind::text = 'delivery_note'), 0),
         coalesce(sum(t.qty) filter (where t.kind::text = 'sales_invoice'), 0),
         coalesce(sum(t.qty) filter (where t.kind::text = 'supplier_bill'), 0)
    from roots r left join tree t on t.root = r.id
   group by r.id, r.document_id, r.kind, r.number, r.party_id, r.line_no, r.item_id, r.description, r.unit, r.qty, r.unit_price, r.currency
   order by r.kind desc, r.number, r.line_no
$$;

-- One row per deal (a project with deal documents): where it stands and the money.
create or replace view public.v_deals with (security_invoker = true) as
with docs as (
  select d.project_id, d.kind::text as kind, d.status, d.amount, d.currency, d.doc_date, d.id
    from public.documents d where d.project_id is not null and d.status <> 'void'
), k as (
  select project_id,
         bool_or(kind = 'customer_request') as has_request,
         bool_or(kind = 'supplier_rfq' and status = 'posted') as has_rfq,
         bool_or(kind = 'supplier_offer' and status = 'posted') as has_offer,
         bool_or(kind = 'quotation' and status = 'posted') as has_quote,
         bool_or(kind = 'sales_order' and status = 'posted') as has_order,
         bool_or(kind = 'purchase_order' and status = 'posted') as has_po,
         bool_or(kind = 'goods_receipt' and status = 'posted') as has_grn,
         bool_or(kind = 'delivery_note' and status = 'posted') as has_dn,
         bool_or(kind = 'sales_invoice' and status = 'posted') as has_inv,
         count(*) filter (where status in ('draft', 'submitted')) as drafts,
         max(doc_date) as last_date
    from docs group by project_id
), money as (
  select d.project_id,
         sum(b.amount / d.rate) filter (where d.kind = 'sales_order') as ordered_usd,
         sum(b.amount / d.rate) filter (where d.kind = 'sales_invoice') as invoiced_usd,
         sum(b.open_amount / d.rate) filter (where d.kind = 'sales_invoice') as receivable_usd,
         sum(b.amount / d.rate) filter (where d.kind = 'supplier_bill') as billed_usd,
         sum(b.open_amount / d.rate) filter (where d.kind = 'supplier_bill') as payable_usd
    from public.documents d join public.v_document_balances b on b.id = d.id
   where d.project_id is not null and d.status = 'posted'
   group by d.project_id
)
select p.id, p.company_id, p.code, p.name_en, p.name_ar, p.customer_id, c.name_en as customer_name, p.status::text as status, p.deal_outcome,
       p.closed_on,
       case
         when p.status = 'closed' then coalesce(p.deal_outcome, 'closed')
         when k.has_inv and coalesce(m.receivable_usd, 0) = 0 then 'paid'
         when k.has_inv then 'invoiced'
         when k.has_dn then 'delivered'
         when k.has_grn then 'received'
         when k.has_po then 'purchasing'
         when k.has_order then 'ordered'
         when k.has_quote then 'quoted'
         when k.has_offer then 'offers'
         when k.has_rfq then 'sourcing'
         else 'request'
       end as stage,
       k.drafts, k.last_date,
       round(coalesce(m.ordered_usd, 0), 2) as ordered_usd, round(coalesce(m.invoiced_usd, 0), 2) as invoiced_usd,
       round(coalesce(m.receivable_usd, 0), 2) as receivable_usd, round(coalesce(m.billed_usd, 0), 2) as billed_usd,
       round(coalesce(m.payable_usd, 0), 2) as payable_usd
  from public.projects p
  join k on k.project_id = p.id
  left join money m on m.project_id = p.id
  left join public.parties c on c.id = p.customer_id;
grant select on public.v_deals to authenticated;
grant execute on function public.deal_lines(uuid) to authenticated;
grant execute on function public.make_document(public.doc_kind, uuid[], uuid, numeric, char) to authenticated;

-- ---------------------------------------------------------------------------
-- Start and close a deal
-- ---------------------------------------------------------------------------
create or replace function public.create_deal(p_company uuid, p_customer uuid, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  perform app.require_perm(p_company, 'docs.create');
  if not exists (select 1 from public.parties where id = p_customer and company_id = p_company and is_customer) then
    raise exception 'Choose a customer';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the deal a name'; end if;
  insert into public.projects (company_id, code, name_en, customer_id, kind, status)
  values (p_company, '', trim(p_name), p_customer, 'contract', 'active') returning id into v;
  return v;
end $$;

-- What still prevents closing a won deal (empty = ready).
create or replace function public.deal_open_items(p_project uuid) returns table (problem text)
language sql stable security definer set search_path = '' as $$
  select format('%s %s is still a draft', k.name_en, d.temp_number)
    from public.documents d join public.doc_kinds k on k.kind = d.kind
   where d.project_id = p_project and d.status in ('draft', 'submitted') and app.has_perm(d.company_id, 'docs.view')
  union all
  select format('Order %s line %s: %s of %s invoiced', l.number, l.line_no, trim_scale(l.invoiced), trim_scale(l.qty))
    from public.deal_lines(p_project) l where l.kind = 'sales_order' and l.invoiced < l.qty
  union all
  select format('Invoice %s: %s %s not yet received', d.number, b.open_amount, d.currency)
    from public.documents d join public.v_document_balances b on b.id = d.id
   where d.project_id = p_project and d.kind::text = 'sales_invoice' and b.open_amount > 0 and app.has_perm(d.company_id, 'docs.view')
  union all
  select format('Supplier bill %s: %s %s not yet paid', d.number, b.open_amount, d.currency)
    from public.documents d join public.v_document_balances b on b.id = d.id
   where d.project_id = p_project and d.kind::text = 'supplier_bill' and b.open_amount > 0 and app.has_perm(d.company_id, 'docs.view')
$$;
grant execute on function public.deal_open_items(uuid) to authenticated;

create or replace function public.close_deal(p_project uuid, p_outcome text, p_note text default null, p_force boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  p public.projects;
  v_open text;
begin
  select * into p from public.projects where id = p_project;
  if p.id is null then raise exception 'Deal not found'; end if;
  perform app.require_perm(p.company_id, 'docs.post');
  if p_outcome not in ('won', 'lost', 'cancelled') then raise exception 'The outcome is won, lost or cancelled'; end if;
  if p_outcome = 'won' then
    select string_agg(problem, E'\n') into v_open from public.deal_open_items(p_project);
    if v_open is not null and not p_force then
      raise exception E'Not ready to close:\n%', v_open;
    end if;
    if v_open is not null and coalesce(trim(p_note), '') = '' then
      raise exception 'Closing with open items needs a note saying why';
    end if;
  elsif exists (select 1 from public.documents where project_id = p_project and status = 'posted'
                 and kind::text in ('sales_order', 'sales_invoice', 'purchase_order', 'supplier_bill')) then
    raise exception 'This deal has orders or invoices: void them first, or close it as won';
  end if;
  update public.projects set status = 'closed', deal_outcome = p_outcome, closed_on = current_date, close_note = p_note
   where id = p_project;
  perform app.log_event(p.company_id, 'projects', p_project::text, format('Deal closed: %s%s', p_outcome, coalesce(' — ' || p_note, '')));
end $$;

create or replace function public.reopen_deal(p_project uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.projects;
begin
  select * into p from public.projects where id = p_project;
  if p.id is null then raise exception 'Deal not found'; end if;
  perform app.require_perm(p.company_id, 'docs.post');
  update public.projects set status = 'active', deal_outcome = null, closed_on = null where id = p_project;
  perform app.log_event(p.company_id, 'projects', p_project::text, 'Deal reopened');
end $$;
grant execute on function public.create_deal(uuid, uuid, text), public.close_deal(uuid, text, text, boolean),
                          public.reopen_deal(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Three-way match: a supplier bill against its purchase order and goods receipt (warnings, not blocks)
-- ---------------------------------------------------------------------------
create or replace function public.match_check(p_bill uuid) returns table (line_no smallint, problem text)
language plpgsql stable security definer set search_path = '' as $$
declare
  b public.documents;
  l record;
  v_po record;
  v_received numeric;
  v_billed numeric;
begin
  select * into b from public.documents where id = p_bill;
  if b.id is null or not app.has_perm(b.company_id, 'docs.view') then return; end if;
  for l in select * from public.document_lines where document_id = p_bill and line_kind = 'item' order by document_lines.line_no loop
    -- The purchase order line behind this bill line (directly, or through a goods receipt).
    with recursive up as (
      select x.id, x.source_line_id, d.kind, x.unit_price, x.qty, 0 as depth
        from public.document_lines x join public.documents d on d.id = x.document_id where x.id = l.source_line_id
      union all
      select x.id, x.source_line_id, d.kind, x.unit_price, x.qty, up.depth + 1
        from up join public.document_lines x on x.id = up.source_line_id join public.documents d on d.id = x.document_id
       where up.depth < 5
    )
    select id, unit_price, qty into v_po from up where kind::text = 'purchase_order' limit 1;
    if v_po.id is null then
      line_no := l.line_no; problem := 'No purchase order behind this line'; return next; continue;
    end if;
    with recursive down as (
      select x.id, d.kind, x.qty, 1 as depth from public.document_lines x join public.documents d on d.id = x.document_id
       where x.source_line_id = v_po.id and d.status <> 'void'
      union all
      select x.id, d.kind, x.qty, down.depth + 1 from down join public.document_lines x on x.source_line_id = down.id
        join public.documents d on d.id = x.document_id where d.status <> 'void' and down.depth < 5
    )
    select coalesce(sum(qty) filter (where kind::text = 'goods_receipt'), 0),
           coalesce(sum(qty) filter (where kind::text = 'supplier_bill'), 0)
      into v_received, v_billed from down;
    if v_received = 0 then
      line_no := l.line_no; problem := 'Nothing received yet against the purchase order'; return next;
    elsif v_billed > v_received then
      line_no := l.line_no; problem := format('Billed %s but received %s', trim_scale(v_billed), trim_scale(v_received)); return next;
    end if;
    if v_billed > v_po.qty then
      line_no := l.line_no; problem := format('Billed %s but ordered %s', trim_scale(v_billed), trim_scale(v_po.qty)); return next;
    end if;
    if v_po.unit_price is not null and l.unit_price is not null and l.unit_price <> v_po.unit_price then
      line_no := l.line_no; problem := format('Price %s differs from the purchase order (%s)', trim_scale(l.unit_price), trim_scale(v_po.unit_price)); return next;
    end if;
  end loop;
end $$;
grant execute on function public.match_check(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Offers side by side: for each requested line, every supplier's posted offer (lowest USD first)
-- ---------------------------------------------------------------------------
create or replace function public.deal_offers(p_project uuid)
returns table (request_line_id uuid, request_number text, line_no smallint, item_id uuid, description text, qty numeric,
               unit text, offer_line_id uuid, offer_id uuid, offer_number text, supplier_id uuid, supplier text,
               offer_qty numeric, currency char(3), unit_price numeric, unit_price_usd numeric, rank_usd bigint)
language sql stable security definer set search_path = '' as $$
  with req as (
    select l.id, d.number, l.line_no, l.item_id, l.description, l.qty, l.unit
      from public.document_lines l join public.documents d on d.id = l.document_id
     where d.project_id = p_project and d.kind = 'customer_request' and d.status = 'posted' and l.line_kind = 'item'
       and app.has_perm(d.company_id, 'docs.view')
  ), off as (
    select r.id as req_line, o.id, od.id as doc_id, od.number, od.party_id, o.qty, od.currency, o.unit_price,
           round(o.unit_price / od.rate, 4) as usd
      from req r
      join public.document_lines q on q.source_line_id = r.id          -- RFQ line
      join public.document_lines o on o.source_line_id = q.id          -- offer line
      join public.documents od on od.id = o.document_id
     where od.kind = 'supplier_offer' and od.status = 'posted' and o.unit_price is not null
  )
  select r.id, r.number, r.line_no, r.item_id, r.description, r.qty, r.unit,
         o.id, o.doc_id, o.number, o.party_id, p.name_en, o.qty, o.currency, o.unit_price, o.usd,
         case when o.id is null then null else rank() over (partition by r.id order by o.usd) end
    from req r left join off o on o.req_line = r.id left join public.parties p on p.id = o.party_id
   order by r.number, r.line_no, o.usd nulls last
$$;
grant execute on function public.deal_offers(uuid) to authenticated;
