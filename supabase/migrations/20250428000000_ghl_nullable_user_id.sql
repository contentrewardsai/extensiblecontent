-- Allow GHL-initiated app installs to store OAuth tokens before a Whop user is linked.
-- The user_id is set later when the user enters their Connection Key (one-time linking).

-- 1. Make user_id nullable on ghl_connections
ALTER TABLE public.ghl_connections ALTER COLUMN user_id DROP NOT NULL;

-- 2. Replace the (user_id, company_id) unique constraint with just (company_id)
--    since each GHL company should only be linked to one Whop user.
ALTER TABLE public.ghl_connections DROP CONSTRAINT IF EXISTS ghl_connections_user_id_company_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS ghl_connections_company_id_uniq ON public.ghl_connections (company_id);

-- 3. Make user_id nullable on ghl_locations
ALTER TABLE public.ghl_locations ALTER COLUMN user_id DROP NOT NULL;
