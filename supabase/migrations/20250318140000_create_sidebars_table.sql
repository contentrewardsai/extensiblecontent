-- Sidebars table: tracks connected extension sidebars per user
create table if not exists public.sidebars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  window_id text not null,
  sidebar_name text not null,
  last_seen timestamptz not null default now(),
  active_project_id uuid references public.projects(id) on delete set null,
  ip_address text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, window_id)
);

alter table public.sidebars enable row level security;

-- No permissive policies: backend uses service_role; extension never queries Supabase directly

create index if not exists sidebars_user_id_idx on public.sidebars (user_id);
create index if not exists sidebars_last_seen_idx on public.sidebars (last_seen);
