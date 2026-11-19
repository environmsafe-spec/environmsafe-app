-- Brief v2, step 2: A3 (receipts / payments settle what they pay; unallocated money is an advance, not revenue),
-- A4 (another currency settles all the same, FX to gain / loss), A5 (supplier statement), write-off, undo.
begin;
select plan(28);
select tests.phase2_fixtures();
insert into public.items (company_id, code, name_en, kind, unit, default_expense_account_id, default_revenue_account_id) values
  (tests.es(), '', 'Inspection', 'service', 'JOB', tests.acct('5100'), tests.acct('4100')),
  (tests.es(), '', 'TRAC102', 'goods', 'Kg', tests.acct('5200'), null);
create function pg_temp.invoice(p_kind text, p_party text, p_ccy char(3), p_amount numeric, p_project text default 'T Project B') returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.documents (company_id, kind, doc_date, party_id, currency, project_id)
  values (tests.es(), p_kind::public.doc_kind, '2026-11-02', tests.party(p_party), p_ccy, tests.project(p_project)) returning id into v;
  insert into public.document_lines (company_id, document_id, line_no, item_id, qty, unit_price, amount)
  values (tests.es(), v, 1, (select id from public.items where name_en = case when p_kind = 'sales_invoice' then 'Inspection' else 'TRAC102' end),
          1, p_amount, p_amount);
  if tests.post_as('owner@es.test', v) <> 'posted' then raise exception 'invoice not posted: %', tests.post_as('owner@es.test', v); end if;
  return v;
end $$;
create function pg_temp.money(p_kind text, p_party text, p_account text, p_amount numeric, p_settles uuid default null,
                              p_link numeric default null, p_link_from numeric default null) returns uuid
language plpgsql as $$
declare v uuid; r text;
begin
  insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, no_document_reason, project_id)
  values (tests.es(), p_kind::public.doc_kind, '2026-11-10', tests.ma(p_account), tests.party(p_party), p_amount, 'test',
          case when p_settles is null then tests.project('T Project B') end) returning id into v;
  if p_settles is not null then
    insert into public.document_links (company_id, from_document_id, to_document_id, amount, from_amount)
    values (tests.es(), v, p_settles, coalesce(p_link, p_amount), p_link_from);
  end if;
  r := tests.post_as('accountant@es.test', v);
  if r = 'submitted' then perform tests.login('owner@es.test'); perform public.approve_document(v); perform tests.logout(); end if;
  return v;
end $$;
create function pg_temp.open(p uuid) returns numeric language sql as $$ select open_amount from public.v_document_balances where id = p $$;
create function pg_temp.bal(p_code text, p_party text default null) returns numeric language sql as $$
  select coalesce(sum(jl.debit - jl.credit), 0) from public.journal_lines jl join public.gl_accounts g on g.id = jl.account_id
   where g.company_id = tests.es() and g.code = p_code and (p_party is null or jl.party_id = tests.party(p_party)) $$;
create function pg_temp.revenue(p_project text) returns numeric language plpgsql as $$
declare v numeric;
begin
  perform tests.login('owner@es.test');
  select revenue into v from public.project_pl(tests.es(), '2026-01-01', '2026-12-31') where project_id = tests.project(p_project);
  perform tests.logout();
  return v;
end $$;
create temp table t (k text primary key, id uuid);
grant all on t to authenticated;

-- ======== A3: an invoice and its receipt are the same money =========================================
insert into t select 'inv', pg_temp.invoice('sales_invoice', 'T Customer', 'USD', 1000);
insert into t select 'rcp', pg_temp.money('customer_receipt', 'T Customer', 'T-USD', 1000, (select id from t where k = 'inv'));
select is((select status::text from public.documents where id = (select id from t where k = 'rcp')), 'posted', 'A3: receipt posted against the invoice');
select is(pg_temp.revenue('T Project B'), 1000.00, 'A3: invoice 1,000 + its receipt 1,000 = project revenue 1,000, not 2,000');
select is(pg_temp.open((select id from t where k = 'inv')), 0.00, 'A3: invoice paid');
select is((select project_id from public.documents where id = (select id from t where k = 'rcp')), tests.project('T Project B'),
  'A3: the receipt takes the project of the invoice it settles');

insert into t select 'adv', pg_temp.money('customer_receipt', 'T Customer', 'T-USD', 500);
select is(pg_temp.bal('2150'), -500.00, 'A3: a receipt with no invoice is a customer advance (liability)');
select is(pg_temp.revenue('T Project B'), 1000.00, 'A3: ... and not revenue');
insert into t select 'inv2', pg_temp.invoice('sales_invoice', 'T Customer', 'USD', 800);
select tests.login('accountant@es.test');
select lives_ok(format('select public.apply_payment(%L, %L)', (select id from t where k = 'adv'), (select id from t where k = 'inv2')),
  'A3: the advance is applied to the invoice when it comes');
select tests.logout();
select is(pg_temp.open((select id from t where k = 'inv2')), 300.00, 'A3: 300 left to pay on the invoice');
select is(pg_temp.bal('2150'), 0.00, 'A3: customer advances back to zero');
select is(pg_temp.bal('1100', 'T Customer'), 300.00, 'A3: receivable = what is really owed');
select is((select count(*)::int from public.v_unapplied where party_id = tests.party('T Customer')), 0, 'A3: nothing left unapplied');

