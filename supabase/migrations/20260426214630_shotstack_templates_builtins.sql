-- Built-in ShotStack templates: allow shotstack_templates rows with no owner
-- so the 7 starter generator templates (seeded from the extension repo) live in
-- the same table and show up for every authenticated extension user.

alter table public.shotstack_templates
  alter column user_id drop not null;

alter table public.shotstack_templates
  add column if not exists is_builtin boolean not null default false,
  add column if not exists source_path text;

-- Every row must either have an owner (user template) or be a built-in starter.
alter table public.shotstack_templates
  drop constraint if exists shotstack_templates_owner_or_builtin_chk;
alter table public.shotstack_templates
  add constraint shotstack_templates_owner_or_builtin_chk
  check (user_id is not null or is_builtin = true);

-- source_path is the extension's template slug (e.g. 'ad-apple-notes'); used by
-- the seed script to upsert idempotently without creating duplicates.
create unique index if not exists shotstack_templates_builtin_source_unique
  on public.shotstack_templates (source_path) where is_builtin = true;

create index if not exists shotstack_templates_is_builtin_idx
  on public.shotstack_templates (is_builtin) where is_builtin = true;

comment on column public.shotstack_templates.is_builtin is
  'True for starter templates seeded from the ExtensibleContentExtension generator. Read-only to end users; editing clones into a user-owned row.';
comment on column public.shotstack_templates.source_path is
  'Stable slug matching generator/templates/<source_path>/template.json in the extension repo. Only used for is_builtin rows so the seed script can upsert by slug.';
