-- Brief v2, step 1: A1 (receipt only, advance repayment is not revenue), A2 (no empty amounts, six statuses),
-- A7 (number formats).
begin;
select plan(19);
select tests.phase2_fixtures();
insert into public.items (company_id, code, name_en, kind, unit, default_expense_account_id) values
  (tests.es(), '', 'Valve', 'goods', 'PC', tests.acct('5200'));

-- ---------- A1 -----------------------------------------------------------------------------------
select is((select count(*)::int from public.doc_kinds where kind::text ilike '%payment_in%' or name_en ilike '%payment in%'), 0,
  'A1: no "payment in" document type exists (customer money in is a Customer receipt)');
insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, no_document_reason)
values (tests.es(), 'employee_advance', '2026-11-02', tests.ma('T-USD'), tests.party('T Employee'), 300, 'test') returning id as adv \gset
select is(tests.post_as('accountant@es.test', :'adv'), 'posted', 'A1: advance to an employee');
insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, no_document_reason)
values (tests.es(), 'advance_repayment', '2026-11-20', tests.ma('T-USD'), tests.party('T Employee'), 300, 'test') returning id as rep \gset
insert into public.document_links (company_id, from_document_id, to_document_id, amount) values (tests.es(), :'rep', :'adv', 300);
select is(tests.post_as('accountant@es.test', :'rep'), 'posted', 'A1: the employee pays it back');
select is((select count(*)::int from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id
             join public.gl_accounts g on g.id = jl.account_id where je.document_id = :'rep' and g.account_type = 'income'), 0,
  'A1: an advance repayment never reaches revenue');
select is((select open_amount from public.v_document_balances where id = :'adv'), 0.00, 'A1: the advance is cleared');

-- ---------- A2: no empty amounts, by any way in -------------------------------------------------------
insert into public.documents (company_id, kind, doc_date, money_account_id, no_document_reason)
values (tests.es(), 'expense', '2026-11-20', tests.ma('T-USD'), 'test') returning id as exp \gset
select throws_ok(format($$insert into public.document_lines (company_id, document_id, line_no, gl_account_id, project_id, amount)
                          values (tests.es(), %L, 1, tests.acct('6200'), null, 0)$$, :'exp'),
  'P0001', 'Line 1: the amount must be above zero (enter the quantity and price)', 'A2: a zero amount is refused by the database (direct SQL)');
select throws_ok(format($$insert into public.document_lines (company_id, document_id, line_no, gl_account_id, amount)
                          values (tests.es(), %L, 1, tests.acct('6200'), null)$$, :'exp'),
  'P0001', null, 'A2: an empty amount is refused');
select is(tests.try_as('dataentry@es.test', format($$insert into public.document_lines (company_id, document_id, line_no, gl_account_id, amount)
                          values (tests.es(), %L, 1, tests.acct('6200'), 0)$$, :'exp')), 'P0001',
  'A2: and through the API (as a signed-in user, RLS applied)');
insert into public.documents (company_id, kind, doc_date, party_id) values (tests.es(), 'purchase_order', '2026-11-20', tests.party('T Supplier')) returning id as po \gset
select throws_ok(format($$insert into public.document_lines (company_id, document_id, line_no, item_id, qty, unit_price, amount)
                          values (tests.es(), %L, 1, (select id from public.items where name_en = 'Valve'), 3, null, 0)$$, :'po'),
  'P0001', null, 'A2: a PO line without a price is refused, even in a draft');
insert into public.document_lines (company_id, document_id, line_no, item_id, qty, unit_price, amount)
values (tests.es(), :'po', 1, (select id from public.items where name_en = 'Valve'), 3, 12.5, 1);
select is((select amount from public.document_lines where document_id = :'po'), 37.50, 'A2: the amount of an item line is always qty x price');
insert into public.documents (company_id, kind, doc_date, party_id) values (tests.es(), 'supplier_rfq', '2026-11-20', tests.party('T Supplier')) returning id as rfq \gset
select lives_ok(format($$insert into public.document_lines (company_id, document_id, line_no, description, qty, amount)
                          values (tests.es(), %L, 1, 'Valve 4in', 3, 0)$$, :'rfq'), 'A2: an RFQ line carries no money, so no amount is needed');

-- ---------- A2: the six statuses ----------------------------------------------------------------------
select is((select public.display_status(d) from public.documents d where id = :'po'), 'draft', 'status: Draft');
select is(tests.post_as('owner@es.test', :'po'), 'posted', 'the PO is issued');
select is((select public.display_status(d) from public.documents d where id = :'po'), 'posted', 'status: Posted');
select is((select number from public.documents where id = :'po'), '2026112001', 'A7: PO number YYYYMMDDNN');
select tests.login('owner@es.test');
select lives_ok(format($$select public.void_document(%L, 'Withdrawn before posting')$$, :'exp'), 'a draft is withdrawn');
select tests.logout();
select is((select public.display_status(d) from public.documents d where id = :'exp'), 'cancelled', 'status: Cancelled (never posted)');
select is(tests.post_as('accountant@es.test', :'rep'), 'ERROR: Document RV-2026-0001 is already posted', 'posted stays posted');
select tests.login('accountant@es.test');
select public.set_reconciled(array[:'rep'::uuid]);
select tests.logout();
select is((select public.display_status(d) from public.documents d where id = :'rep'), 'reconciled', 'status: Reconciled (matched to the bank)');

select * from finish();
rollback;
