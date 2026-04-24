-- Connection keys for GHL External Auth (API Key/Basic Auth mode)
-- Users generate a key from the Whop integrations page, then paste it into GHL during app install.

create table if not exists public.ghl_connection_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  key_hash text not null,
  key_prefix text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

alter table public.ghl_connection_keys enable row level security;

create index if not exists ghl_connection_keys_user_id_idx on public.ghl_connection_keys (user_id);
create index if not exists ghl_connection_keys_hash_idx on public.ghl_connection_keys (key_hash) where is_active = true;
