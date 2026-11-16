-- Sign-in for the Neon + Cloudflare hosting (replaces Supabase Auth).
-- Tables created exactly as Better Auth generates them for pf/api/src/auth-options.ts
-- (pf/api/scripts/gen-auth-schema.ts). Passwords are hashed by Better Auth; TOTP secrets are encrypted by it.
--
-- Nothing here is reachable through the data API: every grant is revoked from the API roles and RLS is on
-- with no policy. Only the Worker's sign-in code (database owner) touches these tables.
-- Every sign-in user is mirrored into auth.users, which the rest of the schema references.

create table public.auth_user ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null, "twoFactorEnabled" boolean);
create table public.auth_session ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" uuid not null references public.auth_user ("id") on delete cascade);
create table public.auth_account ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "accountId" text not null, "providerId" text not null, "userId" uuid not null references public.auth_user ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);
create table public.auth_verification ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);
create table public.auth_two_factor ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "secret" text not null, "backupCodes" text not null, "userId" uuid not null references public.auth_user ("id") on delete cascade, "verified" boolean, "failedVerificationCount" integer, "lockedUntil" timestamptz);
create index "auth_session_userId_idx" on public.auth_session ("userId");
create index "auth_account_userId_idx" on public.auth_account ("userId");
create index "auth_verification_identifier_idx" on public.auth_verification ("identifier");
create index "auth_two_factor_secret_idx" on public.auth_two_factor ("secret");
create index "auth_two_factor_userId_idx" on public.auth_two_factor ("userId");

do $$
declare t text;
begin
  foreach t in array array['auth_user', 'auth_session', 'auth_account', 'auth_verification', 'auth_two_factor'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
  end loop;
end $$;

-- Mirror sign-in users into auth.users (profile, roles and audit refer to it).
create or replace function app.sync_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (new.id, lower(new.email), jsonb_build_object('full_name', new.name))
  on conflict (id) do update set email = excluded.email,
    raw_user_meta_data = auth.users.raw_user_meta_data || excluded.raw_user_meta_data;
  return new;
end $$;

create trigger sync_auth_user after insert or update of email, name on public.auth_user
  for each row execute function app.sync_auth_user();
