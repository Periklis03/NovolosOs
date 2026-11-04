-- NovolosOS 0008: rules behind Admin → Taxonomy. Safe on the live database. Run after 0007.
-- Goal: a skill is never left behind on someone's profile.
--  * Renaming needs nothing special: profiles point to the skill's id, so they show the new name.
--  * Retiring must say what happens to the people who have the skill: remove it from their
--    profiles, or move them to another skill. A plain "active = false" is refused while
--    anyone still has the skill (also via SQL Editor/API), and nobody can add a retired skill.
--  * Every change to skills and categories is written to the audit log.

-- 1. Audit every add / rename / category change / retire / reactivate of skills and categories.
--    (skipped while retire_skill runs: it writes one summary line with the counts instead)
create trigger audit_skill after insert or update or delete on skill
  for each row when (coalesce(current_setting('novolos.retiring', true), '') <> 'on')
  execute function audit_row();
create trigger audit_skill_category after insert or update or delete on skill_category
  for each row execute function audit_row();

-- 2. A skill can't be retired while people still have it, except through retire_skill().
create or replace function guard_skill_retire() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if old.active and not new.active and coalesce(current_setting('novolos.retiring', true), '') <> 'on' then
    select count(*) into n from employee_skill where skill_id = new.id;
    if n > 0 then
      raise exception '% still % "%". Use Retire in Admin → Taxonomy to remove it from them or move them to another skill.',
        case when n = 1 then '1 person' else n || ' people' end, case when n = 1 then 'has' else 'have' end, new.name;
    end if;
  end if;
  return new;
end $$;
create trigger skill_retire_guard before update on skill
  for each row execute function guard_skill_retire();

-- 3. Nobody can put a retired skill on a profile (adding it, or moving a row onto it).
create or replace function guard_active_skill() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT' or new.skill_id is distinct from old.skill_id)
     and not exists (select 1 from skill where id = new.skill_id and active) then
    raise exception 'This skill has been retired and can no longer be added.';
  end if;
  return new;
end $$;
create trigger employee_skill_active_skill before insert or update on employee_skill
  for each row execute function guard_active_skill();

-- 4. Retire a skill and deal with everyone who has it, in one step.
--    _move_to null  → the skill is removed from every profile (each removal is audited).
--    _move_to = id  → everyone is moved to that skill; if a person already has it, the row
--                     with the higher validated level is kept (the other is removed).
create or replace function retire_skill(_skill uuid, _move_to uuid default null) returns text
language plpgsql security definer set search_path = public as $$
declare s skill; t skill; r employee_skill; k employee_skill;
        removed int := 0; moved int := 0; kept_other int := 0; total int := 0;
begin
  if not (auth.uid() is null or has_role('admin')) then raise exception 'Admin only'; end if;
  select * into s from skill where id = _skill;
  if not found then raise exception 'Skill not found'; end if;
  if not s.active then raise exception '"%" is already retired.', s.name; end if;
  if _move_to is not null then
    if _move_to = _skill then raise exception 'Choose a different skill to move people to.'; end if;
    select * into t from skill where id = _move_to;
    if not found then raise exception 'Target skill not found'; end if;
    if not t.active then raise exception '"%" is retired; choose an active skill.', t.name; end if;
  end if;

  perform set_config('novolos.retiring', 'on', true);   -- lets step 2 allow this retire

  for r in select * from employee_skill where skill_id = _skill loop
    total := total + 1;
    if _move_to is null then
      delete from employee_skill where id = r.id;
      removed := removed + 1;
    else
      select * into k from employee_skill where employee_id = r.employee_id and skill_id = _move_to;
      if not found then
        update employee_skill set skill_id = _move_to where id = r.id;
        moved := moved + 1;
      elsif coalesce(r.validated_level, -1) > coalesce(k.validated_level, -1) then
        delete from employee_skill where id = k.id;
        update employee_skill set skill_id = _move_to where id = r.id;
        moved := moved + 1; kept_other := kept_other + 1;
      else
        delete from employee_skill where id = r.id;
        kept_other := kept_other + 1;
      end if;
    end if;
  end loop;

  update skill set active = false where id = _skill;
  perform set_config('novolos.retiring', 'off', true);

  -- one summary line in the audit log (moves don't change a validated level, so they would
  -- not be logged one by one)
  insert into audit_log(actor_id, action, entity_type, entity_id, before, after)
  values (current_employee_id(), 'skill.retire', 'skill', _skill, to_jsonb(s),
          jsonb_build_object('name', s.name, 'moved_to', t.name, 'removed', removed,
                             'moved', moved, 'had_both', kept_other, 'people', total));

  return case when _move_to is null
    then format('"%s" retired and removed from %s %s.', s.name, removed, case when removed = 1 then 'profile' else 'profiles' end)
    else format('"%s" retired; %s %s moved to "%s"%s.', s.name, total,
                case when total = 1 then 'person' else 'people' end, t.name,
                case when kept_other > 0 then format(' (%s already had it: the higher validated level was kept)', kept_other) else '' end)
  end;
end $$;

revoke execute on function retire_skill(uuid, uuid) from public, anon;
grant  execute on function retire_skill(uuid, uuid) to authenticated;
