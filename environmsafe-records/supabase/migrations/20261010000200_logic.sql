-- EnvironmSafe Records: triggers and server functions.

alter table public.profiles add column if not exists revoked_before timestamptz;

-- Sessions issued before an Admin pressed "sign out all devices" stop working
-- immediately, even though their access token has not yet expired.
create or replace function public.effective_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select case
    when p.role = 'admin' and public.jwt_aal() <> 'aal2' then 'office'::public.app_role
    else p.role end
  from public.profiles p
  where p.id = auth.uid() and p.active
    and (p.revoked_before is null
         or coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'iat')::bigint, 0)
            > extract(epoch from p.revoked_before))
$$;

-- True for maintenance work run directly by the database owner (migrations,
-- seed scripts, backups), never for app users.
create or replace function public.is_system() returns boolean
language sql stable as $$
  select auth.uid() is null and current_user not in ('anon', 'authenticated')
$$;

-- ---------------------------------------------------------------------------
-- Housekeeping: timestamps, per-field change times, soft-delete guard.
-- ---------------------------------------------------------------------------
create or replace function public.tg_stamp() returns trigger
language plpgsql as $$
declare
  k text;
  o jsonb;
  n jsonb;
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.created_by := coalesce(new.created_by, auth.uid());
    new.updated_at := now();
    new.updated_by := auth.uid();
    if new.deleted_at is not null and not (public.is_office() or public.is_system()) then
      raise exception 'Only Office or Admin can delete records' using errcode = '42501';
    end if;
    return new;
  end if;

  new.created_at := old.created_at;
  new.created_by := old.created_by;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);

  if new.deleted_at is distinct from old.deleted_at then
    if not (public.is_office() or public.is_system()) then
      raise exception 'Only Office or Admin can delete or restore records' using errcode = '42501';
    end if;
    new.deleted_by := case when new.deleted_at is null then null else auth.uid() end;
  end if;

  -- Record when each field last changed so offline edits merge per field.
  o := to_jsonb(old);
  n := to_jsonb(new);
  for k in
    select key from jsonb_each(n)
    where key not in ('updated_at', 'updated_by', 'field_ts', 'created_at', 'created_by')
      and value is distinct from o -> key
  loop
    if (new.field_ts ->> k) is not distinct from (old.field_ts ->> k) then
      new.field_ts := new.field_ts || jsonb_build_object(k, now());
    end if;
  end loop;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Audit log. Users can never write to it directly.
-- ---------------------------------------------------------------------------
create or replace function public.tg_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb;
  n jsonb;
  diff jsonb := '{}';
  k text;
  act text;
  rid uuid;
begin
  if tg_op = 'DELETE' then
    o := to_jsonb(old);
    act := 'purge';
    rid := (o ->> 'id')::uuid;
    diff := jsonb_build_object('snapshot', o - 'field_ts');
  elsif tg_op = 'INSERT' then
    n := to_jsonb(new);
    act := 'create';
    rid := (n ->> 'id')::uuid;
  else
    o := to_jsonb(old);
    n := to_jsonb(new);
    rid := (n ->> 'id')::uuid;
    for k in
      select key from jsonb_each(n)
      where key not in ('updated_at', 'updated_by', 'field_ts')
        and value is distinct from o -> key
    loop
      diff := diff || jsonb_build_object(k, jsonb_build_array(
        left(coalesce(o ->> k, ''), 300), left(coalesce(n ->> k, ''), 300)));
    end loop;
    if diff = '{}' then
      return null;
    end if;
    act := case
      when (o ->> 'deleted_at') is null and (n ->> 'deleted_at') is not null then 'delete'
      when (o ->> 'deleted_at') is not null and (n ->> 'deleted_at') is null then 'restore'
      when diff ? 'status' then 'status:' || (n ->> 'status')
      else 'update' end;
  end if;

  insert into public.audit_log (user_id, user_email, action, table_name, row_id, details)
  values (auth.uid(), (select email from public.profiles where id = auth.uid()), act, tg_table_name, rid, diff);
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Document numbering. Numbers are never reused.
-- Tokens: {CLIENT} {TYPE} {JOB} {YYYY} {YY} {MM} and {N..} (zero padded).
-- ---------------------------------------------------------------------------
create or replace function public.allocate_number(p_doc_type text, p_client uuid, p_type text default '', p_job text default '')
returns text
language plpgsql security definer set search_path = public as $$
declare
  pat text;
  resolved text;
  ckey text;
  width int;
  n int;
  num text;
  ccode text;
