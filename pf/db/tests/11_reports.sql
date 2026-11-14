-- Financial statements tie out: a small year of activity, checked against hand-computed figures.
begin;
select plan(29);
select tests.phase2_fixtures();

-- Helper: post as the accountant and fail loudly if posting does not succeed.
create or replace function pg_temp.post(p uuid) returns void language plpgsql as $$
declare v text;
begin
  v := tests.post_as('accountant@es.test', p);
  if v <> 'posted' then raise exception 'posting failed: %', v; end if;
end $$;

insert into public.items (company_id, code, name_en, kind, unit, default_expense_account_id, is_asset, life_years)
values (tests.es(), '', 'Calibration bench', 'goods', 'pc', tests.acct('1520'), true, 3),
       (tests.es(), '', 'Inspection service', 'service', 'job', null, false, null);
update public.items set default_revenue_account_id = tests.acct('4100') where name_en = 'Inspection service';

-- Last year: an invoice of 1,000 (profit of earlier years)
insert into public.documents (company_id, kind, doc_date, party_id) values (tests.es(), 'sales_invoice', '2025-12-10', tests.party('T Customer')) returning id as inv0 \gset
insert into public.document_lines (company_id, document_id, line_kind, item_id, qty, unit_price, amount, project_id)
values (tests.es(), :'inv0', 'item', (select id from public.items where name_en = 'Inspection service'), 1, 1000, 1000, tests.project('T Project A'));
select pg_temp.post(:'inv0');

-- Opening capital 10,000 into the bank
insert into public.documents (company_id, kind, doc_date, description) values (tests.es(), 'manual_journal', '2026-01-01', 'Capital paid in') returning id as cap \gset
insert into public.document_lines (company_id, document_id, line_no, amount, side, gl_account_id) values
  (tests.es(), :'cap', 1, 10000, 'D', (select gl_account_id from public.money_accounts where legacy_id = 'T-USD')),
  (tests.es(), :'cap', 2, 10000, 'C', tests.acct('3000'));
select pg_temp.post(:'cap');

-- Sales 5,000; received 3,000
insert into public.documents (company_id, kind, doc_date, party_id) values (tests.es(), 'sales_invoice', '2026-02-05', tests.party('T Customer')) returning id as inv \gset
insert into public.document_lines (company_id, document_id, line_kind, item_id, qty, unit_price, amount, project_id)
values (tests.es(), :'inv', 'item', (select id from public.items where name_en = 'Inspection service'), 5, 1000, 5000, tests.project('T Project A'));
select pg_temp.post(:'inv');
insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, no_document_reason)
values (tests.es(), 'customer_receipt', '2026-02-20', tests.ma('T-USD'), tests.party('T Customer'), 3000, 't') returning id as rcp \gset
insert into public.document_links (company_id, from_document_id, to_document_id, amount) values (tests.es(), :'rcp', :'inv', 3000);
select pg_temp.post(:'rcp');

-- Subcontractor bill 2,000 paid with a 10 fee (split so it stays under the approval limit)
insert into public.documents (company_id, kind, doc_date, party_id) values (tests.es(), 'supplier_bill', '2026-02-10', tests.party('T Supplier')) returning id as bill \gset
insert into public.document_lines (company_id, document_id, line_kind, item_id, qty, unit_price, amount, gl_account_id, project_id)
values (tests.es(), :'bill', 'item', (select id from public.items where name_en = 'Inspection service'), 1, 2000, 2000, tests.acct('5100'), tests.project('T Project A'));
select pg_temp.post(:'bill');
insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, fee_amount, no_document_reason)
values (tests.es(), 'supplier_payment', '2026-02-25', tests.ma('T-USD'), tests.party('T Supplier'), 990, 10, 't') returning id as pay \gset
insert into public.document_links (company_id, from_document_id, to_document_id, amount) values (tests.es(), :'pay', :'bill', 990);
select pg_temp.post(:'pay');
insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, no_document_reason)
values (tests.es(), 'supplier_payment', '2026-02-26', tests.ma('T-USD'), tests.party('T Supplier'), 1010, 't') returning id as pay2 \gset
insert into public.document_links (company_id, from_document_id, to_document_id, amount) values (tests.es(), :'pay2', :'bill', 1010);
select tests.login('owner@es.test');
select public.post_document(:'pay2');
select public.approve_document(:'pay2');
select tests.logout();

