-- NovolosOS 0004: tell the app WHY a login has no employee (inactive vs not linked),
-- and audit skill removals too. Safe on the live database. Run after 0003.

-- After 0003 an inactive employee is invisible to RLS, so the app can't tell
-- "left the company" from "login not linked". This returns only a status word, no data.
create or replace function my_account_status() returns text
language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from employee where auth_user_id = auth.uid()) then 'unlinked'
    when exists (select 1 from employee where auth_user_id = auth.uid() and active) then 'active'
    else 'inactive'
  end
$$;
revoke execute on function my_account_status() from public, anon;
grant  execute on function my_account_status() to authenticated;

-- audit_row() already handles DELETE; 0002 only attached it to UPDATE.
create trigger audit_employee_skill_delete after delete on employee_skill
  for each row execute function audit_row();
