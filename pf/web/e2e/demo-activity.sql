-- LOCAL DEMO ONLY: a year of fictional activity posted through the real posting engine,
-- so the reports have something to show. Run after demo-data.sql.
select set_config('request.jwt.claims', '{"role":"service_role"}', false);

do $$
declare
  c   uuid := 'dee3dc12-55bb-4acc-9c44-46721b36651b';
  usd uuid := (select id from public.money_accounts where legacy_id = 'ACC-0003');
  yer uuid := (select id from public.money_accounts where legacy_id = 'ACC-0008');
  unhcr uuid := (select id from public.parties where legacy_id = 'CUS-0001');
  ycsr  uuid := (select id from public.parties where legacy_id = 'CUS-UL-0004');
  gulf  uuid := (select id from public.parties where legacy_id = 'SUP-UL-0003');
  emp   uuid := (select id from public.parties where legacy_id = 'EMP-0002');
  p_un  uuid := (select id from public.projects where legacy_id = 'PRJ-0042');
  p_yc  uuid := (select id from public.projects where legacy_id = 'PRJ-UL-0019');
  p_gen uuid := (select id from public.projects where name_en = 'General');
  psv   uuid := (select id from public.items where name_en like 'PSV calibration%');
  gen   uuid := (select id from public.items where name_en like 'Generator service%');
  d uuid; d2 uuid; m int;
  owner uuid;
