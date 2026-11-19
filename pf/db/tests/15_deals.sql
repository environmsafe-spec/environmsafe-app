-- Deals (back-to-back): customer request -> RFQs to 3 suppliers -> offers (USD and SAR) -> comparison
-- -> quotation with margin -> customer order -> order split across 3 suppliers (one line split in two)
-- -> partial goods receipt -> bill with three-way-match warnings -> delivery -> invoice -> close.
begin;
select plan(65);
select tests.phase2_fixtures();
insert into public.parties (company_id, code, primary_kind, name_en) values
  (tests.es(), '', 'supplier', 'T Supplier 2'), (tests.es(), '', 'supplier', 'T Supplier 3');
insert into public.items (company_id, code, name_en, kind, unit, default_expense_account_id, default_revenue_account_id) values
  (tests.es(), '', 'Centrifugal pump',  'goods', 'PC',  tests.acct('5200'), tests.acct('4100')),
  (tests.es(), '', 'Gate valve 4"',     'goods', 'PC',  tests.acct('5200'), tests.acct('4100')),
  (tests.es(), '', 'Seal kit',          'goods', 'SET', tests.acct('5200'), tests.acct('4100'));
create temp table t_item as select id, name_en from public.items;
grant select on t_item to authenticated;
create temp table t (k text primary key, id uuid);
grant all on t to authenticated;
create function pg_temp.id(p text) returns uuid language sql as $$ select id from t where k = p $$;
create function pg_temp.lines(p_doc uuid) returns uuid[] language sql as $$
  select array_agg(id order by line_no) from public.document_lines where document_id = p_doc and line_kind = 'item' $$;
create function pg_temp.line(p_doc uuid, p_no int) returns uuid language sql as $$
  select id from public.document_lines where document_id = p_doc and line_no = p_no $$;
create function pg_temp.summary(p_doc uuid) returns text language sql as $$
  select string_agg(coalesce(description, '') || ' x' || qty::numeric(18,2) || coalesce(' @' || unit_price::numeric(18,2), ''), ' | ' order by line_no)
    from public.document_lines where document_id = p_doc and line_kind = 'item' $$;
-- make_document as a user; returns the new id, or the error
create function pg_temp.make(p_email text, p_key text, p_kind text, p_lines uuid[], p_party uuid default null,
                             p_margin numeric default null, p_ccy char(3) default null) returns text
language plpgsql as $$
declare v uuid;
begin
  perform tests.login(p_email);
  begin
    v := public.make_document(p_kind::public.doc_kind, p_lines, p_party, p_margin, p_ccy);
  exception when others then
    perform tests.logout();
    return 'ERROR: ' || sqlerrm;
  end;
  perform tests.logout();
  insert into t values (p_key, v) on conflict (k) do update set id = excluded.id;
  update public.documents set doc_date = '2026-11-20' where id = v;
  return 'made';
end $$;

grant execute on function pg_temp.id(text), pg_temp.lines(uuid), pg_temp.line(uuid, int), pg_temp.summary(uuid) to authenticated;

-- ---------- The deal and the customer's request ----------------------------------------------------
select tests.login('procurement@es.test');
insert into t select 'deal', public.create_deal(tests.es(), tests.party('T Customer'), 'Pumps for the refinery');
select tests.logout();
select ok((select code like 'PJ%' and customer_id = tests.party('T Customer') from public.projects where id = pg_temp.id('deal')),
  'a deal is a project of the customer');

insert into public.documents (company_id, kind, doc_date, party_id, project_id, party_reference)
values (tests.es(), 'customer_request', '2026-11-19', tests.party('T Customer'), pg_temp.id('deal'), 'RFQ-REF-2211')
returning id as req \gset
insert into t values ('req', :'req');
insert into public.document_lines (company_id, document_id, line_no, item_id, description, qty, unit, amount) values
  (tests.es(), :'req', 1, (select id from t_item where name_en = 'Centrifugal pump'), 'Centrifugal pump 50 m3/h', 2, 'PC', 0),
  (tests.es(), :'req', 2, null, 'Mechanical seal kit (as per drawing)', 10, 'SET', 0),
  (tests.es(), :'req', 3, (select id from t_item where name_en = 'Gate valve 4"'), 'Gate valve 4" class 150', 5, 'PC', 0);
select is(tests.post_as('procurement@es.test', :'req'), 'posted', 'the request is issued (a line may be just a description)');
select is((select number from public.documents where id = :'req'), 'REQ-2026-0001', 'request numbered REQ-YYYY-NNNN');
select ok((select journal_entry_id is null from public.documents where id = :'req'), 'tracking documents never touch the ledger');

