-- Allow 1 Upload-Post account per user for testing. Set to 0 to disable; use webhooks to set per-plan.
update public.users set max_upload_post_accounts = 1 where max_upload_post_accounts = 0;
