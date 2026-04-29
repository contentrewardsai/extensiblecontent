-- Consolidate duplicate ghl_locations rows that accumulated when
-- /api/ghl/auto-link inserted a synthetic placeholder row (connection_id
-- pointing at a synthetic ghl_connections row whose company_id is
-- 'loc:<locationId>') BEFORE the real OAuth callback wrote tokens for the
-- same location. The two rows shared a location_id but lived under
-- different connection_ids, so the old (connection_id, location_id)
-- unique constraint didn't dedupe them. Page-context's `.maybeSingle()`
-- silently failed against multiple matches and incorrectly told users to
-- "Activate this location" even when real tokens existed elsewhere.
--
-- This migration runs once to clean up existing data, then replaces the
-- per-connection uniqueness with per-location uniqueness so the same
-- accumulation cannot happen again. The OAuth callback and ghl-link
-- helper are updated in the same change-set to upsert on `location_id`
-- and to garbage-collect synthetic connections after a real OAuth lands.

-- Step 1: For each location_id with multiple rows, migrate every
-- ghl_connection_users membership from the loser connections to the
-- canonical row's connection. The canonical row is the one with the
-- best tokens (non-placeholder beats placeholder, then latest
-- token_expires_at, then most recent updated_at).
DO $$
DECLARE
  loc_rec record;
  canonical_conn uuid;
BEGIN
  FOR loc_rec IN
    SELECT location_id
    FROM public.ghl_locations
    GROUP BY location_id
    HAVING COUNT(*) > 1
  LOOP
    SELECT connection_id INTO canonical_conn
    FROM public.ghl_locations
    WHERE location_id = loc_rec.location_id
    ORDER BY
      CASE WHEN access_token IN ('pending', 'pending-link') THEN 1 ELSE 0 END,
      token_expires_at DESC NULLS LAST,
      updated_at DESC NULLS LAST
    LIMIT 1;

    INSERT INTO public.ghl_connection_users (connection_id, user_id)
    SELECT DISTINCT canonical_conn, cu.user_id
    FROM public.ghl_connection_users cu
    WHERE cu.connection_id IN (
      SELECT connection_id
      FROM public.ghl_locations
      WHERE location_id = loc_rec.location_id
    )
    ON CONFLICT (connection_id, user_id) DO NOTHING;
  END LOOP;
END $$;

-- Step 2: Delete the duplicate location rows, keeping only the canonical
-- row per location_id (same ranking as above).
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY location_id
      ORDER BY
        CASE WHEN access_token IN ('pending', 'pending-link') THEN 1 ELSE 0 END,
        token_expires_at DESC NULLS LAST,
        updated_at DESC NULLS LAST
    ) AS rn
  FROM public.ghl_locations
)
DELETE FROM public.ghl_locations
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Step 3: Garbage-collect synthetic connections that no longer have any
-- locations attached. ghl_connection_users with these connection_ids
-- cascade-delete via the FK. Real Company/Location connections are left
-- untouched.
DELETE FROM public.ghl_connections
WHERE company_id LIKE 'loc:%'
  AND NOT EXISTS (
    SELECT 1
    FROM public.ghl_locations
    WHERE connection_id = ghl_connections.id
  );

-- Step 4: Replace the (connection_id, location_id) unique constraint
-- with a (location_id) unique index. A location_id is globally unique
-- in HighLevel so it should be globally unique here too — at most one
-- row per location_id, no matter which connection currently owns it.
ALTER TABLE public.ghl_locations
  DROP CONSTRAINT IF EXISTS ghl_locations_connection_id_location_id_key;
DROP INDEX IF EXISTS public.ghl_locations_connection_id_location_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS ghl_locations_location_id_uniq
  ON public.ghl_locations (location_id);
