-- Run once in Supabase SQL Editor before deploying app version 107.
alter table public.tasks
  add column if not exists category text check (category in ('bookmarks'));
