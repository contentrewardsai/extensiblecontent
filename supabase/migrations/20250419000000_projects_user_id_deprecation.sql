-- Step 1 of the projects.user_id retirement.
--
-- The earlier `20250418000000_project_sharing_audit.sql` migration introduced
-- `projects.owner_id` and backfilled it from `user_id`. Application code now
-- treats `owner_id` as the source of truth, but a few extension API responses
-- still echo `user_id` for legacy clients.
--
-- This migration:
--   1. Makes `projects.user_id` nullable so new code paths can insert without
--      populating it explicitly.
--   2. Adds a trigger that keeps `user_id` mirrored to `owner_id` whenever the
--      owner changes (or a new project is inserted without `user_id`).
--   3. Marks the column deprecated. A follow-up migration will drop it once
--      every reader has moved to `owner_id`.

-- 1. Drop the NOT NULL constraint.
alter table public.projects
  alter column user_id drop not null;

-- 2. Trigger keeps user_id == owner_id so legacy reads stay correct.
create or replace function public.projects_sync_user_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' and new.user_id is null) then
    new.user_id := new.owner_id;
  elsif (tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id) then
    new.user_id := new.owner_id;
  end if;
  return new;
end;
$$;

drop trigger if exists projects_sync_user_id on public.projects;
create trigger projects_sync_user_id
before insert or update of owner_id on public.projects
for each row execute function public.projects_sync_user_id();

-- 3. Backfill any rows that snuck in with a null user_id (defensive — the
--    NOT NULL constraint above only just dropped, so this is a no-op today).
update public.projects
   set user_id = owner_id
 where user_id is null;

comment on column public.projects.user_id is
  'DEPRECATED — use owner_id. Kept in sync via trigger projects_sync_user_id; will be dropped in a future migration.';
