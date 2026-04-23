-- GoHighLevel integration: connections, locations, social accounts, external auth codes

-- Top-level OAuth connection (agency or direct location auth)
create table if not exists public.ghl_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  company_id text not null,
  user_type text not null check (user_type in ('Company', 'Location')),
  access_token text not null,
  refresh_token text not null,
  token_expires_at timestamptz not null,
  scopes text,
  ghl_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, company_id)
);

alter table public.ghl_connections enable row level security;

create index if not exists ghl_connections_user_id_idx on public.ghl_connections (user_id);
create index if not exists ghl_connections_company_id_idx on public.ghl_connections (company_id);

-- Per-sub-account (location) tokens
create table if not exists public.ghl_locations (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.ghl_connections(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  location_id text not null,
  location_name text,
  access_token text not null,
  refresh_token text not null,
  token_expires_at timestamptz not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, location_id)
);

alter table public.ghl_locations enable row level security;

create index if not exists ghl_locations_user_id_idx on public.ghl_locations (user_id);
create index if not exists ghl_locations_location_id_idx on public.ghl_locations (location_id);
create index if not exists ghl_locations_token_expires_idx on public.ghl_locations (token_expires_at)
  where is_active = true;

-- Cached social media accounts from GHL per location
create table if not exists public.ghl_social_accounts (
  id uuid primary key default gen_random_uuid(),
  ghl_location_id uuid not null references public.ghl_locations(id) on delete cascade,
  ghl_account_id text not null,
  platform text not null,
  display_name text,
  account_type text,
  meta jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ghl_social_accounts enable row level security;

create index if not exists ghl_social_accounts_location_idx on public.ghl_social_accounts (ghl_location_id);

-- Short-lived auth codes for External Authentication OAuth provider
create table if not exists public.ghl_external_auth_codes (
  code text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  redirect_uri text not null,
  expires_at timestamptz not null,
  used boolean not null default false
);

alter table public.ghl_external_auth_codes enable row level security;

-- External auth refresh tokens
create table if not exists public.ghl_external_auth_refresh_tokens (
  token text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  expires_at timestamptz not null,
  used boolean not null default false
);

alter table public.ghl_external_auth_refresh_tokens enable row level security;
