-- NovolosOS 0006: safety rails for the Admin → Users screen. Safe on the live database.
-- Run after 0005. Policies need no change: admins can already write employee and app_role.

-- 1. Audit team-lead and active/inactive changes (who moved whom, who deactivated whom).
--    Only these two columns are logged, so routine HRIS updates don't flood the log.
create trigger audit_employee_lead_active after update on employee
  for each row
  when (old.lead_id is distinct from new.lead_id or old.active is distinct from new.active)
  execute function audit_row();

-- 2. Nobody can be their own team lead.
alter table employee add constraint employee_lead_not_self check (lead_id is null or lead_id <> id);

-- 3. An admin can't lock themselves out: no removing your own admin role,
--    no deactivating yourself. (SQL editor / service key is still allowed.)
create function guard_self_lockout() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return coalesce(new, old); end if;   -- SQL editor: trusted
  if tg_table_name = 'app_role' then
    if old.role = 'admin' and old.employee_id = current_employee_id()
       and (tg_op = 'DELETE' or new.role is distinct from 'admin') then
      raise exception 'You cannot remove your own admin role. Ask another admin.';
    end if;
  elsif tg_table_name = 'employee' then
    if old.id = current_employee_id() and old.active and not new.active then
      raise exception 'You cannot deactivate your own account.';
    end if;
  end if;
  return coalesce(new, old);
end $$;

create trigger app_role_self_lockout before update or delete on app_role
  for each row execute function guard_self_lockout();
create trigger employee_self_lockout before update on employee
  for each row execute function guard_self_lockout();
