-- Swaps the admin account from amit21aim@gmail.com to
-- kuldeepsinghmankotia@gmail.com per explicit user request, and makes it
-- durable rather than a one-time flip: handle_new_user() (the trigger that
-- creates a profiles row whenever a new auth.users row appears — see
-- 20260803210934_init_schema.sql) now grants 'admin' automatically to this
-- specific email at signup time, so this stays the admin even if the
-- profile row is ever recreated, and works correctly whether this account
-- has already signed up or signs up for the first time later.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (
    new.id,
    new.email,
    case
      when new.email = 'kuldeepsinghmankotia@gmail.com' then 'admin'
      else 'user'
    end
  );
  return new;
end;
$$;

-- Promotes the new admin immediately if the account already exists, and
-- demotes the previous one — a plain UPDATE, not routed through the
-- self-promotion-blocking trigger's restriction (that trigger only blocks
-- authenticated-role callers, see prevent_self_role_escalation() in
-- 20260807175704_admin_system_prompt.sql; this migration runs outside any
-- request context, same as that migration's own bootstrap UPDATE).
update public.profiles set role = 'admin' where email = 'kuldeepsinghmankotia@gmail.com';
update public.profiles set role = 'user' where email = 'amit21aim@gmail.com';
