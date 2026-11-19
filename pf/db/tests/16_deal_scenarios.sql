-- Deal scenarios C-G (A and B are in 15_deals.sql and the browser run e2e/deal-flow.mjs):
--   C  supplier advance + final payment, landed costs (freight, customs) on the deal, margin
--   D  partial deliveries and partial invoices, customer advance applied, no double invoicing
--   E  service deal (no purchasing), subcontractor cost
--   F  lost deal
--   G  return: credit note to the customer; supplier bill that does not match (price, quantity)
begin;
select plan(60);
select tests.phase2_fixtures();
insert into public.parties (company_id, code, primary_kind, name_en) values (tests.es(), '', 'supplier', 'T Freight');
insert into public.items (company_id, code, name_en, kind, unit, default_expense_account_id, default_revenue_account_id) values
  (tests.es(), '', 'Feed pump',           'goods',   'PC',  tests.acct('5200'), tests.acct('4500')),
  (tests.es(), '', 'Safety valve 2in',    'goods',   'PC',  tests.acct('5200'), tests.acct('4500')),
  (tests.es(), '', 'Boiler inspection',   'service', 'JOB', tests.acct('5100'), tests.acct('4100'));
create temp table t (k text primary key, id uuid);
grant all on t to authenticated;
create function pg_temp.id(p text) returns uuid language sql as $$ select id from t where k = p $$;
create function pg_temp.item(p text) returns uuid language sql as $$ select id from public.items where name_en = p $$;
create function pg_temp.lines(p_doc uuid) returns uuid[] language sql as $$
  select array_agg(id order by line_no) from public.document_lines where document_id = p_doc and line_kind = 'item' $$;
create function pg_temp.make(p_key text, p_kind text, p_lines uuid[], p_party uuid default null) returns text
language plpgsql as $$
declare v uuid;
begin
  perform tests.login('owner@es.test');
  begin
    v := public.make_document(p_kind::public.doc_kind, p_lines, p_party);
  exception when others then
    perform tests.logout(); return 'ERROR: ' || sqlerrm;
  end;
  perform tests.logout();
  insert into t values (p_key, v) on conflict (k) do update set id = excluded.id;
  update public.documents set doc_date = '2026-11-20' where id = v;
  return 'made';
end $$;
-- a priced customer order / quotation typed in directly (no request before it)
create function pg_temp.order_(p_key text, p_kind text, p_deal uuid, p_item text, p_qty numeric, p_price numeric) returns void
language plpgsql as $$
declare v uuid;
begin
  insert into public.documents (company_id, kind, doc_date, party_id, project_id)
  values (tests.es(), p_kind::public.doc_kind, '2026-11-20', tests.party('T Customer'), p_deal) returning id into v;
  insert into public.document_lines (company_id, document_id, line_no, item_id, description, qty, unit_price, amount, project_id)
  values (tests.es(), v, 1, pg_temp.item(p_item), p_item, p_qty, p_price, round(p_qty * p_price, 2), p_deal);
  insert into t values (p_key, v);
end $$;
-- a payment / receipt in USD (optionally settling one document)
create function pg_temp.money(p_key text, p_kind text, p_party text, p_amount numeric, p_settles uuid default null) returns text
language plpgsql as $$
declare v uuid; r text;
begin
  insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, no_document_reason)
  values (tests.es(), p_kind::public.doc_kind, '2026-11-21', tests.ma('T-USD'), tests.party(p_party), p_amount, 'test')
  returning id into v;
  if p_settles is not null then
    insert into public.document_links (company_id, from_document_id, to_document_id, amount) values (tests.es(), v, p_settles, p_amount);
  end if;
  insert into t values (p_key, v);
  r := tests.post_as('accountant@es.test', v);
  if r = 'submitted' then           -- above the approval limit: the owner approves
    perform tests.login('owner@es.test');
    perform public.approve_document(v);
    perform tests.logout();
    r := (select status::text from public.documents where id = v);
  end if;
  return r;
end $$;
create function pg_temp.open(p_doc uuid) returns numeric language sql as $$ select open_amount from public.v_document_balances where id = p_doc $$;
create function pg_temp.pl(p_deal uuid) returns text language plpgsql as $$
declare r record;
begin
  perform tests.login('owner@es.test');
  select revenue, cost_of_sales into r from public.project_pl(tests.es(), '2026-01-01', '2026-12-31') where project_id = p_deal;
  perform tests.logout();
  return format('revenue %s, cost %s, margin %s', r.revenue, r.cost_of_sales, r.revenue - r.cost_of_sales);
