-- EnvironmSafe Records: core schema.
-- Every business table carries the same housekeeping columns so that the
-- offline sync, the audit log and soft delete work the same way everywhere.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.app_role as enum ('admin', 'office', 'inspector', 'viewer');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  title text not null default '',
  phone text not null default '',
  role public.app_role not null default 'inspector',
  -- A viewer may be limited to a single client (future client portal).
  client_id uuid,
  cert_number text not null default '',
  signature_path text,
  active boolean not null default true,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Only e-mails an Admin has approved may become users (no public sign-up).
create table if not exists public.allowed_signups (
  email text primary key,
  full_name text not null default '',
  role public.app_role not null default 'inspector',
  client_id uuid,
  title text not null default '',
  cert_number text not null default '',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Role helpers. SECURITY DEFINER so they can read profiles regardless of RLS.
-- ---------------------------------------------------------------------------
create or replace function public.jwt_aal() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', 'aal1')
$$;

create or replace function public.base_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

-- An Admin who has not passed two-factor in this session works with Office
-- rights only. Admin-only actions therefore always require TOTP.
create or replace function public.effective_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select case
    when p.role = 'admin' and public.jwt_aal() <> 'aal2' then 'office'::public.app_role
    else p.role end
  from public.profiles p where p.id = auth.uid() and p.active
$$;

create or replace function public.is_admin() returns boolean
language sql stable as $$ select coalesce(public.effective_role() = 'admin', false) $$;

create or replace function public.is_office() returns boolean
language sql stable as $$ select coalesce(public.effective_role() in ('admin', 'office'), false) $$;

create or replace function public.is_field() returns boolean
language sql stable as $$ select coalesce(public.effective_role() in ('admin', 'office', 'inspector'), false) $$;

create or replace function public.is_member() returns boolean
language sql stable as $$ select public.effective_role() is not null $$;

create or replace function public.can_see_client(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case when p.role = 'viewer' and p.client_id is not null then p.client_id = cid else true end
    from public.profiles p where p.id = auth.uid() and p.active
  ), false) and public.effective_role() is not null
$$;

-- ---------------------------------------------------------------------------
-- Settings and libraries (editable by Admin)
-- ---------------------------------------------------------------------------
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  company jsonb not null default '{}',
  branding jsonb not null default '{}',
  options jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists public.ref_lists (
  key text primary key,
  title text not null,
  items jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists public.numbering_schemes (
  doc_type text primary key,
  label text not null,
  pattern text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists public.number_counters (
  key text primary key,
  last_value int not null default 0
);

create table if not exists public.issued_numbers (
  number text primary key,
  doc_type text not null,
  issued_at timestamptz not null default now(),
  issued_by uuid
);

-- ---------------------------------------------------------------------------
-- Generic housekeeping columns are added by this helper.
-- ---------------------------------------------------------------------------
create or replace function public._add_housekeeping(tbl text) returns void
language plpgsql as $$
begin
  execute format($f$
    alter table public.%1$I
      add column if not exists created_at timestamptz not null default now(),
      add column if not exists created_by uuid default auth.uid(),
      add column if not exists updated_at timestamptz not null default now(),
      add column if not exists updated_by uuid,
      add column if not exists deleted_at timestamptz,
      add column if not exists deleted_by uuid,
      add column if not exists field_ts jsonb not null default '{}',
      add column if not exists is_demo boolean not null default false
  $f$, tbl);
end $$;

-- ---------------------------------------------------------------------------
-- Library tables
-- ---------------------------------------------------------------------------
create table if not exists public.standards (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  edition text not null default '',
  category text not null default '',
  active boolean not null default true
);
select public._add_housekeeping('standards');

create table if not exists public.inspection_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  category text not null default '',
  standards text[] not null default '{}',
  checklist jsonb not null default '[]',
  active boolean not null default true,
  sort int not null default 0
);
select public._add_housekeeping('inspection_types');

create table if not exists public.equipment_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  category text not null default '',
  -- [{key,label,type,unit,options,required}]
  custom_fields jsonb not null default '[]',
  -- [{type, months, basis, note}]
  default_intervals jsonb not null default '[]',
  -- {inspection_type_code: [{id,text,kind}]}
  checklists jsonb not null default '{}',
  active boolean not null default true,
  sort int not null default 0
);
select public._add_housekeeping('equipment_types');

create table if not exists public.text_blocks (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  category text not null,
  title text not null,
  body text not null,
  active boolean not null default true
);
select public._add_housekeeping('text_blocks');

create table if not exists public.report_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  config jsonb not null default '{}'
);
select public._add_housekeeping('report_templates');

