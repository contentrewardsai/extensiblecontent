-- YouTube monetization / reporting country codes (ISO 3166-1 alpha-2)
create table if not exists public.youtube_countries (
  code text primary key check (char_length(code) = 2 and code = upper(code)),
  country_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.youtube_countries is 'ISO 3166-1 alpha-2 codes supported for YouTube country targeting; country_name optional for display';

alter table public.youtube_countries enable row level security;

insert into public.youtube_countries (code) values
  ('AU'), ('BH'), ('BD'), ('DZ'), ('BE'), ('BR'), ('AT'), ('AM'), ('BG'), ('BA'),
  ('AZ'), ('BY'), ('BO'), ('BS'), ('CO'), ('HR'), ('CL'), ('CA'), ('CR'), ('CZ'),
  ('DO'), ('EC'), ('DK'), ('CY'), ('KH'), ('GE'), ('EE'), ('JM'), ('LU'), ('NG'),
  ('AE'), ('JO'), ('KW'), ('ME'), ('NA'), ('TW'), ('JP'), ('MK'), ('OM'), ('RU'),
  ('SA'), ('LY'), ('NI'), ('PR'), ('LV'), ('PY'), ('LT'), ('SN'), ('HK'), ('LI'),
  ('GH'), ('KR'), ('ZW'), ('SV'), ('IQ'), ('MY'), ('GI'), ('LK'), ('TH'), ('SE'),
  ('NL'), ('RS'), ('FI'), ('FR'), ('DE'), ('IE'), ('KE'), ('PH'), ('PE'), ('YE'),
  ('ID'), ('IN'), ('HN'), ('HU'), ('MX'), ('NZ'), ('GB'), ('UG'), ('MT'), ('NP'),
  ('PK'), ('PA'), ('QA'), ('RO'), ('VC'), ('LB'), ('SI'), ('LA'), ('MA'), ('PT'),
  ('CH'), ('ES'), ('GR'), ('SG'), ('SK'), ('US'), ('UY'), ('GT'), ('PL'), ('TR'),
  ('TN'), ('EG'), ('VN'), ('IL'), ('IT'), ('KZ'), ('ZA'), ('TZ')
on conflict (code) do nothing;
