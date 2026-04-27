-- Configurable storage destination for rendered videos, thumbnails, and other
-- user-generated media. Users can route uploads to their HighLevel Media
-- Library (when a GHL connection exists) or to our Supabase buckets
-- ("Content Rewards AI account storage"). The policy is:
--
--   1. If the owning project has `storage_destination` set to 'ghl' or
--      'supabase', that wins.
--   2. Otherwise, use `users.preferred_storage`:
--        - 'ghl'      → always try GHL, fall back to Supabase with a notice.
--        - 'supabase' → always use Supabase.
--        - 'auto'     → GHL when a location is resolvable, otherwise Supabase.
--   3. To resolve a GHL location: active cookie context → `users.preferred_ghl_location_id`
--      → Supabase fallback.
--
-- We also track where each individual upload landed, both for debugging and so
-- the UI can show "Saved to HighLevel Media Library" after the fact.

-- Per-user default preference.
alter table public.users
  add column if not exists preferred_storage text not null default 'auto'
    check (preferred_storage in ('auto', 'ghl', 'supabase'));

-- When a user has multiple linked GHL locations, which one is the default for
-- uploads initiated outside a GHL Custom Page (no active cookie context).
-- Stored as the raw GHL locationId string; `lib/ghl.ts` / `getValidTokenForLocation`
-- is already responsible for access checks.
alter table public.users
  add column if not exists preferred_ghl_location_id text;

-- Per-project override. 'auto' means "follow the user's preference".
alter table public.projects
  add column if not exists storage_destination text not null default 'auto'
    check (storage_destination in ('auto', 'ghl', 'supabase'));

-- Record where each render actually landed. We default existing rows to
-- 'supabase' because every previous render went to our buckets.
alter table public.shotstack_renders
  add column if not exists storage_type text not null default 'supabase'
    check (storage_type in ('supabase', 'ghl'));

-- Opaque bag for storage-specific metadata: GHL media id, bucket name,
-- fallback reason, etc. Kept as jsonb so we never have to re-migrate when we
-- pick up a new destination.
alter table public.shotstack_renders
  add column if not exists storage_meta jsonb;

-- Per-template thumbnail storage type. Templates whose thumbnails live in a
-- GHL media library need to be distinguished from Supabase-hosted ones (e.g.
-- for cache-busting policy, deletion on template delete, etc.).
alter table public.shotstack_templates
  add column if not exists thumbnail_storage_type text;

comment on column public.users.preferred_storage is
  'Where uploads land by default: auto (GHL when linked, else Supabase), ghl, or supabase.';
comment on column public.users.preferred_ghl_location_id is
  'Chosen GHL locationId for uploads originating outside an active GHL Custom Page session.';
comment on column public.projects.storage_destination is
  'Project-level override: auto (follow user default), ghl, or supabase.';
comment on column public.shotstack_renders.storage_type is
  'Where the output for this render is physically stored: supabase or ghl.';
comment on column public.shotstack_renders.storage_meta is
  'Storage-specific metadata — GHL media id / locationId, fallback reason, etc.';
comment on column public.shotstack_templates.thumbnail_storage_type is
  'Where the captured thumbnail is physically stored (supabase or ghl).';