begin
  if not (public.is_field() or public.is_system()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select pattern into pat from public.numbering_schemes where doc_type = p_doc_type;
  pat := coalesce(pat, 'ES/{CLIENT}-{TYPE}-{YYYY}-{NNN}');
  select upper(code) into ccode from public.clients where id = p_client;

  resolved := pat;
  resolved := replace(resolved, '{CLIENT}', coalesce(ccode, 'X'));
  resolved := replace(resolved, '{TYPE}', upper(coalesce(nullif(p_type, ''), 'GEN')));
  resolved := replace(resolved, '{JOB}', upper(coalesce(nullif(p_job, ''), 'JOB')));
  resolved := replace(resolved, '{YYYY}', to_char(now(), 'YYYY'));
  resolved := replace(resolved, '{YY}', to_char(now(), 'YY'));
  resolved := replace(resolved, '{MM}', to_char(now(), 'MM'));
  width := coalesce(length(substring(resolved from '\{(N+)\}')), 0);
  if width = 0 then
    resolved := resolved || '-{NNN}';
    width := 3;
  end if;
  ckey := regexp_replace(resolved, '\{N+\}', '#');

  loop
    insert into public.number_counters (key, last_value) values (ckey, 1)
    on conflict (key) do update set last_value = public.number_counters.last_value + 1
    returning last_value into n;
    num := regexp_replace(resolved, '\{N+\}', lpad(n::text, greatest(width, length(n::text)), '0'));
    begin
      insert into public.issued_numbers (number, doc_type, issued_by) values (num, p_doc_type, auth.uid());
      exit;
    exception when unique_violation then
      -- A number typed in by hand already used this value; take the next one.
      continue;
    end;
  end loop;
  return num;
end $$;

-- ---------------------------------------------------------------------------
-- Status rules and the issued-document lock.
-- ---------------------------------------------------------------------------
create or replace function public.tg_status_lock() returns trigger
language plpgsql as $$
declare
  o jsonb;
  n jsonb;
  ignore text[] := array['status', 'updated_at', 'updated_by', 'field_ts'];
  num_col text := case tg_table_name when 'inspections' then 'report_no' else 'number' end;
  doc_type text;
  type_tok text;
  ccode text;
begin
  if tg_op = 'UPDATE' then
    if old.status in ('issued', 'revised') and not public.is_system() then
      o := to_jsonb(old) - ignore;
      n := to_jsonb(new) - ignore;
      if old.status = 'issued' and new.status = 'revised' and o = n and public.is_office() then
        return new;
      end if;
      raise exception 'This document is issued and locked. Create a revision to change it.' using errcode = '42501';
    end if;
  end if;

  if (tg_op = 'INSERT' or new.status is distinct from old.status)
     and new.status in ('reviewed', 'issued', 'revised')
     and not (public.is_office() or public.is_system()) then
    raise exception 'Only Office or Admin can review or issue documents' using errcode = '42501';
  end if;

  if new.status = 'issued' and (tg_op = 'INSERT' or old.status <> 'issued') then
    new.issued_at := coalesce(new.issued_at, now());
    new.issued_by := coalesce(new.issued_by, auth.uid());
    if tg_table_name = 'certificates' then
      select coalesce(nullif(new.issued_by_name, ''), full_name), coalesce(nullif(new.issued_by_cert, ''), cert_number)
        into new.issued_by_name, new.issued_by_cert
        from public.profiles where id = auth.uid();
      new.issued_by_name := coalesce(new.issued_by_name, '');
      new.issued_by_cert := coalesce(new.issued_by_cert, '');
    end if;

    if (to_jsonb(new) ->> num_col) is null
       and not (tg_table_name = 'inspections' and (to_jsonb(new) ->> 'is_historical')::boolean) then
      doc_type := case tg_table_name
        when 'inspections' then 'inspection_report'
        when 'certificates' then 'certificate_' || (to_jsonb(new) ->> 'kind')
        when 'reports' then case when (to_jsonb(new) ->> 'template_code') = 'final' then 'final_report' else 'report' end
        else tg_table_name end;
      type_tok := case tg_table_name
        when 'inspections' then upper(left(regexp_replace(to_jsonb(new) ->> 'type_code', '[^A-Za-z]', '', 'g'), 4))
        when 'certificates' then upper(to_jsonb(new) ->> 'kind')
        when 'reports' then upper(left(to_jsonb(new) ->> 'template_code', 4))
        else '' end;
      if tg_table_name = 'inspections' then
        new.report_no := public.allocate_number(doc_type, new.client_id, type_tok);
      elsif tg_table_name = 'certificates' then
        new.number := public.allocate_number(doc_type, new.client_id, type_tok);
      elsif tg_table_name = 'reports' then
        new.number := public.allocate_number(doc_type, new.client_id, type_tok);
      end if;
    end if;
  end if;
  return new;
end $$;

-- Reports get their number as soon as they are generated, so the number can be
-- printed on the draft output.
create or replace function public.tg_report_number() returns trigger
language plpgsql as $$
begin
  -- Daily reports and certificates carry their own numbers.
  if new.number is null and new.template_code in ('inspection', 'final', 'followup', 'due_register', 'custom') then
    new.number := public.allocate_number(
      case new.template_code when 'final' then 'final_report' when 'inspection' then 'inspection_report' else 'report' end,
      new.client_id, upper(left(new.template_code, 4)));
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- DPR numbering: sequential per job.
-- ---------------------------------------------------------------------------
create or replace function public.tg_dpr_number() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  jnum text;
begin
  perform pg_advisory_xact_lock(hashtext('dpr' || new.job_id::text));
  if new.seq is null then
    select coalesce(max(seq), 0) + 1 into new.seq from public.dprs where job_id = new.job_id;
  end if;
  if new.number is null then
    select number into jnum from public.jobs where id = new.job_id;
    new.number := public.allocate_number('dpr', new.client_id, 'DPR', jnum);
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Findings: F-001, F-002 ... per asset; history updates set current status.
-- ---------------------------------------------------------------------------
create or replace function public.tg_finding_number() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('finding' || new.asset_id::text));
  if new.number is null then
    select coalesce(max(number), 0) + 1 into new.number from public.findings where asset_id = new.asset_id;
  end if;
  if new.ref is null or new.ref = '' then
    new.ref := 'F-' || lpad(new.number::text, 3, '0');
  end if;
  return new;
