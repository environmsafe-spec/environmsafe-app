-- Phase 6: migration of the old app. Synthetic records shaped like the real es_records rows
-- (same collections, keys, ID formats and quirks: amount empty with the value in debit/credit, tombstones,
-- receivable "INV" account, the owner's personal account, transfer legs paired by againstRef).
begin;
select plan(29);

insert into legacy.es_records (company_id, collection, record_id, data, deleted)
select tests.es(), c, coalesce(x ->> 'id', 'TRX-0016'), x - '_deleted', coalesce((x ->> '_deleted')::boolean, x = '{}') from (values
  ('accounts',  '{"id":"ACC-0003","nameEn":"USD-Kur","bank":"Al Kuraimi","kind":"Bank","currency":"USD","opening":"0"}'::jsonb),
  ('accounts',  '{"id":"ACC-0006","nameEn":"YER-QUT","bank":"Al Qutaibi","kind":"Bank","currency":"YER","opening":""}'),
  ('accounts',  '{"id":"ACC-0008","nameEn":"YER-KUR","bank":"Al Kuraimi","kind":"Bank","currency":"YER","opening":"0"}'),
  ('accounts',  '{"id":"ACC-0004","nameEn":"USD-INV","bank":"INV (unconfirmed)","kind":"Bank","currency":"USD","opening":"0"}'),
  ('accounts',  '{"id":"ACC-0022","nameEn":"USD-AKRAM-QUT","bank":"Al Qutaibi","kind":"Bank","currency":"USD","opening":"0"}'),
  ('accounts',  '{"id":"ACC-0020","nameEn":"USD-Akram-TAD","bank":"Tadhamon","kind":"Bank","currency":"USD","opening":"0"}'),
  ('customers', '{"id":"CUS-0043","nameEn":"FAO Aden","nameAr":"الفاو عدن","notes":"","opening":"0"}'),
  ('suppliers', '{"id":"SUP-0001","nameEn":"Gulf Supplies","notes":""}'),
  ('employees', '{"id":"EMP-0021","nameEn":"Yasmeen","nameAr":"ياسمين","position":"Engineer","phone":""}'),
  ('employees', '{"id":"EMP-0002","nameEn":"Ali","nameAr":"علي","position":"Technician","phone":""}'),
  ('projects',  '{"id":"PRJ-UL-0001","nameEn":"FAO-GEN-001","customerId":"CUS-0043","status":"active","budget":""}'),
  ('projects',  '{"id":"PRJ-0001","nameEn":"Inspection Aden","status":"Open","budget":"12000"}'),
  ('items',     '{"id":"ITM-0001","code":"F1","nameEn":"Oil filter","kind":"Goods","unit":"pc","isAsset":"No","lifeYears":"","costPrice":"150","salePrice":"","category":""}'),
  ('categories','{"id":"CAT-0010","nameEn":"Other OPEX","nameAr":"أخرى","kind":"Operations"}'),
  ('users',     '{"id":"USR-0001","username":"akram","pw":"x","salt":"y","role":"admin"}'),
  -- transactions
  ('transactions', '{"id":"TRX-0001","type":"INVOICE OUT","status":"Approved","date":"2025-03-01","currency":"USD","amount":"","debit":"5000","credit":"","customerId":"CUS-0043","projectId":"PRJ-UL-0001","accountId":"ACC-0004","refNo":"INV-1","notes":"Generator maintenance March"}'),
  ('transactions', '{"id":"TRX-0002","type":"RECEIPT","status":"Paid","date":"2025-03-20","currency":"USD","amount":"5000","customerId":"CUS-0043","accountId":"ACC-0003","againstRef":""}'),
  ('transactions', '{"id":"TRX-0003","type":"EXPENSE","status":"Approved","date":"2025-03-20","currency":"USD","amount":"","credit":"3","accountId":"ACC-0003","categoryId":"CAT-0010","description":"Bank fee for TRX-0002","employeeId":"EMP-0002","attachments":[{"path":"tx/TRX-0003/slip.jpg","name":"slip.jpg","type":"image/jpeg","size":1234,"by":"akram","at":"2025-03-20"}]}'),
  ('transactions', '{"id":"TRX-0004","type":"EXPENSE","status":"Approved","date":"2025-04-02","currency":"YER","amount":"204","accountId":"","employeeId":"EMP-0002","description":"Water for site"}'),
  ('transactions', '{"id":"TRX-0005","type":"EXPENSE","status":"Approved","date":"2025-04-03","currency":"USD","amount":"50","accountId":"ACC-0022","description":"Alibaba fee paid by card"}'),
  ('transactions', '{"id":"TRX-0283","type":"ADVANCE TO EMPLOYEE","status":"Closed","date":"2026-04-18","currency":"YER","amount":"1000000","accountId":"ACC-0006","employeeId":"EMP-0021","notes":"Bus advance"}'),
  ('transactions', '{"id":"TRX-UL-0149","type":"LOAN IN","status":"Draft","date":"2026-11-01","currency":"YER","amount":"1000000","accountId":"ACC-0008","againstRef":"TRX-0283"}'),
  ('transactions', '{"id":"TRX-0010","type":"TRANSFER OUT","status":"Approved","date":"2025-05-01","currency":"USD","amount":"1000","accountId":"ACC-0003"}'),
  ('transactions', '{"id":"TRX-0011","type":"TRANSFER IN","status":"Approved","date":"2025-05-01","currency":"USD","amount":"1000","accountId":"ACC-0020","againstRef":"TRX-0010"}'),
  ('transactions', '{"id":"TRX-0012","type":"TRANSFER OUT","status":"Approved","date":"2025-05-02","currency":"USD","amount":"250","accountId":"ACC-0003"}'),
  ('transactions', '{"id":"TRX-0013","type":"PAYMENT OUT","status":"Approved","date":"2025-05-03","currency":"USD","amount":"","credit":"300","qty":"2","unitPrice":"150","discount":"","supplierId":"SUP-0001","itemId":"ITM-0001","projectId":"PRJ-0001","accountId":"ACC-0003"}'),
  ('transactions', '{"id":"TRX-0014","type":"EXPENSE","status":"Draft","date":"2026-11-05","currency":"USD","amount":"20","accountId":"ACC-0003","description":"New since last time"}'),
  ('transactions', '{"id":"TRX-0015","type":"EXPENSE","status":"Approved","date":"2025-06-01","currency":"USD","amount":"70","accountId":"ACC-0003","_deleted":true}'),
  ('transactions', '{}'),
  ('transactions', '{"id":"TRX-0017","type":"OWNER DRAWINGS","status":"Approved","date":"2025-06-02","currency":"USD","amount":"500","accountId":"ACC-0022"}'),
  ('transactions', '{"id":"TRX-0018","type":"SALARY","status":"Approved","date":"2025-06-30","currency":"USD","amount":"400","accountId":"ACC-0003","employeeId":"EMP-0002","categoryId":"CAT-0002"}'),
  ('transactions', '{"id":"TRX-0019","type":"EXPENSE CLAIM","status":"Approved","date":"2025-07-01","currency":"USD","amount":"60","employeeId":"EMP-0002","description":"Taxi to site"}'),
  ('transactions', '{"id":"TRX-0020","type":"PAYMENT OUT","status":"Approved","date":"2025-07-05","currency":"USD","amount":"60","accountId":"ACC-0003","employeeId":"EMP-0002","againstRef":"TRX-0019"}')
) v(c, x);

create temp table before as select md5(string_agg(record_id || data::text || deleted, '|' order by collection, record_id)) h from legacy.es_records;

select lives_ok($$ select * from migration.run(tests.es(), tests.uid('owner@es.test')) $$, 'migration job runs');

create temp view doc as
  select m.legacy_id as old_id, d.* from migration.map m join public.documents d on d.id = m.target_id where m.collection = 'transactions';

select is((select sum(missing)::int from migration.recon_counts), 0, 'every old transaction has an outcome');
select is((select count(*)::int from migration.recon_counts where old_records <> posted + draft + void + skipped + exception
                                                               and old_type not in ('PAYMENT OUT')), 0,
          'each old record has exactly one outcome (payments with an item add a bill)');

-- Masters
select is((select count(*)::int from public.money_accounts where legacy_id in ('ACC-0004', 'ACC-0022')), 0,
          'D/F: the INV placeholder and the owner''s personal account are not money accounts');
select is((select kind::text from public.money_accounts where legacy_id = 'ACC-0006'), 'exchange', 'Qutaibi = exchange company');
select is((select kind::text from public.money_accounts where legacy_id = 'ACC-0020'), 'bank', 'F: Tadhamon = company bank account');
select is((select p.name_en from public.parties p join public.projects j on j.customer_id = p.id where j.legacy_id = 'PRJ-UL-0001'),
          'FAO Aden', 'project keeps its customer');

-- D + G: invoice to receivables, generator revenue; receipt settles it.
select is((select status::text || ' ' || kind from doc where old_id = 'TRX-0001'), 'posted sales_invoice', 'invoice posted');
select is((select sum(jl.credit) from doc d join public.journal_lines jl on jl.entry_id = d.journal_entry_id
             join public.gl_accounts g on g.id = jl.account_id where d.old_id = 'TRX-0001' and g.code = '4250'),
          5000.00, 'G: generator project revenue on 4250 (value taken from debit)');
select is((select open_amount from public.v_document_balances b join doc d on d.id = b.id where d.old_id = 'TRX-0001'),
          0.00, 'receipt of the same customer and amount settles the invoice');

-- Expenses
select is((select g.code from doc d join public.document_lines l on l.document_id = d.id join public.gl_accounts g on g.id = l.gl_account_id
            where d.old_id = 'TRX-0003'), '6900', 'bank fee goes to 6900 Bank charges');
select is((select kind::text || ' ' || status from doc where old_id = 'TRX-0004'), 'expense_claim posted',
          'B: employee expense without a company account = the employee''s claim');
select is((select sum(jl.credit) from doc d join public.journal_lines jl on jl.entry_id = d.journal_entry_id
             join public.gl_accounts g on g.id = jl.account_id where d.old_id = 'TRX-0005' and g.code = '2200'),
          50.00, 'F: paid from the owner''s personal account = owner current account 2200');

-- E: the repayment of the advance
select is((select kind::text || ' ' || status from doc where old_id = 'TRX-UL-0149'), 'advance_repayment draft',
          'E: LOAN IN becomes the advance repayment, kept as a draft (A)');
select is((select count(*)::int from public.document_links l join doc a on a.id = l.to_document_id join doc r on r.id = l.from_document_id
            where a.old_id = 'TRX-0283' and r.old_id = 'TRX-UL-0149'), 1, 'repayment is linked to the advance');

-- Transfers
select is((select count(distinct target_id)::int from migration.map where legacy_id in ('TRX-0010', 'TRX-0011')), 1,
          'transfer out + in = one transfer');
select is((select kind::text || ' ' || status from doc where old_id = 'TRX-0011'), 'transfer posted', 'transfer posted');
select is((select outcome from migration.map where legacy_id = 'TRX-0012'), 'exception', 'unpaired transfer leg goes to the exceptions list');

-- Payment with an item: bill + payment
select is((select string_agg(kind::text || ' ' || status, ', ' order by kind) from doc where old_id = 'TRX-0013'),
          'supplier_payment posted, supplier_bill posted', 'payment with an item = supplier bill + payment');
select is((select open_amount from public.v_document_balances b join doc d on d.id = b.id where d.old_id = 'TRX-0013' and d.kind = 'supplier_bill'),
          0.00, 'the payment settles its bill');

-- Statuses
select is((select string_agg(old_id || '=' || status, ' ' order by old_id) from doc where old_id in ('TRX-0014', 'TRX-0015')),
          'TRX-0014=draft TRX-0015=void', 'A: draft stays draft; deleted with data = void');
select is((select string_agg(legacy_id || '=' || outcome, ' ' order by legacy_id) from migration.map where legacy_id in ('TRX-0016', 'TRX-0017')),
          'TRX-0016=skipped TRX-0017=skipped', 'tombstone and drawing from the personal account are listed, not posted');
select is((select open_amount from public.v_document_balances b join doc d on d.id = b.id where d.old_id = 'TRX-0019'),
          0.00, 'payment against a claim reimburses it');

-- Reconciliation
select is((select string_agg(legacy_id || ':' || difference, ' ' order by legacy_id) from migration.recon_money where difference <> 0),
          'ACC-0003:250.00', 'bank books match the old app except the unpaired transfer');
select is((select string_agg(record_id, ' ') from migration.recon_money_open_items where account = 'ACC-0003'),
          'TRX-0012', 'and the difference is explained by the open item');
select is((select old_files::int || '/' || new_files from migration.recon_attachments), '1/1', 'attachment references carried over');

-- Safety
select is((select md5(string_agg(record_id || data::text || deleted, '|' order by collection, record_id)) from legacy.es_records),
          (select h from before), 'the old records are never changed');

select throws_ok($$ select * from migration.run(tests.es(), tests.uid('owner@es.test')) $$,
  'This company already holds migrated documents: run the migration on a fresh database', 'a second run is refused');
select is((select settings ->> 'approval_threshold_usd' from public.companies where id = tests.es()), '1000',
          'the approval threshold is back after the run');

select * from finish();
rollback;