-- ---------- RFQs to three suppliers (each gets the full quantity) -----------------------------------
select is(pg_temp.make('viewer@es.test', 'x', 'supplier_rfq', pg_temp.lines(:'req'), tests.party('T Supplier')),
  'ERROR: Document not found', 'a viewer cannot see or make documents');
select is(pg_temp.make('procurement@es.test', 'x', 'supplier_rfq', pg_temp.lines(:'req')),
  'ERROR: Choose the supplier for the new document', 'an RFQ needs the supplier');
select is(pg_temp.make('procurement@es.test', 'x', 'supplier_rfq', pg_temp.lines(:'req'), tests.party('T Customer')),
  'ERROR: Choose a supplier for the new document', 'an RFQ goes to a supplier, not a customer');
select is(pg_temp.make('procurement@es.test', 'rfq1', 'supplier_rfq', pg_temp.lines(:'req'), tests.party('T Supplier')), 'made', 'RFQ to supplier 1');
select is(pg_temp.make('procurement@es.test', 'rfq2', 'supplier_rfq', pg_temp.lines(:'req'), tests.party('T Supplier 2')), 'made', 'RFQ to supplier 2');
select is(pg_temp.make('procurement@es.test', 'rfq3', 'supplier_rfq', pg_temp.lines(:'req'), tests.party('T Supplier 3')), 'made', 'RFQ to supplier 3');
select is(pg_temp.summary(pg_temp.id('rfq2')),
  'Centrifugal pump 50 m3/h x2.00 | Mechanical seal kit (as per drawing) x10.00 | Gate valve 4" class 150 x5.00',
  'each RFQ asks for every line in full, without prices');
select is((select project_id from public.documents where id = pg_temp.id('rfq3')), pg_temp.id('deal'), 'the RFQ belongs to the deal');
select is(tests.post_as('procurement@es.test', pg_temp.id('rfq1')), 'posted', 'RFQ 1 issued');
select is(tests.post_as('procurement@es.test', pg_temp.id('rfq2')), 'posted', 'RFQ 2 issued');
select is(tests.post_as('procurement@es.test', pg_temp.id('rfq3')), 'posted', 'RFQ 3 issued');
select is((select number from public.documents where id = pg_temp.id('rfq3')), 'RFQ-2026-0003', 'RFQ numbers');

-- ---------- Offers: supplier 1 and 3 in USD, supplier 2 in SAR ---------------------------------------
select is(pg_temp.make('procurement@es.test', 'x', 'purchase_order', pg_temp.lines(pg_temp.id('rfq1'))),
  'ERROR: A purchase_order cannot be made from a supplier_rfq', 'only the allowed next steps');
select is(pg_temp.make('procurement@es.test', 'ofr1', 'supplier_offer', pg_temp.lines(pg_temp.id('rfq1'))), 'made', 'offer of supplier 1 entered');
select is(tests.post_as('procurement@es.test', pg_temp.id('ofr1')), 'ERROR: Enter the supplier''s price on at least one line', 'an offer needs prices');
update public.document_lines set unit_price = case line_no when 1 then 1000 when 2 then 20 else 150 end where document_id = pg_temp.id('ofr1');
select is(pg_temp.make('procurement@es.test', 'ofr2', 'supplier_offer', pg_temp.lines(pg_temp.id('rfq2')), null, null, 'SAR'), 'made', 'offer of supplier 2 (SAR)');
update public.document_lines set unit_price = case line_no when 1 then 3600 when 2 then 70 else 600 end where document_id = pg_temp.id('ofr2');
select is(pg_temp.make('procurement@es.test', 'ofr3', 'supplier_offer', pg_temp.lines(pg_temp.id('rfq3'))), 'made', 'offer of supplier 3');
update public.document_lines set unit_price = case line_no when 1 then 1100 when 2 then 15 else 140 end where document_id = pg_temp.id('ofr3');
select is(tests.post_as('procurement@es.test', pg_temp.id('ofr1')), 'posted', 'offer 1 recorded');
select is(tests.post_as('procurement@es.test', pg_temp.id('ofr2')), 'posted', 'offer 2 recorded');
select is(tests.post_as('procurement@es.test', pg_temp.id('ofr3')), 'posted', 'offer 3 recorded');
select is((select amount from public.documents where id = pg_temp.id('ofr1')), 2950.00, 'offer total = sum of qty x price');