end $$;

create or replace function public.tg_finding_update_apply() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is not null then
    return null;
  end if;
  -- Only the most recent update decides the current status, so importing an
  -- old history entry never overrides a newer one.
  if not exists (
    select 1 from public.finding_updates u
    where u.finding_id = new.finding_id and u.id <> new.id and u.deleted_at is null
      and (u.update_date > new.update_date or (u.update_date = new.update_date and u.created_at > new.created_at))
  ) then
    update public.findings f set
      status = new.status,
      closed_date = case when new.status in ('closed', 'superseded') then new.update_date else null end,
      justification = case when new.status = 'deferred' and new.note <> '' then new.note else f.justification end
    where f.id = new.finding_id;
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Tag changes are kept with full history.
-- ---------------------------------------------------------------------------
create or replace function public.tg_asset_tag_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tag is distinct from old.tag then
    insert into public.asset_tag_history (asset_id, client_id, old_tag, new_tag, changed_by)
    values (new.id, new.client_id, old.tag, new.tag, auth.uid());
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- No public sign-up: only e-mails an Admin approved can be created.
-- ---------------------------------------------------------------------------
create or replace function public.tg_auth_user_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.allowed_signups where email = lower(new.email)) then
    raise exception 'Sign-up is closed. Ask your administrator for an account.';
  end if;
  return new;
end $$;

create or replace function public.tg_auth_user_created() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  a public.allowed_signups;
begin
  select * into a from public.allowed_signups where email = lower(new.email);
  insert into public.profiles (id, email, full_name, role, client_id, title, cert_number)
  values (new.id, lower(new.email), coalesce(a.full_name, ''), coalesce(a.role, 'viewer'), a.client_id,
          coalesce(a.title, ''), coalesce(a.cert_number, ''))
  on conflict (id) do nothing;
  delete from public.allowed_signups where email = lower(new.email);
  return null;
end $$;

drop trigger if exists es_auth_user_guard on auth.users;
create trigger es_auth_user_guard before insert on auth.users
  for each row execute function public.tg_auth_user_guard();
drop trigger if exists es_auth_user_created on auth.users;
create trigger es_auth_user_created after insert on auth.users
  for each row execute function public.tg_auth_user_created();

