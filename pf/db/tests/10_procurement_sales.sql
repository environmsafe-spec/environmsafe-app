-- Procurement and sales: PO (with surcharge and tax lines, Rev.N), bill from PO, payments that settle
-- bills (with FX), quotation -> invoice, receipts, credit notes, aging, statements, verification.
begin;
select plan(44);
select tests.phase2_fixtures();
update public.parties set payment_terms_days = 30 where name_en = 'T Customer';

insert into public.items (company_id, code, name_en, kind, unit, default_expense_account_id) values
  (tests.es(), '', 'TRAC102.11R (Nalco)', 'goods', 'Kg', null);
insert into public.items (company_id, code, name_en, kind, unit, default_revenue_account_id) values
  (tests.es(), '', 'Calibration of temperature calibrator', 'service', 'PC', tests.acct('4100')),
  (tests.es(), '', 'Calibration of pressure calibrator', 'service', 'PC', tests.acct('4100'));
create temp table t_item as select id, name_en from public.items;
grant select on t_item to authenticated;

-- ---------- Purchase order: the sample PO, 25 Kg x 12.19 + 12% surcharge + 5% tax on products ----
insert into public.documents (company_id, kind, doc_date, party_id, valid_until, party_reference, attention)
values (tests.es(), 'purchase_order', '2026-11-01', tests.party('T Supplier'), '2026-12-01', 'SO/SEC/2026/01212', 'Mr. Abubakr Mohammed, Sales')
returning id as po \gset
insert into public.document_lines (company_id, document_id, line_no, line_kind, item_id, description, detail, qty, unit, unit_price, amount, percent, percent_base) values
  (tests.es(), :'po', 1, 'item',   (select id from t_item where name_en like 'TRAC%'), '[006153] TRAC102.11R (Nalco)', 'Water treatment chemical | 25 Kg / Can', 25, 'Kg', 12.19, 1, null, null),
  (tests.es(), :'po', 2, 'charge', null, 'Nalco temp. surcharge 12%', null, 1, null, null, 1, 12, null),
  (tests.es(), :'po', 3, 'tax',    null, 'Tax 5% on products', null, 1, null, null, 1, 5, 'items');

select is(tests.post_as('dataentry@es.test', :'po'), 'ERROR: Permission denied: docs.post is required', 'data entry cannot issue a PO');
select is(tests.post_as('procurement@es.test', :'po'), 'posted', 'procurement issues the PO');
select is((select string_agg(amount::text, ' / ' order by line_no) from public.document_lines where document_id = :'po'),
  '304.75 / 36.57 / 15.24', 'qty x price, 12% surcharge and 5% tax are computed by the database');
select is((select amount from public.documents where id = :'po'), 356.56, 'PO total USD 356.56 (same as the sample)');
select is((select number from public.documents where id = :'po'), '2026110101', 'PO number YYYYMMDDNN');
select ok((select journal_entry_id is null from public.documents where id = :'po'), 'a PO is a commitment: no accounting entry');
select is((select last_cost::text || ' ' || last_cost_currency || ' ' || last_document_ref from public.items where name_en like 'TRAC%'),
  '12.1900 USD 2026110101', 'the item catalogue learns the last cost and reference');

-- ---------- Revision -----------------------------------------------------------------------------
select tests.login('procurement@es.test');
select public.revise_document(:'po') as po1 \gset
select tests.logout();
update public.document_lines set qty = 30 where document_id = :'po1' and line_kind = 'item';
select is(tests.post_as('procurement@es.test', :'po1'), 'posted', 'Rev.1 is issued');
select is((select number || ' Rev.' || revision from public.documents where id = :'po1'), '2026110101 Rev.1', 'a revision keeps the PO number');
select is((select status::text || ': ' || void_reason from public.documents where id = :'po'), 'void: Superseded by Rev.1', 'the earlier revision is kept, marked superseded');
select is((select amount from public.documents where id = :'po1'), 427.87, 'Rev.1 total recomputed (30 Kg)');

