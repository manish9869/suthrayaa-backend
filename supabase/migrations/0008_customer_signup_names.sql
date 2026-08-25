-- Email/password sign-up now collects first/last name via auth user metadata; capture it
-- into customer_profiles on creation so the admin customer list shows real names instead
-- of "Unnamed". Additive/backward-compatible: falls back to null when metadata is absent
-- (Google OAuth, admin-created users), same as before.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.customer_profiles (id, email, phone, first_name, last_name)
  values (
    new.id,
    new.email,
    new.phone,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
