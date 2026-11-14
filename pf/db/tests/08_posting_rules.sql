-- Posting rules: every document kind produces the right balanced journal entry.
begin;
select plan(44);
select tests.phase2_fixtures();

-- 1. Expense paid now, split across two projects, with a bank fee ---------------------------
insert into public.documents (company_id, kind, doc_date, money_account_id, fee_amount, description, no_document_reason)
values (tests.es(), 'expense', '2026-03-10', tests.ma('T-USD'), 2, 'Fuel and stationery', 'test')
returning id as exp1 \gset
insert into public.document_lines (company_id, document_id, line_no, amount, gl_account_id, project_id) values
  (tests.es(), :'exp1', 1, 60, tests.acct('6200'), tests.project('T Project A')),
  (tests.es(), :'exp1', 2, 40, tests.acct('6800'), tests.project('T Project B'));
select is((select amount from public.documents where id = :'exp1'), 100.00, 'header amount = sum of lines');
select is(tests.post_as('accountant@es.test', :'exp1'), 'posted', 'expense posts');
select is(tests.je(:'exp1'), '6200 D 60.00 | 6800 D 40.00 | 6900 D 2.00 | 1000-001 C 102.00',
  'expense: each line to its account and project, fee to bank charges, bank credited with amount + fee');
select is((select number from public.documents where id = :'exp1'), 'PV-2026-0001', 'payment voucher number assigned at posting');
select is((select count(distinct project_id)::int from public.journal_lines jl join public.documents d on d.journal_entry_id = jl.entry_id
           where d.id = :'exp1' and jl.project_id is not null), 2, 'one voucher, two project lines');

-- 2. Expense in YER converts at the rate ------------------------------------------------------
insert into public.documents (company_id, kind, doc_date, money_account_id, no_document_reason)
values (tests.es(), 'expense', '2026-03-11', tests.ma('T-YER'), 'test') returning id as exp2 \gset
insert into public.document_lines (company_id, document_id, amount, gl_account_id, project_id)
values (tests.es(), :'exp2', 15560, tests.acct('6400'), tests.project('T Project A'));
select is((select currency || ' ' || rate from public.documents where id = :'exp2'), 'YER 1556.000000', 'currency and rate come from the account and rate table');
select is(tests.post_as('accountant@es.test', :'exp2'), 'posted', 'YER expense posts');
select is(tests.je(:'exp2'), '6400 D 10.00 | 1000-002 C 10.00', 'YER 15,560 = USD 10.00 in the ledger');
select is((select txn_currency || ' ' || txn_amount from public.journal_lines jl join public.documents d on d.journal_entry_id = jl.entry_id
           where d.id = :'exp2' and jl.credit > 0), 'YER 15560.00', 'original currency amount kept on the line');

-- 3. Supplier payment with fee; deposit variant ----------------------------------------------
insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, fee_amount, no_document_reason)
values (tests.es(), 'supplier_payment', '2026-03-12', tests.ma('T-USD'), tests.party('T Supplier'), 500, 5, 'test')
returning id as pay1 \gset
select is(tests.post_as('accountant@es.test', :'pay1'), 'posted', 'supplier payment posts');
select is(tests.je(:'pay1'), '2000 D 500.00 | 6900 D 5.00 | 1000-001 C 505.00', 'supplier payment: Dr AP, fee, Cr bank');
select is((select jl.party_id from public.journal_lines jl join public.documents d on d.journal_entry_id = jl.entry_id
           join public.gl_accounts g on g.id = jl.account_id where d.id = :'pay1' and g.code = '2000'),
          tests.party('T Supplier'), 'AP line carries the supplier');

insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, purpose, no_document_reason)
values (tests.es(), 'supplier_payment', '2026-03-12', tests.ma('T-USD'), tests.party('T Supplier'), 200, 'deposit', 'test')
returning id as dep1 \gset
select is(tests.post_as('accountant@es.test', :'dep1'), 'posted', 'deposit payment posts');
select is(tests.je(:'dep1'), '1260 D 200.00 | 1000-001 C 200.00', 'deposit / guarantee goes to 1260');

-- 4. Customer receipt with fee deducted by the bank ------------------------------------------
insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, fee_amount, no_document_reason)
values (tests.es(), 'customer_receipt', '2026-03-15', tests.ma('T-USD'), tests.party('T Customer'), 1000, 10, 'test')
returning id as rcp1 \gset
select is(tests.post_as('accountant@es.test', :'rcp1'), 'posted', 'customer receipt posts');
select is(tests.je(:'rcp1'), '1000-001 D 990.00 | 6900 D 10.00 | 1100 C 1000.00', 'receipt: bank gets net, fee expensed, AR credited in full');
select is((select number from public.documents where id = :'rcp1'), 'RV-2026-0001', 'receipt voucher numbering');

