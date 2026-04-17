-- Public, link-shareable "Promotion Plans".
--
-- A promotion plan is a collaborative proposal page identified by a
-- short, URL-safe slug (e.g. /plan/spring-launch-9f2). Anyone who knows
-- the slug can:
--   * read the plan and all of its profiles, content pieces, and comments
--   * append a new comment (top-level OR per-content-piece, post / ad)
--   * add a new platform profile or content piece
--
-- Only the owning admin (the Whop user who created the plan) can:
--   * edit the plan-level fields (intro, objective, budget, estimates, …)
--   * change post/ad approval status on a content piece
--   * delete platforms or content pieces
--   * attach a ShotStack template to render in the canvas at the bottom
--
-- All access is mediated by API routes using the service-role key; RLS is
-- enabled on every table but no permissive policies are added, mirroring
-- the convention already used by `public.users`, `public.workflows`, etc.

create table if not exists public.promotion_plans (
  -- Slug doubles as the public URL token (lowercase letters, digits, dashes).
  -- Length cap is intentionally loose so the admin can use either short
  -- random ids ("ax9k") or human-friendly slugs ("spring-launch-2026").
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
  admin_user_id uuid references public.users(id) on delete set null,
  intro text not null default '',
  objective text not null default 'Leads',
  objective_description text not null default '',
  budget_type text not null default 'monthly' check (budget_type in ('monthly', 'fixed')),
  daily_budget numeric not null default 0 check (daily_budget >= 0),
  end_date date,
  estimates jsonb not null default '{}'::jsonb,
  shotstack_template_id uuid references public.shotstack_templates(id) on delete set null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists promotion_plans_admin_idx
  on public.promotion_plans (admin_user_id)
  where admin_user_id is not null;

alter table public.promotion_plans enable row level security;

comment on table public.promotion_plans is
  'Public link-shareable promotion plan. id is the URL slug; anyone who knows it can read & contribute (via the API). Only admin_user_id can edit plan-level fields.';

create table if not exists public.promotion_plan_platforms (
  id uuid primary key default gen_random_uuid(),
  plan_id text not null references public.promotion_plans(id) on delete cascade,
  name text not null check (length(name) between 1 and 64),
  followers integer not null default 0 check (followers >= 0),
  position integer not null default 0,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz default now() not null
);

create index if not exists promotion_plan_platforms_plan_idx
  on public.promotion_plan_platforms (plan_id, position, created_at);

alter table public.promotion_plan_platforms enable row level security;

create table if not exists public.promotion_plan_content (
  id uuid primary key default gen_random_uuid(),
  plan_id text not null references public.promotion_plans(id) on delete cascade,
  platform_id uuid not null references public.promotion_plan_platforms(id) on delete cascade,
  is_post boolean not null default true,
  is_ad boolean not null default false,
  post_status text not null default 'pending' check (post_status in ('pending', 'approved', 'rejected')),
  ad_status text not null default 'pending' check (ad_status in ('pending', 'approved', 'rejected')),
  ad_budget_mode text not null default 'dynamic' check (ad_budget_mode in ('dynamic', 'fixed')),
  ad_budget_amount numeric not null default 0 check (ad_budget_amount >= 0),
  -- { age, gender, location, interests } – free-form, validated by the API
  targeting jsonb not null default '{}'::jsonb,
  position integer not null default 0,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz default now() not null
);

create index if not exists promotion_plan_content_plan_idx
  on public.promotion_plan_content (plan_id, platform_id, position, created_at);

alter table public.promotion_plan_content enable row level security;

create table if not exists public.promotion_plan_comments (
  id uuid primary key default gen_random_uuid(),
  plan_id text not null references public.promotion_plans(id) on delete cascade,
  -- Null content_id => the comment belongs to the plan as a whole.
  content_id uuid references public.promotion_plan_content(id) on delete cascade,
  -- Which "thread" this comment belongs to on the parent content piece.
  -- For plan-level comments (content_id is null) the value is forced to
  -- 'plan' by the API so we can use a single index.
  kind text not null default 'plan' check (kind in ('plan', 'post', 'ad')),
  author_name text not null default 'Guest' check (length(author_name) between 1 and 80),
  author_user_id uuid references public.users(id) on delete set null,
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz default now() not null,
  -- Plan-level rows must have content_id null + kind 'plan'; per-content
  -- rows must have content_id not null + kind in ('post','ad'). Enforced
  -- here so client bugs can't insert nonsense states.
  constraint promotion_plan_comments_kind_chk check (
    (content_id is null and kind = 'plan')
    or (content_id is not null and kind in ('post', 'ad'))
  )
);

create index if not exists promotion_plan_comments_plan_idx
  on public.promotion_plan_comments (plan_id, created_at)
  where content_id is null;

create index if not exists promotion_plan_comments_content_idx
  on public.promotion_plan_comments (content_id, kind, created_at)
  where content_id is not null;

alter table public.promotion_plan_comments enable row level security;

-- Touch updated_at whenever a child changes so /plan/[id] can be cache-busted.
create or replace function public.touch_promotion_plan_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_plan_id text;
begin
  if (tg_op = 'DELETE') then
    v_plan_id := old.plan_id;
  else
    v_plan_id := new.plan_id;
  end if;
  update public.promotion_plans
     set updated_at = now()
   where id = v_plan_id;
  if (tg_op = 'DELETE') then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_touch_plan_from_platforms on public.promotion_plan_platforms;
create trigger trg_touch_plan_from_platforms
  after insert or update or delete on public.promotion_plan_platforms
  for each row execute function public.touch_promotion_plan_updated_at();

drop trigger if exists trg_touch_plan_from_content on public.promotion_plan_content;
create trigger trg_touch_plan_from_content
  after insert or update or delete on public.promotion_plan_content
  for each row execute function public.touch_promotion_plan_updated_at();

drop trigger if exists trg_touch_plan_from_comments on public.promotion_plan_comments;
create trigger trg_touch_plan_from_comments
  after insert or update or delete on public.promotion_plan_comments
  for each row execute function public.touch_promotion_plan_updated_at();
