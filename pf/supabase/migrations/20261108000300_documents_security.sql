-- ES-PF v2 · Migration 10: security, storage and read models for documents and the journal.

alter table public.doc_kinds       enable row level security;
alter table public.documents       enable row level security;
alter table public.document_lines  enable row level security;
alter table public.document_links  enable row level security;
alter table public.attachments     enable row level security;
alter table public.approvals       enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines   enable row level security;

revoke all on public.doc_kinds, public.documents, public.document_lines, public.document_links,
              public.attachments, public.approvals, public.journal_entries, public.journal_lines
  from anon, authenticated;

-- May the current user edit this draft? Data entry edits only their own drafts;
-- people who can post may edit anyone's draft.
create or replace function app.can_edit_doc(p_doc uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.documents d
    where d.id = p_doc and d.status = 'draft'
      and app.has_perm(d.company_id, 'docs.create')
      and (d.created_by = auth.uid()
           or app.has_perm(d.company_id, 'docs.post_money')
           or app.has_perm(d.company_id, 'docs.post')
           or app.has_perm(d.company_id, 'journal.manual'))
  )
$$;

create or replace function app.can_view_doc(p_doc uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.documents d where d.id = p_doc and app.has_perm(d.company_id, 'docs.view'))
$$;

grant select on public.doc_kinds to authenticated;
create policy read_all on public.doc_kinds for select to authenticated using (true);

grant select, insert, update, delete on public.documents to authenticated;
create policy view on public.documents for select to authenticated
  using ((select app.has_perm(company_id, 'docs.view')));
create policy create_draft on public.documents for insert to authenticated
  with check ((select app.has_perm(company_id, 'docs.create'))
              and (kind <> 'manual_journal' or (select app.has_perm(company_id, 'journal.manual'))));
create policy edit_draft on public.documents for update to authenticated
  using ((select app.can_edit_doc(id))) with check ((select app.has_perm(company_id, 'docs.create')));
create policy delete_draft on public.documents for delete to authenticated
  using ((select app.can_edit_doc(id)));

grant select, insert, update, delete on public.document_lines to authenticated;
create policy view on public.document_lines for select to authenticated
  using ((select app.has_perm(company_id, 'docs.view')));
create policy edit on public.document_lines for insert to authenticated
  with check ((select app.can_edit_doc(document_id)));
create policy edit_update on public.document_lines for update to authenticated
  using ((select app.can_edit_doc(document_id))) with check ((select app.can_edit_doc(document_id)));
create policy edit_delete on public.document_lines for delete to authenticated
  using ((select app.can_edit_doc(document_id)));

grant select, insert, update, delete on public.document_links to authenticated;
create policy view on public.document_links for select to authenticated
  using ((select app.has_perm(company_id, 'docs.view')));
create policy edit on public.document_links for insert to authenticated
  with check ((select app.can_edit_doc(from_document_id)) and (select app.can_view_doc(to_document_id)));
create policy edit_update on public.document_links for update to authenticated
  using ((select app.can_edit_doc(from_document_id))) with check ((select app.can_edit_doc(from_document_id)));
create policy edit_delete on public.document_links for delete to authenticated
  using ((select app.can_edit_doc(from_document_id)));

-- Files can be added to any non-void document by people who create documents
-- (e.g. a late receipt for a posted payment); they can only be removed from drafts.
grant select, insert, delete on public.attachments to authenticated;
create policy view on public.attachments for select to authenticated
  using ((select app.has_perm(company_id, 'docs.view')));
create policy add on public.attachments for insert to authenticated
  with check ((select app.has_perm(company_id, 'docs.create')) and (select app.can_view_doc(document_id))
              and storage_path like company_id::text || '/%');
create policy remove on public.attachments for delete to authenticated
  using ((select app.can_edit_doc(document_id)));

grant select on public.approvals, public.journal_entries, public.journal_lines to authenticated;
create policy view on public.approvals for select to authenticated
  using ((select app.has_perm(company_id, 'docs.view')));
create policy view on public.journal_entries for select to authenticated
  using ((select app.has_perm(company_id, 'docs.view')) or (select app.has_perm(company_id, 'reports.financial')));
create policy view on public.journal_lines for select to authenticated
  using ((select app.has_perm(company_id, 'docs.view')) or (select app.has_perm(company_id, 'reports.financial')));

