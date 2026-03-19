-- BYOK and JWT cache for upload_post_accounts
-- - upload_post_api_key_encrypted: user's API key when uses_own_key=true (plain for now; encrypt later)
-- - jwt_access_url: cached JWT URL (valid 48h)
-- - jwt_expires_at: when the cached JWT expires

alter table public.upload_post_accounts add column if not exists upload_post_api_key_encrypted text;
alter table public.upload_post_accounts add column if not exists jwt_access_url text;
alter table public.upload_post_accounts add column if not exists jwt_expires_at timestamptz;

comment on column public.upload_post_accounts.upload_post_api_key_encrypted is 'BYOK: user-provided Upload-Post API key (plain for now; TODO encrypt)';
comment on column public.upload_post_accounts.jwt_access_url is 'Cached JWT access URL for connect flow (valid 48h)';
comment on column public.upload_post_accounts.jwt_expires_at is 'When the cached JWT expires';
