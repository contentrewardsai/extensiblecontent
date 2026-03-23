-- Holiday types lookup + holidays (reference data)
create table if not exists public.holiday_types (
  code text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

comment on table public.holiday_types is 'Categories for holidays (e.g. US federal, UN, environmental)';

alter table public.holiday_types enable row level security;

insert into public.holiday_types (code, name) values
  ('US', 'United States'),
  ('Environmental', 'Environmental'),
  ('International', 'International'),
  ('Religious', 'Religious'),
  ('UN', 'United Nations')
on conflict (code) do nothing;

create table if not exists public.holidays (
  id uuid primary key,
  holiday_type_code text not null references public.holiday_types (code) on delete restrict,
  month smallint,
  day smallint,
  rule_day smallint,
  weekday_number text,
  weekday_name text,
  description text not null,
  weight smallint not null default 5,
  link text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.holidays is 'Observances with fixed dates and/or nth-weekday rules; some rows omit month/day (e.g. lunar or computed holidays)';

create index if not exists holidays_holiday_type_code_idx on public.holidays (holiday_type_code);
create index if not exists holidays_month_day_idx on public.holidays (month, day);

alter table public.holidays enable row level security;

insert into public.holidays (
  id, holiday_type_code, month, day, rule_day, weekday_number, weekday_name, description, weight, link
) values
  ('e37dd820-249c-5313-8723-71d38ae3f7ef', 'US', 1, 1, 1, NULL, NULL, 'New Year''s Day', 10, 'https://en.wikipedia.org/wiki/New_Year%27s_Day'),
  ('4e7c83e6-e314-5fca-97e3-c406a77b3c65', 'US', 1, NULL, NULL, '3', 'Monday', 'Martin Luther King Jr. Day', 10, 'https://en.wikipedia.org/wiki/Martin_Luther_King_Jr._Day'),
  ('e2e764c9-4b92-58aa-8b19-ca33cfb7caca', 'US', 2, NULL, NULL, '3', 'Monday', 'Presidents'' Day', 10, 'https://en.wikipedia.org/wiki/Presidents%27_Day'),
  ('0f80f0f2-834c-5102-b4cf-668490132d4d', 'US', 5, NULL, NULL, 'last', 'Monday', 'Memorial Day', 10, 'https://en.wikipedia.org/wiki/Memorial_Day'),
  ('b8434fdd-425f-5503-a361-6db1c5c2d3cc', 'US', 6, 19, 19, NULL, NULL, 'Juneteenth', 10, 'https://en.wikipedia.org/wiki/Juneteenth'),
  ('0b797ebb-feb5-5f3c-a79b-01c63102df4d', 'US', 7, 4, 4, NULL, NULL, 'Independence Day', 10, 'https://en.wikipedia.org/wiki/Independence_Day_(United_States)'),
  ('300f6bb1-f1c4-5ee2-a5a7-44237433ada4', 'US', 9, NULL, NULL, '1', 'Monday', 'Labor Day', 10, 'https://en.wikipedia.org/wiki/Labor_Day'),
  ('c645f099-166e-53e4-a587-e9704468140d', 'US', 10, NULL, NULL, '2', 'Monday', 'Indigenous Peoples'' Day', 10, 'https://en.wikipedia.org/wiki/Indigenous_Peoples%27_Day'),
  ('3a3cf296-976a-55c7-bb9c-61e60b0c99ac', 'US', 11, 11, 11, NULL, NULL, 'Veterans Day', 10, 'https://en.wikipedia.org/wiki/Veterans_Day'),
  ('cb929ff0-1152-53e5-893c-02cda2258874', 'US', 11, NULL, NULL, '4', 'Thursday', 'Thanksgiving Day', 10, 'https://en.wikipedia.org/wiki/Thanksgiving'),
  ('dcfb97c2-2196-555e-bf43-dbb4eb92a9a5', 'US', 12, 25, 25, NULL, NULL, 'Christmas Day', 10, 'https://en.wikipedia.org/wiki/Christmas'),
  ('0623b55f-1368-50f2-b1af-4bfc78d586de', 'US', 2, 2, 2, NULL, NULL, 'Groundhog Day', 5, 'https://en.wikipedia.org/wiki/Groundhog_Day'),
  ('40ad94a1-383c-51eb-b350-347a44697598', 'US', 2, 14, 14, NULL, NULL, 'Valentine''s Day', 5, 'https://en.wikipedia.org/wiki/Valentine%27s_Day'),
  ('ca7ba88f-bf00-50c6-9354-bfb9a3b390a5', 'US', 3, 17, 17, NULL, NULL, 'Saint Patrick''s Day', 5, 'https://en.wikipedia.org/wiki/Saint_Patrick%27s_Day'),
  ('cf7036b9-2355-5615-b48e-2d2129460c83', 'US', 4, 1, 1, NULL, NULL, 'April Fools'' Day', 5, 'https://en.wikipedia.org/wiki/April_Fools%27_Day'),
  ('70bfe3a6-8626-506c-b136-c5bf3f75adcd', 'US', 5, 5, 5, NULL, NULL, 'Cinco de Mayo', 5, 'https://en.wikipedia.org/wiki/Cinco_de_Mayo'),
  ('d4b2b292-43de-58fa-8012-203aa7a44e15', 'US', 5, NULL, NULL, '2', 'Sunday', 'Mother''s Day', 5, 'https://en.wikipedia.org/wiki/Mother%27s_Day'),
  ('5b025925-66fb-598f-9807-2c6bfb10edb1', 'US', 6, NULL, NULL, '3', 'Sunday', 'Father''s Day', 5, 'https://en.wikipedia.org/wiki/Father%27s_Day'),
  ('9f079b38-43db-5275-9e86-4d42ffd5815e', 'US', 6, 14, 14, NULL, NULL, 'Flag Day', 5, 'https://en.wikipedia.org/wiki/Flag_Day_(United_States)'),
  ('8c02f117-7b86-5bb3-9ac7-909ca11c94a1', 'US', 10, 31, 31, NULL, NULL, 'Halloween', 5, 'https://en.wikipedia.org/wiki/Halloween'),
  ('00330263-776f-5a30-8a7b-1b27b941c91b', 'Environmental', 2, 27, 27, NULL, NULL, 'International Polar Bear Day', 5, 'https://en.wikipedia.org/wiki/Polar_bear'),
  ('024f8506-9962-5822-9be7-58146036a130', 'Environmental', 2, 2, 2, NULL, NULL, 'World Wetlands Day', 5, 'https://en.wikipedia.org/wiki/World_Wetlands_Day'),
  ('914c664c-10bb-5ffe-858c-655322071c87', 'Environmental', 2, 14, 14, NULL, NULL, 'World Bonobo Day', 5, 'https://en.wikipedia.org/wiki/Bonobo'),
  ('7a2a84e1-2785-54ce-9059-ea67190fbdc4', 'Environmental', 3, 3, 3, NULL, NULL, 'World Wildlife Day', 5, 'https://en.wikipedia.org/wiki/World_Wildlife_Day'),
  ('4f28aaeb-a9a8-51ec-85d0-ba765a50995d', 'Environmental', 3, 21, 21, NULL, NULL, 'International Day of Forests', 5, 'https://en.wikipedia.org/wiki/International_Day_of_Forests'),
  ('f4f59af7-91db-56ae-925d-d0d71a5c15fc', 'Environmental', 3, 22, 22, NULL, NULL, 'World Water Day', 5, 'https://en.wikipedia.org/wiki/World_Water_Day'),
  ('d03909c9-d694-5b11-93a5-0af0430b6acb', 'Environmental', 3, 23, 23, NULL, NULL, 'World Meteorological Day', 5, 'https://en.wikipedia.org/wiki/World_Meteorological_Day'),
  ('34cf0910-af96-5691-8580-1baf90a834f7', 'Environmental', 4, 22, 22, NULL, NULL, 'Earth Day', 5, 'https://en.wikipedia.org/wiki/Earth_Day'),
  ('3d2b29a9-b2de-51d5-879f-ad2503d81c20', 'Environmental', 5, 10, 10, NULL, NULL, 'World Migratory Bird Day', 5, 'https://en.wikipedia.org/wiki/World_Migratory_Bird_Day'),
  ('65f5ae8c-6107-547a-94b5-3375c30d3060', 'Environmental', 5, 22, 22, NULL, NULL, 'International Day for Biological Diversity', 5, 'https://en.wikipedia.org/wiki/International_Day_for_Biological_Diversity'),
  ('2777f713-e35c-5c47-a856-798f55a588da', 'Environmental', 6, 5, 5, NULL, NULL, 'World Environment Day', 5, 'https://en.wikipedia.org/wiki/World_Environment_Day'),
  ('81003cc1-8d67-5fb9-8a3c-ad27ba16c046', 'Environmental', 6, 8, 8, NULL, NULL, 'World Oceans Day', 5, 'https://en.wikipedia.org/wiki/World_Oceans_Day'),
  ('bcf8282c-8ec1-50e1-9446-8cba542e6bf1', 'Environmental', 6, 15, 15, NULL, NULL, 'Global Wind Day', 5, 'https://en.wikipedia.org/wiki/Global_Wind_Day'),
  ('c1e124f2-a2e4-53b1-92d1-68b486223eb1', 'Environmental', 6, 17, 17, NULL, NULL, 'World Day to Combat Desertification', 5, 'https://en.wikipedia.org/wiki/International_Day_to_Combat_Desertification_and_Drought'),
  ('33283f44-d9c9-5659-9629-4618800784b4', 'Environmental', 7, 11, 11, NULL, NULL, 'World Population Day', 5, 'https://en.wikipedia.org/wiki/World_Population_Day'),
  ('c10ae5de-9f71-58eb-aedd-301e7d78597f', 'Environmental', 9, 16, 16, NULL, NULL, 'International Day for the Preservation of the Ozone Layer', 5, 'https://en.wikipedia.org/wiki/Ozone_layer'),
  ('4431d3d8-0156-5635-9f1d-32b31f40f7f3', 'Environmental', 9, 22, 22, NULL, NULL, 'World Car Free Day', 5, 'https://en.wikipedia.org/wiki/Car-Free_Day'),
  ('101856dd-c526-5745-8d35-61175a5528c0', 'Environmental', 10, 4, 4, NULL, NULL, 'World Animal Day', 5, 'https://en.wikipedia.org/wiki/World_Animal_Day'),
  ('10d4e930-6ada-58c3-87c0-041ac1e51646', 'Environmental', 10, 13, 13, NULL, NULL, 'International Day for Disaster Risk Reduction', 5, 'https://en.wikipedia.org/wiki/International_Day_for_Disaster_Risk_Reduction'),
  ('2155128a-1868-5c5d-b571-671ebd74e44e', 'Environmental', 11, 6, 6, NULL, NULL, 'International Day for Preventing Exploitation of Environment in War', 5, 'https://en.wikipedia.org/wiki/International_Day_for_Preventing_the_Exploitation_of_the_Environment_in_War_and_Armed_Conflict'),
  ('a15f643b-b726-5807-aaa4-10955b606ea0', 'Environmental', 11, 13, 13, NULL, NULL, 'World Kindness Day', 5, 'https://en.wikipedia.org/wiki/World_Kindness_Day'),
  ('ae76fdd2-d73b-527e-bd89-456fc26c7a65', 'Environmental', 12, 5, 5, NULL, NULL, 'World Soil Day', 5, 'https://en.wikipedia.org/wiki/World_Soil_Day'),
  ('e6a887c1-ee62-5bc1-86a1-ab4a5b8efc57', 'Environmental', 12, 11, 11, NULL, NULL, 'International Mountain Day', 5, 'https://en.wikipedia.org/wiki/International_Mountain_Day'),
  ('6ae9032a-e6c5-5bbe-b8d9-d9218ddd32a8', 'International', 1, 26, 26, NULL, NULL, 'International Customs Day', 5, 'https://en.wikipedia.org/wiki/International_Customs_Day'),
  ('2dad849d-85e7-530e-8931-5839180421e3', 'International', 1, 27, 27, NULL, NULL, 'International Holocaust Remembrance Day', 5, 'https://en.wikipedia.org/wiki/International_Holocaust_Remembrance_Day'),
  ('3de2d531-0dc5-5cc5-8e2d-13d37de4398f', 'International', 2, 4, 4, NULL, NULL, 'World Cancer Day', 5, 'https://en.wikipedia.org/wiki/World_Cancer_Day'),
  ('2d78f9f8-9774-5150-9f32-02e0b626c184', 'International', 2, 20, 20, NULL, NULL, 'World Day of Social Justice', 5, 'https://en.wikipedia.org/wiki/World_Day_of_Social_Justice'),
  ('81ac402f-16fa-5833-bc06-a6f91dfd6352', 'International', 3, 8, 8, NULL, NULL, 'International Women''s Day', 5, 'https://en.wikipedia.org/wiki/International_Women%27s_Day'),
  ('0058363f-313c-5336-9d10-a7bd312ba8be', 'International', 3, 15, 15, NULL, NULL, 'World Consumer Rights Day', 5, 'https://en.wikipedia.org/wiki/World_Consumer_Rights_Day'),
  ('a79d1a08-efff-5e64-a49c-8f5fdf951eb0', 'International', 3, 20, 20, NULL, NULL, 'International Day of Happiness', 5, 'https://en.wikipedia.org/wiki/International_Day_of_Happiness'),
  ('6c8d5807-5980-5888-a44d-486df7d266b5', 'International', 3, 21, 21, NULL, NULL, 'International Day for the Elimination of Racial Discrimination', 5, 'https://en.wikipedia.org/wiki/International_Day_for_the_Elimination_of_Racial_Discrimination'),
  ('d39dfe1d-7fdc-5e97-9db1-d4242cc6c2e5', 'International', 4, 2, 2, NULL, NULL, 'World Autism Awareness Day', 5, 'https://en.wikipedia.org/wiki/World_Autism_Awareness_Day'),
  ('c1aa7e6c-2148-5e63-b709-85a8d285235a', 'International', 4, 7, 7, NULL, NULL, 'World Health Day', 5, 'https://en.wikipedia.org/wiki/World_Health_Day'),
  ('f9e33c28-3d5f-5495-8ccc-c068eab5098f', 'International', 4, 21, 21, NULL, NULL, 'World Creativity and Innovation Day', 5, 'https://en.wikipedia.org/wiki/World_Creativity_and_Innovation_Day'),
  ('803c29dc-c66e-56ff-8be1-8f1478d6dc61', 'International', 5, 1, 1, NULL, NULL, 'International Workers'' Day', 5, 'https://en.wikipedia.org/wiki/International_Workers%27_Day'),
  ('493087d6-9394-5d97-9e22-73898b7b4ddd', 'International', 5, 15, 15, NULL, NULL, 'International Day of Families', 5, 'https://en.wikipedia.org/wiki/International_Day_of_Families'),
  ('a97ba559-51da-5ad7-a21f-7d19ab5ab187', 'International', 5, 21, 21, NULL, NULL, 'World Day for Cultural Diversity', 5, 'https://en.wikipedia.org/wiki/World_Day_for_Cultural_Diversity_for_Dialogue_and_Development'),
  ('eda282eb-4836-54df-bf88-6e0a7f8a5b5b', 'International', 5, 31, 31, NULL, NULL, 'World No Tobacco Day', 5, 'https://en.wikipedia.org/wiki/World_No_Tobacco_Day'),
  ('2d2524f5-ad70-5d68-a3fa-05fd7550af25', 'International', 6, 4, 4, NULL, NULL, 'International Day of Innocent Children Victims of Aggression', 5, 'https://en.wikipedia.org/wiki/International_Day_of_Innocent_Children_Victims_of_Aggression'),
  ('a5f653b3-0439-54fb-9dc8-3a4f9be0b0ba', 'International', 6, 20, 20, NULL, NULL, 'World Refugee Day', 5, 'https://en.wikipedia.org/wiki/World_Refugee_Day'),
  ('7e317ea8-85b5-5095-bc7a-a7bd30498dc0', 'International', 7, 30, 30, NULL, NULL, 'World Day Against Trafficking in Persons', 5, 'https://en.wikipedia.org/wiki/Human_trafficking'),
  ('66dcde40-bce0-5fb0-b977-386852b486f4', 'International', 8, 9, 9, NULL, NULL, 'International Day of the World''s Indigenous Peoples', 5, 'https://en.wikipedia.org/wiki/International_Day_of_the_World%27s_Indigenous_Peoples'),
  ('17ef1562-d393-5723-b5cf-0b714da2363b', 'International', 8, 12, 12, NULL, NULL, 'International Youth Day', 5, 'https://en.wikipedia.org/wiki/International_Youth_Day'),
  ('2bd82d44-2de7-5a64-a887-33a29c61b04a', 'International', 8, 19, 19, NULL, NULL, 'World Humanitarian Day', 5, 'https://en.wikipedia.org/wiki/World_Humanitarian_Day'),
  ('dc8a0193-38dd-5a30-8cc1-0bb3ce555778', 'International', 9, 5, 5, NULL, NULL, 'International Day of Charity', 5, 'https://en.wikipedia.org/wiki/International_Day_of_Charity'),
  ('17c0d8c0-d73e-5350-8a93-0942101cb9c7', 'International', 9, 21, 21, NULL, NULL, 'International Day of Peace', 5, 'https://en.wikipedia.org/wiki/International_Day_of_Peace'),
  ('5349b40c-0fb7-5b4f-b52e-bd79cf6d5c02', 'International', 10, 1, 1, NULL, NULL, 'International Day of Older Persons', 5, 'https://en.wikipedia.org/wiki/International_Day_of_Older_Persons'),
  ('799bf4f8-b92e-54c3-be2b-80ec02351c89', 'International', 10, 11, 11, NULL, NULL, 'International Day of the Girl Child', 5, 'https://en.wikipedia.org/wiki/International_Day_of_the_Girl_Child'),
  ('064f0d4b-83d2-53e3-a2d0-dcb5344cfe2e', 'International', 10, 16, 16, NULL, NULL, 'World Food Day', 5, 'https://en.wikipedia.org/wiki/World_Food_Day'),
  ('a7c7f93f-4a6a-51f5-a0f3-9a2050244902', 'International', 11, 14, 14, NULL, NULL, 'World Diabetes Day', 5, 'https://en.wikipedia.org/wiki/Diabetes'),
  ('2ab072e1-7b75-5f99-a32b-939c9c26833c', 'International', 11, 20, 20, NULL, NULL, 'World Children''s Day', 5, 'https://en.wikipedia.org/wiki/Universal_Children%27s_Day'),
  ('57c5e80b-05cb-5a1e-acff-407afedb60d3', 'International', 12, 1, 1, NULL, NULL, 'World AIDS Day', 5, 'https://en.wikipedia.org/wiki/World_AIDS_Day'),
  ('fc3a31a3-117e-51c4-9462-a0f21b369445', 'International', 12, 3, 3, NULL, NULL, 'International Day of Persons with Disabilities', 5, 'https://en.wikipedia.org/wiki/International_Day_of_Persons_with_Disabilities'),
  ('e61e844a-2ace-50e1-8e17-16cd5f2e5318', 'International', 12, 10, 10, NULL, NULL, 'Human Rights Day', 5, 'https://en.wikipedia.org/wiki/Human_Rights_Day'),
  ('3ac76f26-d5be-5d64-989f-96d769b5ed0a', 'International', 12, 18, 18, NULL, NULL, 'International Migrants Day', 5, 'https://en.wikipedia.org/wiki/International_Migrants_Day'),
  ('9d095129-72fb-5403-a728-59498fb050db', 'UN', 4, 26, 26, NULL, NULL, 'International Chernobyl Disaster Remembrance Day', 5, 'https://en.wikipedia.org/wiki/Chernobyl_disaster'),
  ('06d046b3-39f4-56ee-9519-cfa9379d53bd', 'UN', 5, 8, 8, NULL, NULL, 'Time of Remembrance and Reconciliation (Second World War)', 5, 'https://en.wikipedia.org/wiki/Time_of_Remembrance_and_Reconciliation_for_Those_Who_Lost_Their_Lives_during_the_Second_World_War'),
  ('8e1b90f7-243a-5028-8954-a585b8310a07', 'UN', 10, 24, 24, NULL, NULL, 'United Nations Day', 5, 'https://en.wikipedia.org/wiki/United_Nations_Day'),
  ('9276e0cd-4cac-591a-b190-4e0cf67484e0', 'UN', 12, 27, 27, NULL, NULL, 'International Day of Epidemic Preparedness', 5, 'https://en.wikipedia.org/wiki/International_Day_of_Epidemic_Preparedness'),
  ('bf98e7de-09a0-5b9b-9944-f9e5e0281f3b', 'Religious', NULL, NULL, NULL, NULL, NULL, 'Easter Sunday', 10, 'https://en.wikipedia.org/wiki/Easter'),
  ('d4c73027-548b-5865-886d-8fbfb858eb51', 'Religious', NULL, NULL, NULL, NULL, NULL, 'Good Friday', 10, 'https://en.wikipedia.org/wiki/Good_Friday'),
  ('4c4a2ca5-8a5c-51fa-93c6-8330ab592983', 'Religious', NULL, NULL, NULL, NULL, NULL, 'Ramadan (month, lunar calendar)', 5, 'https://en.wikipedia.org/wiki/Ramadan'),
  ('1219ebed-6269-5b25-97d5-57dcd6a6ddd1', 'Religious', NULL, NULL, NULL, NULL, NULL, 'Eid al-Fitr (lunar)', 5, 'https://en.wikipedia.org/wiki/Eid_al-Fitr'),
  ('5defd113-c59f-50ac-83eb-26d106a37d79', 'Religious', NULL, NULL, NULL, NULL, NULL, 'Eid al-Adha (lunar)', 5, 'https://en.wikipedia.org/wiki/Eid_al-Adha'),
  ('690afdd4-0364-5dcf-a9e8-86ec12a1b6f8', 'Religious', NULL, NULL, NULL, NULL, NULL, 'Hanukkah (lunar)', 5, 'https://en.wikipedia.org/wiki/Hanukkah'),
  ('e2eb8f7d-e5fc-562c-87ac-dc5e4e6323f6', 'Religious', NULL, NULL, NULL, NULL, NULL, 'Diwali (lunar)', 5, 'https://en.wikipedia.org/wiki/Diwali'),
  ('e5fdafc5-f4bc-5428-853e-fca862daeadc', 'Religious', NULL, NULL, NULL, NULL, NULL, 'Yom Kippur (lunar)', 5, 'https://en.wikipedia.org/wiki/Yom_Kippur'),
  ('04c62862-12d4-507c-90f7-d802bb75d665', 'Religious', NULL, NULL, NULL, NULL, NULL, 'Rosh Hashanah (lunar)', 5, 'https://en.wikipedia.org/wiki/Rosh_Hashanah'),
  ('94db4960-d33c-5e39-ae68-dd6e37d753f7', 'Religious', NULL, NULL, NULL, NULL, NULL, 'Orthodox Easter', 5, 'https://en.wikipedia.org/wiki/Eastern_Orthodox_liturgical_calendar')
on conflict (id) do update set
  holiday_type_code = excluded.holiday_type_code,
  month = excluded.month,
  day = excluded.day,
  rule_day = excluded.rule_day,
  weekday_number = excluded.weekday_number,
  weekday_name = excluded.weekday_name,
  description = excluded.description,
  weight = excluded.weight,
  link = excluded.link,
  updated_at = now();
