-- Add thumbnail support to shotstack_templates so the gallery UI can show
-- preview tiles without rendering the Fabric canvas client-side every time.
--
-- thumbnail_url          — public URL of the captured PNG (in the public post-media bucket)
-- thumbnail_updated_at   — timestamp used for cache-busting on the client
alter table public.shotstack_templates
  add column if not exists thumbnail_url text,
  add column if not exists thumbnail_updated_at timestamptz;

comment on column public.shotstack_templates.thumbnail_url is
  'Public URL of the latest captured Fabric-canvas thumbnail. Null if never captured.';
comment on column public.shotstack_templates.thumbnail_updated_at is
  'Last thumbnail capture/upload time. Used as cache-buster when displaying the thumbnail.';
