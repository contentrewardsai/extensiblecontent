-- Two related changes:
--
-- 1. `users.max_storage_bytes` — per-user post-media storage cap, materialized
--    from the user's active Whop subscription tier (mirrors the existing
--    `max_upload_post_accounts` column). Free tier defaults to 500 MB so
--    nothing changes for users without a paid plan; the entitlement sync in
--    `lib/plan-entitlements.ts` writes the higher cap (10 / 40 / 100 GB) when
--    a tracked plan is active.
--
-- 2. `shotstack_spendable_credits` no longer filters out grants whose
--    `expires_at` has passed. Instead, the reconciler in
--    `lib/shotstack-expiry.ts` materializes a `kind = 'expiry'` row for each
--    expired grant with the unspent portion (FIFO across all grants), so the
--    billing-history page shows the user exactly what rolled off their books
--    and the spendable balance is the simple `sum(credits)` over all rows.
--
--    The previous formula had a latent bug: a debit followed by the funding
--    grant's expiry would push the spendable balance negative because the
--    debit row stayed but the grant disappeared from the sum. The new model
--    is double-entry: every credit grant is offset by debit and/or expiry
--    rows summing to the same magnitude, so `sum(credits)` is always the
--    truthful balance.

alter table public.users
  add column if not exists max_storage_bytes bigint default 524288000 not null;

comment on column public.users.max_storage_bytes is
  'Max bytes of post-media storage the user can consume across owned projects. Updated by syncUserEntitlements based on active Whop plan; free tier = 500 MB.';

-- New spendable formula: simple sum over all rows. Expiry rows (added by
-- `reconcileExpiredGrants` in lib/shotstack-expiry.ts) provide the negative
-- offset for grants whose 3-month rollover window has ended.
create or replace function public.shotstack_spendable_credits(p_user_id uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(credits), 0)
  from public.shotstack_credit_ledger
  where user_id = p_user_id;
$$;

comment on function public.shotstack_spendable_credits(uuid) is
  'Spendable ShotStack credits = sum(credits) over the ledger. Expired grants are offset by an explicit kind=''expiry'' row inserted by the reconciler.';
