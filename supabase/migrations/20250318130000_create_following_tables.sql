-- Following table (people the user follows)
create table if not exists public.following (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  birthday date,
  deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.following enable row level security;

create index if not exists following_user_id_idx on public.following (user_id);
create index if not exists following_deleted_idx on public.following (deleted);

-- Following accounts (social/platform accounts)
create table if not exists public.following_accounts (
  id uuid primary key default gen_random_uuid(),
  following_id uuid not null references public.following(id) on delete cascade,
  handle text,
  url text,
  platform_id uuid not null references public.platforms(id) on delete cascade,
  deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.following_accounts enable row level security;

create index if not exists following_accounts_following_id_idx on public.following_accounts (following_id);
create index if not exists following_accounts_deleted_idx on public.following_accounts (deleted);

-- Following emails
create table if not exists public.following_emails (
  id uuid primary key default gen_random_uuid(),
  following_id uuid not null references public.following(id) on delete cascade,
  email text not null,
  added_by uuid not null references public.users(id) on delete cascade,
  deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.following_emails enable row level security;

create index if not exists following_emails_following_id_idx on public.following_emails (following_id);
create index if not exists following_emails_deleted_idx on public.following_emails (deleted);

-- Following phones
create table if not exists public.following_phones (
  id uuid primary key default gen_random_uuid(),
  following_id uuid not null references public.following(id) on delete cascade,
  phone_number text not null,
  added_by uuid not null references public.users(id) on delete cascade,
  deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.following_phones enable row level security;

create index if not exists following_phones_following_id_idx on public.following_phones (following_id);
create index if not exists following_phones_deleted_idx on public.following_phones (deleted);

-- Following addresses
create table if not exists public.following_addresses (
  id uuid primary key default gen_random_uuid(),
  following_id uuid not null references public.following(id) on delete cascade,
  address text,
  address_2 text,
  city text,
  state text,
  zip text,
  country text,
  added_by uuid not null references public.users(id) on delete cascade,
  deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.following_addresses enable row level security;

create index if not exists following_addresses_following_id_idx on public.following_addresses (following_id);
create index if not exists following_addresses_deleted_idx on public.following_addresses (deleted);

-- Following notes
create table if not exists public.following_notes (
  id uuid primary key default gen_random_uuid(),
  following_id uuid not null references public.following(id) on delete cascade,
  note text not null,
  added_by uuid not null references public.users(id) on delete cascade,
  access text,
  scheduled timestamptz,
  deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.following_notes enable row level security;

create index if not exists following_notes_following_id_idx on public.following_notes (following_id);
create index if not exists following_notes_deleted_idx on public.following_notes (deleted);