-- ---------- Supplier bill from the PO --------------------------------------------------------------
select tests.login('procurement@es.test');
select public.convert_document(:'po1', 'supplier_bill') as bill \gset
select tests.logout();
select is((select source_document_id from public.documents where id = :'bill'), :'po1'::uuid, 'the bill points back to its PO');
select alike(tests.post_as('procurement@es.test', :'bill'), 'ERROR: Line 1 (TRAC102.11R (Nalco)): choose the expense / asset account%', 'a bill needs an account for each item');
update public.items set default_expense_account_id = tests.acct('5200') where name_en like 'TRAC%';
select alike(tests.post_as('procurement@es.test', :'bill'), 'ERROR: Account 5200 Materials and spare parts needs a project%', 'cost lines need a project');
update public.document_lines set project_id = tests.project('T Project A') where document_id = :'bill';
update public.documents set party_reference = 'SEC-INV-778', doc_date = '2026-11-05' where id = :'bill';
select is(tests.post_as('procurement@es.test', :'bill'), 'posted', 'procurement posts the bill');
select is(tests.je(:'bill'), '5200 D 365.70 | 5200 D 43.88 | 5200 D 18.29 | 2000 C 427.87', 'bill: cost lines (incl. surcharge and tax) Dr, Cr accounts payable');
select is((select number || ' due ' || due_date from public.documents where id = :'bill'), 'BILL-2026-0001 due 2026-11-05', 'bill numbering; due date = date + supplier terms (0)');
select is((select count(*)::int from public.aging(tests.es(), 'ap', '2026-11-30')), 1, 'the bill shows in AP aging');

-- ---------- Payment settles the bill ----------------------------------------------------------------
insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, no_document_reason)
values (tests.es(), 'supplier_payment', '2026-11-10', tests.ma('T-USD'), tests.party('T Supplier'), 427.87, 'test') returning id as pay \gset
insert into public.document_links (company_id, from_document_id, to_document_id, amount) values (tests.es(), :'pay', :'bill', 427.87);
select is(tests.post_as('procurement@es.test', :'pay'), 'ERROR: Permission denied: docs.post_money is required', 'procurement cannot pay (no payment posting)');
select is(tests.post_as('accountant@es.test', :'pay'), 'posted', 'accountant pays the bill');
select is(tests.je(:'pay'), '2000 D 427.87 | 1000-001 C 427.87', 'payment: Dr AP for the bill, Cr bank');
select is((select count(*)::int from public.aging(tests.es(), 'ap', '2026-11-30')), 0, 'a fully paid bill leaves AP aging');
select is((select count(*)::int from public.aging(tests.es(), 'ap', '2026-11-07')), 1, '...but is still open in aging as at a date before the payment');

-- ---------- SAR bill paid at a different rate: realised FX --------------------------------------
insert into public.documents (company_id, kind, doc_date, party_id, currency, rate) values (tests.es(), 'supplier_bill', '2026-11-06', tests.party('T Supplier'), 'SAR', 3.79) returning id as bsar \gset
insert into public.document_lines (company_id, document_id, line_kind, item_id, qty, unit_price, amount, project_id)
values (tests.es(), :'bsar', 'item', (select id from t_item where name_en like 'TRAC%'), 1, 1895, 1895, tests.project('T Project A'));
select is(tests.post_as('accountant@es.test', :'bsar'), 'posted', 'SAR bill posts');
insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, rate, no_document_reason)
values (tests.es(), 'supplier_payment', '2026-11-20', tests.ma('T-SAR'), tests.party('T Supplier'), 1895, 3.75, 'test') returning id as psar \gset
insert into public.document_links (company_id, from_document_id, to_document_id, amount) values (tests.es(), :'psar', :'bsar', 1895);
select is(tests.post_as('accountant@es.test', :'psar'), 'posted', 'SAR payment posts');
select is(tests.je(:'psar'), '2000 D 500.00 | 1000-003 C 505.33 | 7000 D 5.33',
  'AP relieved at the bill rate (USD 500); the riyal cost more on payment day: FX loss 5.33');