end $$;
grant execute on function pg_temp.id(text), pg_temp.lines(uuid), pg_temp.item(text) to authenticated;

-- ======== C: supplier advance + final payment, landed costs ===========================================
select tests.login('owner@es.test');
insert into t select 'dealC', public.create_deal(tests.es(), tests.party('T Customer'), 'C: feed pump, imported');
select tests.logout();
select pg_temp.order_('soC', 'sales_order', pg_temp.id('dealC'), 'Feed pump', 1, 14000);
select is(tests.post_as('owner@es.test', pg_temp.id('soC')), 'posted', 'C: customer order typed in directly (no request, no quotation)');
select is(pg_temp.make('poC', 'purchase_order', pg_temp.lines(pg_temp.id('soC')), tests.party('T Supplier')), 'made', 'C: PO to the supplier');
update public.document_lines set unit_price = 10000 where document_id = pg_temp.id('poC');
select is(tests.post_as('owner@es.test', pg_temp.id('poC')), 'posted', 'C: PO USD 10,000 issued');
select is(pg_temp.money('advC', 'supplier_payment', 'T Supplier', 3000), 'posted', 'C: 30% advance paid before any bill (on account)');
-- landed costs: freight and customs straight onto the deal
insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, no_document_reason, description)
values (tests.es(), 'expense', '2026-11-22', tests.ma('T-USD'), tests.party('T Freight'), 'test', 'Sea freight + customs clearing') returning id as expc \gset
insert into public.document_lines (company_id, document_id, line_no, gl_account_id, project_id, description, amount) values
  (tests.es(), :'expc', 1, tests.acct('5500'), pg_temp.id('dealC'), 'Sea freight Jebel Ali - Aden', 500),
  (tests.es(), :'expc', 2, tests.acct('5500'), pg_temp.id('dealC'), 'Customs duty and clearing', 200);
select is(tests.post_as('owner@es.test', :'expc'), 'posted', 'C: freight and customs paid, charged to the deal');
select is(pg_temp.make('grnC', 'goods_receipt', pg_temp.lines(pg_temp.id('poC'))), 'made', 'C: goods received');
select is(tests.post_as('owner@es.test', pg_temp.id('grnC')), 'posted', 'C: receipt issued');
select is(pg_temp.make('billC', 'supplier_bill', pg_temp.lines(pg_temp.id('grnC'))), 'made', 'C: bill from the receipt');
update public.documents set party_reference = 'SUP-INV-1001' where id = pg_temp.id('billC');
select is(tests.post_as('owner@es.test', pg_temp.id('billC')), 'posted', 'C: bill posted (cost on the deal)');
select is((select count(*)::int from public.match_check(pg_temp.id('billC'))), 0, 'C: bill matches PO and receipt');
select tests.login('owner@es.test');
select lives_ok(format('select public.apply_payment(%L, %L)', pg_temp.id('advC'), pg_temp.id('billC')), 'C: the advance is applied to the bill');
select tests.logout();
select is(pg_temp.open(pg_temp.id('billC')), 7000.00, 'C: bill shows 7,000 still to pay');
select is(pg_temp.money('payC', 'supplier_payment', 'T Supplier', 7000, pg_temp.id('billC')), 'posted', 'C: final payment');
select is(pg_temp.open(pg_temp.id('billC')), 0.00, 'C: bill fully paid');
select is(pg_temp.make('dnC', 'delivery_note', pg_temp.lines(pg_temp.id('soC'))), 'made', 'C: delivery note');
select is(tests.post_as('owner@es.test', pg_temp.id('dnC')), 'posted', 'C: delivered');
select is(pg_temp.make('invC', 'sales_invoice', pg_temp.lines(pg_temp.id('dnC'))), 'made', 'C: invoice');
select is(tests.post_as('owner@es.test', pg_temp.id('invC')), 'posted', 'C: invoice posted');
select is(pg_temp.money('rcpC', 'customer_receipt', 'T Customer', 14000, pg_temp.id('invC')), 'posted', 'C: customer pays');
select is(pg_temp.pl(pg_temp.id('dealC')), 'revenue 14000.00, cost 10700.00, margin 3300.00', 'C: deal margin includes freight and customs');
select tests.login('owner@es.test');
select is((select stage from public.v_deals where id = pg_temp.id('dealC')), 'paid', 'C: stage paid');
select is((select count(*)::int from public.deal_open_items(pg_temp.id('dealC'))), 0, 'C: nothing open');
select lives_ok(format('select public.close_deal(%L, ''won'')', pg_temp.id('dealC')), 'C: closed as won without forcing');
select tests.logout();