-- 5. Transfers: same rate, then a worse exchange rate (FX loss) ------------------------------
insert into public.documents (company_id, kind, doc_date, money_account_id, counter_money_account_id, amount, counter_amount, counter_rate, no_document_reason)
values (tests.es(), 'transfer', '2026-03-16', tests.ma('T-USD'), tests.ma('T-YER'), 100, 155600, 1556, 'test')
returning id as trf1 \gset
select is(tests.post_as('accountant@es.test', :'trf1'), 'posted', 'transfer posts');
select is(tests.je(:'trf1'), '1000-002 D 100.00 | 1000-001 C 100.00', 'transfer at book rate: one document, two legs, no FX');
select is((select number from public.documents where id = :'trf1'), 'TRF-2026-0001', 'transfer numbering');

insert into public.documents (company_id, kind, doc_date, money_account_id, counter_money_account_id, amount, counter_amount, counter_rate, fee_amount, no_document_reason)
values (tests.es(), 'transfer', '2026-03-17', tests.ma('T-USD'), tests.ma('T-YER'), 100, 150000, 1556, 1, 'test')
returning id as trf2 \gset
select is(tests.post_as('accountant@es.test', :'trf2'), 'posted', 'transfer with a fee and a poorer rate posts');
select is(tests.je(:'trf2'), '1000-002 D 96.40 | 6900 D 1.00 | 1000-001 C 101.00 | 7000 D 3.60',
  'transfer: destination at its rate, fee, source with fee, FX loss for the difference');

-- 6. Expense claim and reimbursement (same rate) ---------------------------------------------
insert into public.documents (company_id, kind, doc_date, party_id) values (tests.es(), 'expense_claim', '2026-04-01', tests.party('T Employee'))
returning id as clm1 \gset
insert into public.document_lines (company_id, document_id, amount, gl_account_id, project_id, description) values
  (tests.es(), :'clm1', 250, tests.acct('6600'), tests.project('T Project A'), 'Hotel'),
  (tests.es(), :'clm1', 50,  tests.acct('6200'), tests.project('T Project A'), 'Taxi');
select is(tests.post_as('accountant@es.test', :'clm1'), 'posted', 'claim posts without a bank account or attachment');
select is(tests.je(:'clm1'), '6600 D 250.00 | 6200 D 50.00 | 2100 C 300.00', 'claim: expenses by project, Cr employee payable');

insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, no_document_reason)
values (tests.es(), 'claim_reimbursement', '2026-04-20', tests.ma('T-USD'), tests.party('T Employee'), 300, 'test')
returning id as rmb1 \gset
insert into public.document_links (company_id, from_document_id, to_document_id, amount) values (tests.es(), :'rmb1', :'clm1', 300);
select is(tests.post_as('accountant@es.test', :'rmb1'), 'posted', 'reimbursement posts weeks later');
select is(tests.je(:'rmb1'), '2100 D 300.00 | 1000-001 C 300.00', 'reimbursement: Dr employee payable, Cr bank');
select is((select open_amount from public.v_document_balances where id = :'clm1'), 0.00, 'the claim is fully settled');

-- 7. YER claim reimbursed at a different rate: realised FX gain -------------------------------
insert into public.documents (company_id, kind, doc_date, party_id) values (tests.es(), 'expense_claim', '2026-04-02', tests.party('T Employee'))
returning id as clm2 \gset
update public.documents set currency = 'YER', rate = 1556 where id = :'clm2';
insert into public.document_lines (company_id, document_id, amount, gl_account_id, project_id) values (tests.es(), :'clm2', 15560, tests.acct('6200'), tests.project('T Project B'));
select is(tests.post_as('accountant@es.test', :'clm2'), 'posted', 'YER claim posts');
insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, rate, no_document_reason)
values (tests.es(), 'claim_reimbursement', '2026-05-01', tests.ma('T-YER'), tests.party('T Employee'), 15560, 1600, 'test')
returning id as rmb2 \gset
insert into public.document_links (company_id, from_document_id, to_document_id, amount) values (tests.es(), :'rmb2', :'clm2', 15560);
select is(tests.post_as('accountant@es.test', :'rmb2'), 'posted', 'YER reimbursement at 1600 posts');
select is(tests.je(:'rmb2'), '2100 D 10.00 | 1000-002 C 9.73 | 7000 C 0.27',
  'payable relieved at the claim rate; the rate difference is a realised FX gain');

