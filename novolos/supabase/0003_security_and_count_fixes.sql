-- NovolosOS 0003: security + count fixes found in the end-to-end test (2026-10).
-- Safe to run on the live database: only replaces functions and grants, no data is changed.
-- Run once in Supabase SQL Editor, after 0001 and 0002.

-- 1+2. Validation guard: a row can't move to another skill/person, and only the
--      database stamps validated_by / validated_at.
create or replace function guard_validation() returns trigger language plpgsql as $$
declare can_validate boolean := auth.uid() is null   -- SQL editor / server-side key: trusted
                              or has_role('admin') or is_lead_of(new.employee_id);
begin
  if tg_op = 'INSERT' then
    if new.validated_level is not null and not can_validate then
      raise exception 'Only admin or team lead can set validated_level';
    end if;
    new.validated_by := case when new.validated_level is null then null else current_employee_id() end;
    new.validated_at := case when new.validated_level is null then null else now() end;
  else
    if (new.skill_id is distinct from old.skill_id or new.employee_id is distinct from old.employee_id)
       and not (auth.uid() is null or has_role('admin')) then
      raise exception 'Skill or employee of an existing row cannot be changed; remove it and add a new one';
    end if;
    if new.validated_level is distinct from old.validated_level then
      if not can_validate then
        raise exception 'Only admin or team lead can set validated_level';
      end if;
      new.validated_by := current_employee_id();
      new.validated_at := now();
    else
      new.validated_by := old.validated_by;
      new.validated_at := old.validated_at;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- 3. Leavers lose access: every RLS policy goes through current_employee_id(),
--    so an inactive employee is treated as "not linked" from the next request.
create or replace function current_employee_id() returns uuid
language sql stable security definer set search_path = public as
$$ select id from employee where auth_user_id = auth.uid() and active $$;

-- 4. Counts include only current staff (matches the names search_people shows).
create or replace function skill_holder_count(_skill uuid, _min_level int) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int
  from employee_skill es
  join employee e on e.id = es.employee_id and e.active
  where es.skill_id = _skill and es.validated_level >= _min_level
$$;

create or replace function skill_map() returns table (skill_id uuid, skill text, category text,
                                                       holders int, avg_level numeric)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, c.name, count(es.id)::int, round(avg(es.validated_level),1)
  from skill s join skill_category c on c.id = s.category_id
  left join (employee_skill es join employee e on e.id = es.employee_id and e.active)
         on es.skill_id = s.id and es.validated_level > 0
  where s.active
  group by s.id, s.name, c.name, c.sort_order
  order by c.sort_order, s.name
$$;

create or replace function unvalidated_rate() returns numeric
language sql stable security definer set search_path = public as $$
  select case when not (has_role('admin') or has_role('manager')) then null
         else round(100.0 * count(*) filter (where es.validated_level is null) / nullif(count(*),0), 1) end
  from employee_skill es
  join employee e on e.id = es.employee_id and e.active
$$;

-- 5. Skill counts only for signed-in users (were callable with just the public anon key).
revoke execute on function skill_map()                    from public, anon;
revoke execute on function skill_holder_count(uuid, int)  from public, anon;
revoke execute on function unvalidated_rate()             from public, anon;
grant  execute on function skill_map()                    to authenticated;
grant  execute on function skill_holder_count(uuid, int)  to authenticated;
grant  execute on function unvalidated_rate()             to authenticated;
