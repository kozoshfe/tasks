create table if not exists public.tasks_state (
  id text primary key,
  state jsonb not null default '{"tasks":[],"trash":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.tasks_state enable row level security;

drop policy if exists "tasks_state_select_main" on public.tasks_state;
drop policy if exists "tasks_state_insert_main" on public.tasks_state;
drop policy if exists "tasks_state_update_main" on public.tasks_state;

create policy "tasks_state_select_main"
on public.tasks_state
for select
to anon
using (id = 'simple-task-pwa-main');

create policy "tasks_state_insert_main"
on public.tasks_state
for insert
to anon
with check (id = 'simple-task-pwa-main');

create policy "tasks_state_update_main"
on public.tasks_state
for update
to anon
using (id = 'simple-task-pwa-main')
with check (id = 'simple-task-pwa-main');
