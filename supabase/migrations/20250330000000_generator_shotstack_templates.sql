-- Cloud-synced templates for ShotStack (extension + web)

create table if not exists public.shotstack_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  edit jsonb not null default '{}'::jsonb,
  default_env text not null default 'v1',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint shotstack_templates_default_env_chk check (default_env in ('stage', 'v1'))
);

alter table public.shotstack_templates enable row level security;

create index if not exists shotstack_templates_user_updated_idx
  on public.shotstack_templates (user_id, updated_at desc);

comment on table public.shotstack_templates is 'ShotStack edit JSON templates for cloud render queue';
