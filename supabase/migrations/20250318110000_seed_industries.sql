-- Seed industries
insert into public.industries (name) values
  ('Real Estate'),
  ('Crypto'),
  ('Marketing'),
  ('Gardening'),
  ('Legal'),
  ('Other')
on conflict (name) do nothing;
