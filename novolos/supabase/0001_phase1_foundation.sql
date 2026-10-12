-- NovolosOS Phase 1 foundation: taxonomy, employees, skills, roles, RLS.
-- Run in Supabase SQL editor (or `supabase db push`). Based on Technical Design Doc §4-§5.

create extension if not exists pgcrypto;

create type org_function    as enum ('engineering','product','design','other');
create type seniority_level as enum ('junior','mid','senior','lead','principal');
create type app_role_name   as enum ('admin','manager','team_lead','user','sales');
create type decay_class     as enum ('slow','medium','fast');

-- People. auth_user_id links a Supabase login to an employee row.
-- lead_id is a Phase-1 shortcut for "who validates my skills";
-- Phase 2 replaces it with allocation + project_ownership (doc §5.3).
create table employee (
  id               uuid primary key default gen_random_uuid(),
  auth_user_id     uuid unique references auth.users(id) on delete set null,
  hris_id          text unique,
  full_name        text not null,
  role_title       text,
  function         org_function default 'engineering',
  seniority        seniority_level,
  years_experience numeric(3,1),
  education        text,
  lead_id          uuid references employee(id),
  active           boolean default true,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

create table skill_category (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  sort_order int default 0
);

create table skill (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references skill_category(id),
  name        text not null,
  decay       decay_class default 'medium',
  active      boolean default true,
  unique (category_id, name)
);

create table employee_skill (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references employee(id) on delete cascade,
  skill_id        uuid not null references skill(id),
  self_level      int check (self_level between 0 and 5),
  validated_level int check (validated_level between 0 and 5),
  validated_by    uuid references employee(id),
  validated_at    timestamptz,
  willing         boolean default true,
  wants_to_learn  boolean default false,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  unique (employee_id, skill_id)
);

create table app_role (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee(id) on delete cascade,
  role        app_role_name not null,
  unique (employee_id, role)
);

create index on employee_skill (skill_id, validated_level);
create index on employee_skill (employee_id);
create index on employee (lead_id);
create index on employee using gin (to_tsvector('simple', full_name || ' ' || coalesce(role_title,'')));

-- ---------- helper functions (security definer so they bypass RLS safely) ----------
create function current_employee_id() returns uuid
language sql stable security definer set search_path = public as
$$ select id from employee where auth_user_id = auth.uid() $$;

create function has_role(_role app_role_name) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from app_role
                  where employee_id = current_employee_id() and role = _role) $$;

create function is_lead_of(_employee uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from employee
                  where id = _employee and lead_id = current_employee_id()) $$;

-- Aggregate for plain users: a count, no names (doc §5.2 footnote 1).
create function skill_holder_count(_skill uuid, _min_level int) returns int
language sql stable security definer set search_path = public as
$$ select count(*)::int from employee_skill
   where skill_id = _skill and validated_level >= _min_level $$;

-- ---------- row-level security ----------
alter table employee       enable row level security;
alter table skill_category enable row level security;
alter table skill          enable row level security;
alter table employee_skill enable row level security;
alter table app_role       enable row level security;

-- employee: see yourself, your team, or everyone if admin/manager
create policy emp_read on employee for select using (
  id = current_employee_id() or has_role('admin') or has_role('manager') or is_lead_of(id));
create policy emp_admin_write on employee for all
  using (has_role('admin')) with check (has_role('admin'));

-- taxonomy: everyone signed in reads, only admin writes
create policy cat_read  on skill_category for select using (auth.uid() is not null);
create policy cat_write on skill_category for all using (has_role('admin')) with check (has_role('admin'));
create policy skill_read  on skill for select using (auth.uid() is not null);
create policy skill_write on skill for all using (has_role('admin')) with check (has_role('admin'));

-- employee_skill
create policy es_read on employee_skill for select using (
  employee_id = current_employee_id() or has_role('admin') or has_role('manager') or is_lead_of(employee_id));
create policy es_insert on employee_skill for insert with check (
  employee_id = current_employee_id() or has_role('admin'));
create policy es_update on employee_skill for update
  using      (employee_id = current_employee_id() or has_role('admin') or is_lead_of(employee_id))
  with check (employee_id = current_employee_id() or has_role('admin') or is_lead_of(employee_id));
create policy es_delete on employee_skill for delete using (
  employee_id = current_employee_id() or has_role('admin'));

-- app_role: see your own, admin manages all
create policy role_read  on app_role for select using (
  employee_id = current_employee_id() or has_role('admin'));
create policy role_write on app_role for all using (has_role('admin')) with check (has_role('admin'));

-- Only admin or the employee's lead may set validated_* ; stamps who/when.
create function guard_validation() returns trigger language plpgsql as $$
declare can_validate boolean := auth.uid() is null   -- SQL editor / server-side key: trusted
                              or has_role('admin') or is_lead_of(new.employee_id);
begin
  if tg_op = 'INSERT' then
    if new.validated_level is not null and not can_validate then
      raise exception 'Only admin or team lead can set validated_level';
    end if;
  elsif new.validated_level is distinct from old.validated_level then
    if not can_validate then
      raise exception 'Only admin or team lead can set validated_level';
    end if;
    new.validated_by := current_employee_id();
    new.validated_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger employee_skill_guard before insert or update on employee_skill
  for each row execute function guard_validation();
