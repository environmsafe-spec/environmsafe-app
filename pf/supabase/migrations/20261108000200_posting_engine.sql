-- ES-PF v2 · Migration 9: posting engine.
-- post_document / approve_document / reject_document / void_document / duplicate_document /
-- find_duplicates, plus the draft guards. All business rules live here so no client can skip them.

-- True inside posting functions (they set app.posting = on for their own transaction).
create or replace function app.internal() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(current_setting('app.posting', true), '') = 'on'
$$;

create or replace function app.begin_internal() returns void
language sql set search_path = '' as $$ select set_config('app.posting', 'on', true) $$;
create or replace function app.end_internal() returns void
language sql set search_path = '' as $$ select set_config('app.posting', 'off', true) $$;

-- ---------------------------------------------------------------------------
-- Draft guards and defaults
-- ---------------------------------------------------------------------------
create or replace function app.document_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ccy char(3);
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' and not app.internal() then
      raise exception 'Only drafts can be deleted; void document % instead', coalesce(old.number, old.temp_number)
        using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if old.status <> 'draft' and not app.internal() then
      raise exception 'Document % is %; it cannot be edited (void it and make a corrected copy)',
        coalesce(old.number, old.temp_number), old.status using errcode = '42501';
    end if;
    if new.company_id <> old.company_id or new.kind <> old.kind then
      raise exception 'company and kind of a document cannot change';
    end if;
  end if;

  if not app.internal() then
    -- Workflow and posting fields are owned by the posting functions.
    if tg_op = 'INSERT' then
      new.status := 'draft'; new.number := null; new.journal_entry_id := null; new.reversal_entry_id := null;
      new.posted_at := null; new.posted_by := null; new.submitted_at := null; new.submitted_by := null;
      new.voided_at := null; new.voided_by := null; new.void_reason := null;
      new.created_by := auth.uid();
      if new.source = 'migration' or new.migrated then
        raise exception 'Migrated documents are created by the migration job only' using errcode = '42501';
      end if;
    else
      new.status := old.status; new.number := old.number; new.temp_number := old.temp_number;
      new.journal_entry_id := old.journal_entry_id; new.reversal_entry_id := old.reversal_entry_id;
      new.posted_at := old.posted_at; new.posted_by := old.posted_by;
      new.submitted_at := old.submitted_at; new.submitted_by := old.submitted_by;
      new.voided_at := old.voided_at; new.voided_by := old.voided_by; new.void_reason := old.void_reason;
      new.created_by := old.created_by; new.created_at := old.created_at;
      new.source := old.source; new.migrated := old.migrated;
    end if;
  end if;

  -- Currency always follows the money account.
  if new.money_account_id is not null then
    select currency into new.currency from public.money_accounts where id = new.money_account_id;
  end if;
  new.currency := coalesce(new.currency, 'USD');

  if new.rate is null
     or (tg_op = 'UPDATE' and new.currency <> old.currency)
     or (tg_op = 'UPDATE' and new.doc_date <> old.doc_date and new.rate = old.rate) then
    new.rate := app.rate_on(new.company_id, new.currency, new.doc_date);
    if new.rate is null then
      raise exception 'No FX rate for % on or before %; add one in Settings > FX rates', new.currency, new.doc_date;
    end if;
  end if;

  if new.kind = 'transfer' and new.counter_money_account_id is not null then
    select currency into v_ccy from public.money_accounts where id = new.counter_money_account_id;
    if v_ccy = new.currency then
      new.counter_amount := new.amount;
      new.counter_rate := new.rate;
    elsif new.counter_rate is null
          or (tg_op = 'UPDATE' and new.counter_money_account_id is distinct from old.counter_money_account_id) then
      new.counter_rate := app.rate_on(new.company_id, v_ccy, new.doc_date);
    end if;
  end if;

  if new.kind <> 'supplier_payment' then
    new.purpose := null;
  elsif new.purpose is null then
    new.purpose := 'payable';
  end if;

  return new;
end $$;

create trigger a_documents_guard before insert or update or delete on public.documents
  for each row execute function app.document_guard();
create trigger documents_touch before update on public.documents
  for each row execute function app.touch();

-- Lines, links: only while the parent is a draft.
create or replace function app.child_of_draft_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_doc uuid := coalesce(v_row ->> 'from_document_id', v_row ->> 'document_id')::uuid;
  d public.documents;
