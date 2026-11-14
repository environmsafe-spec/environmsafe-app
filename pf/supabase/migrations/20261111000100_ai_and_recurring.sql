-- ES-PF v2 · Migration 14: AI voucher extraction log and recurring templates.

-- What the AI read from each uploaded voucher, and which draft it became. Never posts anything.
create table public.ai_extractions (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  storage_path  text not null,
  file_name     text,
  model         text,
  status        text not null check (status in ('done', 'failed', 'refused')),
  result        jsonb,
  warnings      text[] not null default '{}',
  error         text,
  document_id   uuid,
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  foreign key (company_id, document_id) references public.documents(company_id, id) on delete set null
);
create index ai_extractions_company_idx on public.ai_extractions(company_id, created_at desc);

alter table public.ai_extractions enable row level security;
revoke all on public.ai_extractions from anon, authenticated;
grant select, insert on public.ai_extractions to authenticated;
create policy view on public.ai_extractions for select to authenticated
  using ((select app.has_perm(company_id, 'docs.view')));
create policy add on public.ai_extractions for insert to authenticated
  with check ((select app.has_perm(company_id, 'docs.create')) and storage_path like company_id::text || '/%');

-- Monthly recurring documents (salaries, rent, subscriptions): a template points at a document whose
-- copy is made as a draft each month on the chosen day.
create table public.recurring_templates (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id),
  name               text not null check (length(trim(name)) > 0),
  source_document_id uuid not null,
  day_of_month       smallint not null default 1 check (day_of_month between 1 and 28),
  is_active          boolean not null default true,
  last_period        text,                 -- 'YYYY-MM' of the last drafts created
  created_at         timestamptz not null default now(),
  created_by         uuid default auth.uid(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  foreign key (company_id, source_document_id) references public.documents(company_id, id)
);

create trigger recurring_templates_touch before update on public.recurring_templates for each row execute function app.touch();
create trigger audit_recurring_templates after insert or update or delete on public.recurring_templates for each row execute function app.audit_row();

alter table public.recurring_templates enable row level security;
revoke all on public.recurring_templates from anon, authenticated;
grant select, insert, update (name, day_of_month, is_active), delete on public.recurring_templates to authenticated;
create policy view on public.recurring_templates for select to authenticated using ((select app.has_perm(company_id, 'docs.view')));
create policy add on public.recurring_templates for insert to authenticated with check ((select app.has_perm(company_id, 'docs.create')));
create policy edit on public.recurring_templates for update to authenticated
  using ((select app.has_perm(company_id, 'docs.create'))) with check ((select app.has_perm(company_id, 'docs.create')));
create policy remove on public.recurring_templates for delete to authenticated using ((select app.has_perm(company_id, 'docs.create')));

-- Create this month's drafts for every active template not yet done for that month.
-- Returns the number of drafts created. Drafts are never posted automatically.
create or replace function public.generate_recurring(p_company uuid, p_year int, p_month int) returns int
language plpgsql security definer set search_path = '' as $$
declare
  t      public.recurring_templates;
  v_key  text := p_year || '-' || lpad(p_month::text, 2, '0');
  v_new  uuid;
  v_n    int := 0;
begin
  perform app.require_perm(p_company, 'docs.create');
  for t in select * from public.recurring_templates
           where company_id = p_company and is_active and (last_period is null or last_period < v_key)
           order by name for update loop
    v_new := public.duplicate_document(t.source_document_id);
    perform app.begin_internal();   -- 'source' is a protected column
    update public.documents
       set doc_date = make_date(p_year, p_month, t.day_of_month),
           description = coalesce(description, t.name) || ' — ' || to_char(make_date(p_year, p_month, 1), 'Mon YYYY'),
           source = 'recurring', rate = null
     where id = v_new;
    perform app.end_internal();
    update public.recurring_templates set last_period = v_key where id = t.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- duplicate_document is called from here as the definer; the copy is still the user's draft.
revoke execute on function public.generate_recurring(uuid, int, int) from public, anon;
grant execute on function public.generate_recurring(uuid, int, int) to authenticated;
