-- ES-PF v2 · step 1 (brief v2, items A1, A2, A7, A16).
--
-- A2  No empty amounts: every document line carries an amount above zero, checked by the database for every
--     way in (screens, API, imports, SQL), drafts included. Only the documents that carry no money are exempt:
--     customer request, RFQ, goods receipt, delivery note, and offer lines the supplier did not price.
--     Statuses shown to people: Draft, Submitted, Posted, Reconciled (a posted money document matched to the
--     bank), Void (posted, then reversed), Cancelled (a draft withdrawn, never posted). Cancelled and Void are
--     both stored as 'void'; a document without a number was never posted, so it reads "Cancelled".
-- A7  Number formats: Q-YYYYMMDDNN, RFQ-YYYYMMDDNN, and the same daily style for the other deal documents.

-- ---------------------------------------------------------------------------
-- A2: amounts
-- ---------------------------------------------------------------------------
create or replace function app.line_amount_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k public.doc_kind;
begin
  select kind into k from public.documents where id = new.document_id;
  -- item lines: amount = quantity x price, always (the posting check recomputes it the same way)
  if new.line_kind = 'item' and new.unit_price is not null and new.qty is not null then
    new.amount := round(new.qty * new.unit_price, 2);
  end if;
  if new.amount is null or new.amount <= 0 then
    if k::text in ('customer_request', 'supplier_rfq', 'goods_receipt', 'delivery_note') then
      return new;                                     -- quantities only, no money
    end if;
    if k::text = 'supplier_offer' and new.unit_price is null then
      return new;                                     -- the supplier did not price this line
    end if;
    raise exception 'Line %: the amount must be above zero (enter the quantity and price)', new.line_no;
  end if;
  return new;
end $$;

-- Reconciled: a posted payment / receipt / transfer matched to the bank statement.
alter table public.documents add column if not exists reconciled_at timestamptz;
alter table public.documents add column if not exists reconciled_by uuid;

create or replace function public.set_reconciled(p_ids uuid[], p_reconciled boolean default true) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_company uuid; n integer;
begin
  select min(company_id::text)::uuid into v_company from public.documents where id = any(p_ids);
  if v_company is null then raise exception 'Document not found'; end if;
  perform app.require_perm(v_company, 'docs.post_money');
  if exists (select 1 from public.documents where id = any(p_ids)
              and (company_id <> v_company or status <> 'posted' or money_account_id is null)) then
    raise exception 'Only posted payments, receipts and transfers can be reconciled';
  end if;
  perform app.begin_internal();
  update public.documents
     set reconciled_at = case when p_reconciled then now() end, reconciled_by = case when p_reconciled then auth.uid() end
   where id = any(p_ids);
  get diagnostics n = row_count;
  perform app.end_internal();
  perform app.log_event(v_company, 'documents', array_to_string(p_ids, ','), case when p_reconciled then 'Reconciled' else 'Reconciliation removed' end);
  return n;
end $$;
grant execute on function public.set_reconciled(uuid[], boolean) to authenticated;

-- The six statuses as people read them.
create or replace function public.display_status(d public.documents) returns text
language sql stable set search_path = '' as $$
  select case
    when d.status = 'void' and d.number is null then 'cancelled'
    when d.status = 'posted' and d.reconciled_at is not null then 'reconciled'
    else d.status::text end
$$;
grant execute on function public.display_status(public.documents) to authenticated;

-- "Next step" may carry the prices typed in its window; a document with money never gets a line without one.
drop function if exists public.make_document(public.doc_kind, uuid[], uuid, numeric, char);
create or replace function public.make_document(
  p_kind public.doc_kind, p_line_ids uuid[], p_party uuid default null, p_margin numeric default null,
  p_currency char(3) default null, p_prices jsonb default null
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
  v_missing text;
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
  -- Currency: as asked; else the source's on the same side; else the deal's currency with the customer,
  -- or that supplier's offer currency; else USD.
  v_ccy := coalesce(p_currency,
    case when app.supplier_side(v_from) = app.supplier_side(p_kind) and v_parties = 1 then src.currency end,
    case when app.supplier_side(p_kind) then
      (select d.currency from public.documents d where d.project_id = v_project and d.party_id = v_party
          and d.kind = 'supplier_offer' and d.status = 'posted' order by d.doc_date desc, d.created_at desc limit 1)
    else
      (select d.currency from public.documents d where d.project_id = v_project and d.status <> 'void'
          and d.kind::text in ('customer_request', 'quotation', 'sales_order') order by d.created_at desc limit 1)
    end,
    'USD');

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
    v_qty := case when app.consumes_qty(p_kind) then app.open_qty(ln.id, p_kind) else ln.qty end;
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
    -- customer prices in cents; purchase prices keep 4 decimals (unit costs such as 12.1900 / kg)
    v_price := round(v_usd * v_rate, case when app.supplier_side(p_kind) then 4 else 2 end);
    -- a price typed in the "Next step" window wins
    if p_prices ? ln.id::text and nullif(p_prices ->> ln.id::text, '') is not null then
      v_price := (p_prices ->> ln.id::text)::numeric;
    end if;
    -- documents with money need a price on every line (no zero amounts, rule A2)
    if v_price is null and p_kind::text in ('quotation', 'sales_order', 'purchase_order', 'sales_invoice', 'supplier_bill') then
      v_missing := concat_ws(', ', v_missing, coalesce(ln.description, 'line ' || ln.line_no));
      continue;
    end if;
    v_no := v_no + 1;
    insert into public.document_lines (company_id, document_id, line_no, line_kind, item_id, description, detail, qty, unit,
                                       unit_price, amount, project_id, source_line_id, cost_price)
    values (src.company_id, v_new, v_no, 'item', ln.item_id, ln.description, ln.detail, v_qty, ln.unit,
            v_price, coalesce(round(v_qty * v_price, 2), 0), coalesce(ln.project_id, v_project), ln.id, v_cost);
  end loop;
  if v_missing is not null then
    raise exception 'No price known for: %. Enter the price for these lines.', v_missing;
  end if;
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
grant execute on function public.make_document(public.doc_kind, uuid[], uuid, numeric, char, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- A7: number formats (series already issued keep their numbers)
-- ---------------------------------------------------------------------------
update public.document_types set prefix = 'Q-',   numbering = 'daily' where code = 'quotation';
update public.document_types set prefix = 'RFQ-', numbering = 'daily' where code = 'supplier_rfq';
update public.document_types set prefix = 'REQ-', numbering = 'daily' where code = 'customer_request';
update public.document_types set prefix = 'OFR-', numbering = 'daily' where code = 'supplier_offer';
update public.document_types set prefix = 'SO-',  numbering = 'daily' where code = 'sales_order';
update public.document_types set prefix = 'GRN-', numbering = 'daily' where code = 'goods_receipt';
update public.document_types set prefix = 'DN-',  numbering = 'daily' where code = 'delivery_note';