-- Rent 500 (project B), drawings 400, employee advance 150
insert into public.documents (company_id, kind, doc_date, money_account_id, no_document_reason) values (tests.es(), 'expense', '2026-03-01', tests.ma('T-USD'), 't') returning id as rent \gset
insert into public.document_lines (company_id, document_id, amount, gl_account_id, project_id) values (tests.es(), :'rent', 500, tests.acct('6300'), tests.project('T Project B'));
select pg_temp.post(:'rent');
insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, no_document_reason)
values (tests.es(), 'owner_drawings', '2026-03-05', tests.ma('T-USD'), tests.party('T Owner'), 400, 't') returning id as drw \gset
select pg_temp.post(:'drw');
insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, no_document_reason)
values (tests.es(), 'employee_advance', '2026-03-06', tests.ma('T-USD'), tests.party('T Employee'), 150, 't') returning id as adv \gset
select pg_temp.post(:'adv');

-- Equipment bought for 3,600 (asset, 3 years): split into a bill + payments to stay under approval
insert into public.documents (company_id, kind, doc_date, party_id) values (tests.es(), 'supplier_bill', '2026-03-15', tests.party('T Supplier')) returning id as eqb \gset
insert into public.document_lines (company_id, document_id, line_kind, item_id, qty, unit_price, amount)
values (tests.es(), :'eqb', 'item', (select id from public.items where name_en = 'Calibration bench'), 1, 3600, 3600);
select pg_temp.post(:'eqb');
select is((select cost_usd::text || ' ' || life_months || ' ' || code from public.assets), '3600.00 36 FA-0001', 'a bill line for an asset item registers the asset (cost, life from the item)');
insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, no_document_reason)
values (tests.es(), 'supplier_payment', '2026-03-16', tests.ma('T-USD'), tests.party('T Supplier'), 3600, 't') returning id as eqp \gset
insert into public.document_links (company_id, from_document_id, to_document_id, amount) values (tests.es(), :'eqp', :'eqb', 3600);
select tests.login('owner@es.test');
select public.post_document(:'eqp');
select public.approve_document(:'eqp');
select tests.logout();

-- Depreciation for April: 3,600 / 36 = 100
select is(tests.try_as('dataentry@es.test', $$select public.run_depreciation(tests.es(), 2026, 4)$$), '42501', 'data entry cannot run depreciation');
select tests.login('accountant@es.test');
select public.run_depreciation(tests.es(), 2026, 4) as dep \gset
select tests.logout();
select is(tests.je(:'dep'), '7100 D 100.00 | 1590 C 100.00', 'depreciation journal: Dr 7100, Cr accumulated depreciation');
select alike(tests.try_as('accountant@es.test', $$select public.run_depreciation(tests.es(), 2026, 4)$$), 'P0001', 'a month cannot be depreciated twice');
select is((select accumulated::text || ' / ' || net_book_value from public.asset_register(tests.es(), '2026-12-31')), '100.00 / 3500.00', 'asset register: accumulated 100, net book value 3,500');

-- ---------- Trial balance ----------
select is((select sum(debit) - sum(credit) from public.trial_balance(tests.es(), '2026-01-01', '2026-12-31')), 0::numeric, 'trial balance balances');
select is((select sum(closing) from public.trial_balance(tests.es(), '2026-01-01', '2026-12-31')), 0::numeric, 'closing balances net to zero');

-- ---------- Profit or loss ----------
select is((select sum(amount) from public.profit_and_loss(tests.es(), '2026-01-01', '2026-12-31')), 2390.00::numeric,
  'profit 2026 = 5,000 - 2,000 - 500 rent - 10 fee - 100 depreciation = 2,390');
select is((select sum(amount) filter (where account_type = 'income') from public.profit_and_loss(tests.es(), '2026-01-01', '2026-12-31')), 5000.00::numeric, 'revenue 5,000');
select is((select sum(cmp_amount) from public.profit_and_loss(tests.es(), '2026-01-01', '2026-12-31', '2025-01-01', '2025-12-31')), 1000.00::numeric, 'comparative period 2025: 1,000');
select is((select sum(amount) from public.profit_and_loss_monthly(tests.es(), '2026-01-01') where month = '2026-02-01'), 2990.00::numeric, 'monthly P&L: February = 5,000 - 2,000 - 10 fee');
select is((select sum(amount) from public.profit_and_loss(tests.es(), '2026-01-01', '2026-12-31', null, null, tests.project('T Project A'))), 3000.00::numeric, 'P&L filtered to project A: 3,000');