-- ======== D: partial deliveries / invoices, customer advance ==========================================
select tests.login('owner@es.test');
insert into t select 'dealD', public.create_deal(tests.es(), tests.party('T Customer'), 'D: valves in two lots');
select tests.logout();
select pg_temp.order_('soD', 'sales_order', pg_temp.id('dealD'), 'Safety valve 2in', 10, 100);
select is(tests.post_as('owner@es.test', pg_temp.id('soD')), 'posted', 'D: order for 10 valves');
select is(pg_temp.money('advD', 'customer_receipt', 'T Customer', 400), 'posted', 'D: customer pays 400 in advance');
select is(pg_temp.make('dn1', 'delivery_note', pg_temp.lines(pg_temp.id('soD'))), 'made', 'D: first delivery');
update public.document_lines set qty = 6 where document_id = pg_temp.id('dn1');
select is(tests.post_as('owner@es.test', pg_temp.id('dn1')), 'posted', 'D: 6 delivered');
select is(pg_temp.make('inv1', 'sales_invoice', pg_temp.lines(pg_temp.id('dn1'))), 'made', 'D: invoice for the first lot');
select is(tests.post_as('owner@es.test', pg_temp.id('inv1')), 'posted', 'D: invoice 600 posted');
select tests.login('owner@es.test');
select lives_ok(format('select public.apply_payment(%L, %L)', pg_temp.id('advD'), pg_temp.id('inv1')), 'D: the advance is applied');
select tests.logout();
select is(pg_temp.open(pg_temp.id('inv1')), 200.00, 'D: 200 left on the first invoice');
select is(pg_temp.make('x', 'sales_invoice', pg_temp.lines(pg_temp.id('soD'))), 'made', 'D: an invoice straight from the order takes only what is not invoiced');
select is((select qty::numeric(18,0) from public.document_lines where document_id = pg_temp.id('x')), 4::numeric, 'D: 4 left, not 10');
delete from public.document_lines where document_id = pg_temp.id('x');
delete from public.documents where id = pg_temp.id('x');
select is(pg_temp.make('dn2', 'delivery_note', pg_temp.lines(pg_temp.id('soD'))), 'made', 'D: second delivery takes the 4 left');
select is(tests.post_as('owner@es.test', pg_temp.id('dn2')), 'posted', 'D: 4 delivered');
select is(pg_temp.make('x2', 'sales_invoice', pg_temp.lines(pg_temp.id('dn1'))), 'ERROR: Nothing left to take: these lines are already fully in other documents of this kind',
  'D: the first delivery cannot be invoiced twice');
select is(pg_temp.make('inv2', 'sales_invoice', pg_temp.lines(pg_temp.id('dn2'))), 'made', 'D: invoice for the second lot');
select is(tests.post_as('owner@es.test', pg_temp.id('inv2')), 'posted', 'D: invoice 400 posted');
select tests.login('owner@es.test');
select is((select delivered::int || '/' || invoiced::int from public.deal_lines(pg_temp.id('dealD')) where kind = 'sales_order'), '10/10', 'D: 10 delivered, 10 invoiced');
select tests.logout();

-- ======== E: service deal ===========================================================================
select tests.login('owner@es.test');
insert into t select 'dealE', public.create_deal(tests.es(), tests.party('T Customer'), 'E: boiler inspection');
select tests.logout();
select pg_temp.order_('qtE', 'quotation', pg_temp.id('dealE'), 'Boiler inspection', 1, 2500);
select is(tests.post_as('owner@es.test', pg_temp.id('qtE')), 'posted', 'E: quotation for a service');
select is(pg_temp.make('soE', 'sales_order', pg_temp.lines(pg_temp.id('qtE'))), 'made', 'E: customer accepts');
select is(tests.post_as('owner@es.test', pg_temp.id('soE')), 'posted', 'E: order confirmed');
select is(pg_temp.make('invE', 'sales_invoice', pg_temp.lines(pg_temp.id('soE'))), 'made', 'E: invoice straight from the order (no delivery note needed)');
select is(tests.post_as('owner@es.test', pg_temp.id('invE')), 'posted', 'E: invoice posted');

