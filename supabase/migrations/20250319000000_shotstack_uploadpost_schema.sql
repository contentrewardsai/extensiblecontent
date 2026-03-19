-- ShotStack & Upload-Post integration schema
-- Supports: managed keys, BYOK, credits, upload-post account limits

-- =============================================================================
-- USERS: extend with ShotStack and Upload-Post fields
-- =============================================================================
alter table public.users add column if not exists shotstack_credits numeric(12,4) default 0 not null;
alter table public.users add column if not exists shotstack_api_key_encrypted text;  -- BYOK: user's own key (encrypt at rest)
alter table public.users add column if not exists max_upload_post_accounts int default 0 not null;  -- 0 = none, 1+ = limit

comment on column public.users.shotstack_credits is 'Credits remaining (1 credit per minute of video, billed by second)';
comment on column public.users.shotstack_api_key_encrypted is 'BYOK: encrypted ShotStack API key; null = use managed key';
comment on column public.users.max_upload_post_accounts is 'Max Upload-Post accounts user can create; 0 = feature disabled';

-- =============================================================================
-- UPLOAD_POST_ACCOUNTS: user-named profiles linked to Upload-Post
-- =============================================================================
create table if not exists public.upload_post_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,  -- user-facing label, e.g. "My Main Brand"
  upload_post_username text not null unique,  -- stable ID for Upload-Post API (e.g. user_id + account_id)
  uses_own_key boolean default false not null,  -- true = user's API key, false = our managed key
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.upload_post_accounts enable row level security;
create index if not exists upload_post_accounts_user_id_idx on public.upload_post_accounts (user_id);
create unique index if not exists upload_post_accounts_username_idx on public.upload_post_accounts (upload_post_username);

comment on table public.upload_post_accounts is 'Upload-Post profiles; each maps to one Upload-Post username for social linking';
comment on column public.upload_post_accounts.upload_post_username is 'Unique identifier sent to Upload-Post API (e.g. extensible_user_<uuid>)';
comment on column public.upload_post_accounts.uses_own_key is 'BYOK: use user-provided Upload-Post API key for this account';

-- =============================================================================
-- SHOTSTACK_USAGE: track renders for credit deduction (no API from ShotStack)
-- =============================================================================
create table if not exists public.shotstack_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  shotstack_render_id text,  -- from ShotStack API response
  duration_seconds numeric(10,2) not null,
  credits_used numeric(10,4) not null,  -- duration_seconds / 60
  created_at timestamptz default now()
);

alter table public.shotstack_usage enable row level security;
create index if not exists shotstack_usage_user_id_idx on public.shotstack_usage (user_id);
create index if not exists shotstack_usage_created_at_idx on public.shotstack_usage (created_at);

comment on table public.shotstack_usage is 'Track video render usage for credit deduction; 1 credit = 1 minute';