begin
  select * into d from public.documents where id = v_doc;
  if d.id is null then
    return case when tg_op = 'DELETE' then old else new end;  -- parent being deleted (cascade)
  end if;
  if tg_table_name = 'attachments' then
    if tg_op = 'DELETE' and d.status <> 'draft' and not app.internal() then
      raise exception 'Files attached to a % document cannot be removed', d.status using errcode = '42501';
    end if;
    if tg_op = 'INSERT' and d.status = 'void' then
      raise exception 'Cannot attach files to a void document' using errcode = '42501';
    end if;
  elsif d.status <> 'draft' and not app.internal() then
    raise exception 'Document % is %; its lines cannot change', coalesce(d.number, d.temp_number), d.status
      using errcode = '42501';
  end if;
  if tg_op <> 'DELETE' then
    new.company_id := d.company_id;
    if tg_table_name = 'document_lines' and d.kind <> 'manual_journal' then
      new.side := 'D';
    end if;
    return new;
  end if;
  return old;
end $$;

create trigger a_document_lines_guard before insert or update or delete on public.document_lines
  for each row execute function app.child_of_draft_guard();
create trigger a_document_links_guard before insert or update or delete on public.document_links
  for each row execute function app.child_of_draft_guard();
create trigger a_attachments_guard before insert or update or delete on public.attachments
  for each row execute function app.child_of_draft_guard();

create or replace function app.attachments_no_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Attachments cannot be modified' using errcode = '42501';
end $$;
create trigger attachments_no_update before update on public.attachments
  for each row execute function app.attachments_no_update();

-- Header amount = total of the lines for kinds that have lines (debits for manual journals).
create or replace function app.sync_document_amount() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_doc uuid := coalesce(new.document_id, old.document_id);
begin
  if exists (select 1 from public.documents d join public.doc_kinds k on k.kind = d.kind
             where d.id = v_doc and k.has_lines and d.status = 'draft') then
    update public.documents
       set amount = coalesce((select sum(amount) from public.document_lines where document_id = v_doc and side = 'D'), 0)
     where id = v_doc;
  end if;
  return null;
