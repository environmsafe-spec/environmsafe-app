-- Workflow rules: who may do what, immutability, evidence, approval, void/reversal, periods, duplicates.
begin;
select plan(42);
select tests.phase2_fixtures();

-- A ready-to-post USD payment as a base
insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, reference_no)
values (tests.es(), 'supplier_payment', '2026-06-10', tests.ma('T-USD'), tests.party('T Supplier'), 250, 'SLIP-77')
returning id as p1 \gset

-- ---------- Evidence --------------------------------------------------------------------
select is(tests.post_as('accountant@es.test', :'p1'), 'ERROR: Attach the voucher / receipt, or say why there is no document',
  'a cash movement without a file or reason cannot be posted');
insert into public.attachments (company_id, document_id, storage_path, file_name, mime_type, size_bytes, sha256)
values (tests.es(), :'p1', tests.es() || '/' || :'p1' || '/slip.jpg', 'slip.jpg', 'image/jpeg', 120000, repeat('a', 64));

-- ---------- Permissions -----------------------------------------------------------------
select is(tests.post_as('dataentry@es.test', :'p1'), 'ERROR: Permission denied: docs.post_money is required', 'data entry cannot post');
select is(tests.post_as('procurement@es.test', :'p1'), 'ERROR: Permission denied: docs.post_money is required', 'procurement cannot post payments');
select is(tests.try_as('dataentry@es.test', $$insert into public.documents (company_id, kind, money_account_id, amount) values (tests.es(), 'expense', tests.ma('T-USD'), 0)$$), 'ok:1', 'data entry creates a draft');
select is(tests.try_as('dataentry@es.test', format($$update public.documents set description = 'x' where id = %L$$, :'p1')), 'ok:0', 'data entry cannot edit someone else''s draft');
select is(tests.try_as('dataentry@es.test', $$insert into public.documents (company_id, kind) values (tests.es(), 'manual_journal')$$), '42501', 'data entry cannot start a manual journal');
select is(tests.try_as('auditor@es.test', $$insert into public.documents (company_id, kind, money_account_id) values (tests.es(), 'expense', tests.ma('T-USD'))$$), '42501', 'auditor cannot create documents');
select is(tests.count_as('viewer@es.test', 'select 1 from public.documents'), 0::bigint, 'viewer does not see documents');
select is(tests.count_as('outsider@other.test', 'select 1 from public.documents'), 0::bigint, 'another company does not see ES documents');
select is(tests.try_as('dataentry@es.test', $$insert into public.documents (company_id, kind, money_account_id, status, number) values (tests.es(), 'expense', tests.ma('T-USD'), 'posted', 'PV-FAKE')$$), 'ok:1', 'a client cannot fake status or number...');
select is((select count(*)::int from public.documents where number = 'PV-FAKE'), 0, '...the database resets them to draft');

-- ---------- Post, then immutability -------------------------------------------------------
select is(tests.post_as('accountant@es.test', :'p1'), 'posted', 'payment posts once evidence is attached');
select throws_ok(format($$update public.documents set amount = 1 where id = %L$$, :'p1'), '42501', null, 'a posted document cannot be edited (even by the database owner)');
select throws_ok(format($$delete from public.documents where id = %L$$, :'p1'), '42501', null, 'a posted document cannot be deleted');
select throws_ok(format($$delete from public.attachments where document_id = %L$$, :'p1'), '42501', null, 'files of a posted document cannot be removed');
select throws_ok($$update public.journal_lines set debit = debit + 1$$, '42501', null, 'journal lines cannot be changed');
select throws_ok($$delete from public.journal_entries$$, '42501', null, 'journal entries cannot be deleted');
select is(tests.post_as('accountant@es.test', :'p1'), 'ERROR: Document PV-2026-0001 is already posted', 'posting twice is refused');
select is(tests.try_as('dataentry@es.test', format($$insert into public.attachments (company_id, document_id, storage_path, file_name) values (tests.es(), %L, tests.es() || '/late.pdf', 'late.pdf')$$, :'p1')), 'ok:1',
  'a late receipt can still be attached to a posted document');

-- ---------- Duplicate guard --------------------------------------------------------------
insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, reference_no)
values (tests.es(), 'supplier_payment', '2026-06-10', tests.ma('T-USD'), tests.party('T Supplier'), 250, 'SLIP-77') returning id as p2 \gset
select tests.login('dataentry@es.test');
select is((select string_agg(reason, ',') from public.find_duplicates(:'p2')), 'same reference', 'duplicate warning: same bank reference');
select tests.logout();
update public.documents set reference_no = null where id = :'p2';
select tests.login('dataentry@es.test');
select is((select string_agg(reason, ',') from public.find_duplicates(:'p2')), 'same party, amount and date', 'duplicate warning: same party, amount and date');
select tests.logout();

-- ---------- Approval threshold (USD 1,000) ----------------------------------------------
insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, no_document_reason)
values (tests.es(), 'supplier_payment', '2026-06-11', tests.ma('T-USD'), tests.party('T Supplier'), 1500, 'test') returning id as big \gset
select is(tests.post_as('accountant@es.test', :'big'), 'submitted', 'a payment over USD 1,000 waits for approval');
select is(tests.try_as('accountant@es.test', format($$select public.approve_document(%L)$$, :'big')), '42501', 'the accountant cannot approve');
select is(tests.try_as('owner@es.test', format($$select public.reject_document(%L, 'wrong supplier')$$, :'big')), 'ok:1', 'the owner can reject (back to draft)');
select tests.login('owner@es.test');
select is((public.approve_document(:'big', 'ok')).status::text, 'posted', 'the owner approves and it posts');
select tests.logout();
select is((select count(*)::int from public.approvals where document_id = :'big'), 1, 'the approval is recorded');

insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, no_document_reason)
values (tests.es(), 'customer_receipt', '2026-06-11', tests.ma('T-USD'), tests.party('T Customer'), 5000, 'test') returning id as bigin \gset
select is(tests.post_as('accountant@es.test', :'bigin'), 'posted', 'money coming in needs no approval');

-- ---------- Void with reversal ------------------------------------------------------------
select is(tests.try_as('dataentry@es.test', format($$select public.void_document(%L, 'mistake')$$, :'p1')), '42501', 'data entry cannot void a posted document');
select tests.login('accountant@es.test');
select is((public.void_document(:'p1', 'Paid the wrong supplier')).status::text, 'void', 'accountant voids the posted payment');
select tests.logout();
select is(tests.je(:'p1', 'reversal'), '2000 C 250.00 | 1000-001 D 250.00', 'the reversal is the exact opposite entry');
select is((select number from public.documents where id = :'p1'), 'PV-2026-0001', 'a voided document keeps its number (no gap)');
select is((select sum(jl.debit - jl.credit) from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id
           where je.document_id = :'p1' and jl.account_id = tests.acct('2000')), 0.00, 'net effect of a voided document is zero');

-- Corrected copy
select tests.login('accountant@es.test');
select ok((select public.duplicate_document(:'p1')) is not null, 'a corrected draft copy can be made from the void document');
select tests.logout();
select is((select status::text || ' ' || amount from public.documents where copied_from_id = :'p1'), 'draft 250.00', 'the copy is an editable draft');

-- Settled documents cannot be voided before their settlement
insert into public.documents (company_id, kind, doc_date, party_id) values (tests.es(), 'expense_claim', '2026-06-12', tests.party('T Employee')) returning id as c1 \gset
insert into public.document_lines (company_id, document_id, amount, gl_account_id, project_id) values (tests.es(), :'c1', 100, tests.acct('6200'), tests.project('T Project A'));
select tests.post_as('accountant@es.test', :'c1');
insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, no_document_reason)
values (tests.es(), 'claim_reimbursement', '2026-06-13', tests.ma('T-USD'), tests.party('T Employee'), 100, 'test') returning id as r1 \gset
insert into public.document_links (company_id, from_document_id, to_document_id, amount) values (tests.es(), :'r1', :'c1', 150);
select alike(tests.post_as('accountant@es.test', :'r1'), 'ERROR: Document CLM-2026-% has only 100.00 USD open', 'cannot settle more than is open');
update public.document_links set amount = 100 where from_document_id = :'r1';
select tests.post_as('accountant@es.test', :'r1');
select is(tests.try_as('accountant@es.test', format($$select public.void_document(%L, 'oops')$$, :'c1')), 'P0001', 'a claim that was reimbursed cannot be voided first');

insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, no_document_reason)
values (tests.es(), 'claim_reimbursement', '2026-06-13', tests.ma('T-SAR'), tests.party('T Employee'), 10, 'test') returning id as r2 \gset
insert into public.document_links (company_id, from_document_id, to_document_id, amount) values (tests.es(), :'r2', :'c1', 10);
select alike(tests.post_as('accountant@es.test', :'r2'), 'ERROR: %is in USD; settle it from a USD account', 'settlement must be in the same currency');

-- ---------- Closed period ---------------------------------------------------------------
select tests.login('accountant@es.test');
select public.close_period(tests.es(), 2026, 7);
select tests.logout();
insert into public.documents (company_id, kind, doc_date, money_account_id, no_document_reason)
values (tests.es(), 'expense', '2026-07-15', tests.ma('T-USD'), 'test') returning id as e7 \gset
insert into public.document_lines (company_id, document_id, amount, gl_account_id, project_id) values (tests.es(), :'e7', 10, tests.acct('6800'), tests.project('T Project A'));
select alike(tests.post_as('accountant@es.test', :'e7'), 'ERROR: Period 2026-07 is closed%', 'posting into a closed period is refused');
select is((select status::text from public.documents where id = :'e7'), 'draft', '...and the document stays a draft');

-- ---------- Manual journal ---------------------------------------------------------------
insert into public.documents (company_id, kind, doc_date) values (tests.es(), 'manual_journal', '2026-06-30') returning id as j1 \gset
insert into public.document_lines (company_id, document_id, line_no, amount, side, gl_account_id) values
  (tests.es(), :'j1', 1, 100, 'D', tests.acct('1150')),
  (tests.es(), :'j1', 2, 90, 'C', tests.acct('2400'));
select is(tests.post_as('accountant@es.test', :'j1'), 'ERROR: Journal is not balanced: debits 100.00 vs credits 90.00', 'an unbalanced manual journal is refused');
update public.document_lines set amount = 100 where document_id = :'j1' and side = 'C';
select is(tests.post_as('accountant@es.test', :'j1'), 'posted', 'a balanced manual journal posts');

select is((select sum(debit) - sum(credit) from public.trial_balance(tests.es(), '2026-01-01', '2026-12-31')), 0::numeric, 'trial balance still balances');

select * from finish();
rollback;