-- Profiles: users may edit only harmless fields of their own profile.
create or replace function public.tg_profile_guard() returns trigger
language plpgsql as $$
begin
  if public.is_admin() or public.is_system() then
    new.updated_at := now();
    return new;
  end if;
  if new.role is distinct from old.role or new.active is distinct from old.active
     or new.client_id is distinct from old.client_id or new.email is distinct from old.email
     or new.revoked_before is distinct from old.revoked_before
     or (new.must_change_password is distinct from old.must_change_password and new.must_change_password) then
    raise exception 'Only an Admin can change roles or access' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists es_profile_guard on public.profiles;
create trigger es_profile_guard before update on public.profiles
  for each row execute function public.tg_profile_guard();

-- ---------------------------------------------------------------------------
-- Attach triggers.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['standards', 'inspection_types', 'equipment_types', 'text_blocks', 'report_templates',
                           'clients', 'sites', 'assets', 'jobs', 'job_items', 'inspections', 'readings', 'findings',
                           'finding_updates', 'dprs', 'certificates', 'documents', 'reports'] loop
    execute format('drop trigger if exists es_stamp on public.%I', t);
    execute format('create trigger es_stamp before insert or update on public.%I for each row execute function public.tg_stamp()', t);
    execute format('drop trigger if exists es_audit on public.%I', t);
    execute format('create trigger es_audit after insert or update or delete on public.%I for each row execute function public.tg_audit()', t);
  end loop;
  foreach t in array array['inspections', 'certificates', 'reports', 'dprs'] loop
    execute format('drop trigger if exists es_status_lock on public.%I', t);
    execute format('create trigger es_status_lock before insert or update on public.%I for each row execute function public.tg_status_lock()', t);
  end loop;
end $$;

create or replace function public.tg_audit_simple() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (user_id, user_email, action, table_name, details)
  values (auth.uid(), (select email from public.profiles where id = auth.uid()),
          lower(tg_op), tg_table_name,
          case when tg_op = 'DELETE' then jsonb_build_object('old', to_jsonb(old))
               else jsonb_build_object('new', to_jsonb(new) - 'signature_path') end);
  return null;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['settings', 'ref_lists', 'numbering_schemes', 'profiles'] loop
    execute format('drop trigger if exists es_audit_simple on public.%I', t);
    execute format('create trigger es_audit_simple after insert or update or delete on public.%I for each row execute function public.tg_audit_simple()', t);
  end loop;
end $$;

drop trigger if exists es_dpr_number on public.dprs;
create trigger es_dpr_number before insert on public.dprs for each row execute function public.tg_dpr_number();
drop trigger if exists es_report_number on public.reports;
create trigger es_report_number before insert on public.reports for each row execute function public.tg_report_number();
drop trigger if exists es_finding_number on public.findings;
create trigger es_finding_number before insert on public.findings for each row execute function public.tg_finding_number();
drop trigger if exists es_finding_update_apply on public.finding_updates;
create trigger es_finding_update_apply after insert or update on public.finding_updates for each row execute function public.tg_finding_update_apply();
drop trigger if exists es_asset_tag_history on public.assets;
create trigger es_asset_tag_history after update of tag on public.assets for each row execute function public.tg_asset_tag_history();

