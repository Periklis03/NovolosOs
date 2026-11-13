-- 0010 · Simpler projects: no win probability, no percentages
--
-- Decided with HR: almost always a person works on one project at a time, so a booking is
-- simply "on this project from – to". Availability becomes: free now / busy, free from <date> /
-- busy with no end date. Two projects at once is still allowed (the app warns), it just isn't
-- split into percentages.
--
-- Removes the columns project.win_probability and allocation.percent (their values are deleted).
-- The views and the availability function that used them are rebuilt; nothing else changes.

drop view allocation_overview;
drop view project_overview;
drop function availability(date);

alter table project drop column win_probability;
alter table allocation drop column percent;

-- same as 0009, without the removed columns
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
--   busy       on a confirmed project that day
--   tentative  on a pipeline project that day (shown, does not make them busy)
--   free_from  when busy: the first day with no confirmed project (null = no end date yet)
create function availability(_on date default null)
returns table (employee_id uuid, busy boolean, tentative boolean, free_from date)
language sql stable as $$
  with d as (select coalesce(_on, novolos_today()) as day),
  conf as (
    select a.employee_id, a.start_date, a.end_date
    from allocation a join project p on p.id = a.project_id where p.stage = 'confirmed'
  ),
  pipe as (
    select a.employee_id, a.start_date, a.end_date
    from allocation a join project p on p.id = a.project_id where p.stage = 'pipeline'
  ),
  people as (
    select e.id,
      exists (select 1 from conf c, d where c.employee_id = e.id
              and c.start_date <= d.day and (c.end_date is null or c.end_date >= d.day)) as busy,
      exists (select 1 from pipe c, d where c.employee_id = e.id
              and c.start_date <= d.day and (c.end_date is null or c.end_date >= d.day)) as tentative
    from employee e
    where e.active
  )
  select p.id, p.busy, p.tentative,
    case when not p.busy then null else (
      select min(x.end_date + 1)
      from conf x, d
      where x.employee_id = p.id and x.end_date >= d.day
        and not exists (select 1 from conf y
                        where y.employee_id = p.id and y.start_date <= x.end_date + 1
                          and (y.end_date is null or y.end_date >= x.end_date + 1))
    ) end
  from people p
$$;

revoke execute on function availability(date) from public, anon;
grant execute on function availability(date) to authenticated;
