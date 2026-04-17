-- Add the actual content payload (title, body copy, media URL, CTA)
-- to promotion_plan_content. Until now the table only held distribution
-- metadata (toggles, status, budget, targeting) — the human-readable
-- text and media a contributor wants to ship were nowhere to live.
--
-- All fields default to empty strings so the migration is safe against
-- existing rows. `media_kind` is constrained to the same set the UI
-- understands; `'embed'` covers YouTube / Vimeo / generic iframe URLs
-- that the client converts to an embed src on the fly.

alter table public.promotion_plan_content
  add column if not exists title text not null default '',
  add column if not exists body text not null default '',
  add column if not exists media_kind text not null default 'none'
    check (media_kind in ('none', 'image', 'video', 'embed')),
  add column if not exists media_url text not null default '',
  add column if not exists cta_label text not null default '',
  add column if not exists cta_url text not null default '';