-- 8. Owner paid a company cost personally: claim credits the owner current account ------------
insert into public.documents (company_id, kind, doc_date, party_id) values (tests.es(), 'expense_claim', '2026-04-03', tests.party('T Owner'))
returning id as own1 \gset
insert into public.document_lines (company_id, document_id, amount, gl_account_id, project_id) values (tests.es(), :'own1', 80, tests.acct('6850'), tests.project('T Project A'));
select is(tests.post_as('accountant@es.test', :'own1'), 'posted', 'owner-paid cost posts');
select is(tests.je(:'own1'), '6850 D 80.00 | 2200 C 80.00', 'owner-paid cost: Cr owner current account');

-- 9. Unpaid salary accrues to employee payable, numbered as a journal -------------------------
insert into public.documents (company_id, kind, doc_date, party_id) values (tests.es(), 'salary', '2026-04-30', tests.party('T Employee'))
returning id as sal1 \gset
insert into public.document_lines (company_id, document_id, amount, project_id) values (tests.es(), :'sal1', 700, tests.project('T Project A'));
select is(tests.post_as('accountant@es.test', :'sal1'), 'posted', 'unpaid salary posts');
select is(tests.je(:'sal1') || ' / ' || (select number from public.documents where id = :'sal1'),
  '6100 D 700.00 | 2100 C 700.00 / JV-2026-0001', 'salary defaults to 6100; unpaid -> employee payable, JV number');

-- 10. Advances, drawings-tagged employee, offset against a claim -----------------------------
insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, no_document_reason)
values (tests.es(), 'employee_advance', '2026-05-02', tests.ma('T-USD'), tests.party('T Employee'), 120, 'test') returning id as adv1 \gset
select is(tests.post_as('accountant@es.test', :'adv1'), 'posted', 'adv1 posts');
select is(tests.je(:'adv1'), '1200 D 120.00 | 1000-001 C 120.00', 'advance: Dr employee advances');

insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, no_document_reason)
values (tests.es(), 'employee_advance', '2026-05-02', tests.ma('T-USD'), tests.party('T Drawer'), 90, 'test') returning id as adv2 \gset
select is(tests.post_as('accountant@es.test', :'adv2'), 'posted', 'adv2 posts');
select is(tests.je(:'adv2'), '3200 D 90.00 | 1000-001 C 90.00', 'withdrawal by a person tagged as owner drawings goes to 3200');

insert into public.documents (company_id, kind, doc_date, party_id) values (tests.es(), 'expense_claim', '2026-05-03', tests.party('T Employee')) returning id as clm3 \gset
insert into public.document_lines (company_id, document_id, amount, gl_account_id, project_id) values (tests.es(), :'clm3', 120, tests.acct('6200'), tests.project('T Project A'));
select tests.post_as('accountant@es.test', :'clm3');
insert into public.documents (company_id, kind, doc_date, party_id) values (tests.es(), 'employee_offset', '2026-05-04', tests.party('T Employee')) returning id as off1 \gset
insert into public.document_links (company_id, from_document_id, to_document_id, amount) values
  (tests.es(), :'off1', :'clm3', 120), (tests.es(), :'off1', :'adv1', 120);
select is(tests.post_as('accountant@es.test', :'off1'), 'posted', 'off1 posts');
select is(tests.je(:'off1'), '2100 D 120.00 | 1200 C 120.00', 'offset: the claim is paid out of the advance');

-- 11. Owner drawings --------------------------------------------------------------------------
insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, no_document_reason)
values (tests.es(), 'owner_drawings', '2026-05-05', tests.ma('T-USD'), tests.party('T Owner'), 400, 'test') returning id as drw1 \gset
select is(tests.post_as('accountant@es.test', :'drw1'), 'posted', 'drw1 posts');
select is(tests.je(:'drw1'), '3200 D 400.00 | 1000-001 C 400.00', 'owner drawings: Dr 3200');

-- 12. Trial balance balances -----------------------------------------------------------------
select is((select sum(debit) - sum(credit) from public.trial_balance(tests.es(), '2026-01-01', '2026-12-31')), 0::numeric, 'trial balance: total debits = total credits');
select is((select count(*)::int from public.journal_entries je
           where (select sum(debit) from public.journal_lines where entry_id = je.id) <> (select sum(credit) from public.journal_lines where entry_id = je.id)),
          0, 'every journal entry is balanced');

select * from finish();
rollback;
