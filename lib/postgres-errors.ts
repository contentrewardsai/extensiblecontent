/**
 * Detect Postgres unique constraint violations from Supabase/PostgREST errors.
 * Used for idempotent retries (e.g. concurrent register upserts).
 */
export function isPostgresUniqueViolation(err: unknown): boolean {
	const e = err as { code?: string; message?: string };
	if (e?.code === "23505") return true;
	const m = String(e?.message ?? "").toLowerCase();
	return m.includes("unique") || m.includes("duplicate key");
}