select tests.login('procurement@es.test');
select is((select string_agg(supplier || ' ' || unit_price_usd::numeric(18,2), ', ' order by rank_usd)
             from public.deal_offers(pg_temp.id('deal')) where line_no = 3),
  'T Supplier 3 140.00, T Supplier 150.00, T Supplier 2 158.31',
  'offers compared per line in USD, cheapest first (SAR converted)');
select tests.logout();

-- ---------- Quotation: best offer per line + 20% margin --------------------------------------------
select is(pg_temp.make('procurement@es.test', 'qt', 'quotation',
            array[pg_temp.line(pg_temp.id('ofr1'), 1), pg_temp.line(pg_temp.id('ofr3'), 2), pg_temp.line(pg_temp.id('ofr3'), 3)],
            null, 20), 'made', 'quotation from the chosen offers of two suppliers');
select is((select party_id from public.documents where id = pg_temp.id('qt')), tests.party('T Customer'), 'the quotation goes to the deal''s customer');
select is((select string_agg(cost_price::numeric(18,2) || ' -> ' || unit_price::numeric(18,2), ', ' order by line_no)
             from public.document_lines where document_id = pg_temp.id('qt')),
  '1000.00 -> 1200.00, 15.00 -> 18.00, 140.00 -> 168.00', 'cost from the offer, price = cost + 20%');
select alike(tests.post_as('procurement@es.test', pg_temp.id('qt')), 'ERROR: Line 2: choose the item%', 'a quoted line needs a catalogue item');
update public.document_lines set item_id = (select id from t_item where name_en = 'Seal kit')
 where document_id = pg_temp.id('qt') and line_no = 2;
select is(tests.post_as('procurement@es.test', pg_temp.id('qt')), 'posted', 'quotation issued');
select is(pg_temp.make('procurement@es.test', 'qt2', 'quotation',
            array[pg_temp.line(pg_temp.id('ofr2'), 1), pg_temp.line(pg_temp.id('ofr3'), 3)], null, 10), 'made', 'a quotation from a SAR and a USD offer');
select is((select currency || ' ' || string_agg(cost_price::numeric(18,2) || '->' || unit_price::numeric(18,2), ', ' order by line_no)
             from public.document_lines l join public.documents d on d.id = l.document_id where d.id = pg_temp.id('qt2') group by currency),
  'USD 949.87->1044.85, 140.00->154.00', 'it is in the customer''s currency (USD), SAR costs converted');
select is((select amount from public.documents where id = pg_temp.id('qt')), 3420.00, 'quotation total 2x1200 + 10x18 + 5x168');

-- ---------- Customer order (their PO) -------------------------------------------------------------
select is(pg_temp.make('procurement@es.test', 'so', 'sales_order', pg_temp.lines(pg_temp.id('qt'))), 'made', 'customer order from the quotation');
update public.documents set party_reference = 'CUST-PO-77' where id = pg_temp.id('so');
select is(tests.post_as('procurement@es.test', pg_temp.id('so')), 'posted', 'customer order confirmed');
select is((select number || ' ' || amount from public.documents where id = pg_temp.id('so')), 'SO-2026-0001 3420.00', 'SO number and value');

-- ---------- Split purchasing: pump from supplier 1, seals and 3 valves from supplier 3, 2 valves from supplier 2 in SAR
select is(pg_temp.make('procurement@es.test', 'poA', 'purchase_order', array[pg_temp.line(pg_temp.id('so'), 1)], tests.party('T Supplier')),
  'made', 'PO A: the pumps');
select is(pg_temp.summary(pg_temp.id('poA')), 'Centrifugal pump 50 m3/h x2.00 @1000.00', 'PO A takes supplier 1''s offered price');
select is(pg_temp.make('procurement@es.test', 'poB', 'purchase_order',
            array[pg_temp.line(pg_temp.id('so'), 2), pg_temp.line(pg_temp.id('so'), 3)], tests.party('T Supplier 3')), 'made', 'PO B: seals and valves');
update public.document_lines set qty = 3 where document_id = pg_temp.id('poB') and line_no = 2;
select is(pg_temp.make('procurement@es.test', 'poC', 'purchase_order', array[pg_temp.line(pg_temp.id('so'), 3)], tests.party('T Supplier 2')),
  'made', 'PO C: the remaining valves');
select is((select currency || ' ' || pg_temp.summary(id) from public.documents where id = pg_temp.id('poC')),
  'SAR Gate valve 4" class 150 x2.00 @600.00', 'PO C: only the 2 valves still open, in supplier 2''s offer currency and price');
