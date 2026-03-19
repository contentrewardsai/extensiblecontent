import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { getShotStackStatus } from "@/lib/shotstack";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

/**
 * GET: Check ShotStack render status.
 * Query: ?env=stage|v1
 * Verifies render belongs to user via shotstack_renders; updates DB when done.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { id } = await params;
	const env = (request.nextUrl.searchParams.get("env") as "stage" | "v1") ?? "v1";

	const supabase = getSupabase();
	const { data: render } = await supabase
		.from("shotstack_renders")
		.select("id")
		.eq("shotstack_render_id", id)
		.eq("user_id", user.user_id)
		.single();

	if (!render) {
		return Response.json({ error: "Render not found" }, { status: 404 });
	}

	const status = await getShotStackStatus(id, { env });
	if (!status) {
		return Response.json({ error: "ShotStack not configured or render not found" }, { status: 404 });
	}

	if (status.status === "done" && status.url) {
		await supabase
			.from("shotstack_renders")
			.update({ status: status.status, output_url: status.url, updated_at: new Date().toISOString() })
			.eq("shotstack_render_id", id)
			.eq("user_id", user.user_id);
	}

	return Response.json({
		id: status.id,
		status: status.status,
		url: status.url,
		error: status.error,
	});
}
