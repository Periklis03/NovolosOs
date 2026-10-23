-- NovolosOS 0007: no duplicate skills.
-- One skill per name across the whole taxonomy, ignoring capitals and extra spaces
-- ("PostgreSQL", "postgresql", " PostgreSQL " are the same). A proposal for a skill that
-- already exists, or that someone already proposed, is refused with a clear message.
-- Safe on the live database. Run after 0006.

-- The comparison key: trimmed, single spaces, lower case.
create or replace function skill_key(_name text) returns text
language sql immutable as $$ select lower(regexp_replace(btrim(_name), '\s+', ' ', 'g')) $$;

-- 1. Stop with a readable message if the live data already has duplicates
--    (the unique index below could not be created otherwise).
do $$
declare dups text;
begin
  select string_agg(names, '; ') into dups from (
    select string_agg(s.name || ' (' || c.name || ')', ', ') as names
    from skill s join skill_category c on c.id = s.category_id
    group by skill_key(s.name) having count(*) > 1) d;
  if dups is not null then
    raise exception 'Duplicate skills already exist: %. Merge or rename them first, then run 0007 again.', dups;
  end if;
end $$;

-- 2. One skill per name, company-wide (also protects direct SQL/API inserts and renames).
create unique index skill_name_unique on skill (skill_key(name));

-- 3. Proposals: tidy the name, refuse existing skills and duplicate pending proposals.
--    SECURITY DEFINER so it also sees other people's pending proposals.
create or replace function guard_skill_proposal() returns trigger
language plpgsql security definer set search_path = public as $$
declare existing record;
begin
  new.name := regexp_replace(btrim(new.name), '\s+', ' ', 'g');
  if new.name = '' then raise exception 'Enter a skill name.'; end if;

  select s.name, s.active, c.name as category into existing
  from skill s join skill_category c on c.id = s.category_id
  where skill_key(s.name) = skill_key(new.name);
  if found then
    if existing.active then
      raise exception '"%" already exists (category %). Add it from the list instead.', existing.name, existing.category;
    else
      raise exception '"%" exists but has been retired by HR. Ask HR if it should come back.', existing.name;
    end if;
  end if;

  if exists (select 1 from skill_proposal
             where status = 'pending' and skill_key(name) = skill_key(new.name)
               and id is distinct from new.id) then
    raise exception '"%" has already been proposed and is waiting for HR approval.', new.name;
  end if;
  return new;
end $$;

create trigger skill_proposal_guard before insert on skill_proposal
  for each row execute function guard_skill_proposal();

-- 4. Approving: never create a duplicate. Proposals made before 0007 may still point
--    at an existing skill; the admin gets a clear message and can reject them.
create or replace function approve_skill_proposal(_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare p skill_proposal; _skill uuid; existing record;
begin
  if not has_role('admin') then raise exception 'Admin only'; end if;
  select * into p from skill_proposal where id = _id and status = 'pending';
  if not found then raise exception 'Proposal not found or already decided'; end if;
  if p.category_id is null then raise exception 'Set a category before approving'; end if;

  select s.id, s.name, c.name as category into existing
  from skill s join skill_category c on c.id = s.category_id
  where skill_key(s.name) = skill_key(p.name);
  if found then
    raise exception '"%" already exists (category %). Reject this proposal.', existing.name, existing.category;
  end if;

  insert into skill(category_id, name)
  values (p.category_id, regexp_replace(btrim(p.name), '\s+', ' ', 'g'))
  returning id into _skill;
  update skill_proposal set status='approved', decided_by=current_employee_id(), decided_at=now()
   where id = _id;
  return _skill;
end $$;
