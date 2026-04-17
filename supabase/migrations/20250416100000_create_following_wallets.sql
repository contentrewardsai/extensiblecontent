-- Following wallets (on-chain wallets watched / automated for a profile)
create table if not exists public.following_wallets (
  id uuid primary key default gen_random_uuid(),
  following_id uuid not null references public.following(id) on delete cascade,
  chain text not null check (chain in ('solana','evm')),
  address text not null,
  network text,
  label text,
  watch_enabled boolean default false,
  automation_enabled boolean default false,
  auto_execute_swaps boolean default false,
  size_mode text,
  quote_mint text,
  fixed_amount_raw text,
  usd_amount text,
  proportional_scale_percent integer,
  slippage_bps integer,
  added_by uuid not null references public.users(id) on delete cascade,
  deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.following_wallets enable row level security;

create index if not exists following_wallets_following_id_idx on public.following_wallets (following_id);
create index if not exists following_wallets_deleted_idx on public.following_wallets (deleted);
