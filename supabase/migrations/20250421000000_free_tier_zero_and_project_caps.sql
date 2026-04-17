-- Free-tier zero, project-scoped sharing, and per-project ShotStack caps.
--
-- Three independent but related changes:
--
--  1. Drop the legacy 500 MB free-tier storage allowance to **0 bytes**, in
--     line with the post-launch "free tier is gated" plan. Free users keep
--     the ability to *receive* invites to paying users' projects (where
--     uploads still count against the *owner's* pool), but their own
--     projects can no longer accept uploads until they upgrade.
--
--  2. Add `project_id` to `workflows` and `shotstack_templates` so a paying
--     user can attach a workflow / template to one of their projects and
--     have invited collaborators see it in the extension without needing
--     access to the global "backend" library.
--
--  3. Per-project monthly ShotStack credit cap with optional per-member
--     overrides. Lets a project owner say "this project may spend at most N
--     credits/month" and optionally "Alice may spend at most M of those".
--     Render attribution columns are added to `shotstack_credit_ledger`
--     (`project_id`, `actor_user_id`) so the cap RPC can sum spend by
--     project and/or actor for the current calendar month.

-- 1. Free tier = 0 bytes ----------------------------------------------------

alter table public.users
  alter column max_storage_bytes set default 0;

update public.users
   set max_storage_bytes = 0
 where has_upgraded = false
   and max_storage_bytes = 524288000; -- only touch rows still on the old 500 MB default

comment on column public.users.max_storage_bytes is
  'Max bytes of post-media storage the user can consume across owned projects. Updated by syncUserEntitlements based on active Whop plan. Free tier = 0 bytes; paid tiers raise it to 10/40/100 GB.';

-- 2. project_id on workflows + shotstack_templates -------------------------

alter table public.workflows
  add column if not exists project_id uuid references public.projects(id) on delete set null;

create index if not exists workflows_project_id_idx
  on public.workflows (project_id)
  where project_id is not null;

comment on column public.workflows.project_id is
  'Optional project this workflow belongs to. Members of the project see it via /api/extension/workflows; null = not project-scoped (visible only to creator + workflow_added_by).';

alter table public.shotstack_templates
  add column if not exists project_id uuid references public.projects(id) on delete set null;

create index if not exists shotstack_templates_project_id_idx
  on public.shotstack_templates (project_id)
  where project_id is not null;

comment on column public.shotstack_templates.project_id is
  'Optional project this template belongs to. Members of the project see it via /api/extension/shotstack-templates; null = creator-only.';

-- 3. Per-project monthly ShotStack credit cap ------------------------------

alter table public.projects
  add column if not exists shotstack_monthly_credit_cap integer;

comment on column public.projects.shotstack_monthly_credit_cap is
  'Optional cap (credits/minutes) on ShotStack spend for this project per calendar month. Null = inherit owner''s wallet with no project sub-cap. Enforced by lib/project-credit-cap.ts in the render endpoint.';

create table if not exists public.project_member_credit_overrides (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  monthly_credit_cap integer not null check (monthly_credit_cap >= 0),
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  primary key (project_id, user_id)
);

alter table public.project_member_credit_overrides enable row level security;

create index if not exists project_member_credit_overrides_user_idx
  on public.project_member_credit_overrides (user_id);

comment on table public.project_member_credit_overrides is
  'Per-member, per-project monthly ShotStack credit cap. Wins over projects.shotstack_monthly_credit_cap when present.';

-- Render attribution columns on the ledger so we can sum spend by project
-- and / or actor without joining shotstack_renders. `user_id` stays the
-- *paying owner* (whose wallet is debited); `actor_user_id` is the project
-- member who triggered the render (may equal `user_id` when the owner
-- renders for themselves).
alter table public.shotstack_credit_ledger
  add column if not exists project_id uuid references public.projects(id) on delete set null,
  add column if not exists actor_user_id uuid references public.users(id) on delete set null;

create index if not exists shotstack_credit_ledger_project_idx
  on public.shotstack_credit_ledger (project_id, created_at desc)
  where project_id is not null;

create index if not exists shotstack_credit_ledger_project_actor_idx
  on public.shotstack_credit_ledger (project_id, actor_user_id, created_at desc)
  where project_id is not null and actor_user_id is not null;

comment on column public.shotstack_credit_ledger.project_id is
  'For debits: the project the render was charged to. Used by project_shotstack_spent_this_month for cap enforcement.';
comment on column public.shotstack_credit_ledger.actor_user_id is
  'For debits: the project member who triggered the render. May differ from user_id (the wallet-holding owner) when a collaborator renders.';

-- RPC: sum of debit credits (as positive numbers) for a project in the
-- current calendar month, optionally scoped to a specific actor. Used by
-- assertProjectShotstackCap before queueing a new render.
create or replace function public.project_shotstack_spent_this_month(
  p_project_id uuid,
  p_actor_user_id uuid default null
)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(-credits), 0)
    from public.shotstack_credit_ledger
   where kind = 'debit'
     and project_id = p_project_id
     and (p_actor_user_id is null or actor_user_id = p_actor_user_id)
     and created_at >= date_trunc('month', now() at time zone 'utc')
     and created_at <  date_trunc('month', now() at time zone 'utc') + interval '1 month';
$$;

comment on function public.project_shotstack_spent_this_month(uuid, uuid) is
  'Total ShotStack credits debited against a project this calendar month (UTC). Pass p_actor_user_id to scope to a single member; null = whole project.';
