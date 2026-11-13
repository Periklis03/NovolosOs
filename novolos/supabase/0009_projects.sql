-- 0009 · Projects, team allocations and role profiles (prototype: Builder → Project / Role,
--        My Profile → Teams & Projects, Capacity → By project)
--
-- What is stored vs. worked out:
--   stored   project.stage = the human decision: pipeline (not won yet) | confirmed | cancelled
--   computed project status from the dates:   upcoming → active → closing (last 30 days) → delivered
--   computed a person's current / future / past projects, from each allocation's dates
--   computed availability: % booked on confirmed projects on a given day, and "free from"
-- Nothing runs on a schedule: the status is worked out every time it is read, so it is never stale.
--
-- Who can do what (same pattern as the rest of the app):
--   admin      everything
--   team lead  sees the projects of the people they lead; edits the projects where they are project lead
--   user       sees their own projects (and the names of their teammates)
--   manager    reads everything, changes nothing (as everywhere else)
--   role profiles: everyone signed in reads them, only admin changes them
-- Every change goes to the audit log. Retiring a skill also updates project stacks and role profiles.

-- ---------- today, in Greek time (Supabase runs in UTC) ----------
create or replace function novolos_today() returns date
language sql stable as $$ select (now() at time zone 'Europe/Athens')::date $$;

