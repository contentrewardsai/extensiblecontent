-- English display names for ISO codes (idempotent upsert)
insert into public.youtube_countries (code, country_name) values
  ('AU', 'Australia'), ('BH', 'Bahrain'), ('BD', 'Bangladesh'), ('DZ', 'Algeria'), ('BE', 'Belgium'),
  ('BR', 'Brazil'), ('AT', 'Austria'), ('AM', 'Armenia'), ('BG', 'Bulgaria'), ('BA', 'Bosnia and Herzegovina'),
  ('AZ', 'Azerbaijan'), ('BY', 'Belarus'), ('BO', 'Bolivia'), ('BS', 'Bahamas'), ('CO', 'Colombia'),
  ('HR', 'Croatia'), ('CL', 'Chile'), ('CA', 'Canada'), ('CR', 'Costa Rica'), ('CZ', 'Czechia'),
  ('DO', 'Dominican Republic'), ('EC', 'Ecuador'), ('DK', 'Denmark'), ('CY', 'Cyprus'), ('KH', 'Cambodia'),
  ('GE', 'Georgia'), ('EE', 'Estonia'), ('JM', 'Jamaica'), ('LU', 'Luxembourg'), ('NG', 'Nigeria'),
  ('AE', 'United Arab Emirates'), ('JO', 'Jordan'), ('KW', 'Kuwait'), ('ME', 'Montenegro'), ('NA', 'Namibia'),
  ('TW', 'Taiwan'), ('JP', 'Japan'), ('MK', 'North Macedonia'), ('OM', 'Oman'), ('RU', 'Russia'),
  ('SA', 'Saudi Arabia'), ('LY', 'Libya'), ('NI', 'Nicaragua'), ('PR', 'Puerto Rico'), ('LV', 'Latvia'),
  ('PY', 'Paraguay'), ('LT', 'Lithuania'), ('SN', 'Senegal'), ('HK', 'Hong Kong'), ('LI', 'Liechtenstein'),
  ('GH', 'Ghana'), ('KR', 'South Korea'), ('ZW', 'Zimbabwe'), ('SV', 'El Salvador'), ('IQ', 'Iraq'),
  ('MY', 'Malaysia'), ('GI', 'Gibraltar'), ('LK', 'Sri Lanka'), ('TH', 'Thailand'), ('SE', 'Sweden'),
  ('NL', 'Netherlands'), ('RS', 'Serbia'), ('FI', 'Finland'), ('FR', 'France'), ('DE', 'Germany'),
  ('IE', 'Ireland'), ('KE', 'Kenya'), ('PH', 'Philippines'), ('PE', 'Peru'), ('YE', 'Yemen'),
  ('ID', 'Indonesia'), ('IN', 'India'), ('HN', 'Honduras'), ('HU', 'Hungary'), ('MX', 'Mexico'),
  ('NZ', 'New Zealand'), ('GB', 'United Kingdom'), ('UG', 'Uganda'), ('MT', 'Malta'), ('NP', 'Nepal'),
  ('PK', 'Pakistan'), ('PA', 'Panama'), ('QA', 'Qatar'), ('RO', 'Romania'), ('VC', 'Saint Vincent and the Grenadines'),
  ('LB', 'Lebanon'), ('SI', 'Slovenia'), ('LA', 'Laos'), ('MA', 'Morocco'), ('PT', 'Portugal'),
  ('CH', 'Switzerland'), ('ES', 'Spain'), ('GR', 'Greece'), ('SG', 'Singapore'), ('SK', 'Slovakia'),
  ('US', 'United States'), ('UY', 'Uruguay'), ('GT', 'Guatemala'), ('PL', 'Poland'), ('TR', 'Turkey'),
  ('TN', 'Tunisia'), ('EG', 'Egypt'), ('VN', 'Vietnam'), ('IL', 'Israel'), ('IT', 'Italy'),
  ('KZ', 'Kazakhstan'), ('ZA', 'South Africa'), ('TZ', 'Tanzania')
on conflict (code) do update set
  country_name = excluded.country_name,
  updated_at = now();
