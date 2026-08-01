-- Run this once in Supabase SQL Editor after creating/confirming the user in
-- Authentication → Users. It makes every task visible only to its owner.

alter table public.tasks
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- Older versions allowed only a few hard-coded recurrence values. Drop that
-- legacy constraint so monthly and yearly rules chosen in the app can persist.
alter table public.tasks
  drop constraint if exists tasks_recurrence_check;

-- New records created by an authenticated user receive that user's ID.
alter table public.tasks
  alter column user_id set default auth.uid();

-- Existing tasks need an owner before the RLS rules below can expose them.
-- Replace the email and run this statement once for the owner of the old list:
-- update public.tasks
-- set user_id = (select id from auth.users where email = 'YOUR_EMAIL@example.com')
-- where user_id is null;

alter table public.tasks enable row level security;

drop policy if exists "tasks_select" on public.tasks;
drop policy if exists "tasks_insert" on public.tasks;
drop policy if exists "tasks_update" on public.tasks;
drop policy if exists "tasks_delete" on public.tasks;

create policy "tasks_select_own" on public.tasks
  for select to authenticated using (user_id = auth.uid());
create policy "tasks_insert_own" on public.tasks
  for insert to authenticated with check (user_id = auth.uid());
create policy "tasks_update_own" on public.tasks
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "tasks_delete_own" on public.tasks
  for delete to authenticated using (user_id = auth.uid());
