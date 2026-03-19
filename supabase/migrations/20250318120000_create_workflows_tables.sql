-- Workflows table
create table if not exists public.workflows (
  id text primary key default ('wf_' || (floor(extract(epoch from now()) * 1000))::bigint::text),
  created_by uuid not null references public.users(id) on delete cascade,
  name text not null,
  workflow jsonb not null default '{}',
  private boolean default true,
  published boolean default false,
  version numeric(10, 2) default 1,
  initial_version text references public.workflows(id) on delete set null,
  archived boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.workflows enable row level security;

create index if not exists workflows_created_by_idx on public.workflows (created_by);
create index if not exists workflows_initial_version_idx on public.workflows (initial_version);
create index if not exists workflows_archived_idx on public.workflows (archived);

-- Workflow added_by junction (users who added this workflow)
create table if not exists public.workflow_added_by (
  workflow_id text not null references public.workflows(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  primary key (workflow_id, user_id)
);

alter table public.workflow_added_by enable row level security;