select is(pg_temp.make('procurement@es.test', 'x', 'purchase_order', array[pg_temp.line(pg_temp.id('so'), 3)], tests.party('T Supplier')),
  'ERROR: Nothing left to take: these lines are already fully in other documents of this kind', 'a line cannot be ordered twice');
select is(tests.post_as('procurement@es.test', pg_temp.id('poA')), 'posted', 'PO A issued');
select is(tests.post_as('procurement@es.test', pg_temp.id('poB')), 'posted', 'PO B issued');
select is(tests.post_as('procurement@es.test', pg_temp.id('poC')), 'posted', 'PO C issued');

select tests.login('procurement@es.test');
select is((select string_agg(line_no || ':' || purchased::numeric(18,0), ' ' order by line_no) from public.deal_lines(pg_temp.id('deal')) where kind = 'sales_order'),
  '1:2 2:10 3:5', 'every customer-order line is fully purchased (line 3 from two suppliers)');
select is((select stage from public.v_deals where id = pg_temp.id('deal')), 'purchasing', 'deal stage: purchasing');
select tests.logout();

-- ---------- Partial receipt and a bill that does not match ----------------------------------------
select is(pg_temp.make('procurement@es.test', 'grn', 'goods_receipt', pg_temp.lines(pg_temp.id('poB'))), 'made', 'goods receipt from PO B');
update public.document_lines set qty = 6 where document_id = pg_temp.id('grn') and line_no = 1;
select is(tests.post_as('procurement@es.test', pg_temp.id('grn')), 'posted', '6 of 10 seal kits and 3 valves received');
select is(pg_temp.make('procurement@es.test', 'bill', 'supplier_bill', pg_temp.lines(pg_temp.id('poB'))), 'made', 'bill from PO B');
select is((select source_document_id from public.documents where id = pg_temp.id('bill')), pg_temp.id('poB'), 'the bill points to its PO');
update public.document_lines set unit_price = 145 where document_id = pg_temp.id('bill') and line_no = 2;
select tests.login('procurement@es.test');
select is((select string_agg(line_no || ': ' || problem, '; ' order by line_no) from public.match_check(pg_temp.id('bill'))),
  '1: Billed 10 but received 6; 2: Price 145 differs from the purchase order (140)', 'three-way match warns about quantity and price');
select tests.logout();

-- ---------- Delivery, invoice, close --------------------------------------------------------------
select is(pg_temp.make('procurement@es.test', 'dn', 'delivery_note', pg_temp.lines(pg_temp.id('so'))), 'made', 'delivery note from the order');
select is(tests.post_as('procurement@es.test', pg_temp.id('dn')), 'posted', 'delivered');
select is(pg_temp.make('procurement@es.test', 'inv', 'sales_invoice', pg_temp.lines(pg_temp.id('dn'))), 'made', 'invoice from the delivery note');
select is((select party_id from public.documents where id = pg_temp.id('inv')), tests.party('T Customer'), 'invoice to the customer');
select is(pg_temp.summary(pg_temp.id('inv')),
  'Centrifugal pump 50 m3/h x2.00 @1200.00 | Mechanical seal kit (as per drawing) x10.00 @18.00 | Gate valve 4" class 150 x5.00 @168.00',
  'the invoice takes the order prices through the delivery note');

select tests.login('procurement@es.test');
select ok((select count(*) >= 2 from public.deal_open_items(pg_temp.id('deal'))), 'open items: draft bill, draft invoice, order not invoiced');
select tests.logout();
select tests.login('procurement@es.test');
select throws_like($$ select public.close_deal(pg_temp.id('deal'), 'won') $$, 'Not ready to close%', 'a deal with open items does not close');
select throws_like($$ select public.close_deal(pg_temp.id('deal'), 'won', null, true) $$, 'Closing with open items needs a note%', 'forcing needs a reason');
select throws_like($$ select public.close_deal(pg_temp.id('deal'), 'lost') $$, 'This deal has orders or invoices%', 'a deal with orders is not "lost"');
select lives_ok($$ select public.close_deal(pg_temp.id('deal'), 'won', 'Customer accepted short delivery', true) $$, 'closed with a note');
select is((select stage from public.v_deals where id = pg_temp.id('deal')), 'won', 'closed deal shows its outcome');
select lives_ok($$ select public.reopen_deal(pg_temp.id('deal')) $$, 'a closed deal can be reopened');
select tests.logout();

select * from finish();
rollback;
