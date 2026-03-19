-- Users: add default_project_id
alter table public.users add column if not exists default_project_id uuid references public.projects(id) on delete set null;

comment on column public.users.default_project_id is 'User default project for extension';

-- Social profiles: linked social accounts (e.g. for Upload-Post, manual entries)
create table if not exists public.social_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  platform text,
  profile_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.social_profiles enable row level security;
create index if not exists social_profiles_user_id_idx on public.social_profiles (user_id);
