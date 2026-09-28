-- Google (and other OAuth) sign-ups carry the name as `given_name`/`family_name` or a single
-- `full_name`/`name`, not the `first_name`/`last_name` our email sign-up sets. Read all of
-- them so OAuth customers get a real name on their profile. Additive/backward-compatible.

create or replace function public.signup_name_parts(meta jsonb, out first_name text, out last_name text)
language sql immutable
as $$
  with m as (
    select nullif(trim(coalesce(meta ->> 'full_name', meta ->> 'name', '')), '') as full_name
  )
  select
    coalesce(
      nullif(trim(meta ->> 'first_name'), ''),
      nullif(trim(meta ->> 'given_name'), ''),
      nullif(trim(meta -> 'custom_claims' ->> 'given_name'), ''),
      split_part(m.full_name, ' ', 1)
    ),
    coalesce(
      nullif(trim(meta ->> 'last_name'), ''),
      nullif(trim(meta ->> 'family_name'), ''),
      nullif(trim(meta -> 'custom_claims' ->> 'family_name'), ''),
      nullif(trim(substr(m.full_name, length(split_part(m.full_name, ' ', 1)) + 1)), '')
    )
  from m;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  n record;
begin
  n := public.signup_name_parts(coalesce(new.raw_user_meta_data, '{}'::jsonb));
  insert into public.customer_profiles (id, email, phone, first_name, last_name)
  values (new.id, new.email, new.phone, n.first_name, n.last_name)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Backfill customers who already signed up with Google and have no name yet (never
-- overwrites a name the customer or an admin has set).
update public.customer_profiles p
set first_name = coalesce(p.first_name, n.first_name),
    last_name  = coalesce(p.last_name, n.last_name)
from auth.users u
cross join lateral public.signup_name_parts(coalesce(u.raw_user_meta_data, '{}'::jsonb)) n
where u.id = p.id
  and (p.first_name is null or p.last_name is null)
  and (n.first_name is not null or n.last_name is not null);
