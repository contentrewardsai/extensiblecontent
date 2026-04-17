-- ShotStack credit ledger: append-only history of grants and debits.
--
-- Each row is either:
--   * a `grant`     row from a Whop subscription / one-time top-up
--                   (positive `credits`, with an `expires_at` for rollover);
--   * a `debit`     row produced by `lib/shotstack-queue.ts` when a render is
--                   submitted (negative `credits`, linked to the render id);
--   * an `expiry`   row produced by the periodic reconciler when unused
--                   credits roll off the books (negative `credits`,
--                   `source_grant_id` set to the original grant);
--   * an `adjustment` row for manual corrections (positive or negative).
--
-- The user's spendable balance is `sum(credits)` over rows where the row is
-- a debit/adjustment OR the row is a grant whose `expires_at` is in the
-- future. `lib/shotstack-ledger.ts` exposes a single `getSpendableCredits`
-- function so callers don't reimplement the rule.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'shotstack_credit_entry_kind') then
    create type public.shotstack_credit_entry_kind as enum ('grant', 'debit', 'expiry', 'adjustment');
  end if;
end $$;

create table if not exists public.shotstack_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  kind public.shotstack_credit_entry_kind not null,
  credits numeric(12,4) not null,
  description text,
  -- For grants: the Whop product/plan that funded the grant + the period covered.
  whop_product_id text,
  whop_plan_id text,
  whop_payment_id text,
  whop_membership_id text,
  period_start timestamptz,
  period_end timestamptz,
  -- For grants: when these credits become unspendable. Null = never expires.
  expires_at timestamptz,
  -- For debits: link to the render that consumed credits.
  shotstack_render_id text,
  -- For expiry rows: which grant they cancel out.
  source_grant_id uuid references public.shotstack_credit_ledger(id) on delete set null,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamptz default now() not null
);

alter table public.shotstack_credit_ledger enable row level security;

create index if not exists shotstack_credit_ledger_user_created_idx
  on public.shotstack_credit_ledger (user_id, created_at desc);
create index if not exists shotstack_credit_ledger_user_kind_idx
  on public.shotstack_credit_ledger (user_id, kind);
create index if not exists shotstack_credit_ledger_user_expires_idx
  on public.shotstack_credit_ledger (user_id, expires_at)
  where kind = 'grant';
create index if not exists shotstack_credit_ledger_render_idx
  on public.shotstack_credit_ledger (shotstack_render_id)
  where shotstack_render_id is not null;
-- Idempotency: never grant the same membership/period twice.
create unique index if not exists shotstack_credit_ledger_grant_period_uidx
  on public.shotstack_credit_ledger (user_id, whop_membership_id, period_start)
  where kind = 'grant' and whop_membership_id is not null and period_start is not null;

comment on table public.shotstack_credit_ledger is
  'Append-only history of ShotStack credit grants, debits, expiries, and adjustments.';
comment on column public.shotstack_credit_ledger.credits is
  '1 credit = 1 minute of ShotStack render time. Positive for grants/adjustments, negative for debits/expiries.';
comment on column public.shotstack_credit_ledger.expires_at is
  'For grant rows: spendable until this timestamp; after that an expiry row offsets the unused balance.';

-- Helper: spendable balance = sum of all non-grant entries + sum of grant
-- entries whose expires_at is null or in the future. Returns 0 for unknown
-- users so callers can treat "no rows" as zero balance safely.
create or replace function public.shotstack_spendable_credits(p_user_id uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(
    case
      when kind = 'grant' and (expires_at is null or expires_at > now()) then credits
      when kind <> 'grant' then credits
      else 0
    end
  ), 0)
  from public.shotstack_credit_ledger
  where user_id = p_user_id;
$$;

comment on function public.shotstack_spendable_credits(uuid) is
  'Returns spendable ShotStack credits: all debits/adjustments + unexpired grants.';
