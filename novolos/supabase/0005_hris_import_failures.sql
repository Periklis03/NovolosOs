-- NovolosOS 0005: a failed HRIS import is now kept in Sync history (status 'failed' + reason),
-- and the reason names the row that broke. Safe on the live database. Run after 0004.
--
-- Before: the error was re-raised, which rolled back the WHOLE call, including the
-- hris_sync_run row, so failures left no trace.
-- Now: the employee upserts run in an inner block. If one row fails, only that block is
-- rolled back (nothing half-imported), the run row is marked 'failed', and the function
-- returns normally with the run id. The app then reads the run's status.

create or replace function hris_import(_rows jsonb, _source text default 'csv') returns bigint
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
    -- _n rows succeeded before the failure, so the bad one is data row _n+1 (CSV line _n+2)
    update hris_sync_run
       set status='failed', finished_at=now(), rows_upserted=0,
           error = format('CSV line %s (hris_id %s): %s', _n + 2, coalesce(r->>'hris_id','?'), sqlerrm)
     where id=_run;
  end;
  return _run;
end $$;
