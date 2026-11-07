-- ES-PF v2 · Migration 7: give an existing auth user a role by email.
-- New people are invited through Supabase Auth (dashboard now, Edge Function later);
-- once they have an account the owner grants roles here.

create or replace function public.grant_role_by_email(p_company uuid, p_email text, p_role text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
begin
  perform app.require_perm(p_company, 'users.manage');
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'No account exists for %. Invite the person first.', p_email;
  end if;
  insert into public.user_roles (company_id, user_id, role_code)
  values (p_company, v_user, p_role)
  on conflict do nothing;
  return v_user;
end $$;

revoke execute on function public.grant_role_by_email(uuid, text, text) from public, anon;
grant execute on function public.grant_role_by_email(uuid, text, text) to authenticated;