-- ======== F: lost deal ==============================================================================
select tests.login('owner@es.test');
insert into t select 'dealF', public.create_deal(tests.es(), tests.party('T Customer'), 'F: chiller spares');
select tests.logout();
select pg_temp.order_('qtF', 'quotation', pg_temp.id('dealF'), 'Feed pump', 2, 9000);
select is(tests.post_as('owner@es.test', pg_temp.id('qtF')), 'posted', 'F: quoted');
select tests.login('owner@es.test');
select lives_ok(format('select public.close_deal(%L, ''lost'', ''Price: customer bought from a local agent'')', pg_temp.id('dealF')), 'F: closed as lost with the reason');
select is((select stage || ' / ' || p.close_note from public.v_deals v join public.projects p using (id) where v.id = pg_temp.id('dealF')),
  'lost / Price: customer bought from a local agent', 'F: lost deals keep the reason (for win / loss analysis)');
select tests.logout();

-- ======== G: customer return (credit note) and a supplier bill that does not match ====================
select tests.login('owner@es.test');
insert into t select 'dealG', public.create_deal(tests.es(), tests.party('T Customer'), 'G: valves, one returned');
select tests.logout();
select pg_temp.order_('soG', 'sales_order', pg_temp.id('dealG'), 'Safety valve 2in', 5, 200);
select is(tests.post_as('owner@es.test', pg_temp.id('soG')), 'posted', 'G: order 5 x 200');
select is(pg_temp.make('poG', 'purchase_order', pg_temp.lines(pg_temp.id('soG')), tests.party('T Supplier')), 'made', 'G: PO');
update public.document_lines set unit_price = 120 where document_id = pg_temp.id('poG');
select is(tests.post_as('owner@es.test', pg_temp.id('poG')), 'posted', 'G: PO 5 x 120');
select is(pg_temp.make('grnG', 'goods_receipt', pg_temp.lines(pg_temp.id('poG'))), 'made', 'G: receipt');
select is(tests.post_as('owner@es.test', pg_temp.id('grnG')), 'posted', 'G: 5 received');
select is(pg_temp.make('billG', 'supplier_bill', pg_temp.lines(pg_temp.id('grnG'))), 'made', 'G: bill from the receipt');
update public.document_lines set qty = 6, unit_price = 125 where document_id = pg_temp.id('billG');   -- the supplier's invoice says 6 x 125
select tests.login('owner@es.test');
select is((select string_agg(problem, '; ' order by problem) from public.match_check(pg_temp.id('billG'))),
  'Billed 6 but ordered 5; Billed 6 but received 5; Price 125 differs from the purchase order (120)', 'G: the bill is flagged for quantity and price');
select tests.logout();
select is(pg_temp.make('dnG', 'delivery_note', pg_temp.lines(pg_temp.id('soG'))), 'made', 'G: delivery');
select is(tests.post_as('owner@es.test', pg_temp.id('dnG')), 'posted', 'G: 5 delivered');
select is(pg_temp.make('invG', 'sales_invoice', pg_temp.lines(pg_temp.id('dnG'))), 'made', 'G: invoice');
select is(tests.post_as('owner@es.test', pg_temp.id('invG')), 'posted', 'G: invoice 1,000');
select tests.login('owner@es.test');
insert into t select 'cnG', public.convert_document(pg_temp.id('invG'), 'credit_note');
select tests.logout();
update public.document_lines set qty = 1 where document_id = pg_temp.id('cnG') and line_kind = 'item';
update public.document_links set amount = 200 where from_document_id = pg_temp.id('cnG');
update public.documents set description = 'One valve returned (damaged in transit)' where id = pg_temp.id('cnG');
select is(tests.post_as('owner@es.test', pg_temp.id('cnG')), 'posted', 'G: credit note for the returned valve');
select is(pg_temp.open(pg_temp.id('invG')), 800.00, 'G: the invoice now asks for 800');

select * from finish();
rollback;
