-- ── Fix: "Database error saving new user" (500 on signup) ────────────────────
-- The original handle_new_user() trigger referenced `user_profiles` unqualified
-- and without a fixed search_path. Auth triggers run as supabase_auth_admin in a
-- context where `public` is not on the search path, so the insert failed and the
-- whole signup transaction rolled back with a 500.
--
-- Fix: pin search_path, fully-qualify the table, and no-op on conflict so a retry
-- can never fail. Run this in the Supabase SQL Editor.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Recreate the trigger to be safe (idempotent).
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Ensure the auth admin role can write to the profiles table via the
-- security-definer function's owner. (No-op if already granted.)
grant usage on schema public to supabase_auth_admin;
grant insert on table public.user_profiles to supabase_auth_admin;