end $$;
create trigger z_document_lines_amount after insert or update or delete on public.document_lines
  for each row execute function app.sync_document_amount();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function app.acct(p_company uuid, p_code text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid;
begin
  select id into v from public.gl_accounts where company_id = p_company and code = p_code;
  if v is null then raise exception 'System account % is missing', p_code; end if;
  return v;
end $$;

create or replace function app.fn(p_amount numeric, p_rate numeric) returns numeric
language sql immutable set search_path = '' as $$ select round(p_amount / p_rate, 2) $$;

-- Append one journal line. side 'D' or 'C'; p_func = functional (USD) amount.
create or replace function app.jl(
  p_entry uuid, p_company uuid, p_account uuid, p_side char, p_func numeric,
  p_ccy char(3), p_txn numeric, p_rate numeric,
  p_project uuid default null, p_party uuid default null, p_item uuid default null,
  p_line uuid default null, p_desc text default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_func = 0 and p_txn = 0 then return; end if;
  if p_func < 0 then  -- a negative amount on one side is a positive amount on the other
    p_func := -p_func; p_txn := abs(p_txn);
    p_side := case p_side when 'D' then 'C' else 'D' end;
  end if;
  insert into public.journal_lines
    (company_id, entry_id, line_no, account_id, debit, credit, txn_currency, txn_amount, rate,
     project_id, party_id, item_id, document_line_id, description)
  values
    (p_company, p_entry,
     (select coalesce(max(line_no), 0) + 1 from public.journal_lines where entry_id = p_entry),
     p_account,
     case when p_side = 'D' then p_func else 0 end,
     case when p_side = 'C' then p_func else 0 end,
     p_ccy, abs(p_txn), p_rate, p_project, p_party, p_item, p_line, p_desc);
end $$;

-- Open amount of a posted document (in its own currency), counting only posted settlements.
create or replace function app.open_amount(p_doc uuid, p_exclude uuid default null) returns numeric
language sql stable security definer set search_path = '' as $$
  select d.amount - coalesce((
    select sum(l.amount) from public.document_links l
    join public.documents s on s.id = l.from_document_id
    where l.to_document_id = d.id and s.status in ('posted', 'submitted')
      and (p_exclude is null or s.id <> p_exclude)), 0)
  from public.documents d where d.id = p_doc
$$;

-- Control account of a settle-able document (what a settlement debits or credits).
create or replace function app.control_account(p_doc public.documents) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_owner boolean;
  v_drawings boolean;
begin
  select is_owner, treat_withdrawals_as_drawings into v_owner, v_drawings
  from public.parties where id = p_doc.party_id;
  return case p_doc.kind
    when 'expense_claim'    then app.acct(p_doc.company_id, case when v_owner then '2200' else '2100' end)
    when 'employee_advance' then app.acct(p_doc.company_id, '1200')
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Validation (raises a clear message for the first problem found)
-- ---------------------------------------------------------------------------
create or replace function app.validate_document(d public.documents) returns void
language plpgsql security definer set search_path = '' as $$
declare
  k public.doc_kinds;
  p public.parties;
  ma public.money_accounts;
  v_lines int;
  v_dr numeric; v_cr numeric;
  l record;
  v_settled public.documents;
begin
  select * into k from public.doc_kinds where kind = d.kind;
  select * into p from public.parties where id = d.party_id;
  select * into ma from public.money_accounts where id = d.money_account_id;

  if k.money_account = 'required' and d.money_account_id is null then
    raise exception 'Choose the bank / cash account';
  end if;
  if k.money_account = 'none' and d.money_account_id is not null then
    raise exception '% does not use a bank / cash account', k.name_en;
  end if;
  if ma.id is not null and not ma.is_active then
    raise exception 'Bank / cash account % is inactive', ma.name_en;
  end if;
  if k.party_required and d.party_id is null then
    raise exception 'Choose the % for this %', coalesce(k.party_role, 'party'), k.name_en;
  end if;
  if p.id is not null then
    if (k.party_role = 'supplier' and not p.is_supplier)
       or (k.party_role = 'customer' and not p.is_customer)
       or (k.party_role = 'employee' and not p.is_employee)
       or (k.party_role = 'owner' and not p.is_owner)
       or (k.party_role = 'employee_or_owner' and not (p.is_employee or p.is_owner)) then
      raise exception '% must be a % for a %', p.name_en, replace(k.party_role, '_', ' '), k.name_en;
    end if;
  end if;
  if not k.allows_fee and d.fee_amount > 0 then
    raise exception '% cannot carry a bank fee', k.name_en;
  end if;
  if d.kind = 'salary' and d.money_account_id is null and d.fee_amount > 0 then
    raise exception 'An unpaid salary cannot carry a bank fee';
  end if;
  if k.direction = 'in' and d.fee_amount >= d.amount then
    raise exception 'The fee must be smaller than the amount received';
  end if;

  if k.has_lines then
    select count(*), coalesce(sum(amount) filter (where side = 'D'), 0), coalesce(sum(amount) filter (where side = 'C'), 0)
      into v_lines, v_dr, v_cr
    from public.document_lines where document_id = d.id;
    if v_lines = 0 then
      raise exception 'Add at least one line';
    end if;
    if d.kind = 'manual_journal' and v_dr <> v_cr then
      raise exception 'Journal is not balanced: debits % vs credits %', v_dr, v_cr;
    end if;
    for l in
      select dl.*, coalesce(dl.gl_account_id, i.default_expense_account_id,
                            case when d.kind = 'salary' then app.acct(d.company_id, '6100') end) as acc
      from public.document_lines dl left join public.items i on i.id = dl.item_id
      where dl.document_id = d.id
    loop
      if l.acc is null then
        raise exception 'Line %: choose the account (what was it for?)', l.line_no;
      end if;
    end loop;
  elsif d.amount <= 0 and d.kind <> 'employee_offset' then  -- an offset's amount comes from its links
    raise exception 'Enter the amount';
  end if;

  if d.kind = 'transfer' then
    if d.counter_money_account_id is null then
      raise exception 'Choose the account the money goes to';
    end if;
    if d.counter_amount is null or d.counter_rate is null then
      raise exception 'Enter the amount received in the destination account';
    end if;
  end if;

  -- Settlement links
  if exists (select 1 from public.document_links where from_document_id = d.id) and cardinality(k.settles) = 0 then
    raise exception '% cannot settle other documents', k.name_en;
  end if;
  for l in select * from public.document_links where from_document_id = d.id loop
    select * into v_settled from public.documents where id = l.to_document_id;
    if v_settled.status <> 'posted' then
      raise exception 'Document % is not posted and cannot be settled', coalesce(v_settled.number, v_settled.temp_number);
    end if;
    if not v_settled.kind = any (k.settles) then
      raise exception '% cannot settle a %', k.name_en, v_settled.kind;
    end if;
    if v_settled.party_id is distinct from d.party_id then
      raise exception 'Document % belongs to another party', v_settled.number;
    end if;
    if v_settled.currency <> d.currency then
      raise exception 'Document % is in %; settle it from a % account', v_settled.number, v_settled.currency, v_settled.currency;
    end if;
    if l.amount > app.open_amount(v_settled.id, d.id) then
      raise exception 'Document % has only % % open', v_settled.number, app.open_amount(v_settled.id, d.id), v_settled.currency;
    end if;
  end loop;

  if d.kind in ('claim_reimbursement', 'advance_repayment')
     and coalesce((select sum(amount) from public.document_links where from_document_id = d.id), 0) > d.amount then
    raise exception 'The documents settled add up to more than the amount';
  end if;
  if d.kind = 'employee_offset' then
    select coalesce(sum(l2.amount) filter (where s.kind = 'expense_claim'), 0),
           coalesce(sum(l2.amount) filter (where s.kind = 'employee_advance'), 0)
      into v_dr, v_cr
    from public.document_links l2 join public.documents s on s.id = l2.to_document_id
    where l2.from_document_id = d.id;
    if v_dr = 0 or v_dr <> v_cr then
      raise exception 'Offset: claims settled (%) must equal advances settled (%)', v_dr, v_cr;
    end if;
    update public.documents set amount = v_dr where id = d.id and amount <> v_dr;
  end if;

  -- Evidence: every cash movement needs a file or a stated reason.
  if d.money_account_id is not null
     and not exists (select 1 from public.attachments where document_id = d.id)
     and coalesce(trim(d.no_document_reason), '') = '' then
    raise exception 'Attach the voucher / receipt, or say why there is no document';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Journal builder: one branch per kind
-- ---------------------------------------------------------------------------
create or replace function app.build_journal(d public.documents, p_entry uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c        uuid := d.company_id;
  r        numeric := d.rate;
  v_bank   uuid;
  v_dest   uuid;
  v_dest_ccy char(3);
  v_fee    uuid := app.acct(d.company_id, '6900');
  v_fx     uuid := app.acct(d.company_id, '7000');
  v_ctrl   uuid;
  v_sum    numeric := 0;
  v_dr     numeric;
  v_cr     numeric;
  v_left   numeric;
  l        record;
  p        public.parties;
  s        public.documents;
begin
  select gl_account_id into v_bank from public.money_accounts where id = d.money_account_id;
  select * into p from public.parties where id = d.party_id;

  if d.kind in ('expense', 'salary', 'expense_claim') then
    for l in
      select dl.*, coalesce(dl.gl_account_id, i.default_expense_account_id,
                            case when d.kind = 'salary' then app.acct(c, '6100') end) as acc
      from public.document_lines dl left join public.items i on i.id = dl.item_id
      where dl.document_id = d.id order by dl.line_no
    loop
      perform app.jl(p_entry, c, l.acc, 'D', app.fn(l.amount, r), d.currency, l.amount, r,
                     l.project_id, coalesce(l.party_id, d.party_id), l.item_id, l.id, coalesce(l.description, d.description));
      v_sum := v_sum + app.fn(l.amount, r);
    end loop;
    if d.fee_amount > 0 then
      perform app.jl(p_entry, c, v_fee, 'D', app.fn(d.fee_amount, r), d.currency, d.fee_amount, r, null, null, null, null, 'Bank / remittance fee');
      v_sum := v_sum + app.fn(d.fee_amount, r);
    end if;
    if d.kind = 'expense_claim' then
      v_ctrl := app.control_account(d);
      perform app.jl(p_entry, c, v_ctrl, 'C', v_sum, d.currency, d.amount, r, null, d.party_id, null, null, d.description);
    elsif d.kind = 'salary' and d.money_account_id is null then
      perform app.jl(p_entry, c, app.acct(c, '2100'), 'C', v_sum, d.currency, d.amount, r, null, d.party_id, null, null, 'Salary payable');
    else
      perform app.jl(p_entry, c, v_bank, 'C', v_sum, d.currency, d.amount + d.fee_amount, r, null, d.party_id, null, null, d.description);
    end if;

  elsif d.kind in ('supplier_payment', 'refund_to_customer', 'owner_drawings', 'employee_advance') then
    v_ctrl := case d.kind
      when 'supplier_payment'   then app.acct(c, case when d.purpose = 'deposit' then '1260' else '2000' end)
      when 'refund_to_customer' then app.acct(c, '1100')
      when 'owner_drawings'     then app.acct(c, '3200')
      when 'employee_advance'   then app.acct(c, case when p.treat_withdrawals_as_drawings then '3200' else '1200' end)
    end;
    perform app.jl(p_entry, c, v_ctrl, 'D', app.fn(d.amount, r), d.currency, d.amount, r, null, d.party_id, null, null, d.description);
    if d.fee_amount > 0 then
      perform app.jl(p_entry, c, v_fee, 'D', app.fn(d.fee_amount, r), d.currency, d.fee_amount, r, null, null, null, null, 'Bank / remittance fee');
    end if;
    perform app.jl(p_entry, c, v_bank, 'C', app.fn(d.amount, r) + app.fn(d.fee_amount, r), d.currency, d.amount + d.fee_amount, r,
                   null, d.party_id, null, null, d.description);

  elsif d.kind in ('customer_receipt', 'refund_from_supplier') then
    v_ctrl := app.acct(c, case d.kind when 'customer_receipt' then '1100' else '2000' end);
    perform app.jl(p_entry, c, v_bank, 'D', app.fn(d.amount, r) - app.fn(d.fee_amount, r), d.currency, d.amount - d.fee_amount, r,
                   null, d.party_id, null, null, d.description);
    if d.fee_amount > 0 then
      perform app.jl(p_entry, c, v_fee, 'D', app.fn(d.fee_amount, r), d.currency, d.fee_amount, r, null, null, null, null, 'Bank / remittance fee');
    end if;
    perform app.jl(p_entry, c, v_ctrl, 'C', app.fn(d.amount, r), d.currency, d.amount, r, null, d.party_id, null, null, d.description);

  elsif d.kind in ('claim_reimbursement', 'advance_repayment') then
    -- Settled documents are relieved at their own rate; the difference is realised FX.
    v_dr := 0; v_cr := 0;
    for l in select lk.*, sd.rate as s_rate, sd.id as sid from public.document_links lk
             join public.documents sd on sd.id = lk.to_document_id where lk.from_document_id = d.id
             order by sd.kind, sd.doc_date, sd.id loop
      select * into s from public.documents where id = l.sid;
      v_ctrl := app.control_account(s);
      perform app.jl(p_entry, c, v_ctrl, case d.kind when 'claim_reimbursement' then 'D' else 'C' end,
                     app.fn(l.amount, l.s_rate), d.currency, l.amount, l.s_rate, null, d.party_id, null, null,
                     'Settles ' || s.number);
      if d.kind = 'claim_reimbursement' then v_dr := v_dr + app.fn(l.amount, l.s_rate);
      else v_cr := v_cr + app.fn(l.amount, l.s_rate); end if;
      v_sum := v_sum + l.amount;
    end loop;
    v_left := d.amount - v_sum;
    if v_left > 0 then  -- not linked to a specific document: on account
      v_ctrl := app.acct(c, case when d.kind = 'advance_repayment' then '1200' when p.is_owner then '2200' else '2100' end);
      perform app.jl(p_entry, c, v_ctrl, case d.kind when 'claim_reimbursement' then 'D' else 'C' end,
                     app.fn(v_left, r), d.currency, v_left, r, null, d.party_id, null, null, 'On account');
      if d.kind = 'claim_reimbursement' then v_dr := v_dr + app.fn(v_left, r); else v_cr := v_cr + app.fn(v_left, r); end if;
    end if;
    if d.fee_amount > 0 then
      perform app.jl(p_entry, c, v_fee, 'D', app.fn(d.fee_amount, r), d.currency, d.fee_amount, r, null, null, null, null, 'Bank / remittance fee');
      v_dr := v_dr + app.fn(d.fee_amount, r);
    end if;
    if d.kind = 'claim_reimbursement' then
      perform app.jl(p_entry, c, v_bank, 'C', app.fn(d.amount, r) + app.fn(d.fee_amount, r), d.currency, d.amount + d.fee_amount, r,
                     null, d.party_id, null, null, d.description);
      v_cr := v_cr + app.fn(d.amount, r) + app.fn(d.fee_amount, r);
    else
      perform app.jl(p_entry, c, v_bank, 'D', app.fn(d.amount, r) - app.fn(d.fee_amount, r), d.currency, d.amount - d.fee_amount, r,
                     null, d.party_id, null, null, d.description);
      v_dr := v_dr + app.fn(d.amount, r) - app.fn(d.fee_amount, r);
    end if;
    -- Balance with realised FX gain (credit) or loss (debit).
    perform app.jl(p_entry, c, v_fx, 'D', v_cr - v_dr, d.currency, 0, r, null, null, null, null, 'Realised FX difference');

  elsif d.kind = 'employee_offset' then
    v_dr := 0; v_cr := 0;
    for l in select lk.*, sd.rate as s_rate, sd.id as sid from public.document_links lk
             join public.documents sd on sd.id = lk.to_document_id where lk.from_document_id = d.id
             order by sd.kind, sd.doc_date, sd.id loop
      select * into s from public.documents where id = l.sid;
      if s.kind = 'expense_claim' then
        perform app.jl(p_entry, c, app.control_account(s), 'D', app.fn(l.amount, l.s_rate), d.currency, l.amount, l.s_rate,
                       null, d.party_id, null, null, 'Claim ' || s.number);
        v_dr := v_dr + app.fn(l.amount, l.s_rate);
      else
        perform app.jl(p_entry, c, app.control_account(s), 'C', app.fn(l.amount, l.s_rate), d.currency, l.amount, l.s_rate,
                       null, d.party_id, null, null, 'Advance ' || s.number);
        v_cr := v_cr + app.fn(l.amount, l.s_rate);
      end if;
    end loop;
    perform app.jl(p_entry, c, v_fx, 'D', v_cr - v_dr, d.currency, 0, r, null, null, null, null, 'Realised FX difference');

  elsif d.kind = 'transfer' then
    select gl_account_id, currency into v_dest, v_dest_ccy from public.money_accounts where id = d.counter_money_account_id;
    perform app.jl(p_entry, c, v_dest, 'D', app.fn(d.counter_amount, d.counter_rate), v_dest_ccy, d.counter_amount, d.counter_rate,
                   null, null, null, null, d.description);
    if d.fee_amount > 0 then
      perform app.jl(p_entry, c, v_fee, 'D', app.fn(d.fee_amount, r), d.currency, d.fee_amount, r, null, null, null, null, 'Transfer fee');
    end if;
    perform app.jl(p_entry, c, v_bank, 'C', app.fn(d.amount, r) + app.fn(d.fee_amount, r), d.currency, d.amount + d.fee_amount, r,
                   null, null, null, null, d.description);
    perform app.jl(p_entry, c, v_fx, 'D',
                   (app.fn(d.amount, r) + app.fn(d.fee_amount, r)) - (app.fn(d.counter_amount, d.counter_rate) + app.fn(d.fee_amount, r)),
                   d.currency, 0, r, null, null, null, null, 'FX difference on transfer');

  elsif d.kind = 'manual_journal' then
    v_dr := 0; v_cr := 0;
    for l in select * from public.document_lines where document_id = d.id order by line_no loop
      perform app.jl(p_entry, c, l.gl_account_id, l.side, app.fn(l.amount, r), d.currency, l.amount, r,
                     l.project_id, l.party_id, l.item_id, l.id, coalesce(l.description, d.description));
      if l.side = 'D' then v_dr := v_dr + app.fn(l.amount, r); else v_cr := v_cr + app.fn(l.amount, r); end if;
    end loop;
    if v_dr <> v_cr then  -- cents lost to conversion rounding
      perform app.jl(p_entry, c, v_fx, 'D', v_cr - v_dr, d.currency, 0, r, null, null, null, null, 'Conversion rounding');
    end if;
  else
    raise exception 'No posting rule for %', d.kind;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Public workflow functions
-- ---------------------------------------------------------------------------
create or replace function public.post_document(p_id uuid) returns public.documents
language plpgsql security definer set search_path = '' as $$
declare
  d        public.documents;
  k        public.doc_kinds;
  v_period uuid;
  v_entry  uuid;
  v_type   text;
  v_limit  numeric;
begin
  select * into d from public.documents where id = p_id for update;
  if d.id is null or not app.has_perm(d.company_id, 'docs.view') then
    raise exception 'Document not found';
  end if;
  select * into k from public.doc_kinds where kind = d.kind;
  perform app.require_perm(d.company_id, k.post_permission);
  if d.status not in ('draft', 'submitted') then
    raise exception 'Document % is already %', coalesce(d.number, d.temp_number), d.status;
  end if;

  perform app.begin_internal();
  perform app.validate_document(d);
  select * into d from public.documents where id = p_id;   -- validation may normalise the amount

  -- Approval threshold (company setting, USD).
  v_limit := nullif(
    (select settings ->> 'approval_threshold_usd' from public.companies where id = d.company_id), '')::numeric;
  if k.approval_applies and v_limit is not null
     and app.fn(d.amount + d.fee_amount, d.rate) > v_limit
     and not exists (select 1 from public.approvals a where a.document_id = d.id and a.decision = 'approved'
                     and a.decided_at >= coalesce(d.submitted_at, d.created_at)) then
    if d.status = 'draft' then
      update public.documents set status = 'submitted', submitted_at = now(), submitted_by = auth.uid()
       where id = d.id returning * into d;
      perform app.log_event(d.company_id, 'documents', d.id::text,
        format('Submitted for approval (over USD %s)', v_limit));
    end if;
    perform app.end_internal();
    return d;
  end if;

  v_period := app.assert_period_open(d.company_id, d.doc_date);
  v_type := case when d.kind = 'salary' and d.money_account_id is null then 'journal' else k.number_type end;

  insert into public.journal_entries (company_id, document_id, entry_date, period_id, kind, memo)
  values (d.company_id, d.id, d.doc_date, v_period, 'posting', d.description)
  returning id into v_entry;

  perform app.build_journal(d, v_entry);

  update public.documents
     set status = 'posted',
         number = app.next_document_number(d.company_id, v_type, d.doc_date),
         journal_entry_id = v_entry,
         posted_at = now(), posted_by = auth.uid()
   where id = d.id
  returning * into d;

  perform app.log_event(d.company_id, 'documents', d.id::text, 'Posted ' || d.number);
  perform app.end_internal();
  return d;
end $$;

create or replace function public.approve_document(p_id uuid, p_note text default null) returns public.documents
language plpgsql security definer set search_path = '' as $$
declare
  d public.documents;
begin
  select * into d from public.documents where id = p_id for update;
  if d.id is null then raise exception 'Document not found'; end if;
  perform app.require_perm(d.company_id, 'docs.approve');
  if d.status <> 'submitted' then
    raise exception 'Only documents waiting for approval can be approved';
  end if;
  insert into public.approvals (company_id, document_id, decision, note)
  values (d.company_id, d.id, 'approved', p_note);
  return public.post_document(p_id);
end $$;

create or replace function public.reject_document(p_id uuid, p_note text) returns public.documents
language plpgsql security definer set search_path = '' as $$
declare
  d public.documents;
begin
  select * into d from public.documents where id = p_id for update;
  if d.id is null then raise exception 'Document not found'; end if;
  perform app.require_perm(d.company_id, 'docs.approve');
  if d.status <> 'submitted' then
    raise exception 'Only documents waiting for approval can be rejected';
  end if;
  insert into public.approvals (company_id, document_id, decision, note)
  values (d.company_id, d.id, 'rejected', p_note);
  perform app.begin_internal();
  update public.documents set status = 'draft', submitted_at = null, submitted_by = null
   where id = p_id returning * into d;
  perform app.end_internal();
  perform app.log_event(d.company_id, 'documents', d.id::text, 'Rejected: ' || coalesce(p_note, ''));
  return d;
end $$;

-- Void: a draft simply becomes void; a posted document gets an automatic reversal entry.
create or replace function public.void_document(p_id uuid, p_reason text, p_reversal_date date default null)
returns public.documents
language plpgsql security definer set search_path = '' as $$
declare
  d        public.documents;
  v_date   date;
  v_period uuid;
  v_entry  uuid;
  v_dep    text;
begin
  select * into d from public.documents where id = p_id for update;
  if d.id is null or not app.has_perm(d.company_id, 'docs.view') then
    raise exception 'Document not found';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then
    raise exception 'Give a reason for voiding';
  end if;
  if d.status = 'void' then
    raise exception 'Document is already void';
  end if;

  if d.status in ('draft', 'submitted') then
    if not (app.has_perm(d.company_id, 'docs.reverse') or (app.has_perm(d.company_id, 'docs.create') and d.created_by = auth.uid())) then
      raise exception 'Permission denied: only the creator or an accountant can void this draft' using errcode = '42501';
    end if;
    perform app.begin_internal();
    update public.documents set status = 'void', void_reason = p_reason, voided_at = now(), voided_by = auth.uid()
     where id = p_id returning * into d;
    perform app.end_internal();
    return d;
  end if;

  perform app.require_perm(d.company_id, 'docs.reverse');
  select string_agg(coalesce(s.number, s.temp_number), ', ') into v_dep
  from public.document_links l join public.documents s on s.id = l.from_document_id
  where l.to_document_id = d.id and s.status in ('posted', 'submitted');
  if v_dep is not null then
    raise exception 'Void the documents that settle this one first: %', v_dep;
  end if;

  v_date := coalesce(p_reversal_date,
    case when exists (select 1 from public.fiscal_periods
                      where company_id = d.company_id and year = extract(year from d.doc_date)
                        and month = extract(month from d.doc_date) and status = 'open')
         then d.doc_date else current_date end);
  if v_date < d.doc_date then
    raise exception 'The reversal date cannot be before the document date';
  end if;
  v_period := app.assert_period_open(d.company_id, v_date);

  perform app.begin_internal();
  insert into public.journal_entries (company_id, document_id, entry_date, period_id, kind, memo)
  values (d.company_id, d.id, v_date, v_period, 'reversal', 'Reversal of ' || d.number || ': ' || p_reason)
  returning id into v_entry;

  insert into public.journal_lines
    (company_id, entry_id, line_no, account_id, debit, credit, txn_currency, txn_amount, rate,
     project_id, party_id, item_id, document_line_id, description)
  select company_id, v_entry, line_no, account_id, credit, debit, txn_currency, txn_amount, rate,
         project_id, party_id, item_id, document_line_id, 'Reversal: ' || coalesce(description, '')
  from public.journal_lines where entry_id = d.journal_entry_id;

  update public.documents
     set status = 'void', void_reason = p_reason, voided_at = now(), voided_by = auth.uid(), reversal_entry_id = v_entry
   where id = p_id returning * into d;
  perform app.end_internal();
  perform app.log_event(d.company_id, 'documents', d.id::text, 'Voided ' || d.number || ': ' || p_reason);
  return d;
end $$;

-- Make an editable draft copy (used to correct a voided document, or to repeat one).
create or replace function public.duplicate_document(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  d public.documents;
  v_new uuid;
begin
  select * into d from public.documents where id = p_id;
  if d.id is null or not app.has_perm(d.company_id, 'docs.view') then
    raise exception 'Document not found';
  end if;
  perform app.require_perm(d.company_id, 'docs.create');
  insert into public.documents
    (company_id, kind, doc_date, party_id, money_account_id, counter_money_account_id, currency, rate,
     amount, counter_amount, counter_rate, fee_amount, purpose, reference_no, description, notes, copied_from_id)
  values
    (d.company_id, d.kind, current_date, d.party_id, d.money_account_id, d.counter_money_account_id, d.currency, null,
     case when (select has_lines from public.doc_kinds where kind = d.kind) then 0 else d.amount end,
     d.counter_amount, null, d.fee_amount, d.purpose, d.reference_no, d.description, d.notes, d.id)
  returning id into v_new;
  insert into public.document_lines
    (company_id, document_id, line_no, item_id, description, qty, unit, unit_price, amount, side, gl_account_id, project_id, party_id, is_asset)
  select company_id, v_new, line_no, item_id, description, qty, unit, unit_price, amount, side, gl_account_id, project_id, party_id, is_asset
  from public.document_lines where document_id = p_id;
  return v_new;
end $$;

-- Possible duplicates: same party + amount + date, or same reference on the same account.
create or replace function public.find_duplicates(p_id uuid)
returns table (id uuid, number text, kind public.doc_kind, doc_date date, amount numeric, currency char(3), reason text)
language sql stable security definer set search_path = '' as $$
  select o.id, coalesce(o.number, o.temp_number), o.kind, o.doc_date, o.amount, o.currency,
         case when o.reference_no is not null and o.reference_no = d.reference_no
                   and o.money_account_id is not distinct from d.money_account_id then 'same reference'
              else 'same party, amount and date' end
  from public.documents d
  join public.documents o on o.company_id = d.company_id and o.id <> d.id and o.status <> 'void'
  where d.id = p_id
    and app.has_perm(d.company_id, 'docs.view')
    and ( (o.party_id = d.party_id and o.amount = d.amount and o.doc_date = d.doc_date and d.amount > 0)
       or (d.reference_no is not null and trim(d.reference_no) <> '' and o.reference_no = d.reference_no
           and o.money_account_id is not distinct from d.money_account_id) )
$$;
