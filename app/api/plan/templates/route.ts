import { getServiceSupabase } from "@/lib/supabase-service";

/**
 * GET /api/plan/templates
 *
 * **Public.** Returns every ShotStack template in the system as a
 * minimal `{ id, name }` list so the open `/plan/<slug>` page can offer
 * a template picker without requiring the visitor to be logged in.
 *
 * Intentionally excludes the `edit` JSON, `user_id`, and any other
 * potentially sensitive fields — the chosen template's `edit` is loaded
 * server-side via `getPlanWithDetails` once attached to a plan.
 */
export async function GET() {
	const supabase = getServiceSupabase();
	const { data, error } = await supabase
		.from("shotstack_templates")
		.select("id, name, updated_at")
		.order("updated_at", { ascending: false });

	if (error) return Response.json({ error: error.message }, { status: 500 });
	return Response.json(
		(data ?? []).map((t) => ({ id: t.id, name: t.name })),
	);
}