create trigger audit_documents      after insert or update or delete on public.documents      for each row execute function app.audit_row();
create trigger audit_document_lines after insert or update or delete on public.document_lines for each row execute function app.audit_row();
create trigger audit_document_links after insert or update or delete on public.document_links for each row execute function app.audit_row();
create trigger audit_attachments    after insert or update or delete on public.attachments    for each row execute function app.audit_row();
create trigger audit_approvals      after insert or update or delete on public.approvals      for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------
-- File storage (Supabase only): private bucket, path = <company_id>/<document_id>/<file>
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage')
     and exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('documents', 'documents', false, 20971520)
    on conflict (id) do nothing;

    execute $p$create policy espf_documents_read on storage.objects for select to authenticated
      using (bucket_id = 'documents' and app.has_perm(((storage.foldername(name))[1])::uuid, 'docs.view'))$p$;
    execute $p$create policy espf_documents_upload on storage.objects for insert to authenticated
      with check (bucket_id = 'documents' and app.has_perm(((storage.foldername(name))[1])::uuid, 'docs.create'))$p$;
    -- No update / delete policy: files are never overwritten or removed through the API.
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Read models (security_invoker: the caller's RLS applies)
-- ---------------------------------------------------------------------------
create view public.v_money_account_balances with (security_invoker = true) as
select ma.id, ma.company_id, ma.code, ma.name_en, ma.name_ar, ma.kind, ma.currency, ma.is_active,
       coalesce(sum(case when jl.debit > 0 then jl.txn_amount else -jl.txn_amount end), 0)::numeric(18, 2) as balance,
       coalesce(sum(jl.debit - jl.credit), 0)::numeric(18, 2) as balance_usd,
       max(je.entry_date) as last_movement
from public.money_accounts ma
left join public.journal_lines jl on jl.account_id = ma.gl_account_id
left join public.journal_entries je on je.id = jl.entry_id
group by ma.id;

create view public.v_document_balances with (security_invoker = true) as
select d.id, d.company_id, d.kind, d.party_id, d.currency, d.amount,
       coalesce(sum(l.amount) filter (where s.status in ('posted', 'submitted')), 0)::numeric(18, 2) as settled,
       (d.amount - coalesce(sum(l.amount) filter (where s.status in ('posted', 'submitted')), 0))::numeric(18, 2) as open_amount
from public.documents d
left join public.document_links l on l.to_document_id = d.id
left join public.documents s on s.id = l.from_document_id
where d.status = 'posted'
group by d.id;

-- Drafts inbox with what is still missing.
create view public.v_drafts with (security_invoker = true) as
select d.id, d.company_id, d.kind, d.status, d.temp_number, d.doc_date, d.party_id, d.money_account_id,
       d.amount, d.currency, d.description, d.created_by, d.created_at,
       (d.money_account_id is not null
        and not exists (select 1 from public.attachments a where a.document_id = d.id)
        and coalesce(trim(d.no_document_reason), '') = '') as missing_attachment,
       exists (select 1 from public.document_lines dl join public.gl_accounts g on g.id = dl.gl_account_id
               where dl.document_id = d.id and g.requires_project and dl.project_id is null) as missing_project,
       exists (select 1 from public.document_lines dl where dl.document_id = d.id and dl.gl_account_id is null and dl.item_id is null) as missing_account,
       (d.amount = 0) as missing_amount
from public.documents d
where d.status in ('draft', 'submitted');

grant select on public.v_money_account_balances, public.v_document_balances, public.v_drafts to authenticated;

-- Trial balance for a date range, in USD. Opening = everything before p_from.
create or replace function public.trial_balance(p_company uuid, p_from date, p_to date)
returns table (account_id uuid, code text, name_en text, name_ar text, account_type public.account_type,
               opening numeric, debit numeric, credit numeric, closing numeric)
language sql stable security invoker set search_path = '' as $$
  select g.id, g.code, g.name_en, g.name_ar, g.account_type,
         coalesce(sum(jl.debit - jl.credit) filter (where je.entry_date < p_from), 0),
         coalesce(sum(jl.debit)  filter (where je.entry_date between p_from and p_to), 0),
         coalesce(sum(jl.credit) filter (where je.entry_date between p_from and p_to), 0),
         coalesce(sum(jl.debit - jl.credit) filter (where je.entry_date <= p_to), 0)
  from public.gl_accounts g
  join public.journal_lines jl on jl.account_id = g.id
  join public.journal_entries je on je.id = jl.entry_id
  where g.company_id = p_company and je.entry_date <= p_to
  group by g.id
  order by g.code
$$;

-- Permission hardening for everything added in migrations 8–10.
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon, authenticated;
grant execute on function app.is_service(), app.aal(), app.has_perm(uuid, text), app.is_member(uuid),
                          app.shares_company(uuid), app.require_perm(uuid, text),
                          app.can_write_party(uuid, boolean, boolean, boolean, boolean, boolean),
                          app.can_edit_doc(uuid), app.can_view_doc(uuid)
  to authenticated, service_role;
grant execute on function public.post_document(uuid), public.approve_document(uuid, text),
                          public.reject_document(uuid, text), public.void_document(uuid, text, date),
                          public.duplicate_document(uuid), public.find_duplicates(uuid),
                          public.trial_balance(uuid, date, date)
  to authenticated;
-- Column default of documents.temp_number runs as the inserting user.
grant execute on function app.next_draft_number() to authenticated, service_role;
