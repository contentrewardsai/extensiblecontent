-- Queue for headless/scheduled posts to GHL social planner.
-- Allows the backend (Whop app, extension, or cron) to schedule a post that
-- will be published to GHL at a future time without the user being online.

create table if not exists public.ghl_scheduled_posts (
  id uuid primary key default gen_random_uuid(),

  -- Who scheduled it (Whop user). Used for access verification via ghl_connection_users.
  user_id uuid not null references public.users(id) on delete cascade,

  -- Target GHL location (sub-account). We denormalize location_id for easy lookup.
  ghl_location_id uuid not null references public.ghl_locations(id) on delete cascade,
  location_id text not null,

  -- Payload passed to POST /social-media-posting/:locationId/posts
  -- (accountIds, summary, media, etc.). Stored verbatim so GHL's API schema
  -- can evolve without a migration.
  payload jsonb not null,

  -- When to publish.
  scheduled_for timestamptz not null,

  -- State machine: pending → in_progress → succeeded | failed | cancelled
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'succeeded', 'failed', 'cancelled')),

  -- Worker leasing (optimistic concurrency).
  leased_at timestamptz,
  lease_token uuid,

  -- Retry tracking.
  attempts int not null default 0,
  last_error text,

  -- Result from GHL once posted.
  ghl_post_id text,
  response jsonb,

  -- Source: "extension" | "whop-app" | "backend" (for observability).
  source text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ghl_scheduled_posts enable row level security;

create index if not exists ghl_scheduled_posts_user_idx
  on public.ghl_scheduled_posts (user_id);
create index if not exists ghl_scheduled_posts_location_idx
  on public.ghl_scheduled_posts (ghl_location_id);

-- Primary index used by the worker: pending work sorted by due time.
create index if not exists ghl_scheduled_posts_due_idx
  on public.ghl_scheduled_posts (status, scheduled_for)
  where status = 'pending';
