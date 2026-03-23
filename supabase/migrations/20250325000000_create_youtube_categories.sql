-- YouTube Data API video category IDs (reference)
create table if not exists public.youtube_categories (
  id smallint primary key,
  category text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.youtube_categories is 'YouTube video category_id values with English labels';

alter table public.youtube_categories enable row level security;

insert into public.youtube_categories (id, category) values
  (1, 'Film & Animation'),
  (2, 'Autos & Vehicles'),
  (15, 'Pets & Animals'),
  (19, 'Travel & Events'),
  (20, 'Gaming'),
  (18, 'Short Movies'),
  (17, 'Sports'),
  (23, 'Comedy'),
  (24, 'Entertainment'),
  (21, 'Videoblogging'),
  (10, 'Music'),
  (22, 'People & Blogs'),
  (31, 'Anime/Animation'),
  (27, 'Education'),
  (29, 'Sci-Fi/Fantasy'),
  (33, 'Action/Adventure'),
  (26, 'Howto & Style'),
  (25, 'News & Politics'),
  (32, 'Action/Adventure'),
  (40, 'Sci-Fi/Fantasy'),
  (42, 'Shorts'),
  (34, 'Comedy'),
  (38, 'Foreign'),
  (39, 'Horror'),
  (36, 'Drama'),
  (30, 'Movies'),
  (43, 'Shows'),
  (28, 'Science & Technology'),
  (35, 'Documentary'),
  (37, 'Family'),
  (41, 'Thriller'),
  (44, 'Trailers')
on conflict (id) do update set
  category = excluded.category,
  updated_at = now();