-- ---------- tables ----------
create table project (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (btrim(name) <> '' and char_length(name) <= 120),
  client          text check (char_length(client) <= 120),
  description     text check (char_length(description) <= 2000),
  stage           text not null default 'pipeline' check (stage in ('pipeline', 'confirmed', 'cancelled')),
  win_probability int check (win_probability between 0 and 100),
  start_date      date,
  end_date        date,
  project_lead_id uuid references employee(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint project_dates check (end_date is null or start_date is null or end_date >= start_date),
  constraint project_confirmed_start check (stage <> 'confirmed' or start_date is not null)
);
create unique index project_name_unique on project (skill_key(name));

-- required stack: "Java ≥ 4 × 2 people"
create table project_requirement (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references project(id) on delete cascade,
  skill_id   uuid not null references skill(id),
  min_level  int  not null check (min_level between 1 and 5),
  headcount  int  not null default 1 check (headcount between 1 and 50),
  unique (project_id, skill_id)
);

-- who works where, how much, when. A project that has a team can't be deleted (cancel it instead),
-- so the history of who worked where is kept.
create table allocation (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references project(id),
  employee_id uuid not null references employee(id) on delete cascade,
  role_title  text check (char_length(role_title) <= 80),
  percent     int  not null default 100 check (percent between 1 and 100),
  start_date  date not null,
  end_date    date,
  created_at  timestamptz not null default now(),
  constraint allocation_dates check (end_date is null or end_date >= start_date)
);
create index allocation_employee_idx on allocation (employee_id);
create index allocation_project_idx on allocation (project_id);

-- role profiles: "Senior Backend Engineer = Java ≥ 4, Spring Boot ≥ 4, ..."
create table role_profile (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (btrim(name) <> '' and char_length(name) <= 80),
  description   text check (char_length(description) <= 500),
  min_seniority seniority_level,
  created_at    timestamptz not null default now()
);
create unique index role_profile_name_unique on role_profile (skill_key(name));

create table role_profile_skill (
  id              uuid primary key default gen_random_uuid(),
  role_profile_id uuid not null references role_profile(id) on delete cascade,
  skill_id        uuid not null references skill(id),
  min_level       int  not null check (min_level between 1 and 5),
  unique (role_profile_id, skill_id)
);

-- ---------- helpers for the security rules (security definer: they read without the rules,
--            which avoids project ↔ allocation rules calling each other forever) ----------
create or replace function leads_project(_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from project where id = _project and project_lead_id = current_employee_id())
$$;

create or replace function can_see_project(_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select has_role('admin') or has_role('manager')
      or exists (select 1 from project p where p.id = _project and p.project_lead_id = current_employee_id())
      or exists (select 1 from allocation a where a.project_id = _project
                   and (a.employee_id = current_employee_id() or is_lead_of(a.employee_id)))
$$;

-- ---------- security rules ----------
alter table project             enable row level security;
alter table project_requirement enable row level security;
alter table allocation          enable row level security;
alter table role_profile        enable row level security;
alter table role_profile_skill  enable row level security;

create policy project_read   on project for select using (can_see_project(id));
create policy project_insert on project for insert with check (has_role('admin'));
create policy project_update on project for update
  using (has_role('admin') or leads_project(id)) with check (has_role('admin') or leads_project(id));
create policy project_delete on project for delete using (has_role('admin'));

create policy preq_read  on project_requirement for select using (can_see_project(project_id));
create policy preq_write on project_requirement for all
  using (has_role('admin') or leads_project(project_id)) with check (has_role('admin') or leads_project(project_id));

create policy alloc_read on allocation for select using (
  has_role('admin') or has_role('manager') or employee_id = current_employee_id()
  or is_lead_of(employee_id) or leads_project(project_id));
create policy alloc_write on allocation for all
  using (has_role('admin') or leads_project(project_id)) with check (has_role('admin') or leads_project(project_id));

create policy rp_read  on role_profile for select using (auth.uid() is not null);
create policy rp_write on role_profile for all using (has_role('admin')) with check (has_role('admin'));
create policy rps_read  on role_profile_skill for select using (auth.uid() is not null);
create policy rps_write on role_profile_skill for all using (has_role('admin')) with check (has_role('admin'));

-- ---------- guards ----------
-- only an admin hands a project to another lead
create or replace function guard_project() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not has_role('admin')
     and new.project_lead_id is distinct from old.project_lead_id then
    raise exception 'Only an admin can change the project lead.';
  end if;
  return new;
end $$;
create trigger project_guard before update on project
  for each row execute function guard_project();

-- one entry per person per project per period; an entry isn't moved to another person/project
create or replace function guard_allocation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.project_id <> old.project_id or new.employee_id <> old.employee_id) then
    raise exception 'Remove this entry and add a new one instead of moving it to another person or project.';
  end if;
  if exists (select 1 from allocation a
             where a.project_id = new.project_id and a.employee_id = new.employee_id and a.id <> new.id
               and a.start_date <= coalesce(new.end_date, 'infinity'::date)
               and coalesce(a.end_date, 'infinity'::date) >= new.start_date) then
    raise exception 'This person is already on this project for overlapping dates. Change the existing entry instead.';
  end if;
  return new;
end $$;
create trigger allocation_guard before insert or update on allocation
  for each row execute function guard_allocation();

-- retired skills can't go into a stack or a role profile (same rule as profiles, 0008)
create trigger project_requirement_active_skill before insert or update on project_requirement
  for each row execute function guard_active_skill();
create trigger role_profile_skill_active_skill before insert or update on role_profile_skill
  for each row execute function guard_active_skill();

-- a skill can't be retired by hand while profiles, project stacks or role profiles still use it
create or replace function guard_skill_retire() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int; m int;
begin
  if old.active and not new.active and coalesce(current_setting('novolos.retiring', true), '') <> 'on' then
    select count(*) into n from employee_skill where skill_id = new.id;
    if n > 0 then
      raise exception '% still % "%". Use Retire in Admin → Taxonomy to remove it from them or move them to another skill.',
        case when n = 1 then '1 person' else n || ' people' end, case when n = 1 then 'has' else 'have' end, new.name;
    end if;
    select (select count(*) from project_requirement where skill_id = new.id)
         + (select count(*) from role_profile_skill where skill_id = new.id) into m;
    if m > 0 then
      raise exception '"%" is still used in project stacks or role profiles. Use Retire in Admin → Taxonomy.', new.name;
    end if;
  end if;
  return new;
end $$;

-- ---------- audit log ----------
create trigger audit_project after insert or update or delete on project
  for each row execute function audit_row();
create trigger audit_project_requirement after insert or update or delete on project_requirement
  for each row execute function audit_row();
create trigger audit_allocation after insert or update or delete on allocation
  for each row execute function audit_row();
create trigger audit_role_profile after insert or update or delete on role_profile
  for each row execute function audit_row();
create trigger audit_role_profile_skill after insert or update or delete on role_profile_skill
  for each row execute function audit_row();

-- ---------- computed status (read through these views; the security rules still apply) ----------
create view project_overview with (security_invoker = true) as
select p.*,
  case
    when p.stage = 'cancelled' then 'cancelled'
    when p.stage = 'pipeline' then 'pipeline'
    when novolos_today() < p.start_date then 'upcoming'
    when p.end_date < novolos_today() then 'delivered'
    when p.end_date - novolos_today() <= 30 then 'closing'
    else 'active'
  end as status
from project p;

create view allocation_overview with (security_invoker = true) as
select a.*, p.name as project_name, p.client, p.stage, p.status as project_status,
  case
    when a.start_date > novolos_today() then 'future'
    when a.end_date < novolos_today() then 'past'
    else 'current'
  end as timing
from allocation a
join project_overview p on p.id = a.project_id;

-- Availability on a day (default today), for everyone the caller is allowed to see.
--   load       % booked on confirmed projects that day
--   tentative  % on pipeline projects that day (shown, not counted)
--   free_from  when load is 100%+: the first day it drops below 100% (null = no end date yet)
create or replace function availability(_on date default null)
returns table (employee_id uuid, load int, tentative int, free_from date)
language sql stable as $$
  with d as (select coalesce(_on, novolos_today()) as day),
  booked as (
    select a.employee_id, a.percent, p.stage
    from allocation a join project p on p.id = a.project_id, d
    where p.stage <> 'cancelled' and a.start_date <= d.day and (a.end_date is null or a.end_date >= d.day)
  ),
  totals as (
    select e.id,
      coalesce(sum(b.percent) filter (where b.stage = 'confirmed'), 0)::int as load,
      coalesce(sum(b.percent) filter (where b.stage = 'pipeline'), 0)::int as tentative
    from employee e left join booked b on b.employee_id = e.id
    where e.active
    group by e.id
  )
  select t.id, t.load, t.tentative,
    case when t.load < 100 then null else (
      select min(c.day) from (
        select x.end_date + 1 as day
        from allocation x join project px on px.id = x.project_id, d
        where x.employee_id = t.id and px.stage = 'confirmed' and x.end_date >= d.day
      ) c
      where (select coalesce(sum(y.percent), 0)
             from allocation y join project py on py.id = y.project_id
             where y.employee_id = t.id and py.stage = 'confirmed'
               and y.start_date <= c.day and (y.end_date is null or y.end_date >= c.day)) < 100
    ) end
  from totals t
$$;

-- Teammates on a project the caller can see: names and roles only (no skills, no percentages),
-- so a user can see who they work with without opening everyone's profile.
create or replace function project_team(_project uuid)
returns table (employee_id uuid, full_name text, job_title text, project_role text,
               start_date date, end_date date, timing text)
language sql stable security definer set search_path = public as $$
  select e.id, e.full_name, e.role_title, a.role_title, a.start_date, a.end_date,
    case when a.start_date > novolos_today() then 'future'
         when a.end_date < novolos_today() then 'past' else 'current' end
  from allocation a join employee e on e.id = a.employee_id
  where a.project_id = _project and e.active and can_see_project(_project)
  order by e.full_name
$$;

revoke execute on function availability(date) from public, anon;
revoke execute on function project_team(uuid) from public, anon;
grant execute on function availability(date) to authenticated;
grant execute on function project_team(uuid) to authenticated;

-- ---------- retiring a skill also updates project stacks and role profiles ----------
-- (same function as 0008, plus the two new places a skill can be used)
create or replace function retire_skill(_skill uuid, _move_to uuid default null) returns text
language plpgsql security definer set search_path = public as $$
declare s skill; t skill; r employee_skill; k employee_skill;
        q project_requirement; q2 project_requirement; rs role_profile_skill; rs2 role_profile_skill;
        removed int := 0; moved int := 0; kept_other int := 0; total int := 0;
        stacks int := 0; roles int := 0;
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

  perform set_config('novolos.retiring', 'on', true);

  -- 1. people (unchanged from 0008)
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

  -- 2. project stacks: move (keeping the stricter level and the larger headcount) or remove
  for q in select * from project_requirement where skill_id = _skill loop
    stacks := stacks + 1;
    if _move_to is null then
      delete from project_requirement where id = q.id;
    else
      select * into q2 from project_requirement where project_id = q.project_id and skill_id = _move_to;
      if not found then
        update project_requirement set skill_id = _move_to where id = q.id;
      else
        update project_requirement set min_level = greatest(q.min_level, q2.min_level),
                                       headcount = greatest(q.headcount, q2.headcount) where id = q2.id;
        delete from project_requirement where id = q.id;
      end if;
    end if;
  end loop;

  -- 3. role profiles: move (keeping the stricter level) or remove
  for rs in select * from role_profile_skill where skill_id = _skill loop
    roles := roles + 1;
    if _move_to is null then
      delete from role_profile_skill where id = rs.id;
    else
      select * into rs2 from role_profile_skill where role_profile_id = rs.role_profile_id and skill_id = _move_to;
      if not found then
        update role_profile_skill set skill_id = _move_to where id = rs.id;
      else
        update role_profile_skill set min_level = greatest(rs.min_level, rs2.min_level) where id = rs2.id;
        delete from role_profile_skill where id = rs.id;
      end if;
    end if;
  end loop;

  update skill set active = false where id = _skill;
  perform set_config('novolos.retiring', 'off', true);

  insert into audit_log(actor_id, action, entity_type, entity_id, before, after)
  values (current_employee_id(), 'skill.retire', 'skill', _skill, to_jsonb(s),
          jsonb_build_object('name', s.name, 'moved_to', t.name, 'removed', removed,
                             'moved', moved, 'had_both', kept_other, 'people', total,
                             'project_stacks', stacks, 'role_profiles', roles));

  return case when _move_to is null
    then format('"%s" retired and removed from %s %s', s.name, removed, case when removed = 1 then 'profile' else 'profiles' end)
    else format('"%s" retired; %s %s moved to "%s"%s', s.name, total,
                case when total = 1 then 'person' else 'people' end, t.name,
                case when kept_other > 0 then format(' (%s already had it: the higher validated level was kept)', kept_other) else '' end)
  end
  || case when stacks + roles = 0 then '.'
          else format('. Also updated in %s project %s and %s role %s.',
                      stacks, case when stacks = 1 then 'stack' else 'stacks' end,
                      roles, case when roles = 1 then 'profile' else 'profiles' end) end;
end $$;

revoke execute on function retire_skill(uuid, uuid) from public, anon;
grant  execute on function retire_skill(uuid, uuid) to authenticated;