-- ---------------------------------------------------------------------------
-- Offline sync: apply a batch of queued changes, merging per field.
-- Runs with the caller's rights, so Row Level Security applies to every change.
-- ---------------------------------------------------------------------------
create or replace function public.sync_apply(ops jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  op jsonb;
  tbl text;
  rid uuid;
  fields jsonb;
  fts jsonb;
  cur jsonb;
  merged jsonb;
  newts jsonb;
  k text;
  v jsonb;
  cts timestamptz;
  sts timestamptz;
  base timestamptz;
  cols text;
  cnt int;
  results jsonb := '[]';
  row_out jsonb;
  allowed text[] := array['clients', 'sites', 'assets', 'jobs', 'job_items', 'inspections', 'readings', 'findings',
                          'finding_updates', 'dprs', 'certificates', 'documents', 'reports', 'standards',
                          'inspection_types', 'equipment_types', 'text_blocks', 'report_templates'];
  forbidden text[] := array['created_at', 'created_by', 'updated_at', 'updated_by', 'field_ts', 'deleted_by', 'tag_norm',
                            'issued_at', 'issued_by'];
begin
  if not public.is_field() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(ops) <> 'array' or jsonb_array_length(ops) > 500 then
    raise exception 'Bad batch';
  end if;

  for op in select value from jsonb_array_elements(ops) loop
    begin
      tbl := op ->> 'table';
      rid := (op ->> 'id')::uuid;
      fields := coalesce(op -> 'fields', '{}'::jsonb) - forbidden;
      fts := coalesce(op -> 'ts', '{}'::jsonb);
      base := nullif(op ->> 'base', '')::timestamptz;
      if tbl is null or not tbl = any (allowed) then
        raise exception 'Table % cannot be synced', tbl;
      end if;

      execute format('select to_jsonb(t) from public.%I t where id = $1', tbl) into cur using rid;

      if cur is null then
        fields := fields || jsonb_build_object('id', rid);
        select string_agg(quote_ident(key), ',') into cols from jsonb_object_keys(fields) key;
        execute format('insert into public.%I (%s, field_ts) select %s, $2 from jsonb_populate_record(null::public.%I, $1)',
                       tbl, cols, cols, tbl) using fields, fts;
      else
        merged := '{}';
        newts := coalesce(cur -> 'field_ts', '{}'::jsonb);
        for k, v in select key, value from jsonb_each(fields) loop
          continue when k = 'id';
          if not cur ? k then
            raise exception 'Unknown field %', k;
          end if;
          continue when (cur -> k) is not distinct from v;
          cts := coalesce((fts ->> k)::timestamptz, now());
          -- A field nobody has edited on the server only holds its default:
          -- the device's value always wins.
          sts := coalesce((cur -> 'field_ts' ->> k)::timestamptz, '-infinity'::timestamptz);
          if cts >= sts then
            merged := merged || jsonb_build_object(k, v);
            newts := newts || jsonb_build_object(k, cts);
            if base is not null and sts > base then
              insert into public.sync_conflicts (table_name, row_id, field, server_value, client_value, server_ts, client_ts, kept)
              values (tbl, rid, k, cur -> k, v, sts, cts, 'client');
            end if;
          else
            insert into public.sync_conflicts (table_name, row_id, field, server_value, client_value, server_ts, client_ts, kept)
            values (tbl, rid, k, cur -> k, v, sts, cts, 'server');
          end if;
        end loop;

        if merged <> '{}'::jsonb then
          select string_agg(quote_ident(key), ',') into cols from jsonb_object_keys(merged) key;
          execute format('update public.%I t set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)), field_ts = $2 where id = $3',
                         tbl, cols, cols, tbl) using merged, newts, rid;
          get diagnostics cnt = row_count;
          if cnt = 0 then
            raise exception 'You do not have permission to change this record' using errcode = '42501';
          end if;
        end if;
      end if;

      execute format('select to_jsonb(t) from public.%I t where id = $1', tbl) into row_out using rid;
      results := results || jsonb_build_array(jsonb_build_object('op_id', op ->> 'op_id', 'ok', true, 'row', row_out));
    exception when others then
      results := results || jsonb_build_array(jsonb_build_object('op_id', op ->> 'op_id', 'ok', false, 'error', sqlerrm, 'code', sqlstate));
    end;
  end loop;
  return results;
end $$;

-- ---------------------------------------------------------------------------
-- Small helpers used by the app.
-- ---------------------------------------------------------------------------
create or replace function public.log_event(p_action text, p_details jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.effective_role() is null then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  insert into public.audit_log (user_id, user_email, action, details)
  values (auth.uid(), (select email from public.profiles where id = auth.uid()),
          'event:' || left(regexp_replace(p_action, '[^a-z_:.-]', '', 'g'), 40), coalesce(p_details, '{}'));
end $$;

create or replace function public.storage_usage() returns jsonb
language plpgsql security definer set search_path = public, storage as $$
declare
  r jsonb;
begin
  if not public.is_office() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'files_bytes', coalesce(sum((metadata ->> 'size')::bigint), 0),
    'files_count', count(*),
    'db_bytes', pg_database_size(current_database()))
  into r from storage.objects where bucket_id = 'files';
  return r;
end $$;

create or replace function public.admin_sign_out(p_user uuid default null) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then
    raise exception 'Only an Admin can sign users out' using errcode = '42501';
  end if;
  update public.profiles set revoked_before = now()
  where (p_user is null and id <> auth.uid()) or id = p_user;
  delete from auth.sessions where (p_user is null and user_id <> auth.uid()) or user_id = p_user;
  perform public.log_event('sign_out_all', jsonb_build_object('user', p_user));
end $$;

create or replace function public.keepalive() returns text
language sql stable security definer set search_path = public as $$
  select 'ok ' || (select count(*) from public.clients)::text
$$;

create or replace function public.resolve_conflict(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.sync_conflicts set resolved = true, resolved_by = auth.uid(), resolved_at = now() where id = p_id;
end $$;
