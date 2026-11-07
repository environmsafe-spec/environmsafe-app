-- ES-PF v2 · Migration 2: append-only audit log
-- Written only by triggers / app.log_event(). Nobody (Admin, service role, even the
-- table owner) can update, delete or truncate it: guarded by triggers and privileges.

create table public.audit_log (
  id             bigint generated always as identity primary key,
  at             timestamptz not null default clock_timestamp(),
  company_id     uuid,
  user_id        uuid,
  jwt_role       text,
  table_name     text not null,
  record_id      text,
  action         text not null check (action in ('INSERT', 'UPDATE', 'DELETE', 'EVENT')),
  changed_fields text[],
  before         jsonb,
  after          jsonb,
  note           text,
  ip             text,
  user_agent     text
);
create index audit_log_company_at_idx on public.audit_log(company_id, at desc);
create index audit_log_record_idx     on public.audit_log(table_name, record_id);

-- Request metadata forwarded by PostgREST (empty outside an API call).
create or replace function app.request_header(p_name text) returns text
language plpgsql stable set search_path = '' as $$
declare
  v text := nullif(current_setting('request.headers', true), '');
begin
  if v is null then
    return null;
  end if;
  return v::jsonb ->> p_name;
exception when others then
  return null;
end $$;

create or replace function app.write_audit(
  p_company uuid, p_table text, p_record text, p_action text,
  p_before jsonb, p_after jsonb, p_changed text[], p_note text
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log
    (company_id, user_id, jwt_role, table_name, record_id, action,
     changed_fields, before, after, note, ip, user_agent)
  values
    (p_company, auth.uid(), auth.role(), p_table, p_record, p_action,
     p_changed, p_before, p_after, p_note,
     split_part(coalesce(app.request_header('x-forwarded-for'), app.request_header('x-real-ip'), ''), ',', 1),
     app.request_header('user-agent'));
end $$;

-- Row trigger attached to every business table.
create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old     jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new     jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row     jsonb := coalesce(v_new, v_old);
  v_changed text[];
  v_record  text;
begin
  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into v_changed
    from jsonb_object_keys(v_new) k
    where v_new -> k is distinct from v_old -> k
      and k not in ('updated_at', 'updated_by');
    if v_changed is null then
      return new;  -- nothing but the timestamp changed
    end if;
  end if;

  v_record := coalesce(v_row ->> 'id', v_row ->> 'user_id', v_row ->> 'code');
  if tg_table_name = 'user_roles' then
    v_record := (v_row ->> 'user_id') || ':' || (v_row ->> 'role_code');
  end if;

  perform app.write_audit(
    case when tg_table_name = 'companies' then (v_row ->> 'id')::uuid
         else nullif(v_row ->> 'company_id', '')::uuid end,
    tg_table_name, v_record, tg_op, v_old, v_new, v_changed, null);

  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- Business events that are not a plain row change (period reopen, role grant, posting...).
create or replace function app.log_event(
  p_company uuid, p_table text, p_record text, p_note text, p_data jsonb default null
) returns void
language sql security definer set search_path = '' as $$
  select app.write_audit(p_company, p_table, p_record, 'EVENT', null, p_data, null, p_note)
$$;

-- Immutability guard.
create or replace function app.audit_log_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_log is append-only: % is not allowed', tg_op using errcode = '42501';
end $$;

create trigger audit_log_no_update   before update or delete on public.audit_log
  for each row execute function app.audit_log_immutable();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function app.audit_log_immutable();

revoke all on public.audit_log from public, anon, authenticated, service_role;
grant select on public.audit_log to authenticated, service_role;

-- Attach the audit trigger to the tables created so far.
create trigger audit_companies     after insert or update or delete on public.companies     for each row execute function app.audit_row();
create trigger audit_user_profiles after insert or update or delete on public.user_profiles for each row execute function app.audit_row();
create trigger audit_user_roles    after insert or update or delete on public.user_roles    for each row execute function app.audit_row();