-- ---------- Balance sheet ----------
select is((select sum(case section when 'assets' then balance else -balance end) from public.balance_sheet(tests.es(), '2026-12-31')), 0::numeric,
  'balance sheet balances: assets = liabilities + equity');
select is((select balance from public.balance_sheet(tests.es(), '2026-12-31') where ifrs_line = 'profit_for_period'), 2390.00::numeric, 'profit for the year shown in equity');
select is((select balance from public.balance_sheet(tests.es(), '2026-12-31') where name_en = 'Profit of earlier years'), 1000.00::numeric, 'profit of earlier years shown in equity');
select is((select sum(balance) from public.balance_sheet(tests.es(), '2026-12-31') where ifrs_line = 'trade_receivables'), 3000.00::numeric, 'receivables 3,000 (1,000 from 2025 + 2,000 open)');
select is((select sum(balance) from public.balance_sheet(tests.es(), '2026-12-31') where ifrs_line = 'property_plant_equipment'), 3500.00::numeric, 'equipment at net book value 3,500');

-- ---------- Cash flow (direct) ----------
select is((select amount from public.cash_flow(tests.es(), '2026-01-01', '2026-12-31') where activity = 'closing'), 6340.00::numeric,
  'closing cash 6,340 = 10,000 + 3,000 - 2,000 - 10 - 500 - 400 - 150 - 3,600');
select is((select sum(amount) from public.cash_flow(tests.es(), '2026-01-01', '2026-12-31') where activity not in ('opening', 'closing'))
          + (select amount from public.cash_flow(tests.es(), '2026-01-01', '2026-12-31') where activity = 'opening'),
          (select amount from public.cash_flow(tests.es(), '2026-01-01', '2026-12-31') where activity = 'closing'), 'cash flow ties to the change in cash');
select is((select amount from public.cash_flow(tests.es(), '2026-01-01', '2026-12-31') where category = 'Purchase of property and equipment'), -3600.00::numeric, 'investing: equipment -3,600');
select is((select amount from public.cash_flow(tests.es(), '2026-01-01', '2026-12-31') where category = 'Owner contributions and drawings'), 9600.00::numeric, 'financing: capital 10,000 - drawings 400');
select is((select amount from public.cash_flow(tests.es(), '2026-01-01', '2026-12-31') where category = 'Receipts from customers'), 3000.00::numeric, 'operating: receipts from customers 3,000');
select is((select balance_usd from public.v_money_account_balances where code = (select code from public.money_accounts where legacy_id = 'T-USD')), 6340.00::numeric, 'cash flow closing = bank balance');

-- ---------- Equity, projects, parties ----------
select is((select closing from public.changes_in_equity(tests.es(), '2026-01-01', '2026-12-31') where component = 'Retained earnings'), 3390.00::numeric, 'retained earnings: 1,000 + 2,390');
select is((select drawings from public.changes_in_equity(tests.es(), '2026-01-01', '2026-12-31') where component = 'Owner drawings'), -400.00::numeric, 'drawings -400 in changes in equity');
select is((select revenue || ' / ' || cost_of_sales || ' / ' || margin || ' / ' || margin_pct from public.project_pl(tests.es(), '2026-01-01', '2026-12-31') where name_en = 'T Project A'),
  '5000.00 / 2000.00 / 3000.00 / 60.0', 'project A: revenue 5,000, cost 2,000, margin 60%');
select is((select balance from public.party_balances(tests.es(), '2026-12-31') where party_name = 'T Employee'), 150.00::numeric, 'employee balances: advance 150 outstanding');

-- ---------- Bank book and reconciliation ----------
select is((select balance from public.bank_book(tests.es(), tests.ma('T-USD'), '2026-01-01', '2026-12-31') order by entry_date desc, journal_line_id desc nulls last limit 1), 6340.00::numeric,
  'bank book running balance ends at 6,340');
insert into public.bank_reconciliations (company_id, money_account_id, statement_date, statement_balance) values (tests.es(), tests.ma('T-USD'), '2026-02-28', 13000) returning id as rec \gset
insert into public.bank_cleared_lines (journal_line_id, company_id, reconciliation_id)
select jl.id, tests.es(), :'rec' from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id
where jl.account_id = (select gl_account_id from public.money_accounts where legacy_id = 'T-USD') and je.document_id in (:'cap', :'rcp');
select tests.login('accountant@es.test');
select is((public.close_bank_reconciliation(:'rec')).status, 'closed', 'reconciliation closes when cleared lines match the statement (10,000 + 3,000)');
select tests.logout();

select * from finish();
rollback;