begin
  -- Bulk demo posting: lift the approval limit while loading, restore it at the end.
  update public.companies set settings = settings || '{"approval_threshold_usd": 1000000}' where id = c;
  insert into public.parties (company_id, code, primary_kind, name_en, name_ar) values (c, '', 'owner', 'Akram (owner)', 'أكرم') returning id into owner;
  update public.items set default_revenue_account_id = (select id from public.gl_accounts where company_id = c and code = '4200') where id = gen;
  update public.items set default_revenue_account_id = (select id from public.gl_accounts where company_id = c and code = '4100'),
                          default_expense_account_id = (select id from public.gl_accounts where company_id = c and code = '5100') where id = psv;
  insert into public.items (company_id, code, name_en, kind, unit, default_expense_account_id, is_asset, life_years)
  values (c, '', 'Dead-weight tester (calibration bench)', 'goods', 'pc', (select id from public.gl_accounts where company_id = c and code = '1520'), true, 5);

  -- Capital
  insert into public.documents (company_id, kind, doc_date, description) values (c, 'manual_journal', '2026-01-02', 'Capital paid in') returning id into d;
  insert into public.document_lines (company_id, document_id, line_no, amount, side, gl_account_id) values
    (c, d, 1, 25000, 'D', (select gl_account_id from public.money_accounts where id = usd)),
    (c, d, 2, 25000, 'C', (select id from public.gl_accounts where company_id = c and code = '3000'));
  perform public.post_document(d);

  -- UNHCR generator maintenance: monthly invoices Jan-Oct 3,800, paid the next month
  for m in 1..10 loop
    insert into public.documents (company_id, kind, doc_date, party_id, description) values (c, 'sales_invoice', make_date(2026, m, 25), unhcr, 'Generator maintenance ' || to_char(make_date(2026, m, 1), 'Mon YYYY')) returning id into d;
    insert into public.document_lines (company_id, document_id, line_kind, item_id, description, qty, unit, unit_price, amount, project_id)
    values (c, d, 'item', gen, 'Generator service visits', 4, 'visit', 950, 3800, p_un);
    perform public.post_document(d);
    if m < 10 then
      insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, fee_amount, no_document_reason)
      values (c, 'customer_receipt', make_date(2026, m + 1, 10), usd, unhcr, 3800, 15, 'Bank advice') returning id into d2;
      insert into public.document_links (company_id, from_document_id, to_document_id, amount) values (c, d2, d, 3800);
      perform public.post_document(d2);
    end if;
    -- Field engineer salary for the month (paid)
    insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, no_document_reason) values (c, 'salary', make_date(2026, m, 28), usd, emp, 'Payroll sheet') returning id into d;
    insert into public.document_lines (company_id, document_id, amount, project_id) values (c, d, 900, p_un);
    perform public.post_document(d);
    -- Office rent
    insert into public.documents (company_id, kind, doc_date, money_account_id, no_document_reason, description) values (c, 'expense', make_date(2026, m, 1), usd, 'Rent contract', 'Office rent') returning id into d;
    insert into public.document_lines (company_id, document_id, amount, gl_account_id, project_id) values (c, d, 600, (select id from public.gl_accounts where company_id = c and code = '6300'), p_gen);
    perform public.post_document(d);
  end loop;

  -- YCSR PSV job: subcontract bill 4,200 (paid), invoice 11,400 (half received)
  insert into public.documents (company_id, kind, doc_date, party_id, party_reference) values (c, 'supplier_bill', '2026-10-20', gulf, 'GCS-INV-5521') returning id into d;
  insert into public.document_lines (company_id, document_id, line_kind, item_id, description, qty, unit, unit_price, amount, project_id)
  values (c, d, 'item', psv, 'PSV bench testing (subcontract)', 12, 'valve', 350, 4200, p_yc);
  perform public.post_document(d);
  insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, fee_amount, no_document_reason) values (c, 'supplier_payment', '2026-10-28', usd, gulf, 4200, 20, 'Swift copy') returning id into d2;
  insert into public.document_links (company_id, from_document_id, to_document_id, amount) values (c, d2, d, 4200);
  perform public.post_document(d2);
  insert into public.documents (company_id, kind, doc_date, party_id) values (c, 'sales_invoice', '2026-10-30', ycsr) returning id into d;
  insert into public.document_lines (company_id, document_id, line_kind, item_id, description, qty, unit, unit_price, amount, project_id)
  values (c, d, 'item', psv, 'PSV calibration and certification', 12, 'valve', 950, 11400, p_yc);
  perform public.post_document(d);
  insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, no_document_reason) values (c, 'customer_receipt', '2026-11-05', usd, ycsr, 5700, 'Cheque') returning id into d2;
  insert into public.document_links (company_id, from_document_id, to_document_id, amount) values (c, d2, d, 5700);
  perform public.post_document(d2);

  -- Calibration bench bought (asset, 5 years)
  insert into public.documents (company_id, kind, doc_date, party_id) values (c, 'supplier_bill', '2026-03-10', gulf) returning id into d;
  insert into public.document_lines (company_id, document_id, line_kind, item_id, qty, unit, unit_price, amount)
  values (c, d, 'item', (select id from public.items where name_en like 'Dead-weight%'), 1, 'pc', 6000, 6000);
  perform public.post_document(d);
  insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, no_document_reason) values (c, 'supplier_payment', '2026-03-12', usd, gulf, 6000, 'Swift copy') returning id into d2;
  insert into public.document_links (company_id, from_document_id, to_document_id, amount) values (c, d2, d, 6000);
  perform public.post_document(d2);
  for m in 4..10 loop perform public.run_depreciation(c, 2026, m); end loop;

  -- USD -> YER for local costs; local fuel; claim and reimbursement; drawings
  insert into public.documents (company_id, kind, doc_date, money_account_id, counter_money_account_id, amount, counter_amount, counter_rate, fee_amount, no_document_reason)
  values (c, 'transfer', '2026-06-01', usd, yer, 2000, 3080000, 1556, 5, 'Exchange receipt') returning id into d;
  perform public.post_document(d);
  insert into public.documents (company_id, kind, doc_date, money_account_id, no_document_reason, description) values (c, 'expense', '2026-06-15', yer, 'Fuel receipts', 'Generator fuel, Aden sites') returning id into d;
  insert into public.document_lines (company_id, document_id, amount, gl_account_id, project_id) values (c, d, 1245000, (select id from public.gl_accounts where company_id = c and code = '5500'), p_un);
  perform public.post_document(d);
  insert into public.documents (company_id, kind, doc_date, party_id) values (c, 'expense_claim', '2026-10-22', emp) returning id into d;
  insert into public.document_lines (company_id, document_id, amount, gl_account_id, project_id, description) values (c, d, 240, (select id from public.gl_accounts where company_id = c and code = '6600'), p_yc, 'Hotel Hodeidah, 2 nights');
  perform public.post_document(d);
  insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount) values (c, 'employee_advance', '2026-10-15', usd, emp, 300) returning id into d;
  update public.documents set no_document_reason = 'Signed receipt' where id = d;
  perform public.post_document(d);
  insert into public.documents (company_id, kind, doc_date, money_account_id, party_id, amount, no_document_reason) values (c, 'owner_drawings', '2026-09-30', usd, owner, 2500, 'Owner withdrawal') returning id into d;
  perform public.post_document(d);
  update public.companies set settings = settings || '{"approval_threshold_usd": 1000}' where id = c;
end $$;
