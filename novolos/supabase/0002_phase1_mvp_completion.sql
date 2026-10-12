-- NovolosOS Phase 1 MVP completion: audit log, taxonomy governance,
-- HRIS import, people search, aggregate skill map. Run after 0001.

-- ---------- employee additions (HRIS fields) ----------
alter table employee add column email   text unique;
alter table employee add column left_at date;

-- Auto-link a new Supabase login to the employee with the same email
create function link_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update employee set auth_user_id = new.id
   where lower(email) = lower(new.email) and auth_user_id is null;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function link_auth_user();

-- ---------- audit log (append-only, doc §4.3 / §12) ----------
create table audit_log (
  id          bigserial primary key,
  actor_id    uuid,
  action      text not null,
  entity_type text not null,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  at          timestamptz default now()
);
alter table audit_log enable row level security;
create policy audit_read on audit_log for select using (has_role('admin'));
-- no insert/update/delete policies: only the security-definer triggers below can write

create function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare _action text; _entity uuid;
begin
  if tg_table_name = 'employee_skill' then
    if tg_op = 'UPDATE' and new.validated_level is not distinct from old.validated_level then
      return new;                                   -- only log validation changes
    end if;
    _action := 'employee_skill.' || case when tg_op='DELETE' then 'delete' else 'validate' end;
  else
    _action := tg_table_name || '.' || lower(tg_op);
  end if;
  _entity := coalesce(case when tg_op='DELETE' then old.id else new.id end, null);
  insert into audit_log(actor_id, action, entity_type, entity_id, before, after)
  values (current_employee_id(), _action, tg_table_name, _entity,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create trigger audit_employee_skill after update on employee_skill
  for each row execute function audit_row();
create trigger audit_app_role after insert or update or delete on app_role
  for each row execute function audit_row();

-- ---------- taxonomy governance: propose-a-skill (doc §14 #4) ----------
create table skill_proposal (
  id          uuid primary key default gen_random_uuid(),
  proposed_by uuid not null references employee(id),
  category_id uuid references skill_category(id),
  name        text not null,
  note        text,
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by  uuid references employee(id),
  decided_at  timestamptz,
  created_at  timestamptz default now()
);
alter table skill_proposal enable row level security;
create policy sp_read on skill_proposal for select using (
  proposed_by = current_employee_id() or has_role('admin') or has_role('manager'));
create policy sp_insert on skill_proposal for insert with check (
  proposed_by = current_employee_id() and status = 'pending');
create policy sp_admin_update on skill_proposal for update
  using (has_role('admin')) with check (has_role('admin'));

create function approve_skill_proposal(_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare p skill_proposal; _skill uuid;
begin
  if not has_role('admin') then raise exception 'Admin only'; end if;
  select * into p from skill_proposal where id = _id and status = 'pending';
  if not found then raise exception 'Proposal not found or already decided'; end if;
  if p.category_id is null then raise exception 'Set a category before approving'; end if;
  insert into skill(category_id, name) values (p.category_id, p.name)
    on conflict (category_id, name) do update set active = true returning id into _skill;
  update skill_proposal set status='approved', decided_by=current_employee_id(), decided_at=now()
   where id = _id;
  return _skill;
end $$;

-- ---------- HRIS import (idempotent upsert on hris_id, doc §9) ----------
create table hris_sync_run (
  id            bigserial primary key,
  source        text not null default 'csv',
  started_at    timestamptz default now(),
  finished_at   timestamptz,
  status        text default 'running' check (status in ('running','ok','failed')),
  rows_seen     int default 0,
  rows_upserted int default 0,
  error         text
);
alter table hris_sync_run enable row level security;
create policy hris_run_read on hris_sync_run for select using (has_role('admin'));

-- payload: [{hris_id, full_name, email, role_title, function, seniority,
--            years_experience, education, active, left_at}, ...]
create function hris_import(_rows jsonb, _source text default 'csv') returns bigint
language plpgsql security definer set search_path = public as $$
declare _run bigint; r jsonb; _n int := 0;
begin
  if not has_role('admin') then raise exception 'Admin only'; end if;
  insert into hris_sync_run(source, rows_seen) values (_source, jsonb_array_length(_rows))
    returning id into _run;
  begin
    for r in select * from jsonb_array_elements(_rows) loop
      insert into employee (hris_id, full_name, email, role_title, function, seniority,
                            years_experience, education, active, left_at)
      values (r->>'hris_id', r->>'full_name', nullif(r->>'email',''), r->>'role_title',
              coalesce(nullif(r->>'function','')::org_function, 'engineering'),
              nullif(r->>'seniority','')::seniority_level,
              nullif(r->>'years_experience','')::numeric, r->>'education',
              coalesce((r->>'active')::boolean, true), nullif(r->>'left_at','')::date)
      on conflict (hris_id) do update set
        full_name = excluded.full_name, email = excluded.email, role_title = excluded.role_title,
        function = excluded.function, seniority = excluded.seniority,
        years_experience = excluded.years_experience, education = excluded.education,
        active = excluded.active, left_at = excluded.left_at, updated_at = now();
      _n := _n + 1;
    end loop;
    update hris_sync_run set status='ok', finished_at=now(), rows_upserted=_n where id=_run;
  exception when others then
    update hris_sync_run set status='failed', finished_at=now(), error=sqlerrm where id=_run;
    raise;
  end;
  return _run;
end $$;

-- ---------- Ask: who knows what / People & Skills search ----------
-- SECURITY INVOKER: RLS on employee/employee_skill decides who sees which rows.
create function search_people(_q text default null, _skill uuid default null, _min_level int default 1)
returns table (employee_id uuid, full_name text, role_title text, seniority seniority_level,
               years_experience numeric, skill_level int, self_level int)
language sql stable as $$
  select e.id, e.full_name, e.role_title, e.seniority, e.years_experience,
         es.validated_level, es.self_level
  from employee e
  left join employee_skill es on es.employee_id = e.id and es.skill_id = _skill
  where e.active
    and (_q is null or e.full_name ilike '%'||_q||'%' or e.role_title ilike '%'||_q||'%')
    and (_skill is null or coalesce(es.validated_level,0) >= _min_level)
  order by es.validated_level desc nulls last, e.full_name
$$;

-- Aggregate skill map for everyone: counts only, no names (doc §5.2 fn.1)
create function skill_map() returns table (skill_id uuid, skill text, category text,
                                           holders int, avg_level numeric)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, c.name, count(es.id)::int, round(avg(es.validated_level),1)
  from skill s join skill_category c on c.id = s.category_id
  left join employee_skill es on es.skill_id = s.id and es.validated_level > 0
  where s.active group by s.id, s.name, c.name, c.sort_order
  order by c.sort_order, s.name
$$;

-- Data-quality signal for HR (doc §12): share of skills still unvalidated
create function unvalidated_rate() returns numeric
language sql stable security definer set search_path = public as $$
  select case when not (has_role('admin') or has_role('manager')) then null
         else round(100.0 * count(*) filter (where validated_level is null) / nullif(count(*),0), 1) end
  from employee_skill
$$;