-- ---------------------------------------------------------------------------
-- Business tables
-- ---------------------------------------------------------------------------
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 200),
  code text not null check (code ~ '^[A-Za-z0-9-]{1,16}$'),
  contacts jsonb not null default '[]',
  address text not null default '',
  notes text not null default '',
  logo_path text,
  status text not null default 'active' check (status in ('active', 'inactive'))
);
select public._add_housekeeping('clients');
create unique index if not exists clients_code_uq on public.clients (upper(code)) where deleted_at is null;

alter table public.profiles drop constraint if exists profiles_client_fk;
alter table public.profiles add constraint profiles_client_fk foreign key (client_id) references public.clients (id) on delete set null;

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id),
  name text not null check (length(name) between 1 and 200),
  area text not null default '',
  location text not null default '',
  lat double precision,
  lng double precision,
  notes text not null default ''
);
select public._add_housekeeping('sites');

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id),
  site_id uuid references public.sites (id),
  parent_id uuid references public.assets (id),
  tag text not null check (length(btrim(tag)) between 1 and 120),
  -- Normalised tag for near-duplicate detection: "PSV 18 111-1" -> "psv181111"
  tag_norm text generated always as (lower(regexp_replace(tag, '[^A-Za-z0-9]', '', 'g'))) stored,
  equipment_type_id uuid references public.equipment_types (id),
  description text not null default '',
  manufacturer text not null default '',
  model text not null default '',
  serial_no text not null default '',
  year_built int check (year_built is null or year_built between 1850 and 2200),
  design jsonb not null default '{}',
  service text not null default '',
  location text not null default '',
  status text not null default 'in_service' check (status in ('in_service', 'out_of_service', 'decommissioned')),
  criticality text not null default 'medium' check (criticality in ('low', 'medium', 'high')),
  custom jsonb not null default '{}',
  intervals jsonb not null default '{}',
  notes text not null default ''
);
select public._add_housekeeping('assets');
create unique index if not exists assets_tag_uq on public.assets (client_id, lower(btrim(tag))) where deleted_at is null;
create index if not exists assets_tag_norm on public.assets (client_id, tag_norm);

create table if not exists public.asset_tag_history (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets (id),
  client_id uuid not null,
  old_tag text not null,
  new_tag text not null,
  changed_at timestamptz not null default now(),
  changed_by uuid default auth.uid()
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id),
  site_id uuid references public.sites (id),
  number text not null check (length(btrim(number)) between 1 and 60),
  title text not null default '',
  scope text not null default '',
  start_date date,
  end_date date,
  team text not null default '',
  status text not null default 'in_progress' check (status in ('planned', 'in_progress', 'completed', 'closed')),
  notes text not null default ''
);
select public._add_housekeeping('jobs');

create table if not exists public.job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id),
  client_id uuid not null,
  kind text not null check (kind in ('hold', 'observation')),
  ref_no text not null default '',
  title text not null,
  description text not null default '',
  raised_date date not null default current_date,
  closed_date date,
  status text not null default 'open' check (status in ('open', 'closed')),
  raised_by_name text not null default ''
);
select public._add_housekeeping('job_items');

create table if not exists public.inspections (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id),
  asset_id uuid not null references public.assets (id),
  job_id uuid references public.jobs (id),
  type_code text not null,
  standard text not null default '',
  code_edition text not null default '',
  inspection_date date not null default current_date,
  inspector_id uuid,
  inspector_name text not null default '',
  witness text not null default '',
  status text not null default 'draft' check (status in ('draft', 'submitted', 'reviewed', 'issued', 'revised')),
  is_historical boolean not null default false,
  contractor text not null default '',
  summary text not null default '',
  checklist jsonb not null default '{}',
  results jsonb not null default '{}',
  conclusion text not null default 'not_assessed' check (conclusion in ('fit', 'fit_conditions', 'not_fit', 'not_assessed')),
  conclusion_text text not null default '',
  limitations text not null default '',
  recommendations text not null default '',
  interval_months int check (interval_months is null or interval_months between 0 and 240),
  next_due date,
  report_no text,
  revision int not null default 0,
  supersedes_id uuid references public.inspections (id),
  signature jsonb not null default '{}',
  submitted_at timestamptz,
  issued_at timestamptz,
  issued_by uuid
);
select public._add_housekeeping('inspections');
create index if not exists inspections_asset on public.inspections (asset_id, inspection_date desc);

create table if not exists public.readings (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid references public.inspections (id),
  asset_id uuid not null references public.assets (id),
  client_id uuid not null,
  kind text not null default 'ut' check (kind in ('ut', 'calibration', 'pressure', 'other')),
  point text not null default '',
  location text not null default '',
  nominal numeric,
  measured numeric,
  previous numeric,
  retirement numeric,
  unit text not null default 'mm',
  reading_date date not null default current_date,
  data jsonb not null default '{}',
  sort int not null default 0
);
select public._add_housekeeping('readings');
create index if not exists readings_asset_point on public.readings (asset_id, point, reading_date);