-- ---------- Quotation -> invoice -> receipt -> credit note -------------------------------------
insert into public.documents (company_id, kind, doc_date, party_id, valid_until) values (tests.es(), 'quotation', '2026-09-13', tests.party('T Customer'), '2026-10-13') returning id as qt \gset
insert into public.document_lines (company_id, document_id, line_no, line_kind, item_id, description, detail, qty, unit, unit_price, amount, project_id) values
  (tests.es(), :'qt', 1, 'item', (select id from t_item where name_en like '%temperature%'), 'Calibration of Temperature Calibrator', 'Fluke 724', 1, 'PC', 926.32, 926.32, tests.project('T Project B')),
  (tests.es(), :'qt', 2, 'item', (select id from t_item where name_en like '%pressure%'),    'Calibration of Digital Pressure Calibrator', 'Druck DPI 612', 1, 'PC', 926.31, 926.31, tests.project('T Project B'));
select is(tests.post_as('accountant@es.test', :'qt'), 'posted', 'quotation issued');
select is((select number from public.documents where id = :'qt'), 'QT-2026-0001', 'quotation number QT-YYYY-NNNN');
select tests.login('accountant@es.test');
select public.convert_document(:'qt', 'sales_invoice') as inv \gset
select tests.logout();
update public.documents set doc_date = '2026-11-07' where id = :'inv';
select is(tests.post_as('accountant@es.test', :'inv'), 'posted', 'invoice posts');
select is((select number || ' due ' || due_date || ' ref ' || party_reference from public.documents where id = :'inv'),
  'INV-2026110701 due 2026-12-07 ref QT-2026-0001', 'INV-YYYYMMDDNN; due = date + 30 days customer terms; references the quotation');
select is(tests.je(:'inv'), '4100 C 926.32 | 4100 C 926.31 | 1100 D 1852.63', 'invoice: revenue by line and project, Dr receivable');
select is((select last_sale_price::text || ' ' || last_customer_id::text from public.items where name_en like '%temperature%'),
  '926.3200 ' || tests.party('T Customer')::text, 'the catalogue learns the last sale price and customer');

insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, no_document_reason)
values (tests.es(), 'customer_receipt', '2026-12-01', tests.ma('T-USD'), tests.party('T Customer'), 1000, 'test') returning id as rcp \gset
insert into public.document_links (company_id, from_document_id, to_document_id, amount) values (tests.es(), :'rcp', :'inv', 1000);
select is(tests.post_as('accountant@es.test', :'rcp'), 'posted', 'part payment received');
select is((select open_amount::text || ' ' || bucket from public.aging(tests.es(), 'ar', '2027-01-20')), '852.63 31-60',
  'AR aging: 852.63 open, 44 days overdue on 20 Jan 2027');

select tests.login('accountant@es.test');
select public.convert_document(:'inv', 'credit_note') as cn \gset
select tests.logout();
delete from public.document_lines where document_id = :'cn' and line_no = 1;
update public.document_lines set unit_price = 852.63, amount = 852.63 where document_id = :'cn';
select is((select amount from public.document_links where from_document_id = :'cn'), 852.63, 'the credit note is linked to the invoice for its open amount');
select is(tests.post_as('accountant@es.test', :'cn'), 'posted', 'credit note posts');
select is(tests.je(:'cn'), '4100 D 852.63 | 1100 C 852.63', 'credit note: Dr revenue, Cr receivable');
select is((select count(*)::int from public.aging(tests.es(), 'ar', '2027-01-20')), 0, 'the invoice is now fully settled');

-- ---------- Statement, verification ---------------------------------------------------------------
select is((select balance from public.party_statement(tests.es(), tests.party('T Customer'), '2026-01-01', '2026-12-31') order by entry_date desc, balance limit 1), 0.00,
  'customer statement ends at zero');

select is(tests.try_as('owner@es.test', $$select public.void_document((select id from public.documents where kind = 'quotation' and number = 'QT-2026-0001'), 'Customer withdrew')$$), 'ok:1',
  'an issued quotation can be cancelled (no entry to reverse)');
select verify_token as tok from public.documents where id = :'inv' \gset
select is(tests.anon_verify(:'tok'), 'valid 1852.63', 'the QR page confirms a genuine invoice without signing in');
select is(tests.anon_verify(gen_random_uuid()), 'none:0', 'an unknown code shows nothing');
select throws_ok($$set local role anon; select * from public.documents$$, '42501', null, 'anonymous visitors cannot read documents');
reset role;

select is((select sum(debit) - sum(credit) from public.trial_balance(tests.es(), '2026-01-01', '2027-12-31')), 0::numeric, 'trial balance balances');

select * from finish();
rollback;
