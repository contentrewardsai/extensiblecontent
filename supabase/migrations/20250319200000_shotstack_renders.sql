-- shotstack_renders: store full render lifecycle (request, id, output URL, credits)
create table if not exists public.shotstack_renders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  shotstack_render_id text not null,
  request_json jsonb not null,
  status text not null default 'queued',
  output_url text,
  credits_used numeric(10,4) default 0,
  env text not null default 'v1',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.shotstack_renders enable row level security;
create index if not exists shotstack_renders_user_id_idx on public.shotstack_renders (user_id);
create index if not exists shotstack_renders_shotstack_id_idx on public.shotstack_renders (shotstack_render_id);

comment on table public.shotstack_renders is 'ShotStack render jobs: request, status, output URL, credits used';