create table if not exists public.findings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id),
  asset_id uuid not null references public.assets (id),
  inspection_id uuid references public.inspections (id),
  number int,
  ref text,
  title text not null check (length(btrim(title)) between 1 and 300),
  description text not null default '',
  location text not null default '',
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  priority text not null default 'P2' check (priority in ('P1', 'P2', 'P3')),
  category text not null default '',
  damage_mechanism text not null default '',
  code_ref text not null default '',
  recommendation text not null default '',
  status text not null default 'open' check (status in ('open', 'open_deteriorated', 'open_improved', 'open_unchanged', 'closed', 'superseded', 'deferred')),
  due_date date,
  owner text not null default '',
  raised_date date not null default current_date,
  closed_date date,
  justification text not null default ''
);
select public._add_housekeeping('findings');
create unique index if not exists findings_asset_number on public.findings (asset_id, number);

create table if not exists public.finding_updates (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.findings (id),
  client_id uuid not null,
  inspection_id uuid references public.inspections (id),
  update_date date not null default current_date,
  status text not null check (status in ('open', 'open_deteriorated', 'open_improved', 'open_unchanged', 'closed', 'superseded', 'deferred')),
  note text not null default '',
  photo_doc_id uuid,
  by_name text not null default ''
);
select public._add_housekeeping('finding_updates');

create table if not exists public.dprs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id),
  client_id uuid not null,
  number text,
  seq int,
  report_date date not null default current_date,
  manpower jsonb not null default '[]',
  hours_worked numeric,
  toolbox_talks text not null default '',
  hse jsonb not null default '{}',
  activities jsonb not null default '[]',
  progress_planned numeric check (progress_planned is null or progress_planned between 0 and 100),
  progress_actual numeric check (progress_actual is null or progress_actual between 0 and 100),
  observations text not null default '',
  planned_next text not null default '',
  issues text not null default '',
  status text not null default 'draft' check (status in ('draft', 'submitted', 'issued', 'revised')),
  revision int not null default 0,
  supersedes_id uuid references public.dprs (id),
  issued_at timestamptz,
  issued_by uuid
);
select public._add_housekeeping('dprs');

create table if not exists public.certificates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id),
  asset_id uuid not null references public.assets (id),
  inspection_id uuid references public.inspections (id),
  job_id uuid references public.jobs (id),
  kind text not null check (kind in ('psv', 'hydro', 'ut', 'calibration', 'lifting', 'general')),
  number text,
  data jsonb not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'issued', 'revised')),
  revision int not null default 0,
  supersedes_id uuid references public.certificates (id),
  issued_at timestamptz,
  issued_by uuid,
  issued_by_name text not null default '',
  issued_by_cert text not null default '',
  signature jsonb not null default '{}'
);
select public._add_housekeeping('certificates');

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id),
  asset_id uuid references public.assets (id),
  inspection_id uuid references public.inspections (id),
  finding_id uuid references public.findings (id),
  job_id uuid references public.jobs (id),
  dpr_id uuid references public.dprs (id),
  report_id uuid,
  kind text not null default 'photo' check (kind in ('photo', 'manual', 'drawing', 'datasheet', 'previous_report', 'certificate', 'report_output', 'nameplate', 'other')),
  title text not null default '',
  caption text not null default '',
  file_path text not null,
  mime text not null default 'application/octet-stream',
  size_bytes bigint not null default 0 check (size_bytes between 0 and 52428800),
  taken_at timestamptz,
  lat double precision,
  lng double precision,
  figure_no int,
  sort int not null default 0
);
select public._add_housekeeping('documents');

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id),
  job_id uuid references public.jobs (id),
  template_code text not null,
  number text,
  title text not null default '',
  revision int not null default 0,
  status text not null default 'draft' check (status in ('draft', 'issued', 'revised')),
  config jsonb not null default '{}',
  supersedes_id uuid references public.reports (id),
  docx_path text,
  pdf_path text,
  issued_at timestamptz,
  issued_by uuid
);
select public._add_housekeeping('reports');

-- ---------------------------------------------------------------------------
-- Audit log and conflicts
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid,
  user_email text,
  action text not null,
  table_name text,
  row_id uuid,
  details jsonb not null default '{}'
);
create index if not exists audit_log_at on public.audit_log (at desc);

create table if not exists public.sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  table_name text not null,
  row_id uuid not null,
  field text not null,
  server_value jsonb,
  client_value jsonb,
  server_ts timestamptz,
  client_ts timestamptz,
  kept text not null check (kept in ('server', 'client')),
  resolved boolean not null default false,
  resolved_by uuid,
  resolved_at timestamptz
);
