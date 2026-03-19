-- Industries reference table (populate manually in Supabase)
create table if not exists public.industries (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz default now()
);

alter table public.industries enable row level security;

-- Platforms reference table (seeded below)
create table if not exists public.platforms (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  created_at timestamptz default now()
);

alter table public.platforms enable row level security;

-- Monetization options reference table (seeded below)
create table if not exists public.monetization_options (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  created_at timestamptz default now()
);

alter table public.monetization_options enable row level security;

-- Projects table
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.projects enable row level security;

create index if not exists projects_user_id_idx on public.projects (user_id);

-- Project-industries junction (many-to-many)
create table if not exists public.project_industries (
  project_id uuid not null references public.projects(id) on delete cascade,
  industry_id uuid not null references public.industries(id) on delete cascade,
  primary key (project_id, industry_id)
);

alter table public.project_industries enable row level security;

-- Project-platforms junction (many-to-many)
create table if not exists public.project_platforms (
  project_id uuid not null references public.projects(id) on delete cascade,
  platform_id uuid not null references public.platforms(id) on delete cascade,
  primary key (project_id, platform_id)
);

alter table public.project_platforms enable row level security;

-- Project-monetization junction (many-to-many)
create table if not exists public.project_monetization (
  project_id uuid not null references public.projects(id) on delete cascade,
  monetization_id uuid not null references public.monetization_options(id) on delete cascade,
  primary key (project_id, monetization_id)
);

alter table public.project_monetization enable row level security;

-- Seed platforms
insert into public.platforms (name, slug) values
  ('Newsletter', 'newsletter'),
  ('Other', 'other'),
  ('Quora', 'quora'),
  ('Reddit', 'reddit'),
  ('SnapChat', 'snapchat'),
  ('bluesky', 'bluesky'),
  ('facebook', 'facebook'),
  ('instagram', 'instagram'),
  ('linkedin', 'linkedin'),
  ('pinterest', 'pinterest'),
  ('threads', 'threads'),
  ('tiktok', 'tiktok'),
  ('twitter', 'twitter'),
  ('youtube', 'youtube')
on conflict (slug) do nothing;

-- Seed monetization options
insert into public.monetization_options (name, slug) values
  ('Ads', 'ads'),
  ('Affiliate Marketing', 'affiliate_marketing'),
  ('Book Sales', 'book_sales'),
  ('Course Sales', 'course_sales'),
  ('Physical Products', 'physical_products'),
  ('Selling Leads', 'selling_leads'),
  ('Services', 'services'),
  ('Software/SAAS Sales', 'software_saas_sales')
on conflict (slug) do nothing;
