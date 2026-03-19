-- Add has_upgraded boolean to users table
alter table public.users add column if not exists has_upgraded boolean default false not null;

comment on column public.users.has_upgraded is 'Whether user has upgraded (e.g. via Whop payment)';
