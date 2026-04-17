-- Project sharing + audit log.
--
-- Adds collaborators, per-project storage quotas, invite links, and an
-- append-only audit trail for every project / member / file mutation.
--
-- Naming and "edit source" convention mirrors what the Chrome extension
-- already stamps locally for workflow modifications:
--   'user'    – sidepanel UI / dashboard human action (default)
--   'backend' – server-initiated sync (webhooks, dashboard server actions)
--   'mcp'     – MCP server / AI agent tooling
--
-- Storage layout stays `${owner_id}/${project_id}/posts/${folder}/${fileId}`,
-- so every byte counts toward the *project owner* even when an editor uploads.

-- 1. Enums --------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'project_member_role') then
    create type public.project_member_role as enum ('owner', 'editor', 'viewer');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'edit_source') then
    create type public.edit_source as enum ('user', 'backend', 'mcp');
  end if;
end $$;

-- 2. projects: owner_id (mirrors user_id), quota_bytes, description ------

alter table public.projects
  add column if not exists owner_id uuid references public.users(id) on delete cascade;

update public.projects
   set owner_id = user_id
 where owner_id is null;

alter table public.projects
  alter column owner_id set not null;

create index if not exists projects_owner_id_idx on public.projects (owner_id);

alter table public.projects
  add column if not exists quota_bytes bigint;

alter table public.projects
  add column if not exists description text;

comment on column public.projects.owner_id is
  'Project owner. All file storage in the project counts against this user''s cap.';
comment on column public.projects.quota_bytes is
  'Optional per-project storage cap in bytes. Null = inherit owner cap with no sub-cap.';

-- 3. project_members ----------------------------------------------------

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role public.project_member_role not null default 'viewer',
  invited_by uuid references public.users(id) on delete set null,
  accepted_at timestamptz default now() not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  primary key (project_id, user_id)
);

alter table public.project_members enable row level security;

create index if not exists project_members_user_id_idx on public.project_members (user_id);
create index if not exists project_members_project_role_idx on public.project_members (project_id, role);

comment on table public.project_members is
  'Project collaborators with a role. The owner row is auto-created by trigger.';

-- Auto-insert an owner membership row whenever a project is created.
create or replace function public.project_members_seed_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.project_members (project_id, user_id, role, invited_by)
  values (new.id, new.owner_id, 'owner', new.owner_id)
  on conflict (project_id, user_id) do update
    set role = 'owner', updated_at = now();
  return new;
end;
$$;

drop trigger if exists project_members_seed_owner on public.projects;
create trigger project_members_seed_owner
after insert on public.projects
for each row execute function public.project_members_seed_owner();

-- Backfill owner rows for existing projects.
insert into public.project_members (project_id, user_id, role, invited_by)
select p.id, p.owner_id, 'owner', p.owner_id
  from public.projects p
 on conflict (project_id, user_id) do nothing;

-- Keep owner membership in sync if a project's owner_id ever changes.
create or replace function public.project_members_sync_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    update public.project_members
       set role = 'editor', updated_at = now()
     where project_id = new.id and user_id = old.owner_id and role = 'owner';
    insert into public.project_members (project_id, user_id, role, invited_by)
    values (new.id, new.owner_id, 'owner', new.owner_id)
    on conflict (project_id, user_id) do update
      set role = 'owner', updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists project_members_sync_owner on public.projects;
create trigger project_members_sync_owner
after update of owner_id on public.projects
for each row execute function public.project_members_sync_owner();

-- 4. project_invites ----------------------------------------------------

create table if not exists public.project_invites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  role public.project_member_role not null default 'viewer',
  token text not null unique,
  created_by uuid references public.users(id) on delete set null,
  expires_at timestamptz,
  used_by uuid references public.users(id) on delete set null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz default now() not null
);

alter table public.project_invites enable row level security;

create index if not exists project_invites_project_idx on public.project_invites (project_id);
create index if not exists project_invites_active_idx
  on public.project_invites (project_id)
  where revoked_at is null and used_at is null;

comment on table public.project_invites is
  'Shareable invite links. Anyone with the token can claim the role on accept.';

-- 5. project_audit_log --------------------------------------------------

create table if not exists public.project_audit_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  actor_user_id uuid references public.users(id) on delete set null,
  source public.edit_source not null default 'backend',
  action text not null,
  target_type text,
  target_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz default now() not null
);

alter table public.project_audit_log enable row level security;

create index if not exists project_audit_log_project_created_idx
  on public.project_audit_log (project_id, created_at desc);
create index if not exists project_audit_log_actor_idx
  on public.project_audit_log (actor_user_id, created_at desc)
  where actor_user_id is not null;

comment on table public.project_audit_log is
  'Append-only log of project, member, and file mutations with the edit source enum.';

-- 6. Project storage RPCs ----------------------------------------------

-- Bytes used by a single project under the owner's user prefix. Mirrors
-- get_user_storage_stats but adds a project-id segment on the path.
create or replace function public.get_project_storage_bytes(
  p_owner_prefix text,
  p_project_id uuid,
  p_bucket_ids text[]
)
returns table(bucket_id text, file_count bigint, total_bytes bigint)
language sql stable
set search_path = ''
as $$
  select
    o.bucket_id::text,
    count(*)::bigint as file_count,
    coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint as total_bytes
  from storage.objects o
  where o.bucket_id = any(p_bucket_ids)
    and o.name like p_owner_prefix || p_project_id::text || '/%'
  group by o.bucket_id;
$$;

comment on function public.get_project_storage_bytes(text, uuid, text[]) is
  'Per-project storage usage rolled up by bucket. Owner prefix must include trailing slash.';

-- List storage objects under a single project (owner_prefix + project_id/).
create or replace function public.list_user_storage_files_by_project(
  p_owner_prefix text,
  p_project_id uuid,
  p_bucket_ids text[],
  p_limit int default 100,
  p_offset int default 0
)
returns table(id uuid, bucket_id text, name text, metadata jsonb, created_at timestamptz)
language sql stable
set search_path = ''
as $$
  select o.id, o.bucket_id::text, o.name, o.metadata, o.created_at
  from storage.objects o
  where o.bucket_id = any(p_bucket_ids)
    and o.name like p_owner_prefix || p_project_id::text || '/%'
  order by o.created_at desc
  limit p_limit
  offset p_offset;
$$;

comment on function public.list_user_storage_files_by_project(text, uuid, text[], int, int) is
  'List storage objects scoped to a single project under the owner prefix.';