-- ======== A4: a YER receipt settles a USD invoice (GO GREEN) ==========================================
insert into t select 'usd_inv', pg_temp.invoice('sales_invoice', 'T Customer', 'USD', 3882.20, 'T Project A');
insert into t select 'yer_rcp', pg_temp.money('customer_receipt', 'T Customer', 'T-YER', 6075643, (select id from t where k = 'usd_inv'), 3882.20, 6075643);
select is((select status::text from public.documents where id = (select id from t where k = 'yer_rcp')), 'posted', 'A4: YER receipt posted against the USD invoice');
select is(pg_temp.open((select id from t where k = 'usd_inv')), 0.00, 'A4: the USD invoice is fully settled');
select is(tests.je((select id from t where k = 'yer_rcp')), '1000-002 D 3904.65 | 1100 C 3882.20 | 7000 C 22.45',
  'A4: bank at the receipt''s rate, AR relieved at the invoice''s rate, difference = FX gain');
select is(pg_temp.revenue('T Project A'), 3882.20, 'A4: revenue counted once');
-- Without the amount in each currency the link is refused.
insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, no_document_reason)
values (tests.es(), 'customer_receipt', '2026-11-10', tests.ma('T-YER'), tests.party('T Customer'), 1556, 'test') returning id as bad \gset
insert into t select 'usd_inv2', pg_temp.invoice('sales_invoice', 'T Customer', 'USD', 1, 'T Project A');
insert into public.document_links (company_id, from_document_id, to_document_id, amount) values (tests.es(), :'bad', (select id from t where k = 'usd_inv2'), 1);
select alike(tests.post_as('accountant@es.test', :'bad'), 'ERROR: Document % is in USD: enter how much of this 1556.00 YER payment goes to it', 'A4: the amount in each currency is required');
-- Applied afterwards across currencies: SAR invoice, YER advance.
insert into t select 'sar_inv', pg_temp.invoice('sales_invoice', 'T Customer', 'SAR', 46500, 'T Project A');
insert into t select 'yer_adv', pg_temp.money('customer_receipt', 'T Customer', 'T-YER', 11342000);
select tests.login('accountant@es.test');
select lives_ok(format('select public.apply_payment(%L, %L, 27500, 11342000)', (select id from t where k = 'yer_adv'), (select id from t where k = 'sar_inv')),
  'A4: a YER advance applied to a SAR invoice (27,500 SAR covered)');
select tests.logout();
select is(pg_temp.open((select id from t where k = 'sar_inv')), 19000.00, 'A4: 19,000 SAR still open on the SAR invoice');
select is(pg_temp.bal('2150'), 0.00, 'A4: the YER advance is fully used');

-- ======== A5: supplier side ==========================================================================
insert into t select 'bill', pg_temp.invoice('supplier_bill', 'T Supplier', 'USD', 356.56, 'T Project A');
insert into t select 'pay', pg_temp.money('supplier_payment', 'T Supplier', 'T-USD', 356.56, (select id from t where k = 'bill'));
select is(pg_temp.open((select id from t where k = 'bill')), 0.00, 'A5: bill 356.56 paid 356.56');
insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, no_document_reason) values
  (tests.es(), 'expense', '2026-11-11', tests.ma('T-USD'), tests.party('T Supplier'), 'test') returning id as cash \gset
insert into public.document_lines (company_id, document_id, line_no, gl_account_id, project_id, amount) values (tests.es(), :'cash', 1, tests.acct('5200'), tests.project('T Project A'), 40);
select is(tests.post_as('accountant@es.test', :'cash'), 'posted', 'A5: a cash purchase from the same supplier');
select tests.login('owner@es.test');
select is((select balance from public.party_statement(tests.es(), tests.party('T Supplier'), '2026-01-01', '2026-12-31') order by entry_date desc, balance limit 1),
  0.00, 'A5: supplier statement balance 0; the cash purchase is not shown as owed');
select tests.logout();
insert into t select 'prep', pg_temp.money('supplier_payment', 'T Supplier', 'T-USD', 200);
select is(pg_temp.bal('1250', 'T Supplier'), 200.00, 'A5: a payment with no bill is a prepayment (asset), not a negative payable');
select is(pg_temp.bal('2000', 'T Supplier'), 0.00, 'A5: payable untouched');

-- ======== Write-off of a small difference; undo ======================================================
insert into t select 'inv3', pg_temp.invoice('sales_invoice', 'T Customer', 'USD', 1000);
insert into t select 'rcp3', pg_temp.money('customer_receipt', 'T Customer', 'T-USD', 999.50, (select id from t where k = 'inv3'), 999.50);
select tests.login('accountant@es.test');
select lives_ok(format('select public.write_off(%L, ''Customer paid 0.50 short'')', (select id from t where k = 'inv3')), 'a 0.50 difference is written off');
select tests.logout();
select is(pg_temp.open((select id from t where k = 'inv3')), 0.00, 'the invoice is closed');
select is(pg_temp.bal('6950'), 0.50, 'the 0.50 is on Settlement differences');
select tests.login('accountant@es.test');
select throws_like(format('select public.void_document(%L, ''wrong customer'')', (select id from t where k = 'adv')), 'Undo what was applied afterwards first%',
  'a payment applied afterwards is voided only after the application is undone');
select tests.logout();

select * from finish();
rollback;
