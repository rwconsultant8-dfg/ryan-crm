begin;

create or replace function public.can_view_team_calendar()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles
     where id = (select auth.uid())
       and active
       and role = 'admin'
       and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.lower(pg_catalog.btrim(email)), 'UTF8')), 'hex')
           = 'f48677665bae2da62f30a0039c2fa90f777b5da4af4a36601a2d55a19b40cc0f'
  );
$$;

revoke all on function public.can_view_team_calendar() from public, anon;
grant execute on function public.can_view_team_calendar() to authenticated;

alter policy activity_days_select on public.activity_days
  using (
    (owner_id = (select auth.uid()) and (select public.is_active_user()))
    or (select public.can_view_team_calendar())
  );

commit;
