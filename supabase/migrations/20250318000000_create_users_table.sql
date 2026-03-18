-- Users table: links Whop identity to app data (email matching for same user)
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  whop_user_id text unique,
  name text,
  updated_at timestamptz default now()
);

-- Enable RLS (service_role bypasses RLS; anon has no access by default)
alter table public.users enable row level security;

-- No permissive policies: backend uses service_role for upserts; extension never queries Supabase directly

-- Index for lookups
create index if not exists users_email_idx on public.users (email);
create index if not exists users_whop_user_id_idx on public.users (whop_user_id);
