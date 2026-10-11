-- EnvironmSafe Records: Row Level Security, grants and private file storage.
-- Permissions are enforced here, in the database, not only in the app.

create or replace function public.try_uuid(t text) returns uuid
language plpgsql immutable as $$
begin
  return t::uuid;
exception when others then
  return null;
end $$;

-- Anonymous visitors get nothing at all.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on function public.keepalive() to anon;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- Nobody writes the audit log, counters or conflict list directly.
revoke insert, update, delete, truncate on public.audit_log from authenticated;
revoke insert, update, delete, truncate on public.number_counters from authenticated;
revoke insert, update, delete, truncate on public.issued_numbers from authenticated;
revoke update, delete, truncate on public.sync_conflicts from authenticated;
revoke insert, update, delete, truncate on public.asset_tag_history from authenticated;
revoke insert, delete, truncate on public.profiles from authenticated;
revoke execute on function public._add_housekeeping(text) from authenticated;

do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Drop any earlier versions of our policies so this file can be re-applied.
do $$
declare
  r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' and policyname like 'es_%' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Users ----------------------------------------------------------------------
create policy es_profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.effective_role() in ('admin', 'office', 'inspector'));
create policy es_profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

create policy es_allowed_signups_admin on public.allowed_signups for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Settings and libraries: everyone signed in reads, Admin edits -------------
do $$
declare
  t text;
begin
  foreach t in array array['settings', 'ref_lists', 'numbering_schemes', 'standards', 'inspection_types',
                           'equipment_types', 'text_blocks', 'report_templates'] loop
    execute format('create policy es_%1$s_select on public.%1$I for select to authenticated using (public.is_member())', t);
    execute format('create policy es_%1$s_insert on public.%1$I for insert to authenticated with check (public.is_admin())', t);
    execute format('create policy es_%1$s_update on public.%1$I for update to authenticated using (public.is_admin()) with check (public.is_admin())', t);
    execute format('create policy es_%1$s_delete on public.%1$I for delete to authenticated using (public.is_admin())', t);
  end loop;
end $$;

create policy es_issued_numbers_select on public.issued_numbers for select to authenticated using (public.is_office());

-- Clients, sites, assets, jobs: Office manages, everyone allowed reads ------
create policy es_clients_select on public.clients for select to authenticated using (public.can_see_client(id));
create policy es_clients_insert on public.clients for insert to authenticated with check (public.is_office());
create policy es_clients_update on public.clients for update to authenticated using (public.is_office()) with check (public.is_office());
create policy es_clients_delete on public.clients for delete to authenticated using (public.is_admin());

do $$
declare
  t text;
begin
  foreach t in array array['sites', 'assets', 'jobs'] loop
    execute format('create policy es_%1$s_select on public.%1$I for select to authenticated using (public.can_see_client(client_id))', t);
    execute format('create policy es_%1$s_insert on public.%1$I for insert to authenticated with check (public.is_office() and public.can_see_client(client_id))', t);
    execute format('create policy es_%1$s_update on public.%1$I for update to authenticated using (public.is_office()) with check (public.is_office())', t);
    execute format('create policy es_%1$s_delete on public.%1$I for delete to authenticated using (public.is_admin())', t);
  end loop;

  -- Field records: inspectors create them and edit their own.
  foreach t in array array['job_items', 'readings', 'findings', 'finding_updates', 'documents'] loop
    execute format('create policy es_%1$s_select on public.%1$I for select to authenticated using (public.can_see_client(client_id))', t);
    execute format('create policy es_%1$s_insert on public.%1$I for insert to authenticated with check (public.is_field() and public.can_see_client(client_id) and (public.is_office() or created_by = auth.uid()))', t);
    execute format('create policy es_%1$s_update on public.%1$I for update to authenticated using (public.is_office() or (public.is_field() and created_by = auth.uid())) with check (public.is_office() or (public.is_field() and created_by = auth.uid()))', t);
    execute format('create policy es_%1$s_delete on public.%1$I for delete to authenticated using (public.is_admin())', t);
  end loop;

  -- Documents with a status: inspectors edit their own drafts only.
  foreach t in array array['inspections', 'dprs', 'certificates', 'reports'] loop
    execute format('create policy es_%1$s_select on public.%1$I for select to authenticated using (public.can_see_client(client_id))', t);
    execute format('create policy es_%1$s_insert on public.%1$I for insert to authenticated with check (public.is_field() and public.can_see_client(client_id) and (public.is_office() or (created_by = auth.uid() and status in (''draft'', ''submitted''))))', t);
    execute format('create policy es_%1$s_update on public.%1$I for update to authenticated using (public.is_office() or (public.is_field() and created_by = auth.uid() and status = ''draft'')) with check (public.is_office() or (public.is_field() and created_by = auth.uid() and status in (''draft'', ''submitted'')))', t);
    execute format('create policy es_%1$s_delete on public.%1$I for delete to authenticated using (public.is_admin())', t);
  end loop;
end $$;

create policy es_asset_tag_history_select on public.asset_tag_history for select to authenticated
  using (public.can_see_client(client_id));

-- Audit log: Admin reads, nobody writes or edits.
create policy es_audit_log_select on public.audit_log for select to authenticated using (public.is_admin());

-- Conflicts: recorded by the sync function; Admin sees all, users their own.
create policy es_sync_conflicts_insert on public.sync_conflicts for insert to authenticated
  with check (public.is_field() and user_id = auth.uid());
create policy es_sync_conflicts_select on public.sync_conflicts for select to authenticated
  using (public.is_admin() or user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Private file storage. Files live under <client id>/..., signatures under
-- signatures/<user id>..., company branding under branding/...
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('files', 'files', false, 52428800, array[
  'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel', 'text/csv', 'application/zip', 'application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists es_files_select on storage.objects;
drop policy if exists es_files_insert on storage.objects;
drop policy if exists es_files_update on storage.objects;
drop policy if exists es_files_delete on storage.objects;

create policy es_files_select on storage.objects for select to authenticated using (
  bucket_id = 'files' and (
    ((storage.foldername(name))[1] in ('signatures', 'branding') and public.is_member())
    or public.can_see_client(public.try_uuid((storage.foldername(name))[1]))
  ));

create policy es_files_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'files' and (
    ((storage.foldername(name))[1] = 'signatures' and (storage.foldername(name))[2] = auth.uid()::text)
    or ((storage.foldername(name))[1] = 'branding' and public.is_admin())
    or (public.is_field() and public.can_see_client(public.try_uuid((storage.foldername(name))[1])))
  ));

create policy es_files_update on storage.objects for update to authenticated using (
  bucket_id = 'files' and (
    ((storage.foldername(name))[1] = 'signatures' and (storage.foldername(name))[2] = auth.uid()::text)
    or ((storage.foldername(name))[1] = 'branding' and public.is_admin())
    or public.is_office()
  ));

create policy es_files_delete on storage.objects for delete to authenticated using (
  bucket_id = 'files' and public.is_admin());
