import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { getOrRefreshUploadPostConnectUrl } from "@/lib/upload-post-connect";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { id } = await params;
	let body: { redirect_url?: string; logo_image?: string } = {};
	try {
		body = await request.json();
	} catch {
		// empty body is ok
	}

	const supabase = getSupabase();
	const result = await getOrRefreshUploadPostConnectUrl(supabase, user.user_id, id, body);

	if (!result.ok) {
		return Response.json({ error: result.error }, { status: result.status });
	}

	return Response.json({
		access_url: result.access_url,
		duration: result.duration,
		...(result.cached ? { cached: true } : {}),
	});
}
