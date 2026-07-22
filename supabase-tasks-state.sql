-- Run this once in Supabase: SQL Editor → New query → Run.
-- The old tasks_state table is kept as a backup and is not deleted.
create table if not exists public.tasks (
  id uuid primary key,
  value text not null,
  done boolean not null default false,
  priority text check (priority in ('high', 'medium', 'low')),
  created_at timestamptz not null default now(),
  reminder_at timestamptz,
  recurrence text check (recurrence in ('daily', 'weekly-monday', 'monthly-20')),
  last_completed_at timestamptz,
  deleted_at timestamptz
);

-- If the previous version of this migration was already run, rename its
-- title column to the clearer value column.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tasks' and column_name = 'title'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tasks' and column_name = 'value'
  ) then
    alter table public.tasks rename column title to value;
  end if;
end $$;

-- Copy existing JSON tasks into separate rows. Safe to run more than once.
insert into public.tasks (id, value, done, priority, created_at, reminder_at, recurrence, last_completed_at, deleted_at)
select
  (item->>'id')::uuid,
  item->>'title',
  coalesce((item->>'done')::boolean, false),
  nullif(item->>'priority', ''),
  to_timestamp(coalesce((item->>'createdAt')::double precision / 1000, extract(epoch from now()))),
  nullif(item->>'reminderAt', '')::timestamptz,
  nullif(item->>'recurrence', ''),
  nullif(item->>'lastCompletedAt', '')::bigint * interval '1 millisecond' + timestamptz 'epoch',
  nullif(item->>'deletedAt', '')::bigint * interval '1 millisecond' + timestamptz 'epoch'
from public.tasks_state state_row
cross join lateral jsonb_array_elements(coalesce(state_row.state->'tasks', '[]'::jsonb) || coalesce(state_row.state->'trash', '[]'::jsonb)) item
where (item->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
on conflict (id) do update set
  value = excluded.value,
  done = excluded.done,
  priority = excluded.priority,
  created_at = excluded.created_at,
  reminder_at = excluded.reminder_at,
  recurrence = excluded.recurrence,
  last_completed_at = excluded.last_completed_at,
  deleted_at = excluded.deleted_at;

alter table public.tasks enable row level security;

drop policy if exists "tasks_select" on public.tasks;
drop policy if exists "tasks_insert" on public.tasks;
drop policy if exists "tasks_update" on public.tasks;
drop policy if exists "tasks_delete" on public.tasks;

create policy "tasks_select" on public.tasks for select to anon using (true);
create policy "tasks_insert" on public.tasks for insert to anon with check (true);
create policy "tasks_update" on public.tasks for update to anon using (true) with check (true);
create policy "tasks_delete" on public.tasks for delete to anon using (true);
