-- Many-to-many: Whop users ↔ GHL connections.
-- A Whop user can access multiple GHL companies, and a GHL company can be
-- accessed by multiple Whop users. Access is granted at the connection
-- (company) level and cascades to all child locations.

create table if not exists public.ghl_connection_users (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.ghl_connections(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (connection_id, user_id)
);

alter table public.ghl_connection_users enable row level security;

create index if not exists ghl_connection_users_user_idx
  on public.ghl_connection_users (user_id);
create index if not exists ghl_connection_users_conn_idx
  on public.ghl_connection_users (connection_id);

-- Backfill existing single-user links into the join table so nobody loses access
insert into public.ghl_connection_users (connection_id, user_id)
select id, user_id
from public.ghl_connections
where user_id is not null
on conflict (connection_id, user_id) do nothing;
